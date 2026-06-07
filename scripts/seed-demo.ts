#!/usr/bin/env tsx
/**
 * Seed local D1 with demo analytics data for dashboard development.
 *
 * Usage:
 *   pnpm seed:demo
 *   pnpm seed:demo -- --fresh          # default — replace demo websites + data
 *   pnpm seed:demo -- --skip-admin     # assume admin already exists
 *   pnpm seed:demo -- --days 30        # history window (default 30)
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_TYPE, hashPassword, ROLES, uuid } from '@flareboard/shared';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = 'apps/api/wrangler.jsonc';
const wranglerBin = join(root, 'node_modules/.bin/wrangler');
const wrangler = existsSync(wranglerBin) ? wranglerBin : 'wrangler';

const LOCAL_DEFAULT_USERNAME = 'admin';
const LOCAL_DEFAULT_PASSWORD = 'flareboard';
const BATCH_SIZE = 400;

const DEMO_WEBSITE_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
] as const;

const DEMO_WEBSITES = [
  {
    id: DEMO_WEBSITE_IDS[0],
    name: 'Demo Store',
    domain: 'demo-store.example.com',
    paths: ['/', '/pricing', '/features', '/blog', '/blog/launch', '/about', '/checkout'],
    referrers: ['google.com', 'twitter.com', 'news.ycombinator.com', 'github.com', null] as const,
    customEvents: ['signup', 'cta_click', 'download', 'purchase'] as const,
    replayEnabled: true,
    heatmapConfig: { enabled: true, sampleRate: 1, previewUrl: 'https://demo-store.example.com' },
    goalConfig: {
      goals: [
        { event: 'signup', target: 50, period: 'monthly' },
        { event: 'purchase', target: 10, period: 'monthly' },
      ],
    },
  },
  {
    id: DEMO_WEBSITE_IDS[1],
    name: 'Demo Docs',
    domain: 'docs.example.com',
    paths: ['/', '/getting-started', '/api', '/guides/tracking', '/changelog'],
    referrers: ['google.com', 'bing.com', 'stackoverflow.com', 'dev.to', null] as const,
    customEvents: ['search', 'copy_snippet', 'feedback'] as const,
    replayEnabled: false,
    heatmapConfig: { enabled: true, sampleRate: 0.5 },
    goalConfig: { goals: [{ event: 'copy_snippet', target: 100, period: 'monthly' }] },
  },
] as const;

const COHORT_IDS = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
] as const;

const SEGMENT_IDS = [
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
] as const;

const COUNTRIES = [
  { country: 'US', region: 'California', city: 'San Francisco' },
  { country: 'DE', region: 'Berlin', city: 'Berlin' },
  { country: 'JP', region: 'Tokyo', city: 'Tokyo' },
  { country: 'GB', region: 'England', city: 'London' },
  { country: 'CN', region: 'Shanghai', city: 'Shanghai' },
  { country: 'FR', region: 'Île-de-France', city: 'Paris' },
  { country: 'CA', region: 'Ontario', city: 'Toronto' },
  { country: 'AU', region: 'New South Wales', city: 'Sydney' },
] as const;

const BROWSERS = [
  { browser: 'Chrome', os: 'Windows', device: 'desktop', screen: '1920x1080' },
  { browser: 'Safari', os: 'macOS', device: 'desktop', screen: '1440x900' },
  { browser: 'Firefox', os: 'Linux', device: 'desktop', screen: '1366x768' },
  { browser: 'Mobile Safari', os: 'iOS', device: 'mobile', screen: '390x844' },
  { browser: 'Chrome', os: 'Android', device: 'mobile', screen: '412x915' },
  { browser: 'Edge', os: 'Windows', device: 'desktop', screen: '1536x864' },
] as const;

type Options = {
  fresh: boolean;
  skipAdmin: boolean;
  days: number;
  remote: boolean;
};

function printUsage(): void {
  console.log(`Seed demo analytics data into local Flareboard D1.

Usage:
  pnpm seed:demo [--] [options]

Options:
  --fresh               Replace demo websites and analytics (default)
  --no-fresh            Skip if demo websites already exist
  --skip-admin          Do not create/update admin user
  --days <n>            Days of history to generate (default: 30)
  --remote              Target production D1 (not recommended for demo data)
  --help, -h            Show this help

Creates:
  - Admin user admin / flareboard (unless --skip-admin)
  - 2 demo websites with domains, goals, and heatmap config
  - ~30 days of sessions, pageviews, custom events, performance samples
  - Heatmap click cells, cohorts, segments, sample revenue
  - Session replay metadata (playback needs local R2 — see docs/development.md)

Re-running with --fresh deletes and recreates demo website data only.
Other websites and users are left untouched.
`);
}

function parseArgs(argv: string[]): Options {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let days = 30;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        console.error('Missing value for --days');
        process.exit(1);
      }
      days = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        console.error('--days must be between 1 and 365');
        process.exit(1);
      }
    }
  }

  return {
    fresh: !argv.includes('--no-fresh'),
    skipAdmin: argv.includes('--skip-admin'),
    days,
    remote: argv.includes('--remote'),
  };
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function jsonSql(value: unknown): string {
  return `'${sqlEscape(JSON.stringify(value))}'`;
}

function wranglerFlags(remote: boolean): string[] {
  return remote ? ['--remote', '--env', 'production'] : ['--local'];
}

function queryD1<T extends Record<string, unknown>>(
  sql: string,
  remote: boolean,
): T[] {
  const out = execFileSync(
    wrangler,
    [
      'd1',
      'execute',
      'flareboard-db',
      ...wranglerFlags(remote),
      '--config',
      configPath,
      '--command',
      sql,
      '--json',
    ],
    { cwd: root, encoding: 'utf-8' },
  );
  const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

function runSqlBatch(statements: string[], remote: boolean): void {
  if (!statements.length) return;
  const file = join(root, '.seed-demo-batch.sql');
  writeFileSync(file, statements.join('\n'));
  try {
    execFileSync(
      wrangler,
      [
        'd1',
        'execute',
        'flareboard-db',
        ...wranglerFlags(remote),
        '--config',
        configPath,
        '--file',
        file,
      ],
      { cwd: root, stdio: 'inherit' },
    );
  } finally {
    unlinkSync(file);
  }
}

function flushBatch(batch: string[], remote: boolean, force = false): void {
  if (batch.length >= BATCH_SIZE || (force && batch.length > 0)) {
    runSqlBatch(batch.splice(0, batch.length), remote);
  }
}

function seedAdmin(remote: boolean): void {
  const passwordHash = hashPassword(LOCAL_DEFAULT_PASSWORD);
  const adminId = uuid(LOCAL_DEFAULT_USERNAME, 'admin-seed');
  const now = Date.now();
  const sql = `INSERT INTO user (user_id, username, password, role, created_at, updated_at) VALUES ('${adminId}', '${sqlEscape(LOCAL_DEFAULT_USERNAME)}', '${sqlEscape(passwordHash)}', '${ROLES.admin}', ${now}, ${now}) ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role, updated_at = excluded.updated_at;`;
  execFileSync(
    wrangler,
    [
      'd1',
      'execute',
      'flareboard-db',
      ...wranglerFlags(remote),
      '--config',
      configPath,
      '--command',
      sql,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}

function getAdminUserId(remote: boolean): string {
  const rows = queryD1<{ user_id: string }>(
    `SELECT user_id FROM user WHERE username = '${sqlEscape(LOCAL_DEFAULT_USERNAME)}' LIMIT 1`,
    remote,
  );
  if (!rows[0]?.user_id) {
    throw new Error(`Admin user "${LOCAL_DEFAULT_USERNAME}" not found. Run without --skip-admin.`);
  }
  return rows[0].user_id;
}

function demoWebsitesExist(remote: boolean): boolean {
  const ids = DEMO_WEBSITE_IDS.map((id) => `'${id}'`).join(',');
  const rows = queryD1<{ count: number }>(
    `SELECT COUNT(*) as count FROM website WHERE website_id IN (${ids})`,
    remote,
  );
  return (rows[0]?.count ?? 0) > 0;
}

function deleteDemoData(remote: boolean): void {
  const ids = DEMO_WEBSITE_IDS.map((id) => `'${id}'`).join(',');
  const statements = [
    `DELETE FROM event_data WHERE website_id IN (${ids});`,
    `DELETE FROM website_event WHERE website_id IN (${ids});`,
    `DELETE FROM session_data WHERE website_id IN (${ids});`,
    `DELETE FROM revenue WHERE website_id IN (${ids});`,
    `DELETE FROM heatmap_cell WHERE website_id IN (${ids});`,
    `DELETE FROM cohort WHERE website_id IN (${ids});`,
    `DELETE FROM segment WHERE website_id IN (${ids});`,
    `DELETE FROM report WHERE website_id IN (${ids});`,
    `DELETE FROM session_replay WHERE website_id IN (${ids});`,
    `DELETE FROM session_replay_summary WHERE website_id IN (${ids});`,
    `DELETE FROM session_replay_saved WHERE website_id IN (${ids});`,
    `DELETE FROM rollup_session_day WHERE website_id IN (${ids});`,
    `DELETE FROM rollup_stats_daily WHERE website_id IN (${ids});`,
    `DELETE FROM rollup_pageview_series WHERE website_id IN (${ids});`,
    `DELETE FROM rollup_dimension_daily WHERE website_id IN (${ids});`,
    `DELETE FROM rollup_event_daily WHERE website_id IN (${ids});`,
    `DELETE FROM website_email_report WHERE website_id IN (${ids});`,
    `DELETE FROM session WHERE website_id IN (${ids});`,
    `DELETE FROM website WHERE website_id IN (${ids});`,
  ];
  runSqlBatch(statements, remote);
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

type GeneratedStats = {
  sessions: number;
  pageviews: number;
  customEvents: number;
  performanceEvents: number;
  revenueRows: number;
  heatmapCells: number;
  replaySummaries: number;
};

function generateDemoData(
  adminUserId: string,
  days: number,
  remote: boolean,
): GeneratedStats {
  const rand = mulberry32(42);
  const now = Date.now();
  const startMs = now - days * 24 * 60 * 60 * 1000;
  const batch: string[] = [];
  const stats: GeneratedStats = {
    sessions: 0,
    pageviews: 0,
    customEvents: 0,
    performanceEvents: 0,
    revenueRows: 0,
    heatmapCells: 0,
    replaySummaries: 0,
  };

  const push = (sql: string) => {
    batch.push(sql);
    flushBatch(batch, remote);
  };

  for (const site of DEMO_WEBSITES) {
    const createdAt = now - (days + 5) * 24 * 60 * 60 * 1000;
    push(
      `INSERT INTO website (website_id, name, domain, user_id, created_by, created_at, updated_at, replay_enabled, replay_config, heatmap_config, goal_config) VALUES ('${site.id}', '${sqlEscape(site.name)}', '${sqlEscape(site.domain)}', '${adminUserId}', '${adminUserId}', ${createdAt}, ${now}, ${site.replayEnabled ? 1 : 0}, NULL, ${jsonSql(site.heatmapConfig)}, ${jsonSql(site.goalConfig)});`,
    );
  }

  push(
    `INSERT INTO cohort (cohort_id, website_id, name, type, value, definition, created_at, updated_at) VALUES ('${COHORT_IDS[0]}', '${DEMO_WEBSITE_IDS[0]}', 'Signed up', 'event', 'signup', ${jsonSql({ conditions: [{ field: 'event_name', operator: 'equals', value: 'signup' }] })}, ${now}, ${now});`,
  );
  push(
    `INSERT INTO cohort (cohort_id, website_id, name, type, value, definition, created_at, updated_at) VALUES ('${COHORT_IDS[1]}', '${DEMO_WEBSITE_IDS[0]}', 'Pricing page', 'url', '/pricing', ${jsonSql({ conditions: [{ field: 'url_path', operator: 'equals', value: '/pricing' }] })}, ${now}, ${now});`,
  );

  push(
    `INSERT INTO segment (segment_id, website_id, type, name, parameters, created_at, updated_at) VALUES ('${SEGMENT_IDS[0]}', '${DEMO_WEBSITE_IDS[0]}', 'segment', 'US visitors', ${jsonSql({ country: 'US' })}, ${now}, ${now});`,
  );
  push(
    `INSERT INTO segment (segment_id, website_id, type, name, parameters, created_at, updated_at) VALUES ('${SEGMENT_IDS[1]}', '${DEMO_WEBSITE_IDS[1]}', 'segment', 'Blog readers', ${jsonSql({ pathContains: '/guides' })}, ${now}, ${now});`,
  );

  const replayVisits: Array<{
    websiteId: string;
    sessionId: string;
    visitId: string;
    startedAt: number;
    endedAt: number;
  }> = [];
  let visitCounter = 0;

  for (const site of DEMO_WEBSITES) {
    const siteWeight = site.id === DEMO_WEBSITE_IDS[0] ? 0.6 : 0.4;

    for (let dayOffset = days; dayOffset >= 0; dayOffset--) {
      const dayStart = startMs + (days - dayOffset) * 24 * 60 * 60 * 1000;
      const recencyBoost = 1 + (days - dayOffset) / days;
      const visitsToday = Math.floor((12 + rand() * 18) * siteWeight * recencyBoost);

      for (let v = 0; v < visitsToday; v++) {
        const visitKey = visitCounter++;
        const sessionId = uuid('demo-session', site.id, visitKey);
        const visitId = uuid('demo-visit', site.id, visitKey);
        const profile = pick(BROWSERS, rand);
        const geo = pick(COUNTRIES, rand);
        const visitStart =
          dayStart + Math.floor(rand() * 24 * 60 * 60 * 1000) - 12 * 60 * 60 * 1000;
        const clampedStart = Math.max(dayStart, Math.min(visitStart, now - 60_000));

        push(
          `INSERT INTO session (session_id, website_id, browser, os, device, screen, language, country, region, city, distinct_id, created_at) VALUES ('${sessionId}', '${site.id}', '${sqlEscape(profile.browser)}', '${sqlEscape(profile.os)}', '${sqlEscape(profile.device)}', '${profile.screen}', 'en-US', '${geo.country}', '${sqlEscape(geo.region)}', '${sqlEscape(geo.city)}', '${uuid('distinct', sessionId)}', ${clampedStart});`,
        );
        stats.sessions++;

        const pageCount = 1 + Math.floor(rand() * 4);
        const referrer = pick(site.referrers, rand);
        let eventTs = clampedStart;

        for (let p = 0; p < pageCount; p++) {
          const path = pick(site.paths, rand);
          eventTs += 5_000 + Math.floor(rand() * 120_000);
          if (eventTs > now) break;

          const eventId = uuid('demo-pv', site.id, sessionId, p, eventTs);
          const utm =
            referrer && rand() > 0.7
              ? `utm_source=${referrer.split('.')[0]}&utm_medium=social`
              : null;

          push(
            `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, url_query, referrer_domain, page_title, event_type, hostname) VALUES ('${eventId}', '${site.id}', '${sessionId}', '${visitId}', ${eventTs}, '${sqlEscape(path)}', ${utm ? `'${sqlEscape(utm)}'` : 'NULL'}, ${referrer ? `'${sqlEscape(referrer)}'` : 'NULL'}, '${sqlEscape(`${site.name}${path}`)}', ${EVENT_TYPE.pageView}, '${sqlEscape(site.domain)}');`,
          );
          stats.pageviews++;

          if (site.id === DEMO_WEBSITE_IDS[0] && (path === '/' || path === '/pricing') && rand() > 0.55) {
            const normX = 200 + Math.floor(rand() * 600);
            const normY = 150 + Math.floor(rand() * 500);
            const day = dayKey(eventTs);
            push(
              `INSERT INTO heatmap_cell (website_id, url_path, day, kind, norm_x, norm_y, device_class, viewport_w, viewport_h, count) VALUES ('${site.id}', '${sqlEscape(path)}', '${day}', 'click', ${normX}, ${normY}, '${profile.device}', ${profile.device === 'mobile' ? 390 : 1440}, ${profile.device === 'mobile' ? 844 : 900}, ${1 + Math.floor(rand() * 5)}) ON CONFLICT(website_id, url_path, day, kind, norm_x, norm_y, device_class) DO UPDATE SET count = count + excluded.count;`,
            );
            stats.heatmapCells++;
          }
        }

        if (rand() < 0.35) {
          const eventName = pick(site.customEvents, rand);
          eventTs += 3_000 + Math.floor(rand() * 30_000);
          if (eventTs <= now) {
            const eventId = uuid('demo-ce', site.id, sessionId, eventName, eventTs);
            push(
              `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name, hostname) VALUES ('${eventId}', '${site.id}', '${sessionId}', '${visitId}', ${eventTs}, '${sqlEscape(pick(site.paths, rand))}', ${EVENT_TYPE.customEvent}, '${sqlEscape(eventName)}', '${sqlEscape(site.domain)}');`,
            );
            stats.customEvents++;

            if (eventName === 'purchase' && site.id === DEMO_WEBSITE_IDS[0]) {
              const revenueId = uuid('demo-rev', eventId);
              push(
                `INSERT INTO revenue (revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at) VALUES ('${revenueId}', '${site.id}', '${sessionId}', '${eventId}', 'purchase', 'USD', ${(19.99 + rand() * 180).toFixed(2)}, ${eventTs});`,
              );
              stats.revenueRows++;
            }
          }
        }

        if (site.id === DEMO_WEBSITE_IDS[1] && rand() < 0.2) {
          eventTs += 2_000;
          if (eventTs <= now) {
            const eventId = uuid('demo-perf', site.id, sessionId, eventTs);
            const lcp = 1200 + rand() * 2800;
            const inp = 80 + rand() * 320;
            const cls = rand() * 0.25;
            push(
              `INSERT INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name, hostname, lcp, inp, cls, fcp, ttfb) VALUES ('${eventId}', '${site.id}', '${sessionId}', '${visitId}', ${eventTs}, '${sqlEscape(pick(site.paths, rand))}', ${EVENT_TYPE.performance}, 'performance', '${sqlEscape(site.domain)}', ${lcp.toFixed(1)}, ${inp.toFixed(1)}, ${cls.toFixed(4)}, ${(600 + rand() * 900).toFixed(1)}, ${(120 + rand() * 400).toFixed(1)});`,
            );
            stats.performanceEvents++;
          }
        }

        if (site.replayEnabled && replayVisits.length < 8 && rand() < 0.08) {
          replayVisits.push({
            websiteId: site.id,
            sessionId,
            visitId,
            startedAt: clampedStart,
            endedAt: eventTs,
          });
        }
      }
    }
  }

  for (const replay of replayVisits) {
    const replayId = uuid('demo-replay', replay.visitId);
    push(
      `INSERT INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at) VALUES ('${replayId}', '${replay.websiteId}', '${replay.sessionId}', '${replay.visitId}', 0, X'', 12, ${replay.startedAt}, ${replay.endedAt}, ${replay.endedAt});`,
    );
    stats.replaySummaries++;
  }

  flushBatch(batch, remote, true);
  return stats;
}

function backfillRollups(remote: boolean): void {
  // backfill-rollups.ts rebuilds summaries from session_replay but does not clear first
  runSqlBatch(['DELETE FROM session_replay_summary;'], remote);
  const flag = remote ? '--remote' : '';
  execSync(`tsx scripts/backfill-rollups.ts ${flag}`.trim(), {
    cwd: root,
    stdio: 'inherit',
  });
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const target = opts.remote ? 'remote production D1' : 'local D1';

  console.log(`Seeding demo data on ${target}...`);

  if (!opts.skipAdmin) {
    console.log(`Ensuring admin user (${LOCAL_DEFAULT_USERNAME} / ${LOCAL_DEFAULT_PASSWORD})...`);
    seedAdmin(opts.remote);
  }

  const adminUserId = getAdminUserId(opts.remote);

  if (!opts.fresh && demoWebsitesExist(opts.remote)) {
    console.log('Demo websites already exist. Use --fresh (default) to replace demo data.');
    process.exit(0);
  }

  if (opts.fresh) {
    console.log('Removing previous demo website data...');
    deleteDemoData(opts.remote);
  }

  console.log(`Generating ${opts.days} days of analytics...`);
  const stats = generateDemoData(adminUserId, opts.days, opts.remote);

  console.log('Backfilling rollup tables...');
  backfillRollups(opts.remote);

  console.log('\nDemo seed complete.');
  console.log(`  Websites: ${DEMO_WEBSITES.map((w) => w.name).join(', ')}`);
  console.log(`  Sessions: ${stats.sessions}`);
  console.log(`  Pageviews: ${stats.pageviews}`);
  console.log(`  Custom events: ${stats.customEvents}`);
  console.log(`  Performance events: ${stats.performanceEvents}`);
  console.log(`  Revenue rows: ${stats.revenueRows}`);
  console.log(`  Heatmap cells: ${stats.heatmapCells}`);
  console.log(`  Replay summaries: ${stats.replaySummaries} (playback needs R2 chunks)`);
  console.log(`\nSign in: ${LOCAL_DEFAULT_USERNAME} / ${LOCAL_DEFAULT_PASSWORD}`);
  console.log('Start: pnpm dev:api && pnpm dev:dashboard');
}

try {
  main();
} catch (err) {
  const hint = 'Run `pnpm db:migrate` first.';
  console.error('Demo seed failed.', hint);
  if (err instanceof Error) console.error(err.message);
  process.exit(1);
}
