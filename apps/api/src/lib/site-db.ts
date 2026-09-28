import type { Env } from '../env';
import type { EventStore, StoreMode, StoreParam, StoreResult, StoreStatement } from '../store/event-store';

/**
 * Tables that hold a website's high-volume analytics data. They live in one SQLite Durable
 * Object per website (apps/api/src/store) instead of the shared D1 database. Everything else
 * (websites, users, teams, flags, experiments, surveys, workflows, boards, reports, …) stays in
 * D1 and keeps using `env.DB`.
 */
export const SITE_TABLES = [
  'website_event',
  'event_data',
  'session',
  'session_data',
  'revenue',
  'session_replay',
  'session_replay_summary',
  'heatmap_cell',
  'heatmap_ingest_dedup',
  'rollup_stats_daily',
  'rollup_pageview_series',
  'rollup_series_bucket',
  'rollup_dimension_daily',
  'rollup_event_daily',
  'rollup_session_day',
  'person',
  'person_group_membership',
] as const;

/**
 * Where analytics tables are read from and written to:
 * - `d1`   (legacy) the shared D1 database;
 * - `dual` writers write both, readers still use D1 (while history is backfilled);
 * - `do`   the per-website Durable Object only.
 */
export type EventStoreMode = 'd1' | 'dual' | 'do';

export function eventStoreMode(env: Pick<Env, 'EVENT_STORE'>): EventStoreMode {
  const mode = env.EVENT_STORE;
  return mode === 'do' || mode === 'dual' ? mode : 'd1';
}

export function siteStoreStub(env: Env, websiteId: string): DurableObjectStub<EventStore> {
  if (!env.SITE_STORE) throw new Error('SITE_STORE binding is missing');
  return env.SITE_STORE.get(env.SITE_STORE.idFromName(`site:${websiteId}`));
}

/**
 * Database handle for one website's analytics tables (SITE_TABLES).
 *
 * Every read or write of a SITE_TABLES table must go through this handle, and a single SQL
 * statement must never join SITE_TABLES with D1-only tables (website, cohort, feature_flag, …):
 * load the D1 rows first, then pass their values as parameters. Queries across several websites
 * call siteDb once per website and merge the results in code.
 */
export function siteDb(env: Env, websiteId: string): D1Database {
  if (eventStoreMode(env) !== 'do') return env.DB;
  return new SiteDatabase(siteStoreStub(env, websiteId), websiteId) as unknown as D1Database;
}

/** The Durable Object handle regardless of mode (backfill, dual writes, deletion). */
export function siteStoreDb(env: Env, websiteId: string): D1Database {
  return new SiteDatabase(siteStoreStub(env, websiteId), websiteId) as unknown as D1Database;
}

function toParam(value: unknown): StoreParam {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.getTime();
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (Array.isArray(value)) return new Uint8Array(value as number[]).buffer;
  throw new TypeError(`Unsupported SQL parameter type: ${typeof value}`);
}

function toD1Result<T>(result: StoreResult): D1Result<T> {
  return {
    results: result.results as T[],
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: result.rowsRead,
      rows_written: result.rowsWritten,
      last_row_id: result.lastRowId ?? 0,
      changed_db: result.changes > 0,
      changes: result.changes,
    },
  } as D1Result<T>;
}

class SiteStatement {
  constructor(
    private readonly db: SiteDatabase,
    readonly sql: string,
    readonly params: StoreParam[] = [],
  ) {}

  bind(...values: unknown[]): SiteStatement {
    return new SiteStatement(this.db, this.sql, values.map(toParam));
  }

  toStatement(mode: StoreMode): StoreStatement {
    return { sql: this.sql, params: this.params, mode };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return toD1Result<T>(await this.db.run(this.toStatement('all')));
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return toD1Result<T>(await this.db.run(this.toStatement('run')));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const { results } = await this.db.run(this.toStatement('all'));
    const row = results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column] as T;
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.db.run(this.toStatement('raw'));
    return (options?.columnNames ? [result.columns, ...result.raw] : result.raw) as T[];
  }
}

class SiteDatabase {
  constructor(
    private readonly stub: DurableObjectStub<EventStore>,
    private readonly websiteId: string,
  ) {}

  prepare(sql: string): SiteStatement {
    return new SiteStatement(this, sql);
  }

  run(statement: StoreStatement): Promise<StoreResult> {
    return this.stub.query(this.websiteId, statement) as Promise<StoreResult>;
  }

  async batch<T = Record<string, unknown>>(statements: SiteStatement[]): Promise<D1Result<T>[]> {
    if (!statements.length) return [];
    const results = (await this.stub.batch(
      this.websiteId,
      statements.map((statement) => statement.toStatement('all')),
    )) as StoreResult[];
    return results.map((result) => toD1Result<T>(result));
  }

  async exec(script: string): Promise<D1ExecResult> {
    const { count } = await this.stub.execScript(this.websiteId, script);
    return { count, duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump() is not supported on a website store');
  }

  withSession(): SiteDatabase {
    return this;
  }
}
