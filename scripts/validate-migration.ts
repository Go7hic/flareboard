#!/usr/bin/env tsx
/**
 * Post-migration sanity checks against D1 (local or remote).
 *
 * Usage:
 *   pnpm validate:migration
 *   pnpm validate:migration -- --remote
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = 'apps/api/wrangler.jsonc';

function parseArgs() {
  return { remote: process.argv.includes('--remote') };
}

function query(sql: string, remote: boolean): string {
  const out = execSync(
    `wrangler d1 execute flareboard-db ${remote ? '--remote --env production' : '--local'} --config ${configPath} --command "${sql.replace(/"/g, '\\"')}" --json`,
    { cwd: root, encoding: 'utf8' },
  );
  const parsed = JSON.parse(out) as Array<{ results: Array<{ rows: Array<Record<string, number>> }> }>;
  const row = parsed[0]?.results?.[0]?.rows?.[0];
  return String(Object.values(row ?? {})[0] ?? '0');
}

function main() {
  const { remote } = parseArgs();
  const tables = [
    'user',
    'website',
    'session',
    'website_event',
    'event_data',
    'session_data',
    'team',
    'team_user',
    'segment',
    'report',
    'board',
    'share',
    'revenue',
    'rollup_stats_daily',
    'rollup_pageview_series',
    'rollup_dimension_daily',
    'rollup_event_daily',
    'rollup_session_day',
    'session_replay_summary',
  ];

  console.log(`Validating D1 (${remote ? 'remote' : 'local'})…`);
  let ok = true;
  for (const table of tables) {
    try {
      const count = query(`SELECT COUNT(*) as c FROM ${table}`, remote);
      console.log(`  ${table}: ${count}`);
      if (table === 'user' && Number(count) === 0) {
        console.warn('  ⚠ user table empty — expected at least one admin');
        ok = false;
      }
    } catch (e) {
      console.error(`  ✗ ${table}: ${(e as Error).message}`);
      ok = false;
    }
  }

  if (!ok) process.exit(1);
  console.log('Validation finished.');
}

main();
