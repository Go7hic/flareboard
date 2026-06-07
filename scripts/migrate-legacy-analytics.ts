#!/usr/bin/env tsx
/**
 * Import legacy analytics PostgreSQL or JSON export into Flareboard D1.
 * Expects legacy analytics v3 PostgreSQL dump column/table layout (source format only).
 *
 * JSON format (all keys optional):
 * { users, websites, sessions, events, event_data, session_data, teams, team_users,
 *   segments, reports, boards, shares, revenue }
 *
 * Usage:
 *   pnpm migrate:legacy -- --json ./legacy-export.json
 *   pnpm migrate:legacy -- --postgres "$DATABASE_URL"
 *   pnpm migrate:legacy -- --json ./export.json --remote
 *   pnpm migrate:legacy -- --json ./export.json --dry-run
 *   pnpm migrate:legacy -- --replay-r2-source legacy-replays --replay-r2-dest flareboard-replays --remote
 *   pnpm migrate:legacy -- --replay-r2-source legacy-replays --replay-r2-dest flareboard-replays --dry-run
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = 'apps/api/wrangler.jsonc';

interface LegacyExportUser {
  user_id: string;
  username: string;
  password: string;
  role: string;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportWebsite {
  website_id: string;
  name: string;
  domain?: string | null;
  user_id?: string | null;
  team_id?: string | null;
  created_by?: string | null;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportSession {
  session_id: string;
  website_id: string;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  language?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  created_at?: number | string | null;
}

interface LegacyExportEvent {
  event_id: string;
  website_id: string;
  session_id: string;
  visit_id: string;
  created_at?: number | string | null;
  url_path: string;
  url_query?: string | null;
  referrer_domain?: string | null;
  page_title?: string | null;
  event_type?: number;
  event_name?: string | null;
  hostname?: string | null;
  lcp?: number | null;
  inp?: number | null;
  cls?: number | null;
  fcp?: number | null;
  ttfb?: number | null;
}

interface LegacyExportEventData {
  event_data_id: string;
  website_id: string;
  website_event_id: string;
  data_key: string;
  string_value?: string | null;
  number_value?: number | null;
  date_value?: number | string | null;
  data_type: number;
  created_at?: number | string | null;
}

interface LegacyExportSessionData {
  session_data_id: string;
  website_id: string;
  session_id: string;
  data_key: string;
  string_value?: string | null;
  number_value?: number | null;
  date_value?: number | string | null;
  data_type: number;
  created_at?: number | string | null;
}

interface LegacyExportTeam {
  team_id: string;
  name: string;
  access_code?: string | null;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportTeamUser {
  team_user_id: string;
  team_id: string;
  user_id: string;
  role: string;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportSegment {
  segment_id: string;
  website_id: string;
  type: string;
  name: string;
  parameters: string | Record<string, unknown>;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportReport {
  report_id: string;
  user_id: string;
  website_id: string;
  type: string;
  name: string;
  description?: string | null;
  parameters: string | Record<string, unknown>;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportBoard {
  board_id: string;
  user_id: string;
  team_id?: string | null;
  type: string;
  name: string;
  description?: string | null;
  parameters: string | Record<string, unknown>;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportShare {
  share_id: string;
  entity_id: string;
  name: string;
  share_type: string;
  slug: string;
  parameters: string | Record<string, unknown>;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

interface LegacyExportRevenue {
  revenue_id: string;
  website_id: string;
  session_id: string;
  event_id: string;
  event_name: string;
  currency: string;
  revenue: number;
  created_at?: number | string | null;
}

interface LegacyExportSessionReplay {
  replay_id: string;
  website_id: string;
  session_id: string;
  visit_id: string;
  chunk_index: number;
  event_count?: number;
  started_at?: number | string | null;
  ended_at?: number | string | null;
  created_at?: number | string | null;
}

interface ExportBundle {
  users?: LegacyExportUser[];
  websites?: LegacyExportWebsite[];
  sessions?: LegacyExportSession[];
  events?: LegacyExportEvent[];
  event_data?: LegacyExportEventData[];
  session_data?: LegacyExportSessionData[];
  teams?: LegacyExportTeam[];
  team_users?: LegacyExportTeamUser[];
  segments?: LegacyExportSegment[];
  reports?: LegacyExportReport[];
  boards?: LegacyExportBoard[];
  shares?: LegacyExportShare[];
  revenue?: LegacyExportRevenue[];
  session_replays?: LegacyExportSessionReplay[];
}

function jsonParam(v: string | Record<string, unknown>): string {
  const raw = typeof v === 'string' ? v : JSON.stringify(v);
  return esc(raw);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const pgIdx = args.indexOf('--postgres');
  const srcIdx = args.indexOf('--replay-r2-source');
  const destIdx = args.indexOf('--replay-r2-dest');
  return {
    jsonFile: jsonIdx >= 0 ? args[jsonIdx + 1] : null,
    postgresUrl: pgIdx >= 0 ? args[pgIdx + 1] : null,
    remote: args.includes('--remote'),
    dryRun: args.includes('--dry-run'),
    batchSize: Number(args.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? 100),
    replayR2Source: srcIdx >= 0 ? args[srcIdx + 1] : null,
    replayR2Dest: destIdx >= 0 ? args[destIdx + 1] : null,
  };
}

function ts(v: number | string | null | undefined): number {
  if (v == null) return Date.now();
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? Date.now() : n;
}

function esc(s: string | null | undefined): string {
  if (s == null) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function num(n: number | null | undefined): string {
  return n == null ? 'NULL' : String(n);
}

async function loadFromPostgres(url: string): Promise<ExportBundle> {
  let pg: typeof import('pg');
  try {
    pg = await import('pg');
  } catch {
    console.error('Install pg: pnpm add -D pg @types/pg');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const users = (await client.query('SELECT * FROM "user" WHERE deleted_at IS NULL')).rows;
  const websites = (await client.query('SELECT * FROM website WHERE deleted_at IS NULL')).rows;
  const sessions = (await client.query('SELECT * FROM session ORDER BY created_at')).rows;
  const events = (await client.query('SELECT * FROM website_event ORDER BY created_at')).rows;
  const event_data = (await client.query('SELECT * FROM event_data ORDER BY created_at')).rows;
  const session_data = (await client.query('SELECT * FROM session_data ORDER BY created_at')).rows;
  const teams = (await client.query('SELECT * FROM team WHERE deleted_at IS NULL')).rows;
  const team_users = (await client.query('SELECT * FROM team_user')).rows;
  const segments = (await client.query('SELECT * FROM segment')).rows;
  const reports = (await client.query('SELECT * FROM report')).rows;
  const boards = (await client.query('SELECT * FROM board')).rows;
  const shares = (await client.query('SELECT * FROM share')).rows;
  const revenue = (await client.query('SELECT * FROM revenue ORDER BY created_at')).rows;
  let session_replays: LegacyExportSessionReplay[] = [];
  try {
    session_replays = (await client.query('SELECT * FROM session_replay ORDER BY created_at')).rows;
  } catch {
    console.warn('session_replay table not found in source Postgres — skipping replay metadata');
  }
  await client.end();
  return {
    users,
    websites,
    sessions,
    events,
    event_data,
    session_data,
    teams,
    team_users,
    segments,
    reports,
    boards,
    shares,
    revenue,
    session_replays,
  };
}

function runSqlBatch(statements: string[], remote: boolean, dryRun: boolean) {
  if (!statements.length) return;
  if (dryRun) {
    console.log(`[dry-run] ${statements.length} statements`);
    return;
  }
  const flag = remote ? '--remote' : '--local';
  const file = join(root, '.migrate-batch.sql');
  writeFileSync(file, statements.join('\n'));
  try {
    execSync(`wrangler d1 execute flareboard-db ${flag} --config ${configPath} --file "${file}"`, {
      stdio: 'inherit',
      cwd: root,
    });
  } finally {
    unlinkSync(file);
  }
}

async function migrate(bundle: ExportBundle, opts: ReturnType<typeof parseArgs>): Promise<LegacyExportSessionReplay[]> {
  const users = bundle.users ?? [];
  const websites = bundle.websites ?? [];
  const sessions = bundle.sessions ?? [];
  const events = bundle.events ?? [];
  const eventData = bundle.event_data ?? [];
  const sessionData = bundle.session_data ?? [];
  const teams = bundle.teams ?? [];
  const teamUsers = bundle.team_users ?? [];
  const segments = bundle.segments ?? [];
  const reports = bundle.reports ?? [];
  const boards = bundle.boards ?? [];
  const shares = bundle.shares ?? [];
  const revenueRows = bundle.revenue ?? [];
  const replayRows = bundle.session_replays ?? [];

  console.log(
    `Importing ${users.length} users, ${websites.length} websites, ${sessions.length} sessions, ${events.length} events, ${eventData.length} event_data, ${sessionData.length} session_data, ${teams.length} teams, ${teamUsers.length} team_users, ${segments.length} segments, ${reports.length} reports, ${boards.length} boards, ${shares.length} shares, ${revenueRows.length} revenue, ${replayRows.length} session_replays`,
  );

  const pending: string[] = [];

  const flush = (force = false) => {
    if (!pending.length) return;
    if (!force && pending.length < opts.batchSize) return;
    runSqlBatch(pending.splice(0, pending.length), opts.remote, opts.dryRun);
  };

  for (const u of users) {
    pending.push(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (${esc(u.user_id)}, ${esc(u.username)}, ${esc(u.password)}, ${esc(u.role)}, ${ts(u.created_at)}, ${ts(u.updated_at ?? u.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const w of websites) {
    pending.push(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_by, created_at, updated_at) VALUES (${esc(w.website_id)}, ${esc(w.name)}, ${esc(w.domain)}, ${w.user_id ? esc(w.user_id) : 'NULL'}, ${w.team_id ? esc(w.team_id) : 'NULL'}, ${w.created_by ? esc(w.created_by) : w.user_id ? esc(w.user_id) : 'NULL'}, ${ts(w.created_at)}, ${ts(w.updated_at ?? w.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const s of sessions) {
    pending.push(
      `INSERT OR IGNORE INTO session (session_id, website_id, browser, os, device, language, country, region, city, created_at) VALUES (${esc(s.session_id)}, ${esc(s.website_id)}, ${esc(s.browser)}, ${esc(s.os)}, ${esc(s.device)}, ${esc(s.language)}, ${esc(s.country)}, ${esc(s.region)}, ${esc(s.city)}, ${ts(s.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const e of events) {
    pending.push(
      `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, url_query, referrer_domain, page_title, event_type, event_name, hostname, lcp, inp, cls, fcp, ttfb) VALUES (${esc(e.event_id)}, ${esc(e.website_id)}, ${esc(e.session_id)}, ${esc(e.visit_id)}, ${ts(e.created_at)}, ${esc(e.url_path)}, ${esc(e.url_query)}, ${esc(e.referrer_domain)}, ${esc(e.page_title)}, ${num(e.event_type ?? 1)}, ${esc(e.event_name)}, ${esc(e.hostname)}, ${num(e.lcp)}, ${num(e.inp)}, ${num(e.cls)}, ${num(e.fcp)}, ${num(e.ttfb)});`,
    );
    flush();
  }
  flush(true);

  for (const t of teams) {
    pending.push(
      `INSERT OR IGNORE INTO team (team_id, name, access_code, created_at, updated_at) VALUES (${esc(t.team_id)}, ${esc(t.name)}, ${esc(t.access_code)}, ${ts(t.created_at)}, ${ts(t.updated_at ?? t.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const tu of teamUsers) {
    pending.push(
      `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at) VALUES (${esc(tu.team_user_id)}, ${esc(tu.team_id)}, ${esc(tu.user_id)}, ${esc(tu.role)}, ${ts(tu.created_at)}, ${ts(tu.updated_at ?? tu.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const ed of eventData) {
    pending.push(
      `INSERT OR IGNORE INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, date_value, data_type, created_at) VALUES (${esc(ed.event_data_id)}, ${esc(ed.website_id)}, ${esc(ed.website_event_id)}, ${esc(ed.data_key)}, ${esc(ed.string_value)}, ${num(ed.number_value)}, ${ed.date_value != null ? ts(ed.date_value) : 'NULL'}, ${num(ed.data_type)}, ${ts(ed.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const sd of sessionData) {
    pending.push(
      `INSERT OR IGNORE INTO session_data (session_data_id, website_id, session_id, data_key, string_value, number_value, date_value, data_type, created_at) VALUES (${esc(sd.session_data_id)}, ${esc(sd.website_id)}, ${esc(sd.session_id)}, ${esc(sd.data_key)}, ${esc(sd.string_value)}, ${num(sd.number_value)}, ${sd.date_value != null ? ts(sd.date_value) : 'NULL'}, ${num(sd.data_type)}, ${ts(sd.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const seg of segments) {
    pending.push(
      `INSERT OR IGNORE INTO segment (segment_id, website_id, type, name, parameters, created_at, updated_at) VALUES (${esc(seg.segment_id)}, ${esc(seg.website_id)}, ${esc(seg.type)}, ${esc(seg.name)}, ${jsonParam(seg.parameters)}, ${ts(seg.created_at)}, ${ts(seg.updated_at ?? seg.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const r of reports) {
    pending.push(
      `INSERT OR IGNORE INTO report (report_id, user_id, website_id, type, name, description, parameters, created_at, updated_at) VALUES (${esc(r.report_id)}, ${esc(r.user_id)}, ${esc(r.website_id)}, ${esc(r.type)}, ${esc(r.name)}, ${esc(r.description ?? '')}, ${jsonParam(r.parameters)}, ${ts(r.created_at)}, ${ts(r.updated_at ?? r.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const b of boards) {
    pending.push(
      `INSERT OR IGNORE INTO board (board_id, user_id, team_id, type, name, description, parameters, created_at, updated_at) VALUES (${esc(b.board_id)}, ${esc(b.user_id)}, ${b.team_id ? esc(b.team_id) : 'NULL'}, ${esc(b.type)}, ${esc(b.name)}, ${esc(b.description ?? '')}, ${jsonParam(b.parameters)}, ${ts(b.created_at)}, ${ts(b.updated_at ?? b.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const sh of shares) {
    pending.push(
      `INSERT OR IGNORE INTO share (share_id, entity_id, name, share_type, slug, parameters, created_at, updated_at) VALUES (${esc(sh.share_id)}, ${esc(sh.entity_id)}, ${esc(sh.name)}, ${esc(sh.share_type)}, ${esc(sh.slug)}, ${jsonParam(sh.parameters)}, ${ts(sh.created_at)}, ${ts(sh.updated_at ?? sh.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const rev of revenueRows) {
    pending.push(
      `INSERT OR IGNORE INTO revenue (revenue_id, website_id, session_id, event_id, event_name, currency, revenue, created_at) VALUES (${esc(rev.revenue_id)}, ${esc(rev.website_id)}, ${esc(rev.session_id)}, ${esc(rev.event_id)}, ${esc(rev.event_name)}, ${esc(rev.currency)}, ${num(rev.revenue)}, ${ts(rev.created_at)});`,
    );
    flush();
  }
  flush(true);

  for (const sr of replayRows) {
    pending.push(
      `INSERT OR IGNORE INTO session_replay (replay_id, website_id, session_id, visit_id, chunk_index, events, event_count, started_at, ended_at, created_at) VALUES (${esc(sr.replay_id)}, ${esc(sr.website_id)}, ${esc(sr.session_id)}, ${esc(sr.visit_id)}, ${num(sr.chunk_index)}, X'', ${num(sr.event_count ?? 0)}, ${ts(sr.started_at ?? sr.created_at)}, ${ts(sr.ended_at ?? sr.created_at)}, ${ts(sr.created_at)});`,
    );
    flush();
  }
  flush(true);

  console.log('Migration complete.');
  return replayRows;
}

function copyR2Object(
  sourceBucket: string,
  destBucket: string,
  key: string,
  remote: boolean,
  dryRun: boolean,
) {
  const flag = remote ? '--remote' : '--local';
  if (dryRun) {
    console.log(`[dry-run] R2 copy ${sourceBucket}/${key} -> ${destBucket}/${key}`);
    return;
  }
  const tmpDir = mkdtempSync(pathJoin(tmpdir(), 'flareboard-r2-'));
  const tmpFile = pathJoin(tmpDir, 'chunk');
  try {
    execSync(
      `wrangler r2 object get ${sourceBucket}/${key} ${flag} --config ${configPath} --file "${tmpFile}"`,
      { stdio: 'pipe', cwd: root },
    );
    execSync(
      `wrangler r2 object put ${destBucket}/${key} ${flag} --config ${configPath} --file "${tmpFile}" --content-type application/json`,
      { stdio: 'pipe', cwd: root },
    );
    console.log(`Copied R2 ${key}`);
  } catch (err) {
    console.warn(`Failed to copy R2 key ${key}:`, (err as Error).message);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function migrateReplayR2(
  replays: LegacyExportSessionReplay[],
  opts: ReturnType<typeof parseArgs>,
) {
  if (!opts.replayR2Source || !opts.replayR2Dest) return;
  if (!replays.length) {
    console.warn('No session_replay rows — nothing to copy to R2');
    return;
  }

  console.log(
    `Copying ${replays.length} replay chunks from R2 bucket "${opts.replayR2Source}" to "${opts.replayR2Dest}"`,
  );

  for (const row of replays) {
    const key = `${row.website_id}/${row.visit_id}/${row.chunk_index}`;
    copyR2Object(opts.replayR2Source, opts.replayR2Dest, key, opts.remote, opts.dryRun);
  }

  console.log('R2 replay migration pass complete.');
}

async function main() {
  const opts = parseArgs();
  if (!opts.jsonFile && !opts.postgresUrl && !opts.replayR2Source) {
    console.error('Provide --json <file> or --postgres <DATABASE_URL>');
    process.exit(1);
  }

  let bundle: ExportBundle = {};
  if (opts.jsonFile) {
    bundle = JSON.parse(readFileSync(opts.jsonFile, 'utf8')) as ExportBundle;
  } else if (opts.postgresUrl) {
    bundle = await loadFromPostgres(opts.postgresUrl);
  }

  let replayRows = bundle.session_replays ?? [];
  if (opts.jsonFile || opts.postgresUrl) {
    replayRows = await migrate(bundle, opts);
  }

  if (opts.replayR2Source && opts.replayR2Dest) {
    await migrateReplayR2(replayRows, opts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
