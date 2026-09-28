import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { STORE_MIGRATIONS, STORE_SCHEMA_VERSION } from './schema';

export type StoreParam = string | number | null | ArrayBuffer;
export type StoreMode = 'all' | 'raw' | 'run';

export type StoreStatement = {
  sql: string;
  params: StoreParam[];
  mode: StoreMode;
};

export type StoreResult = {
  /** Rows as objects (mode 'all' / 'run'). */
  results: Record<string, unknown>[];
  /** Rows as arrays (mode 'raw'), in `columns` order. */
  raw: unknown[][];
  columns: string[];
  /** Rows changed by an INSERT/UPDATE/DELETE (SQLite changes()), 0 for reads. */
  changes: number;
  lastRowId: number | null;
  rowsRead: number;
  rowsWritten: number;
};

export type StoreInfo = {
  websiteId: string | null;
  schemaVersion: number;
  sizeBytes: number;
  events: number;
  oldestEventAt: number | null;
  newestEventAt: number | null;
};

const READ_ONLY_PREFIX = /^\s*(WITH|SELECT|EXPLAIN|VALUES)\b/i;

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
    });
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
    await this.ctx.storage.deleteAll();
    this.websiteId = null;
    this.migrated = false;
  }
}
