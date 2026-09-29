/**
 * Client side of a website's analytics store (the `EventStore` Durable Object hosted by the API
 * worker). `createSiteDatabase` wraps a store stub in a D1-compatible handle so query code keeps
 * using prepare/bind/all/first/run/raw/batch unchanged. Shared by the API and the aggregator.
 */

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

/** The RPC surface a store stub must offer (structural, so any runtime stub type fits). */
export interface SiteStoreRpc {
  query(websiteId: string, statement: StoreStatement): Promise<StoreResult> | StoreResult;
  batch(websiteId: string, statements: StoreStatement[]): Promise<StoreResult[]> | StoreResult[];
  execScript(websiteId: string, script: string): Promise<{ count: number }> | { count: number };
}

/**
 * Where analytics tables are read from and written to:
 * - `d1`   (legacy) the shared D1 database;
 * - `dual` writers also copy events into the website stores, readers still use D1;
 * - `do`   the per-website Durable Object stores only.
 */
export type EventStoreMode = 'd1' | 'dual' | 'do';

export function eventStoreMode(env: { EVENT_STORE?: string }): EventStoreMode {
  const mode = env.EVENT_STORE;
  return mode === 'do' || mode === 'dual' ? mode : 'd1';
}

/** Durable Object name of a website's store. */
export function siteStoreName(websiteId: string): string {
  return `site:${websiteId}`;
}

/** Event properties as the JSON object stored in `website_event.properties`. */
export function eventPropertiesJson(
  rows: ReadonlyArray<{ dataKey: string; dataType: number; stringValue?: string | null; numberValue?: number | null }> | undefined,
): string | null {
  if (!rows?.length) return null;
  const properties: Record<string, string | number | boolean | null> = {};
  for (const row of rows) {
    if (row.dataType === 2) properties[row.dataKey] = row.numberValue ?? null;
    else if (row.dataType === 3) properties[row.dataKey] = row.stringValue === 'true';
    else properties[row.dataKey] = row.stringValue ?? null;
  }
  return JSON.stringify(properties);
}

/** D1-compatible handle over one website's store. */
export function createSiteDatabase(stub: SiteStoreRpc, websiteId: string): D1Database {
  return new SiteDatabase(stub, websiteId) as unknown as D1Database;
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
    private readonly stub: SiteStoreRpc,
    private readonly websiteId: string,
  ) {}

  prepare(sql: string): SiteStatement {
    return new SiteStatement(this, sql);
  }

  async run(statement: StoreStatement): Promise<StoreResult> {
    return this.stub.query(this.websiteId, statement);
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
