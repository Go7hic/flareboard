import { DEMO_WEBSITE_IDS } from '@flareboard/shared';
import type { Env } from '../../env';
import { isDemoWebsiteId } from '../demo-access';
import { eventStoreMode, siteStoreDb, siteStoreStub } from '../site-db';
import { profileFor } from './catalog';
import { DEMO_RETENTION_DAYS, demoHostname, ensureDemoConfig, loadDemoWebsite, type DemoWebsite } from './config';
import { demoFlags, demoSurveys, demoWorkflows, surveyId, workflowId } from './definitions';
import { generateHour, heatmapDay, type DemoSite, type HeatmapCellRow, type HourData } from './generate';
import { DAY_MS, dayKey, HOUR_MS, hourFloor } from './schedule';
import { writeD1Rows, writeReplayObjects, writeStoreRows } from './write';

/**
 * Keeps the demo websites current. The hourly cron generates the hours since the per-website
 * watermark (KV); the admin endpoint wipes a demo website and backfills 90 days in resumable
 * steps. Both only ever touch DEMO_WEBSITE_IDS.
 */

const WATERMARK_KEY = (websiteId: string) => `demo-data:watermark:${websiteId}`;
/** Set while a reset / backfill owns the website, so the cron leaves it alone. */
const ACTIVE_KEY = (websiteId: string) => `demo-data:active:${websiteId}`;
const RUN_KEY = (websiteIds: readonly string[]) => `demo-data:backfill:${websiteIds.join(',')}`;

/** Days of history the demo keeps (matches the websites' retention setting). */
export const DEMO_HISTORY_DAYS = DEMO_RETENTION_DAYS;
/** OpenTelemetry rows are purged by the store after 30 days; older hours skip them. */
const OTEL_DAYS = 29;
/** When the cron finds no watermark it starts this far back (the admin backfill does history). */
const CRON_START_BACK_MS = 6 * HOUR_MS;
/** Hours written per store round trip. */
const WRITE_GROUP_HOURS = 6;

let loggedStoreModeSkip = false;

/** Why the generator must not run here, or null. */
export function demoDataDisabledReason(env: Env): 'disabled' | 'store-mode' | null {
  if ((env.DEMO_DATA ?? '').trim().toLowerCase() === 'off') return 'disabled';
  if (eventStoreMode(env) !== 'do') return 'store-mode';
  return null;
}

export function demoSite(website: DemoWebsite): DemoSite {
  const profile = profileFor(website.websiteId)!;
  return { websiteId: website.websiteId, profile, hostname: demoHostname(website), flags: demoFlags(profile.kind) };
}

export type Budget = { deadline: number; maxHours: number; maxReplayChunks: number };

export type RangeResult = { cursor: number; hours: number; events: number; replayChunks: number; complete: boolean };

/**
 * Generates hours from `from` up to the hour in progress at `now`, within the budget. Returns
 * the first hour that still needs (re)generation: complete hours advance the cursor, the hour in
 * progress is written up to `now` and generated again next time.
 */
export async function generateRange(env: Env, site: DemoSite, from: number, now: number, budget: Budget): Promise<RangeResult> {
  const lastHour = hourFloor(now);
  let hour = hourFloor(from);
  let cursor = hour;
  let hours = 0;
  let events = 0;
  let replayChunks = 0;
  let pending: HourData[] = [];
  let heatmap: HeatmapCellRow[] = [];

  const flush = async () => {
    if (!pending.length && !heatmap.length) return;
    // Replay objects first: a row must never point at a chunk that is not stored yet.
    replayChunks += await writeReplayObjects(env, site.websiteId, pending);
    const summary = await writeStoreRows(env, site.websiteId, pending, heatmap);
    await writeD1Rows(env, site.websiteId, pending);
    events += summary.events;
    pending = [];
    heatmap = [];
  };

  while (hour <= lastHour) {
    if (hours >= budget.maxHours || Date.now() > budget.deadline || replayChunks + countChunks(pending) >= budget.maxReplayChunks) break;
    const complete = hour + HOUR_MS <= now;
    const data = generateHour(site, hour, {
      until: now,
      replays: complete,
      otel: hour >= now - OTEL_DAYS * DAY_MS,
    });
    pending.push(data);
    hours++;
    const dayStart = Math.floor(hour / DAY_MS) * DAY_MS;
    const endOfDay = hour + HOUR_MS === dayStart + DAY_MS;
    const lastOfRun = hour === lastHour || hours >= budget.maxHours;
    if (endOfDay || lastOfRun) {
      const fraction = Math.min(1, (Math.min(now, hour + HOUR_MS) - dayStart) / DAY_MS);
      heatmap.push(...heatmapDay(site, dayStart, fraction));
    }
    cursor = complete ? hour + HOUR_MS : hour;
    if (pending.length >= WRITE_GROUP_HOURS || heatmap.length) await flush();
    if (!complete) break;
    hour += HOUR_MS;
  }
  await flush();
  return { cursor, hours, events, replayChunks, complete: cursor >= lastHour };
}

function countChunks(hours: HourData[]) {
  let total = 0;
  for (const hour of hours) for (const replay of hour.replays) total += replay.chunks.length;
  return total;
}

export type DemoTickResult = {
  skipped?: 'disabled' | 'store-mode';
  websites: Array<{ websiteId: string; hours?: number; events?: number; until?: string; skipped?: string; error?: string }>;
};

/**
 * Hourly cron step (scheduled-jobs.ts). Each UTC day is written in full by the first run that
 * day (the console only shows what is before now); later runs that day only check the watermark.
 */
export async function runDemoDataGenerator(env: Env, now = Date.now(), options: { maxHoursPerSite?: number; budgetMs?: number } = {}): Promise<DemoTickResult> {
  const reason = demoDataDisabledReason(env);
  if (reason) {
    if (reason === 'store-mode' && !loggedStoreModeSkip) {
      loggedStoreModeSkip = true;
      console.log(JSON.stringify({ event: 'demo_data_skipped', reason: 'EVENT_STORE is not do' }));
    }
    return { skipped: reason, websites: [] };
  }
  const deadline = Date.now() + (options.budgetMs ?? 20_000);
  const dayEnd = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  const results: DemoTickResult['websites'] = [];
  for (const websiteId of DEMO_WEBSITE_IDS) {
    const website = await loadDemoWebsite(env, websiteId);
    if (!website) continue;
    try {
      await ensureDemoConfig(env, website, now);
      if (await env.CACHE.get(ACTIVE_KEY(websiteId))) {
        results.push({ websiteId, skipped: 'backfill-running' });
        continue;
      }
      const stored = Number(await env.CACHE.get(WATERMARK_KEY(websiteId)));
      if (Number.isFinite(stored) && stored >= dayEnd) {
        results.push({ websiteId, skipped: 'day-written' });
        continue;
      }
      const start = Number.isFinite(stored) && stored > 0 ? stored : hourFloor(now) - CRON_START_BACK_MS;
      const from = Math.max(start, hourFloor(now) - DEMO_HISTORY_DAYS * DAY_MS);
      // Up to the end of the UTC day, so every hour of it is complete (replays included). A run
      // cut short by its budget leaves the watermark behind and the next hourly run continues.
      const range = await generateRange(env, demoSite(website), from, dayEnd, { deadline, maxHours: options.maxHoursPerSite ?? 30, maxReplayChunks: 400 });
      await env.CACHE.put(WATERMARK_KEY(websiteId), String(range.cursor));
      if (range.hours) await siteStoreStub(env, websiteId).rebuildRollups(websiteId);
      await pruneDemoData(env, website, now);
      results.push({ websiteId, hours: range.hours, events: range.events, until: new Date(range.cursor).toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: 'demo_data_failed', websiteId, error: message }));
      results.push({ websiteId, error: message });
    }
  }
  console.log(JSON.stringify({ event: 'demo_data_complete', websites: results }));
  return { websites: results };
}

/**
 * Rows the website retention job does not cover: heatmap cells, sessions without events,
 * people not seen for 90 days and old survey responses. Bounded per call.
 */
export async function pruneDemoData(env: Env, website: DemoWebsite, now: number) {
  const cutoff = now - (DEMO_HISTORY_DAYS + 1) * DAY_MS;
  const db = siteStoreDb(env, website.websiteId);
  const results = await db.batch([
    db.prepare(`DELETE FROM heatmap_cell WHERE rowid IN (SELECT rowid FROM heatmap_cell WHERE day < ?1 LIMIT 5000)`).bind(dayKey(cutoff)),
    db.prepare(
      `DELETE FROM session WHERE rowid IN (
         SELECT s.rowid FROM session s
         WHERE s.created_at < ?1 AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id)
         LIMIT 2000)`,
    ).bind(cutoff),
    db.prepare(
      `DELETE FROM person_group_membership WHERE person_id IN (
         SELECT person_id FROM person WHERE last_seen_at < ?1 LIMIT 2000)`,
    ).bind(cutoff),
    db.prepare(`DELETE FROM person WHERE rowid IN (SELECT rowid FROM person WHERE last_seen_at < ?1 LIMIT 2000)`).bind(cutoff),
  ]);
  const surveys = demoSurveys(website.kind).map((survey) => surveyId(website.websiteId, survey.key));
  let surveyDeleted = 0;
  if (surveys.length) {
    const result = await env.DB.prepare(
      `DELETE FROM survey_response WHERE response_id IN (
         SELECT response_id FROM survey_response
         WHERE website_id = ?1 AND created_at < ?2 AND survey_id IN (${surveys.map((_, i) => `?${i + 3}`).join(', ')})
         LIMIT 2000)`,
    )
      .bind(website.websiteId, cutoff, ...surveys)
      .run();
    surveyDeleted = result.meta?.changes ?? 0;
  }
  return results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0) + surveyDeleted;
}

// ---------------------------------------------------------------------------------------------
// Reset + backfill (admin)
// ---------------------------------------------------------------------------------------------

type SitePhase = 'wipe' | 'generate' | 'done';
type SiteRun = { phase: SitePhase; from: number; cursor: number; wipedObjects: number };
type BackfillRun = { reset: boolean; days: number; startedAt: number; sites: Record<string, SiteRun>; done: boolean };

export type BackfillResult = {
  done: boolean;
  /** Oldest point every website is generated up to (ISO). */
  until: string;
  reset: boolean;
  websites: Array<{ websiteId: string; phase: SitePhase | 'missing'; until: string | null; wipedObjects?: number }>;
};

export async function runDemoBackfill(
  env: Env,
  input: { websiteIds?: readonly string[]; reset?: boolean; days?: number; now?: number; budgetMs?: number; maxHours?: number },
): Promise<BackfillResult> {
  const websiteIds = (input.websiteIds?.length ? input.websiteIds : DEMO_WEBSITE_IDS).filter(isDemoWebsiteId);
  const now = input.now ?? Date.now();
  if (!websiteIds.length) return { done: true, until: new Date(now).toISOString(), reset: Boolean(input.reset), websites: [] };
  const deadline = Date.now() + (input.budgetMs ?? 20_000);
  const days = Math.max(1, Math.min(DEMO_HISTORY_DAYS, Math.round(input.days ?? DEMO_HISTORY_DAYS)));
  const runKey = RUN_KEY(websiteIds);
  let run = (await env.CACHE.get<BackfillRun>(runKey, 'json')) ?? null;
  if (!run || run.done) {
    const from = hourFloor(now) - days * DAY_MS;
    run = { reset: Boolean(input.reset), days, startedAt: now, done: false, sites: {} };
    for (const websiteId of websiteIds) run.sites[websiteId] = { phase: input.reset ? 'wipe' : 'generate', from, cursor: from, wipedObjects: 0 };
  }
  const save = () => env.CACHE.put(runKey, JSON.stringify(run), { expirationTtl: 7 * 86_400 });

  const report: BackfillResult['websites'] = [];
  for (const websiteId of websiteIds) {
    const state = run.sites[websiteId]!;
    const website = await loadDemoWebsite(env, websiteId);
    if (!website) {
      state.phase = 'done';
      report.push({ websiteId, phase: 'missing', until: null });
      continue;
    }
    if (state.phase !== 'done') await env.CACHE.put(ACTIVE_KEY(websiteId), String(now), { expirationTtl: 3 * 3600 });

    if (state.phase === 'wipe' && Date.now() < deadline) {
      const wiped = await wipeDemoWebsite(env, website, deadline);
      state.wipedObjects += wiped.objects;
      if (wiped.done) state.phase = 'generate';
      await save();
    }
    if (state.phase === 'generate' && Date.now() < deadline) {
      await ensureDemoConfig(env, website, now, { force: state.cursor === state.from });
      const range = await generateRange(env, demoSite(website), state.cursor, now, {
        deadline,
        maxHours: input.maxHours ?? 48,
        maxReplayChunks: 500,
      });
      state.cursor = range.cursor;
      await env.CACHE.put(WATERMARK_KEY(websiteId), String(range.cursor));
      if (range.complete) {
        await siteStoreStub(env, websiteId).rebuildRollups(websiteId);
        state.phase = 'done';
        await env.CACHE.delete(ACTIVE_KEY(websiteId));
      }
      await save();
    }
    report.push({ websiteId, phase: state.phase, until: new Date(state.cursor).toISOString(), wipedObjects: state.wipedObjects });
    if (state.phase !== 'done') break;
  }
  for (const websiteId of websiteIds) {
    if (!report.some((row) => row.websiteId === websiteId)) {
      const state = run.sites[websiteId]!;
      report.push({ websiteId, phase: state.phase, until: new Date(state.cursor).toISOString(), wipedObjects: state.wipedObjects });
    }
  }
  run.done = Object.values(run.sites).every((site) => site.phase === 'done');
  await save();
  const until = Math.min(...Object.values(run.sites).map((site) => site.cursor));
  return { done: run.done, until: new Date(until).toISOString(), reset: run.reset, websites: report };
}

/**
 * Removes a demo website's analytics: its replay objects in R2 first (the retention rule), then
 * the whole website store, then the generator's D1 rows (survey responses of the demo surveys,
 * runs of the demo workflows). Configuration is kept. Returns done=false when R2 still has
 * objects left for the next call.
 */
export async function wipeDemoWebsite(env: Env, website: DemoWebsite, deadline: number): Promise<{ done: boolean; objects: number }> {
  const { websiteId } = website;
  if (!isDemoWebsiteId(websiteId)) throw new Error('Only demo websites can be wiped');
  let objects = 0;
  if (env.REPLAY_BUCKET) {
    for (;;) {
      if (Date.now() > deadline) return { done: false, objects };
      const listed = await env.REPLAY_BUCKET.list({ prefix: `${websiteId}/`, limit: 1000 });
      if (!listed.objects.length) break;
      await env.REPLAY_BUCKET.delete(listed.objects.map((object) => object.key));
      objects += listed.objects.length;
      if (!listed.truncated && listed.objects.length < 1000) {
        const again = await env.REPLAY_BUCKET.list({ prefix: `${websiteId}/`, limit: 1 });
        if (!again.objects.length) break;
      }
    }
  }
  await siteStoreStub(env, websiteId).erase();

  const surveys = demoSurveys(website.kind).map((survey) => surveyId(websiteId, survey.key));
  const workflows = demoWorkflows(website.kind).map((workflow) => workflowId(websiteId, workflow.key));
  const statements: D1PreparedStatement[] = [];
  const list = (ids: string[], offset: number) => ids.map((_, index) => `?${index + offset}`).join(', ');
  if (surveys.length) {
    statements.push(env.DB.prepare(`DELETE FROM survey_response WHERE website_id = ?1 AND survey_id IN (${list(surveys, 2)})`).bind(websiteId, ...surveys));
  }
  if (workflows.length) {
    statements.push(
      env.DB.prepare(`DELETE FROM workflow_execution_attempt WHERE website_id = ?1 AND workflow_id IN (${list(workflows, 2)})`).bind(websiteId, ...workflows),
      env.DB.prepare(`DELETE FROM workflow_execution WHERE website_id = ?1 AND workflow_id IN (${list(workflows, 2)})`).bind(websiteId, ...workflows),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  await Promise.all([env.CACHE.delete(WATERMARK_KEY(websiteId)), env.CACHE.delete(`demo-data:config:${websiteId}`)]);
  return { done: true, objects };
}
