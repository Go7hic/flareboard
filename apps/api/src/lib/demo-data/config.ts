import {
  computeErrorFingerprint,
  DEMO_TEAM_ID,
  legacySurveyFields,
  surveyAppearanceSchema,
} from '@flareboard/shared';
import type { Env } from '../../env';
import { bumpActionDefinitionsVersion } from '../action-cache';
import { invalidateFeatureFlagCaches } from '../feature-flags';
import { profileFor, type SiteKind } from './catalog';
import { STORE_ERRORS } from './content';
import {
  annotationId,
  boardId,
  CHECKOUT_FLAG,
  CUSTOM_MODEL,
  CUSTOM_MODEL_PRICE,
  demoActions,
  demoCohorts,
  demoFlags,
  demoInsights,
  demoSurveys,
  demoWorkflows,
  DOCS_GOALS,
  errorAlertRuleId,
  experimentId,
  flagId,
  insightId,
  logAlertRuleId,
  notebookId,
  STORE_GOALS,
  surveyId,
  workflowId,
} from './definitions';
import { demoId } from './ids';
import {
  campaignStartDays,
  CAMPAIGNS,
  DAY_MS,
  dayNumber,
  docsReleaseOn,
  HOUR_MS,
  incidentOn,
  isDocsReleaseDay,
  isStoreReleaseDay,
  lastRegressionResolveAt,
  storeReleaseOn,
} from './schedule';

/**
 * Idempotent seeding of the D1 configuration a demo website shows: flags, the checkout
 * experiment, surveys, workflows, actions, cohorts, insights, a board, a notebook, alert rules,
 * annotations and a few website settings. Every object has a deterministic id, so a second run
 * updates the same rows. Objects the generator did not create are never modified: when a flag
 * key or similar is already taken by someone else's object, that definition is skipped.
 *
 * Nothing seeded here can deliver anything: alert rules use the `record` channel, workflows have
 * no webhook / email / Slack step.
 */

export const DEMO_CONFIG_VERSION = 3;
export const DEMO_RETENTION_DAYS = 90;
const CONFIG_MARKER = (websiteId: string) => `demo-data:config:${websiteId}`;

export type DemoWebsite = {
  websiteId: string;
  name: string;
  domain: string | null;
  userId: string | null;
  teamId: string | null;
  kind: SiteKind;
};

export async function loadDemoWebsite(env: Env, websiteId: string): Promise<DemoWebsite | null> {
  const profile = profileFor(websiteId);
  if (!profile) return null;
  const row = await env.DB.prepare(
    `SELECT website_id AS websiteId, name, domain, user_id AS userId, team_id AS teamId
     FROM website WHERE website_id = ?1 AND deleted_at IS NULL`,
  )
    .bind(websiteId)
    .first<Omit<DemoWebsite, 'kind'>>();
  return row ? { ...row, kind: profile.kind } : null;
}

/** Hostname the demo website's events are recorded on. */
export function demoHostname(website: Pick<DemoWebsite, 'websiteId' | 'domain'>): string {
  const domain = (website.domain ?? '').trim().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  return domain || profileFor(website.websiteId)?.defaultDomain || 'demo.example.com';
}

export type ConfigResult = { ensured: boolean; statements: number; skipped: string[] };

type Stmt = D1PreparedStatement;

const json = (value: unknown) => JSON.stringify(value);

/**
 * Seeds or refreshes the configuration. Runs at most once per UTC day per website unless
 * `force` is set (annotations and the regression cycle move with the calendar).
 */
export async function ensureDemoConfig(env: Env, website: DemoWebsite, now = Date.now(), options: { force?: boolean } = {}): Promise<ConfigResult> {
  const marker = `${DEMO_CONFIG_VERSION}:${dayNumber(now)}`;
  if (!options.force && (await env.CACHE.get(CONFIG_MARKER(website.websiteId))) === marker) {
    return { ensured: false, statements: 0, skipped: [] };
  }
  const { websiteId, kind } = website;
  const owner = website.userId;
  const skipped: string[] = [];
  const statements: Stmt[] = [];
  const db = env.DB;

  // Website settings the demo relies on: 90-day retention, replay with console / network
  // capture, heatmaps and goals.
  statements.push(
    db.prepare(
      `UPDATE website SET retention_days = ?2, replay_enabled = 1, replay_config = ?3, heatmap_config = ?4, goal_config = ?5
       WHERE website_id = ?1`,
    ).bind(
      websiteId,
      DEMO_RETENTION_DAYS,
      json({ sampleRate: 1, minDurationSeconds: 2, maskInputs: true, captureConsole: true, captureNetwork: true }),
      json({ enabled: true, sampleRate: 1, ...(website.domain ? { previewUrl: `https://${website.domain}` } : {}) }),
      json(kind === 'store' ? STORE_GOALS : DOCS_GOALS),
    ),
  );

  // Flags: skip any key another object already uses.
  const existingFlags = await db.prepare(`SELECT flag_id AS id, key FROM feature_flag WHERE website_id = ?1`).bind(websiteId).all<{ id: string; key: string }>();
  const flagOwners = new Map((existingFlags.results ?? []).map((row) => [row.key, row.id]));
  const writtenFlags = new Set<string>();
  for (const flag of demoFlags(kind)) {
    const id = flagId(websiteId, flag.key);
    const holder = flagOwners.get(flag.key);
    if (holder && holder !== id) {
      skipped.push(`flag:${flag.key}`);
      continue;
    }
    writtenFlags.add(flag.key);
    const groups = flag.conditionGroups ?? [];
    statements.push(
      db.prepare(
        `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, variants, targeting_rules, condition_groups,
           payload, early_access, early_access_name, early_access_description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
         ON CONFLICT(flag_id) DO UPDATE SET
           key = excluded.key, name = excluded.name, description = excluded.description, enabled = excluded.enabled,
           rollout = excluded.rollout, variants = excluded.variants, targeting_rules = excluded.targeting_rules,
           condition_groups = excluded.condition_groups, payload = excluded.payload, early_access = excluded.early_access,
           early_access_name = excluded.early_access_name, early_access_description = excluded.early_access_description,
           updated_at = excluded.updated_at`,
      ).bind(
        id,
        websiteId,
        flag.key,
        flag.name,
        flag.description,
        flag.enabled ? 1 : 0,
        groups[0]?.rollout ?? 100,
        json(flag.variants ?? []),
        json(groups[0]?.conditions ?? []),
        json(groups),
        flag.payload === undefined ? null : json(flag.payload),
        flag.earlyAccess ? 1 : 0,
        flag.earlyAccessName ?? '',
        flag.earlyAccessDescription ?? '',
        now,
      ),
    );
  }

  if (kind === 'store' && writtenFlags.has(CHECKOUT_FLAG)) {
    const checkout = demoFlags(kind).find((flag) => flag.key === CHECKOUT_FLAG)!;
    statements.push(
      db.prepare(
        `INSERT INTO experiment (experiment_id, website_id, feature_flag_id, name, description, status, goal_event, primary_metric,
           secondary_metrics, minimum_detectable_effect, allocation, started_at, ended_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'running', 'purchase', ?6, ?7, 10, ?8, ?9, NULL, ?9, ?10)
         ON CONFLICT(experiment_id) DO UPDATE SET
           name = excluded.name, description = excluded.description, status = 'running', goal_event = excluded.goal_event,
           primary_metric = excluded.primary_metric, secondary_metrics = excluded.secondary_metrics,
           minimum_detectable_effect = excluded.minimum_detectable_effect, allocation = excluded.allocation,
           ended_at = NULL, updated_at = excluded.updated_at`,
      ).bind(
        experimentId(websiteId),
        websiteId,
        flagId(websiteId, CHECKOUT_FLAG),
        'One-page checkout',
        'Does the one-page checkout with express pay convert more carts into orders?',
        json({ type: 'conversion', event: 'purchase', name: 'Purchase conversion' }),
        json([
          { type: 'property_sum', event: 'purchase', property: 'revenue', name: 'Revenue' },
          { type: 'count', event: 'checkout_started', name: 'Checkouts started' },
        ]),
        json({ enabled: true, rollout: 100, variants: (checkout.variants ?? []).map((v) => ({ key: v.key, weight: v.weight })), targeted: false }),
        now - 21 * DAY_MS,
        now,
      ),
    );
  }

  for (const survey of demoSurveys(kind)) {
    const legacy = legacySurveyFields(survey.questions);
    statements.push(
      db.prepare(
        `INSERT INTO survey (survey_id, website_id, name, question, type, options, enabled, trigger_path, trigger_event, display_delay_seconds,
           display_rules, questions, appearance, sample_rate, response_limit, starts_at, ends_at, repeat_interval_days, hosted_enabled, slug,
           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, 3, '[]', ?9, ?10, ?11, NULL, ?12, NULL, ?13, 0, NULL, ?12, ?14)
         ON CONFLICT(survey_id) DO UPDATE SET
           name = excluded.name, question = excluded.question, type = excluded.type, options = excluded.options,
           trigger_path = excluded.trigger_path, trigger_event = excluded.trigger_event, questions = excluded.questions,
           appearance = excluded.appearance, sample_rate = excluded.sample_rate, repeat_interval_days = excluded.repeat_interval_days,
           updated_at = excluded.updated_at`,
      ).bind(
        surveyId(websiteId, survey.key),
        websiteId,
        survey.name,
        legacy.question,
        legacy.type,
        json(legacy.options),
        survey.triggerPath,
        survey.triggerEvent,
        json(survey.questions),
        json(surveyAppearanceSchema.parse({ position: 'bottom-right' })),
        survey.sampleRate,
        now - 120 * DAY_MS,
        survey.key === 'nps' ? 90 : null,
        now,
      ),
    );
  }

  for (const workflow of demoWorkflows(kind)) {
    statements.push(
      db.prepare(
        `INSERT INTO workflow (workflow_id, website_id, name, trigger_event, enabled, action_type, action_config, description, trigger_filters,
           steps, signing_secret, signing_secret_rotated_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'record', '{}', ?6, ?7, ?8, NULL, NULL, ?9, ?9)
         ON CONFLICT(workflow_id) DO UPDATE SET
           name = excluded.name, trigger_event = excluded.trigger_event, enabled = excluded.enabled, action_type = 'record',
           action_config = '{}', description = excluded.description, trigger_filters = excluded.trigger_filters,
           steps = excluded.steps, updated_at = excluded.updated_at`,
      ).bind(
        workflowId(websiteId, workflow.key),
        websiteId,
        workflow.name,
        workflow.triggerEvent,
        workflow.enabled ? 1 : 0,
        workflow.description,
        json(workflow.filters),
        json(workflow.steps),
        now,
      ),
    );
  }

  for (const action of demoActions(kind)) {
    statements.push(
      db.prepare(
        `INSERT INTO action_definition (action_id, website_id, name, description, rules, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(action_id) DO UPDATE SET name = excluded.name, description = excluded.description, rules = excluded.rules,
           updated_at = excluded.updated_at`,
      ).bind(demoId(websiteId, 'action', action.key), websiteId, action.name, action.description, json(action.rules), now),
    );
  }

  for (const cohort of demoCohorts(kind)) {
    statements.push(
      db.prepare(
        `INSERT INTO cohort (cohort_id, website_id, name, type, value, definition, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(cohort_id) DO UPDATE SET name = excluded.name, type = excluded.type, value = excluded.value,
           definition = excluded.definition, updated_at = excluded.updated_at`,
      ).bind(demoId(websiteId, 'cohort', cohort.key), websiteId, cohort.name, cohort.legacyType, cohort.legacyValue, json(cohort.definition), now),
    );
  }

  statements.push(
    db.prepare(
      `INSERT INTO llm_model_price (website_id, model, input_per_million, output_per_million, cache_read_per_million, cache_write_per_million, updated_at)
       VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5)
       ON CONFLICT(website_id, model) DO UPDATE SET input_per_million = excluded.input_per_million,
         output_per_million = excluded.output_per_million, updated_at = excluded.updated_at`,
    ).bind(websiteId, CUSTOM_MODEL, CUSTOM_MODEL_PRICE.input, CUSTOM_MODEL_PRICE.output, now),
  );

  if (kind === 'store') {
    statements.push(
      db.prepare(
        `INSERT INTO error_alert_rule (alert_rule_id, website_id, name, enabled, threshold, window_minutes, severity, release, environment,
           channel, target, notify_regressions, created_at, updated_at)
         VALUES (?1, ?2, 'Storefront error spike', 1, 15, 60, NULL, NULL, 'production', 'record', NULL, 1, ?3, ?3)
         ON CONFLICT(alert_rule_id) DO UPDATE SET channel = 'record', target = NULL, updated_at = excluded.updated_at`,
      ).bind(errorAlertRuleId(websiteId), websiteId, now),
      db.prepare(
        `INSERT INTO log_alert_rule (alert_rule_id, website_id, name, enabled, threshold, window_minutes, level, service, search, release,
           environment, attribute_key, attribute_value, channel, target, created_at, updated_at)
         VALUES (?1, ?2, 'checkout-service errors', 1, 3, 60, 'error', 'checkout-service', NULL, NULL, 'production', NULL, NULL, 'record', NULL, ?3, ?3)
         ON CONFLICT(alert_rule_id) DO UPDATE SET channel = 'record', target = NULL, updated_at = excluded.updated_at`,
      ).bind(logAlertRuleId(websiteId), websiteId, now),
    );

    // The checkout timeout goes through resolve → regress cycles (schedule.ts); the chunk
    // load error is ignored (stale deploys).
    const origin = `https://${demoHostname(website)}`;
    const fill = (text: string) => text.replaceAll('{origin}', origin);
    const timeout = STORE_ERRORS.paymentTimeout!;
    const { fingerprint } = computeErrorFingerprint({ type: timeout.name, message: fill(timeout.message), stack: fill(timeout.stack) });
    const resolvedAt = lastRegressionResolveAt(now);
    const chunk = STORE_ERRORS.chunkLoad!;
    const chunkFingerprint = computeErrorFingerprint({ type: chunk.name, message: fill(chunk.message), stack: fill(chunk.stack) }).fingerprint;
    statements.push(
      db.prepare(
        `INSERT INTO error_issue_state (website_id, fingerprint, status, note, resolved_at, regressed_at, regression_checked_at, created_at, updated_at)
         VALUES (?1, ?2, 'resolved', ?3, ?4, NULL, NULL, ?5, ?5)
         ON CONFLICT(website_id, fingerprint) DO UPDATE SET status = 'resolved', note = excluded.note, resolved_at = excluded.resolved_at,
           regressed_at = NULL, regression_checked_at = NULL, updated_at = excluded.updated_at
         WHERE error_issue_state.resolved_at IS NULL OR error_issue_state.resolved_at < excluded.resolved_at`,
      ).bind(websiteId, fingerprint, `Fixed in storefront@${storeReleaseOn(dayNumber(resolvedAt))}: longer confirmation timeout`, resolvedAt, now),
      db.prepare(
        `INSERT INTO error_issue_state (website_id, fingerprint, status, note, created_at, updated_at)
         VALUES (?1, ?2, 'ignored', 'Stale tabs after a deploy; the app reloads itself.', ?3, ?3)
         ON CONFLICT(website_id, fingerprint) DO NOTHING`,
      ).bind(websiteId, chunkFingerprint, now),
    );
  }

  if (owner) {
    for (const insight of demoInsights(kind)) {
      statements.push(
        db.prepare(
          `INSERT INTO insight (insight_id, website_id, user_id, type, name, description, query, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
           ON CONFLICT(insight_id) DO UPDATE SET type = excluded.type, name = excluded.name, description = excluded.description,
             query = excluded.query, updated_at = excluded.updated_at`,
        ).bind(insightId(websiteId, insight.key), websiteId, owner, insight.type, insight.name, insight.description, json(insight.query), now),
      );
    }

    // Boards are listed by owner or team: the demo team makes this one visible to the demo account.
    const demoTeam = await db.prepare(`SELECT team_id AS id FROM team WHERE team_id = ?1 AND deleted_at IS NULL`).bind(DEMO_TEAM_ID).first<{ id: string }>();
    const teamId = demoTeam?.id ?? website.teamId ?? null;
    const insights = demoInsights(kind);
    const widgetWidth = (type: string) => (type === 'funnel' || type === 'retention' ? 'large' : 'medium');
    statements.push(
      db.prepare(
        `INSERT INTO board (board_id, type, name, description, parameters, user_id, team_id, created_at, updated_at)
         VALUES (?1, 'dashboard', ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(board_id) DO UPDATE SET name = excluded.name, description = excluded.description, parameters = excluded.parameters,
           team_id = excluded.team_id, updated_at = excluded.updated_at`,
      ).bind(
        boardId(websiteId),
        kind === 'store' ? 'Northwind Supply — weekly review' : 'Docs engagement',
        kind === 'store' ? 'Traffic, conversion, retention and revenue of the demo store.' : 'How developers use the documentation.',
        json({
          rangePreset: '30d',
          filters: [],
          widgets: [
            { type: 'stats', websiteId, label: 'Traffic', width: 'full' },
            ...insights.map((insight) => ({ type: 'insight', insightId: insightId(websiteId, insight.key), label: insight.name, width: widgetWidth(insight.type) })),
          ],
        }),
        owner,
        teamId,
        now,
      ),
    );

    if (kind === 'store') {
      statements.push(
        db.prepare(
          `INSERT INTO notebook (notebook_id, website_id, title, content, created_by, updated_by, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6)
           ON CONFLICT(notebook_id) DO UPDATE SET title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`,
        ).bind(
          notebookId(websiteId),
          websiteId,
          'Checkout experiment readout',
          json({
            blocks: [
              {
                id: 'intro',
                type: 'text',
                text: '# One-page checkout\nWe are testing a one-page checkout with express pay against the current three-step flow. Exposure happens on the cart page; the goal is a completed purchase.',
              },
              { id: 'funnel', type: 'insight', insightId: insightId(websiteId, 'checkout-funnel'), rangePreset: '30d' },
              {
                id: 'observations',
                type: 'text',
                text: '## Observations\n- The test variant converts noticeably more started checkouts.\n- Mobile visitors benefit most; see conversion by device below.\n- Payment timeouts on the old flow are tracked in Errors (they regress every few weeks).',
              },
              { id: 'conversion', type: 'insight', insightId: insightId(websiteId, 'conversion-by-device'), rangePreset: '30d' },
              { id: 'revenue', type: 'insight', insightId: insightId(websiteId, 'revenue-by-country'), rangePreset: '90d' },
            ],
          }),
          owner,
          now,
        ),
      );
    }

    statements.push(...annotationStatements(env, website, owner, now));
  }

  // D1 batches are atomic; foreign-key surprises in one part must not block the rest.
  for (let i = 0; i < statements.length; i += 40) {
    await db.batch(statements.slice(i, i + 40));
  }

  await Promise.all([
    invalidateFeatureFlagCaches(env, websiteId),
    env.CACHE.delete(`tracker-settings:${websiteId}`),
    bumpActionDefinitionsVersion(env, websiteId),
  ]);
  await env.CACHE.put(CONFIG_MARKER(websiteId), marker, { expirationTtl: 2 * 86_400 });
  return { ensured: true, statements: statements.length, skipped };
}

type AnnotationSpec = { key: string; title: string; description: string; category: string; happenedAt: number };

/** Calendar entries (schedule.ts) inside the retention window. */
export function demoAnnotations(kind: SiteKind, now: number, days = DEMO_RETENTION_DAYS): AnnotationSpec[] {
  const today = dayNumber(now);
  const from = today - days;
  const specs: AnnotationSpec[] = [];
  for (let day = from; day <= today; day++) {
    const at = (hour: number) => day * DAY_MS + hour * HOUR_MS;
    if (kind === 'store') {
      if (isStoreReleaseDay(day) && at(9) <= now) {
        specs.push({
          key: `release:${day}`,
          title: `Storefront ${storeReleaseOn(day)} released`,
          description: 'Weekly storefront release.',
          category: 'release',
          happenedAt: at(9),
        });
      }
      const incident = incidentOn(day);
      if (incident && incident.startAt <= now) {
        specs.push({
          key: `incident:${day}`,
          title: 'Payment provider degraded',
          description: 'AcmePay returned 503s for about two hours; checkout conversion dropped.',
          category: 'incident',
          happenedAt: incident.startAt,
        });
      }
    } else if (isDocsReleaseDay(day) && at(15) <= now) {
      specs.push({
        key: `docs-release:${day}`,
        title: `Docs ${docsReleaseOn(day)} published`,
        description: 'Monthly docs and changelog update.',
        category: 'release',
        happenedAt: at(15),
      });
    }
  }
  if (kind === 'store') {
    for (const day of campaignStartDays(from, today)) {
      if (day * DAY_MS + 7 * HOUR_MS > now) continue;
      const index = Math.floor((day - 3) / 19);
      const campaign = CAMPAIGNS[((index % CAMPAIGNS.length) + CAMPAIGNS.length) % CAMPAIGNS.length]!;
      specs.push({ key: `campaign:${day}`, title: campaign.title, description: `Campaign ${campaign.slug} (${campaign.source} / ${campaign.medium}).`, category: 'campaign', happenedAt: day * DAY_MS + 7 * HOUR_MS });
    }
    for (let resolveAt = lastRegressionResolveAt(now); resolveAt >= from * DAY_MS; resolveAt -= 21 * DAY_MS) {
      specs.push({
        key: `hotfix:${dayNumber(resolveAt)}`,
        title: 'Hotfix: checkout payment timeout',
        description: 'Raised the PaymentIntent confirmation timeout. (It came back a few days later.)',
        category: 'note',
        happenedAt: resolveAt,
      });
    }
    specs.push({
      key: 'experiment:checkout',
      title: 'Started experiment: one-page checkout',
      description: 'Flag new-checkout-flow, 50 / 50.',
      category: 'experiment',
      happenedAt: -1,
    });
  }
  return specs;
}

function annotationStatements(env: Env, website: DemoWebsite, owner: string, now: number): Stmt[] {
  const { websiteId, kind } = website;
  const db = env.DB;
  const statements: Stmt[] = [];
  for (const spec of demoAnnotations(kind, now)) {
    const id = annotationId(websiteId, spec.key);
    if (spec.happenedAt < 0) {
      // Pinned to the experiment's own start.
      statements.push(
        db.prepare(
          `INSERT INTO annotation (annotation_id, website_id, user_id, title, description, category, happened_at, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, e.started_at, ?7, ?7 FROM experiment e WHERE e.experiment_id = ?8 AND e.started_at IS NOT NULL
           ON CONFLICT(annotation_id) DO UPDATE SET happened_at = excluded.happened_at, updated_at = excluded.updated_at`,
        ).bind(id, websiteId, owner, spec.title, spec.description, spec.category, now, experimentId(websiteId)),
      );
      continue;
    }
    statements.push(
      db.prepare(
        `INSERT INTO annotation (annotation_id, website_id, user_id, title, description, category, happened_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(annotation_id) DO UPDATE SET title = excluded.title, description = excluded.description,
           category = excluded.category, happened_at = excluded.happened_at, updated_at = excluded.updated_at`,
      ).bind(id, websiteId, owner, spec.title, spec.description, spec.category, spec.happenedAt, now),
    );
  }
  // Our own calendar entries that fell out of the window (ids recomputed from the calendar).
  const stale = demoAnnotations(kind, now - (DEMO_RETENTION_DAYS + 1) * DAY_MS, 120)
    .filter((spec) => spec.happenedAt >= 0 && spec.happenedAt < now - DEMO_RETENTION_DAYS * DAY_MS)
    .map((spec) => annotationId(websiteId, spec.key));
  for (let i = 0; i < stale.length; i += 90) {
    const ids = stale.slice(i, i + 90);
    statements.push(
      db.prepare(`DELETE FROM annotation WHERE website_id = ?1 AND annotation_id IN (${ids.map((_, index) => `?${index + 2}`).join(', ')})`).bind(websiteId, ...ids),
    );
  }
  return statements;
}
