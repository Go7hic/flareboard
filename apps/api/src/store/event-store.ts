import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { StoreParam, StoreResult, StoreStatement } from '@flareboard/db/site-store';
import { STORE_MIGRATIONS, STORE_SCHEMA_VERSION } from './schema';

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
      // Daily housekeeping (see alarm()); re-armed whenever a sleeping store wakes up.
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
  }

  /** Housekeeping that must not depend on a global cron walking every website. */
  async alarm(): Promise<void> {
    if (!this.migrated) this.migrate();
    const cutoff = Date.now() - HEATMAP_DEDUP_TTL_MS;
    this.sql.exec('DELETE FROM heatmap_ingest_dedup WHERE created_at < ?', cutoff);
    const hasData = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM heatmap_ingest_dedup').one().n > 0;
    // Nothing left to clean: let the store sleep; the constructor re-arms it on the next write.
    if (hasData) await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  private migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS _store_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
    const rows = this.sql.exec<{ key: string; value: string }>('SELECT key, value FROM _store_meta').toArray();
    const meta = new Map(rows.map((row) => [row.key, row.value]));
    this.websiteId = meta.get('website_id') ?? null;
    let version = Number(meta.get('schema_version') ?? 0);
    for (const migration of STORE_MIGRATIONS) {
      if (migration.version <= version) continue;
      this.ctx.storage.transactionSync(() => {
        for (const statement of migration.statements) this.sql.exec(statement);
        this.sql.exec(
          `INSERT INTO _store_meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          String(migration.version),
        );
      });
      version = migration.version;
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

  /** Erases everything this website stored (used by the deletion job). */
  async erase(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.websiteId = null;
    this.migrated = false;
  }
}
