import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  ROLES,
  getPlan,
  nextSubscriptionRunAt,
  parseBoardFilters,
  subscriptionPeriods,
  type AuthUser,
  type InsightResult,
  type SubscriptionFrequency,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessTeamResource, userIdHasWebsiteAccess } from './access';
import { escapeHtml } from './alert-delivery';
import { isHostedMode, getUserSubscription } from './billing';
import { resolveBoardOwner } from './board-widgets';
import { runBoardWidgets, runSavedInsight, type BoardRunWidget } from './board-run';
import { sendEmail } from './email';
import { InsightQueryError } from './property-filters';
import { getWebsiteById } from './queries';

export type SubscriptionRow = typeof schema.reportSubscription.$inferSelect;

export function serializeSubscription(row: SubscriptionRow) {
  return {
    id: row.subscriptionId,
    websiteId: row.websiteId,
    userId: row.userId,
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.title,
    frequency: row.frequency,
    weekday: row.weekday,
    hour: row.hour,
    timezone: row.timezone,
    recipients: Array.isArray(row.recipients) ? (row.recipients as string[]) : [],
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastSentAt: row.lastSentAt?.getTime() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt?.getTime() ?? null,
    updatedAt: row.updatedAt?.getTime() ?? null,
  };
}

/** Email subscriptions follow the email report plan gate in hosted mode. */
export async function subscriptionsAllowed(env: Env, userId: string) {
  if (!isHostedMode(env)) return true;
  const sub = await getUserSubscription(env, userId);
  return getPlan(sub.planId).emailReportsEnabled;
}

// ---------------------------------------------------------------------------------------------
// Summary content: key numbers of an insight (current period vs previous period)
// ---------------------------------------------------------------------------------------------

export type SummaryMetric = { label: string; value: number; previous: number | null; unit?: '%' };
export type SummarySection = { title: string; metrics: SummaryMetric[]; rows?: Array<{ label: string; value: number }>; note?: string };

const MAX_LINES = 6;

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function retentionRate(result: Extract<InsightResult, { kind: 'retention' }>) {
  let size = 0;
  let returned = 0;
  for (const cohort of result.cohorts) {
    if (cohort.values.length < 2) continue;
    size += cohort.size;
    returned += cohort.values[1] ?? 0;
  }
  return size ? (returned / size) * 100 : 0;
}

/** Headline numbers of an insight result, paired with the previous period when there is one. */
export function summarizeInsightResult(current: InsightResult, previous: InsightResult | null): Omit<SummarySection, 'title'> {
  switch (current.kind) {
    case 'trend': {
      const prev = previous?.kind === 'trend' ? previous : null;
      const lines = current.formula ? current.results.filter((line) => line.key === 'formula') : current.results;
      return {
        metrics: lines.slice(0, MAX_LINES).map((line) => {
          const match = prev?.results.find(
            (p) => p.key === line.key && p.breakdownValue === line.breakdownValue && Boolean(p.isOther) === Boolean(line.isOther),
          );
          const breakdown = line.isOther ? 'Other' : line.breakdownValue === undefined ? '' : (line.breakdownValue ?? '(none)');
          return {
            label: breakdown ? `${line.label} · ${breakdown}` : line.label,
            value: line.total,
            previous: match ? match.total : null,
          };
        }),
      };
    }
    case 'funnel': {
      const prev = previous?.kind === 'funnel' ? previous : null;
      const first = current.steps[0];
      const last = current.steps[current.steps.length - 1];
      return {
        metrics: [
          { label: 'Conversion', value: current.conversion, previous: prev ? prev.conversion : null, unit: '%' },
          ...(first ? [{ label: first.label || 'Step 1', value: first.count, previous: prev?.steps[0]?.count ?? null }] : []),
          ...(last && current.steps.length > 1
            ? [{ label: last.label || `Step ${current.steps.length}`, value: last.count, previous: prev?.steps[current.steps.length - 1]?.count ?? null }]
            : []),
        ],
      };
    }
    case 'retention': {
      const prev = previous?.kind === 'retention' ? previous : null;
      return {
        metrics: [
          { label: 'Cohort size', value: sum(current.cohorts.map((c) => c.size)), previous: prev ? sum(prev.cohorts.map((c) => c.size)) : null },
          { label: `Returned after 1 ${current.period}`, value: retentionRate(current), previous: prev ? retentionRate(prev) : null, unit: '%' },
        ],
      };
    }
    case 'lifecycle': {
      const prev = previous?.kind === 'lifecycle' ? previous : null;
      return {
        metrics: (['new', 'returning', 'resurrecting', 'dormant'] as const).map((key) => ({
          label: key.charAt(0).toUpperCase() + key.slice(1),
          value: Math.abs(sum(current[key])),
          previous: prev ? Math.abs(sum(prev[key])) : null,
        })),
      };
    }
    case 'stickiness': {
      const prev = previous?.kind === 'stickiness' ? previous : null;
      return {
        metrics: [
          { label: 'Active users', value: current.totalActors, previous: prev ? prev.totalActors : null },
          { label: 'Average active days', value: current.averageActiveDays, previous: prev ? prev.averageActiveDays : null },
        ],
      };
    }
    case 'path':
      return {
        metrics: [{ label: 'Visits', value: current.total, previous: previous?.kind === 'path' ? previous.total : null }],
        rows: current.next.slice(0, 5).map((row) => ({ label: row.path, value: row.count })),
      };
    case 'table':
      return { metrics: [], rows: current.rows.slice(0, 5).map((row) => ({ label: row.x, value: row.y })) };
  }
}

type Periods = ReturnType<typeof subscriptionPeriods>;

async function insightSection(
  env: Env,
  insight: typeof schema.insight.$inferSelect,
  periods: Periods,
  filters: Parameters<typeof runSavedInsight>[4],
  title: string,
): Promise<SummarySection> {
  try {
    const current = await runSavedInsight(env, insight, periods.current.startAt, periods.current.endAt, filters);
    const previous =
      current.kind === 'table'
        ? null
        : await runSavedInsight(env, insight, periods.previous.startAt, periods.previous.endAt, filters);
    return { title, ...summarizeInsightResult(current, previous) };
  } catch (error) {
    if (error instanceof InsightQueryError) return { title, metrics: [], note: 'This insight could not be calculated.' };
    throw error;
  }
}

function statsSection(title: string, current: BoardRunWidget, previous: BoardRunWidget | undefined): SummarySection {
  const now = current.stats;
  const before = previous?.stats;
  return {
    title,
    metrics: now
      ? [
          { label: 'Pageviews', value: now.pageviews.value, previous: before?.pageviews.value ?? null },
          { label: 'Visitors', value: now.visitors.value, previous: before?.visitors.value ?? null },
          { label: 'Visits', value: now.visits.value, previous: before?.visits.value ?? null },
        ]
      : [],
  };
}

async function boardSections(env: Env, owner: AuthUser, board: typeof schema.board.$inferSelect, periods: Periods) {
  const filters = parseBoardFilters(board.parameters);
  const [current, previous] = await Promise.all([
    runBoardWidgets(env, owner, board.parameters, { ...periods.current, filters }),
    runBoardWidgets(env, owner, board.parameters, { ...periods.previous, filters }),
  ]);
  return current.map((widget, index): SummarySection => {
    const title = widget.label?.trim() || widget.insightName || (widget.type === 'stats' ? 'Site stats' : 'Insight');
    if (widget.type === 'stats') return statsSection(title, widget, previous[index]);
    if (widget.error || !widget.result) return { title, metrics: [], note: 'This insight could not be calculated.' };
    const before = previous[index]?.result ?? null;
    return { title, ...summarizeInsightResult(widget.result, widget.result.kind === 'table' ? null : before) };
  });
}

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

function formatValue(value: number, unit?: '%') {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded.toLocaleString('en-US')}${unit ?? ''}`;
}

export function formatDelta(value: number, previous: number | null): string {
  if (previous === null) return '';
  if (previous === 0) return value === 0 ? '0%' : 'new';
  const change = ((value - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(change * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function dayLabel(ms: number, timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function renderSummaryEmail(input: {
  title: string;
  frequency: SubscriptionFrequency;
  periods: Periods;
  timezone: string;
  sections: SummarySection[];
  url: string | null;
}) {
  const range =
    input.frequency === 'daily'
      ? dayLabel(input.periods.current.startAt, input.timezone)
      : `${dayLabel(input.periods.current.startAt, input.timezone)} – ${dayLabel(input.periods.current.endAt, input.timezone)}`;
  const heading = `${input.title} — ${input.frequency === 'daily' ? 'Daily' : 'Weekly'} summary`;
  const compareLabel = input.frequency === 'daily' ? 'vs previous day' : 'vs previous week';

  const text: string[] = [heading, range, ''];
  const html: string[] = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#171717;max-width:640px">`,
    `<h2 style="margin:0 0 4px;font-size:20px">${escapeHtml(input.title)}</h2>`,
    `<p style="margin:0 0 20px;color:#666">${escapeHtml(input.frequency === 'daily' ? 'Daily' : 'Weekly')} summary · ${escapeHtml(range)}</p>`,
  ];
  for (const section of input.sections) {
    text.push(section.title);
    html.push(`<h3 style="margin:20px 0 8px;font-size:15px">${escapeHtml(section.title)}</h3>`);
    if (section.note) {
      text.push(`  ${section.note}`);
      html.push(`<p style="margin:0;color:#666">${escapeHtml(section.note)}</p>`);
    }
    if (section.metrics.length) {
      html.push('<table style="border-collapse:collapse;width:100%;font-size:14px">');
      for (const metric of section.metrics) {
        const delta = formatDelta(metric.value, metric.previous);
        text.push(`  ${metric.label}: ${formatValue(metric.value, metric.unit)}${delta ? ` (${delta} ${compareLabel})` : ''}`);
        html.push(
          `<tr><td style="padding:6px 0;border-bottom:1px solid #eaeaea">${escapeHtml(metric.label)}</td>` +
            `<td style="padding:6px 0;border-bottom:1px solid #eaeaea;text-align:right;font-weight:600">${escapeHtml(formatValue(metric.value, metric.unit))}</td>` +
            `<td style="padding:6px 0 6px 12px;border-bottom:1px solid #eaeaea;text-align:right;color:#666;white-space:nowrap">${escapeHtml(delta ? `${delta} ${compareLabel}` : '')}</td></tr>`,
        );
      }
      html.push('</table>');
    }
    if (section.rows?.length) {
      html.push('<table style="border-collapse:collapse;width:100%;font-size:14px">');
      for (const row of section.rows) {
        text.push(`  ${row.label}: ${formatValue(row.value)}`);
        html.push(
          `<tr><td style="padding:4px 0;border-bottom:1px solid #eaeaea">${escapeHtml(row.label)}</td>` +
            `<td style="padding:4px 0;border-bottom:1px solid #eaeaea;text-align:right">${escapeHtml(formatValue(row.value))}</td></tr>`,
        );
      }
      html.push('</table>');
    }
    text.push('');
  }
  if (input.url) {
    text.push(`Open in Flareboard: ${input.url}`);
    html.push(`<p style="margin:24px 0 0"><a href="${escapeHtml(input.url)}">Open in Flareboard</a></p>`);
  }
  text.push('', 'You receive this email because someone subscribed this address in Flareboard.');
  html.push(
    '<p style="margin:24px 0 0;color:#888;font-size:12px">You receive this email because someone subscribed this address in Flareboard.</p></div>',
  );
  return { subject: `${heading.slice(0, 150)}`, text: text.join('\n'), html: html.join('') };
}

// ---------------------------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------------------------

function dashboardUrl(env: Env) {
  return env.DASHBOARD_URL?.trim().replace(/\/$/, '') || null;
}

type BuiltSummary = { title: string; sections: SummarySection[]; url: string | null } | { error: string };

/** Summary content as the subscription's creator sees it, or why it cannot be built. */
export async function buildSubscriptionSummary(env: Env, row: SubscriptionRow, periods: Periods): Promise<BuiltSummary> {
  const owner = await resolveBoardOwner(env, row.userId);
  if (!owner) return { error: 'Subscription owner no longer exists' };
  const db = createDb(env.DB);
  const base = dashboardUrl(env);

  if (row.targetType === 'insight') {
    const [insight] = await db.select().from(schema.insight).where(eq(schema.insight.insightId, row.targetId)).limit(1);
    const website = insight ? await getWebsiteById(env, insight.websiteId) : null;
    if (!insight || !website) return { error: 'Insight no longer exists' };
    if (owner.role !== ROLES.admin && !(await userIdHasWebsiteAccess(env, website, owner.userId))) {
      return { error: 'Owner lost access to the insight' };
    }
    const section = await insightSection(env, insight, periods, [], insight.name);
    return { title: row.title, sections: [section], url: base ? `${base}/insights?insight=${insight.insightId}` : null };
  }

  const [board] = await db.select().from(schema.board).where(eq(schema.board.boardId, row.targetId)).limit(1);
  if (!board) return { error: 'Board no longer exists' };
  if (!(await canAccessTeamResource(env, board, owner))) return { error: 'Owner lost access to the board' };
  const sections = await boardSections(env, owner, board, periods);
  return { title: row.title, sections, url: base ? `${base}/boards/${board.boardId}` : null };
}

const MAX_SUBSCRIPTIONS_PER_TICK = 25;

/**
 * Sends every due subscription once. Each row is claimed by moving `next_run_at` forward with a
 * compare-and-set before anything is sent, so overlapping ticks never send the same slot twice.
 */
export async function runDueSubscriptions(env: Env, now = Date.now(), limit = MAX_SUBSCRIPTIONS_PER_TICK) {
  const db = createDb(env.DB);
  const due = await env.DB.prepare(
    `SELECT subscription_id as id FROM report_subscription
     WHERE enabled = 1 AND next_run_at <= ?1 ORDER BY next_run_at LIMIT ?2`,
  )
    .bind(now, limit)
    .all<{ id: string }>();

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const { id } of due.results ?? []) {
    const [row] = await db.select().from(schema.reportSubscription).where(eq(schema.reportSubscription.subscriptionId, id)).limit(1);
    if (!row) continue;
    const schedule = {
      frequency: row.frequency as SubscriptionFrequency,
      hour: row.hour,
      weekday: row.weekday,
      timezone: row.timezone,
    };
    // Missed slots (downtime) are not replayed: the next slot is the first one after now.
    const next = nextSubscriptionRunAt(schedule, Math.max(now, row.nextRunAt));
    const claim = await env.DB.prepare(
      `UPDATE report_subscription SET next_run_at = ?3 WHERE subscription_id = ?1 AND next_run_at = ?2 AND enabled = 1`,
    )
      .bind(row.subscriptionId, row.nextRunAt, next)
      .run();
    if (!claim.meta?.changes) continue;

    const markError = (error: string) =>
      env.DB.prepare(`UPDATE report_subscription SET last_error = ?2, updated_at = ?3 WHERE subscription_id = ?1`)
        .bind(row.subscriptionId, error, now)
        .run();

    try {
      if (!(await subscriptionsAllowed(env, row.userId))) {
        skipped++;
        await markError('Email subscriptions require a paid plan');
        continue;
      }
      const periods = subscriptionPeriods(schedule.frequency, row.nextRunAt, row.timezone);
      const summary = await buildSubscriptionSummary(env, row, periods);
      if ('error' in summary) {
        skipped++;
        await markError(summary.error);
        continue;
      }
      const email = renderSummaryEmail({
        title: summary.title,
        frequency: schedule.frequency,
        periods,
        timezone: row.timezone,
        sections: summary.sections,
        url: summary.url,
      });
      const recipients = Array.isArray(row.recipients) ? (row.recipients as string[]) : [];
      let delivered = 0;
      for (const to of recipients) {
        if (await sendEmail(env, { to, subject: email.subject, text: email.text, html: email.html }).catch(() => false)) delivered++;
      }
      const error = delivered === recipients.length ? null : `Delivered to ${delivered} of ${recipients.length} recipients`;
      await env.DB.prepare(
        `UPDATE report_subscription SET last_sent_at = ?2, last_error = ?3, updated_at = ?2 WHERE subscription_id = ?1`,
      )
        .bind(row.subscriptionId, now, error)
        .run();
      if (error) failed++;
      else sent++;
    } catch (error) {
      failed++;
      await markError('Summary could not be built');
      // Ids only: summaries and recipient addresses never go to the logs.
      console.error(
        JSON.stringify({
          event: 'subscription_send_failed',
          subscriptionId: row.subscriptionId,
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }
  console.log(JSON.stringify({ event: 'subscriptions_complete', sent, skipped, failed }));
  return { sent, skipped, failed };
}
