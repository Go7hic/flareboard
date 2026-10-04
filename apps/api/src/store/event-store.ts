import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { StoreParam, StoreResult, StoreStatement } from '@flareboard/db/site-store';
import { OTEL_RETENTION_DAYS, pendingStoreMigrations, STORE_MIGRATIONS, STORE_SCHEMA_VERSION } from './schema';

export type { StoreMode, StoreParam, StoreResult, StoreStatement } from '@flareboard/db/site-store';

export type StoreInfo = {
  websiteId: string | null;
  schemaVersion: number;
  sizeBytes: number;
  events: number;
  oldestEventAt: number | null;
  newestEventAt: number | null;
};

const READ_ONLY_PREFIX = /^\s*(WITH|SELECT|EXPLAIN|VALUES)\b/i;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Heatmap dedup ids only need to outlive queue redelivery (retries span minutes to hours). */
const HEATMAP_DEDUP_TTL_MS = 2 * DAY_MS;
/** Rows deleted per table and alarm; a larger backlog is worked off by a follow-up alarm. */
const OTEL_PURGE_BATCH = 10_000;
const OTEL_PURGE_BACKLOG_DELAY_MS = 60 * 1000;
/** Rollup tables derived from raw rows (rebuildRollups / refreshRollups). Heatmap cells are not. */
const ROLLUP_TABLES = [
  'rollup_session_day',
  'rollup_stats_daily',
  'rollup_pageview_series',
  'rollup_series_bucket',
  'rollup_dimension_daily',
  'rollup_event_daily',
] as const;
const REPLAY_SUMMARY_COLUMNS = `MIN(session_id), MIN(started_at), MAX(ended_at), SUM(event_count), COUNT(*),
  SUM(click_count), SUM(input_count), SUM(console_log_count), SUM(console_warn_count),
  SUM(console_error_count), SUM(network_error_count)`;

/** Rollup bucket of a millisecond column, in UTC (the aggregator's dayKey/hourBucket/...). */
function utcBucket(format: string, column = 'created_at') {
  return `strftime('${format}', ${column} / 1000, 'unixepoch')`;
}

function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A time inlined into SQL; only whole milliseconds pass. */
function sqlTime(ms: number) {
  if (!Number.isSafeInteger(ms)) throw new Error(`Invalid time: ${ms}`);
  return String(ms);
}

/**
 * One website's analytics store: a SQLite-backed Durable Object addressed by
 * `idFromName('site:<websiteId>')`. Callers use it through `siteDb()` (a D1-compatible
 * facade), so query code is the same SQL it always was; see `schema.ts` for the tables.
 */
export class EventStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private websiteId: string | null = null;
  private migrated = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.optimize();
      // Daily housekeeping (see alarm()); re-armed whenever a sleeping store wakes up.
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
  }

  /** Housekeeping that must not depend on a global cron walking every website. */
  async alarm(): Promise<void> {
    if (!this.migrated) this.migrate();
    const now = Date.now();
    this.sql.exec('DELETE FROM heatmap_ingest_dedup WHERE created_at < ?', now - HEATMAP_DEDUP_TTL_MS);
    const otelBacklog = this.purgeExpiredOtel(now);
    this.optimize();
    const hasData =
      this.sql.exec<{ n: number }>(
        `SELECT (EXISTS (SELECT 1 FROM heatmap_ingest_dedup)
                 OR EXISTS (SELECT 1 FROM log_record)
                 OR EXISTS (SELECT 1 FROM trace_span)) AS n`,
      ).one().n > 0;
    // Nothing left to clean: let the store sleep; the constructor re-arms it on the next write.
    if (otelBacklog) await this.ctx.storage.setAlarm(now + OTEL_PURGE_BACKLOG_DELAY_MS);
    else if (hasData) await this.ctx.storage.setAlarm(now + DAY_MS);
  }

  /**
   * Keeps SQLite's planner statistics (sqlite_stat1) current. Without them the planner picks
   * among indexes blindly: listing people scanned the website's whole session_data once per
   * session (40 s instead of 0.6 s on demo data). 0x10002 checks every table, not only those this
   * connection has queried; SQLite then analyzes a table only when an index has no statistics or
   * it grew 25x since the last run, skips tables under ~25 rows (stats taken on an empty table
   * mislead the planner badly once it fills) and samples a bounded number of rows. A no-op check
   * costs microseconds per table, so it runs on every wake and in the daily alarm.
   */
  private optimize() {
    try {
      this.sql.exec('PRAGMA optimize=0x10002');
    } catch (error) {
      // Statistics are an optimization: never let them keep the store from starting.
      console.warn('EventStore: PRAGMA optimize failed', error);
    }
  }

  /**
   * Deletes OpenTelemetry logs and spans older than OTEL_RETENTION_DAYS, in bounded batches so
   * one alarm cannot run long. Returns true while expired rows remain.
   */
  private purgeExpiredOtel(now: number): boolean {
    const cutoff = now - OTEL_RETENTION_DAYS * DAY_MS;
    let backlog = false;
    for (const [table, key] of [
      ['log_record', 'log_id'],
      ['trace_span', 'rowid'],
    ] as const) {
      this.sql
        .exec(
          `DELETE FROM ${table} WHERE ${key} IN (
             SELECT ${key} FROM ${table} WHERE created_at < ? LIMIT ${OTEL_PURGE_BATCH}
           )`,
          cutoff,
        )
        .toArray();
      const deleted = Number(this.sql.exec<{ n: number }>('SELECT changes() AS n').one().n) || 0;
      if (deleted >= OTEL_PURGE_BATCH) backlog = true;
    }
    return backlog;
  }

  private migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS _store_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
    const rows = this.sql.exec<{ key: string; value: string }>('SELECT key, value FROM _store_meta').toArray();
    const meta = new Map(rows.map((row) => [row.key, row.value]));
    this.websiteId = meta.get('website_id') ?? null;
    let version = Number(meta.get('schema_version') ?? 0);
    for (const migration of pendingStoreMigrations(meta, STORE_MIGRATIONS)) {
      version = Math.max(version, migration.version);
      this.ctx.storage.transactionSync(() => {
        for (const statement of migration.statements) this.sql.exec(statement);
        this.sql.exec(`INSERT OR REPLACE INTO _store_meta (key, value) VALUES (?, '1')`, `migration:${migration.version}`);
        this.sql.exec(
          `INSERT INTO _store_meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          String(version),
        );
      });
    }
    this.migrated = true;
  }

  /** Records which website this store belongs to (first call wins; a mismatch is a routing bug). */
  private claim(websiteId: string) {
    if (!this.migrated) this.migrate();
    if (this.websiteId === websiteId) return;
    if (this.websiteId && this.websiteId !== websiteId) {
      throw new Error(`EventStore for ${this.websiteId} was addressed as ${websiteId}`);
    }
    this.sql.exec(
      `INSERT INTO _store_meta (key, value) VALUES ('website_id', ?) ON CONFLICT(key) DO NOTHING`,
      websiteId,
    );
    this.websiteId = websiteId;
  }

  private execute(statement: StoreStatement): StoreResult {
    const cursor = this.sql.exec(statement.sql, ...statement.params);
    let results: Record<string, unknown>[] = [];
    let raw: unknown[][] = [];
    if (statement.mode === 'raw') {
      raw = Array.from(cursor.raw());
    } else {
      results = cursor.toArray() as Record<string, unknown>[];
    }
    const columns = cursor.columnNames;
    const isRead = READ_ONLY_PREFIX.test(statement.sql) && !/\bRETURNING\b/i.test(statement.sql);
    let changes = 0;
    let lastRowId: number | null = null;
    if (!isRead) {
      const status = this.sql.exec<{ changes: number; lastRowId: number }>(
        'SELECT changes() AS changes, last_insert_rowid() AS lastRowId',
      ).one();
      changes = Number(status.changes) || 0;
      lastRowId = Number(status.lastRowId) || null;
    }
    return {
      results,
      raw,
      columns,
      changes,
      lastRowId,
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
    };
  }

  query(websiteId: string, statement: StoreStatement): StoreResult {
    this.claim(websiteId);
    return this.execute(statement);
  }

  /** All statements in one transaction, like D1's batch(). */
  batch(websiteId: string, statements: StoreStatement[]): StoreResult[] {
    this.claim(websiteId);
    return this.ctx.storage.transactionSync(() => statements.map((statement) => this.execute(statement)));
  }

  /**
   * Runs one read-only statement with extra tables attached for its duration (the warehouse
   * joins D1-only tables such as survey_response). Everything happens in one synchronous
   * transaction, so the scratch tables can never leak into another request, and they are
   * dropped before returning.
   */
  queryWithAttachments(
    websiteId: string,
    statement: StoreStatement,
    attachments: Array<{ name: string; columns: string[]; rows: StoreParam[][] }>,
  ): StoreResult {
    this.claim(websiteId);
    const identifier = /^[a-z_][a-z0-9_]*$/;
    return this.ctx.storage.transactionSync(() => {
      for (const table of attachments) {
        if (!identifier.test(table.name) || !table.columns.every((column) => identifier.test(column))) {
          throw new Error(`Invalid attachment ${table.name}`);
        }
        this.sql.exec(`DROP TABLE IF EXISTS ${table.name}`);
        this.sql.exec(`CREATE TABLE ${table.name} (${table.columns.join(', ')})`);
        const insert = `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${table.columns.map(() => '?').join(', ')})`;
        for (const row of table.rows) this.sql.exec(insert, ...row);
      }
      try {
        return this.execute(statement);
      } finally {
        for (const table of attachments) this.sql.exec(`DROP TABLE IF EXISTS ${table.name}`);
      }
    });
  }

  /** Multi-statement script without parameters (D1 exec()). */
  execScript(websiteId: string, script: string): { count: number } {
    this.claim(websiteId);
    const cursor = this.sql.exec(script);
    cursor.toArray();
    return { count: script.split(';').filter((part) => part.trim()).length };
  }

  info(): StoreInfo {
    if (!this.migrated) this.migrate();
    const stats = this.sql
      .exec<{ events: number; oldest: number | null; newest: number | null }>(
        'SELECT COUNT(*) AS events, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM website_event',
      )
      .one();
    return {
      websiteId: this.websiteId,
      schemaVersion: STORE_SCHEMA_VERSION,
      sizeBytes: this.sql.databaseSize,
      events: Number(stats.events) || 0,
      oldestEventAt: stats.oldest ?? null,
      newestEventAt: stats.newest ?? null,
    };
  }

  /**
   * Recomputes every rollup table (and replay summaries) from raw rows, in one transaction so
   * readers never see a half-built state. Mirrors the aggregator's incremental rules
   * (workers/aggregator/src). Heatmap cells are not derivable from events and are left alone.
   */
  rebuildRollups(websiteId: string): { pageviews: number; rowsWritten: number } {
    this.claim(websiteId);
    return this.ctx.storage.transactionSync(() => {
      let rowsWritten = 0;
      for (const table of [...ROLLUP_TABLES, 'session_replay_summary']) {
        rowsWritten += this.write(`DELETE FROM ${table}`);
      }
      rowsWritten += this.insertDailyRollups(websiteId, null);
      rowsWritten += this.insertMonthYearRollups(websiteId, null, null);
      rowsWritten += this.write(
        `INSERT INTO session_replay_summary (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks,
           click_count, input_count, console_log_count, console_warn_count, console_error_count, network_error_count)
         SELECT website_id, visit_id, ${REPLAY_SUMMARY_COLUMNS}
         FROM session_replay GROUP BY visit_id`,
      );
      const pageviews = this.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM website_event WHERE event_type = 1')
        .one().n;
      return { pageviews: Number(pageviews) || 0, rowsWritten };
    });
  }

  /**
   * Brings the rollups up to date for an append-only writer (the demo generator) that added rows
   * from `since` on, and drops what lies before `keepFrom` (past retention), both rounded down to
   * the UTC day. rebuildRollups rewrites every rollup row each time; this recomputes day and hour
   * rows from the day of `since` only, adds the new visits to the month and year visitor sets and
   * removes visits whose pageviews in that month or year have all expired. The result matches
   * rebuildRollups over the raw rows from the day of `keepFrom` on (store-rollups-parity.spec.ts).
   */
  refreshRollups(websiteId: string, range: { since: number; keepFrom: number }): { rowsWritten: number } {
    this.claim(websiteId);
    const keepFrom = Math.floor(range.keepFrom / DAY_MS) * DAY_MS;
    // Days before keepFrom are expired, so recomputing never starts earlier than that.
    const from = Math.max(Math.floor(range.since / DAY_MS) * DAY_MS, keepFrom);
    const keepDay = utcDay(keepFrom);
    const fromDay = utcDay(from);
    const kept = new Date(keepFrom);
    // The month and year keepFrom falls in are partly expired: their visitor sets need a check.
    const partlyExpired: Array<[unit: string, bucket: string, end: number]> = [
      ['month', keepDay.slice(0, 7), Date.UTC(kept.getUTCFullYear(), kept.getUTCMonth() + 1, 1)],
      ['year', keepDay.slice(0, 4), Date.UTC(kept.getUTCFullYear() + 1, 0, 1)],
    ];

    return this.ctx.storage.transactionSync(() => {
      let rowsWritten = 0;
      for (const [unit, bucket, end] of partlyExpired) {
        rowsWritten += this.write(
          `DELETE FROM rollup_series_bucket WHERE website_id = ? AND unit = ? AND bucket < ?`,
          websiteId,
          unit,
          bucket,
        );
        // Visits found on expired days (their day rows go below) that have no pageview left in
        // the kept part of this month or year.
        rowsWritten += this.write(
          `DELETE FROM rollup_series_bucket
           WHERE website_id = ? AND unit = ? AND bucket = ?
             AND (session_id, visit_id) IN (
               SELECT session_id, visit_id FROM rollup_series_bucket
               WHERE website_id = ? AND unit = 'day' AND bucket < ?)
             AND NOT EXISTS (
               SELECT 1 FROM website_event e
               WHERE e.visit_id = rollup_series_bucket.visit_id AND e.session_id = rollup_series_bucket.session_id
                 AND e.event_type = 1 AND e.created_at >= ? AND e.created_at < ?)`,
          websiteId,
          unit,
          bucket,
          websiteId,
          keepDay,
          keepFrom,
          end,
        );
      }
      for (const table of ['rollup_session_day', 'rollup_stats_daily', 'rollup_dimension_daily', 'rollup_event_daily']) {
        rowsWritten += this.write(
          `DELETE FROM ${table} WHERE website_id = ? AND (day < ? OR day >= ?)`,
          websiteId,
          keepDay,
          fromDay,
        );
      }
      rowsWritten += this.write(
        `DELETE FROM rollup_series_bucket
         WHERE website_id = ? AND unit IN ('day', 'hour') AND (bucket < ? OR bucket >= ?)`,
        websiteId,
        keepDay,
        fromDay,
      );
      // Month and year pageview counts are a handful of rows: recount them from what is kept.
      rowsWritten += this.write(
        `DELETE FROM rollup_pageview_series
         WHERE website_id = ? AND (unit IN ('month', 'year') OR bucket < ? OR bucket >= ?)`,
        websiteId,
        keepDay,
        fromDay,
      );
      rowsWritten += this.insertDailyRollups(websiteId, from);
      rowsWritten += this.insertMonthYearRollups(websiteId, keepFrom, from);
      // Replay summaries of the visits with new chunks; expired ones go with the retention job.
      const touched = `SELECT visit_id FROM session_replay WHERE website_id = ? AND created_at >= ?`;
      rowsWritten += this.write(
        `DELETE FROM session_replay_summary WHERE website_id = ? AND visit_id IN (${touched})`,
        websiteId,
        websiteId,
        from,
      );
      rowsWritten += this.write(
        `INSERT INTO session_replay_summary (website_id, visit_id, session_id, started_at, ended_at, event_count, chunks,
           click_count, input_count, console_log_count, console_warn_count, console_error_count, network_error_count)
         SELECT website_id, visit_id, ${REPLAY_SUMMARY_COLUMNS}
         FROM session_replay WHERE website_id = ? AND visit_id IN (${touched})
         GROUP BY visit_id`,
        websiteId,
        websiteId,
        from,
      );
      return { rowsWritten };
    });
  }

  /**
   * Day-keyed rollups and the day and hour series, from the rows at or after `from` (all rows
   * when null). Callers delete the rows being replaced first.
   */
  private insertDailyRollups(websiteId: string, from: number | null): number {
    const recent = (column: string) => (from === null ? `${column} IS NOT NULL` : `${column} >= ${sqlTime(from)}`);
    const DAY = utcBucket('%Y-%m-%d');
    const DAY_E = utcBucket('%Y-%m-%d', 'e.created_at');
    let rowsWritten = this.write(
      `INSERT INTO rollup_session_day (website_id, day, session_id, visit_id, pageviews, first_at, last_at)
       SELECT website_id, ${DAY}, session_id, visit_id, COUNT(*), MIN(created_at), MAX(created_at)
       FROM website_event WHERE website_id = ? AND event_type = 1 AND ${recent('created_at')}
       GROUP BY ${DAY}, session_id, visit_id`,
      websiteId,
    );
    rowsWritten += this.write(
      `INSERT INTO rollup_stats_daily (website_id, day, pageviews, visitors, visits, bounces, totaltime_sec)
       SELECT website_id, day, SUM(pageviews), COUNT(DISTINCT session_id), COUNT(*),
              SUM(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END), COALESCE(SUM((last_at - first_at) / 1000), 0)
       FROM rollup_session_day WHERE website_id = ? AND day >= ? GROUP BY day`,
      websiteId,
      from === null ? '' : utcDay(from),
    );
    for (const [unit, expr] of [
      ['day', DAY],
      ['hour', utcBucket('%Y-%m-%d %H:00')],
    ] as const) {
      rowsWritten += this.write(
        `INSERT INTO rollup_pageview_series (website_id, unit, bucket, pageviews)
         SELECT website_id, ?, ${expr}, COUNT(*)
         FROM website_event WHERE website_id = ? AND event_type = 1 AND ${recent('created_at')} GROUP BY ${expr}`,
        unit,
        websiteId,
      );
      rowsWritten += this.write(
        `INSERT INTO rollup_series_bucket (website_id, unit, bucket, session_id, visit_id)
         SELECT DISTINCT website_id, ?, ${expr}, session_id, visit_id
         FROM website_event WHERE website_id = ? AND event_type = 1 AND ${recent('created_at')}`,
        unit,
        websiteId,
      );
    }
    const dimension = (name: string, value: string, join = '') =>
      this.write(
        `INSERT INTO rollup_dimension_daily (website_id, day, dimension, value, count)
         SELECT e.website_id, ${DAY_E}, ?, ${value}, COUNT(*)
         FROM website_event e ${join}
         WHERE e.website_id = ? AND e.event_type = 1 AND ${recent('e.created_at')}
         GROUP BY ${DAY_E}, ${value}`,
        name,
        websiteId,
      );
    rowsWritten += dimension('path', "COALESCE(e.url_path, '')");
    rowsWritten += dimension('referrer', "COALESCE(NULLIF(e.referrer_domain, ''), 'Direct')");
    // Session dimensions only when the session row exists, as in the aggregator.
    for (const column of ['browser', 'os', 'device', 'language', 'country']) {
      rowsWritten += dimension(column, `COALESCE(NULLIF(s.${column}, ''), 'Unknown')`, 'JOIN session s ON s.session_id = e.session_id');
    }
    rowsWritten += this.write(
      `INSERT INTO rollup_event_daily (website_id, day, event_name, count)
       SELECT website_id, ${DAY}, event_name, COUNT(*)
       FROM website_event
       WHERE website_id = ? AND event_type = 2 AND event_name IS NOT NULL AND event_name <> '' AND ${recent('created_at')}
       GROUP BY ${DAY}, event_name`,
      websiteId,
    );
    return rowsWritten;
  }

  /**
   * Month and year rollups: pageview counts over the rows at or after `pageviewsFrom`, and the
   * visits with a pageview at or after `visitsFrom` added to the visitor sets (visits already in
   * a set stay; null means all rows). Callers delete the count rows being replaced first.
   */
  private insertMonthYearRollups(websiteId: string, pageviewsFrom: number | null, visitsFrom: number | null): number {
    const recent = (from: number | null) => (from === null ? 'created_at IS NOT NULL' : `created_at >= ${sqlTime(from)}`);
    let rowsWritten = 0;
    for (const [unit, expr] of [
      ['month', utcBucket('%Y-%m')],
      ['year', utcBucket('%Y')],
    ] as const) {
      rowsWritten += this.write(
        `INSERT INTO rollup_pageview_series (website_id, unit, bucket, pageviews)
         SELECT website_id, ?, ${expr}, COUNT(*)
         FROM website_event WHERE website_id = ? AND event_type = 1 AND ${recent(pageviewsFrom)} GROUP BY ${expr}`,
        unit,
        websiteId,
      );
      rowsWritten += this.write(
        `INSERT OR IGNORE INTO rollup_series_bucket (website_id, unit, bucket, session_id, visit_id)
         SELECT DISTINCT website_id, ?, ${expr}, session_id, visit_id
         FROM website_event WHERE website_id = ? AND event_type = 1 AND ${recent(visitsFrom)}`,
        unit,
        websiteId,
      );
    }
    return rowsWritten;
  }

  /** Runs a write statement to completion and returns the rows it wrote (what storage bills). */
  private write(query: string, ...bindings: unknown[]): number {
    const cursor = this.sql.exec(query, ...bindings);
    cursor.toArray();
    return cursor.rowsWritten;
  }

  /** Erases everything this website stored (used by the deletion job). */
  async erase(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.websiteId = null;
    this.migrated = false;
  }
}
