#!/usr/bin/env tsx
/**
 * Backfill rollup tables from raw website_event data.
 *
 * Usage:
 *   pnpm backfill:rollups
 *   pnpm backfill:rollups -- --remote
 *   pnpm backfill:rollups -- --website=<uuid>
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = 'apps/api/wrangler.jsonc';

const DAY = "strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch'))";
const DAY_E = "strftime('%Y-%m-%d', datetime(e.created_at / 1000, 'unixepoch'))";
const HOUR_BUCKET = "strftime('%Y-%m-%d %H:00', datetime(created_at / 1000, 'unixepoch'))";

function parseArgs() {
  const remote = process.argv.includes('--remote');
  const websiteArg = process.argv.find((a) => a.startsWith('--website='));
  return { remote, websiteId: websiteArg?.split('=')[1] };
}

function wranglerD1Flags(remote: boolean) {
  return remote ? '--remote --env production' : '--local';
}

function run(sql: string, remote: boolean) {
  execSync(
    `wrangler d1 execute flareboard-db ${wranglerD1Flags(remote)} --config ${configPath} --command "${sql.replace(/"/g, '\\"')}"`,
    { cwd: root, stdio: 'inherit' },
  );
}

function main() {
  const { remote, websiteId } = parseArgs();
  const scope = websiteId ? `AND website_id = '${websiteId}'` : '';
  const scopeE = websiteId ? `AND e.website_id = '${websiteId}'` : '';

  console.log(`Backfilling rollups (${remote ? 'remote' : 'local'})…`);

  run('DELETE FROM rollup_session_day;', remote);
  run('DELETE FROM rollup_stats_daily;', remote);
  run('DELETE FROM rollup_pageview_series;', remote);
  run('DELETE FROM rollup_dimension_daily;', remote);
  run('DELETE FROM rollup_event_daily;', remote);

  run(
    `INSERT INTO rollup_session_day (website_id, day, session_id, visit_id, pageviews, first_at, last_at)
     SELECT website_id,
            ${DAY},
            session_id,
            visit_id,
            COUNT(*),
            MIN(created_at),
            MAX(created_at)
     FROM website_event
     WHERE event_type = 1 ${scope}
     GROUP BY website_id, ${DAY}, session_id;`,
    remote,
  );

  run(
    `INSERT INTO rollup_stats_daily (website_id, day, pageviews, visitors, visits, bounces, totaltime_sec)
     SELECT website_id,
            day,
            SUM(pageviews),
            COUNT(*),
            COUNT(DISTINCT visit_id),
            SUM(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END),
            COALESCE(SUM((last_at - first_at) / 1000), 0)
     FROM rollup_session_day
     ${websiteId ? `WHERE website_id = '${websiteId}'` : ''}
     GROUP BY website_id, day;`,
    remote,
  );

  run(
    `INSERT INTO rollup_pageview_series (website_id, unit, bucket, pageviews)
     SELECT website_id, 'day', ${DAY}, COUNT(*)
     FROM website_event WHERE event_type = 1 ${scope}
     GROUP BY website_id, ${DAY};`,
    remote,
  );

  run(
    `INSERT INTO rollup_pageview_series (website_id, unit, bucket, pageviews)
     SELECT website_id, 'hour', ${HOUR_BUCKET}, COUNT(*)
     FROM website_event WHERE event_type = 1 ${scope}
     GROUP BY website_id, ${HOUR_BUCKET};`,
    remote,
  );

  run(
    `INSERT INTO rollup_dimension_daily (website_id, day, dimension, value, count)
     SELECT e.website_id,
            ${DAY_E},
            'path',
            e.url_path,
            COUNT(*)
     FROM website_event e
     WHERE e.event_type = 1 ${scopeE}
     GROUP BY e.website_id, ${DAY_E}, e.url_path;`,
    remote,
  );

  run(
    `INSERT INTO rollup_dimension_daily (website_id, day, dimension, value, count)
     SELECT e.website_id,
            ${DAY_E},
            'referrer',
            COALESCE(e.referrer_domain, 'Direct'),
            COUNT(*)
     FROM website_event e
     WHERE e.event_type = 1 ${scopeE}
     GROUP BY e.website_id, ${DAY_E}, COALESCE(e.referrer_domain, 'Direct');`,
    remote,
  );

  run(
    `INSERT INTO rollup_dimension_daily (website_id, day, dimension, value, count)
     SELECT e.website_id,
            ${DAY_E},
            'country',
            COALESCE(s.country, 'Unknown'),
            COUNT(*)
     FROM website_event e
     LEFT JOIN session s ON s.session_id = e.session_id
     WHERE e.event_type = 1 ${scopeE}
     GROUP BY e.website_id, ${DAY_E}, COALESCE(s.country, 'Unknown');`,
    remote,
  );

  run(
    `INSERT INTO rollup_event_daily (website_id, day, event_name, count)
     SELECT website_id,
            ${DAY},
            COALESCE(event_name, 'Unknown'),
            COUNT(*)
     FROM website_event
     WHERE event_type = 2 ${scope}
     GROUP BY website_id, ${DAY}, COALESCE(event_name, 'Unknown');`,
    remote,
  );

  run(
    `INSERT INTO session_replay_summary (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks)
     SELECT website_id, visit_id, session_id,
            MIN(started_at), MAX(ended_at), SUM(event_count), COUNT(*)
     FROM session_replay
     ${websiteId ? `WHERE website_id = '${websiteId}'` : ''}
     GROUP BY website_id, visit_id;`,
    remote,
  );

  console.log('Rollup backfill complete.');
}

main();
