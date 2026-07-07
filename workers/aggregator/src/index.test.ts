import { describe, expect, it, vi } from 'vitest';
import { EVENT_TYPE, type QueueMessage } from '@flareboard/shared';
import worker, { type Env } from './index';

class FakeD1Statement {
  constructor(
    readonly db: FakeD1Database,
    readonly sql: string,
    readonly bindings: unknown[] = [],
  ) {}

  bind(...bindings: unknown[]) {
    return new FakeD1Statement(this.db, this.sql, bindings);
  }

  async all<T>() {
    return { results: this.db.query(this) as T[] };
  }

  async run() {
    return { success: true, meta: { changes: 1 } };
  }
}

class FakeD1Database {
  readonly batchStatements: FakeD1Statement[][] = [];
  readonly existingEventIds = new Set<string>();

  constructor(
    readonly options: {
      failOnRollup?: boolean;
    } = {},
  ) {}

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  query(statement: FakeD1Statement) {
    if (statement.sql.includes('FROM session WHERE session_id IN')) {
      return [];
    }
    return [];
  }

  async batch(statements: FakeD1Statement[]) {
    const sqls = statements.map((stmt) => stmt.sql);
    this.batchStatements.push(statements);

    if (this.options.failOnRollup && sqls.some((sql) => sql.includes('rollup_session_day'))) {
      throw new Error('simulated rollup failure');
    }

    return statements.map((stmt) => {
      if (stmt.sql.includes('INSERT INTO website_event')) {
        const eventId = String(stmt.bindings[0]);
        if (this.existingEventIds.has(eventId)) {
          return { success: true, meta: { changes: 0 } };
        }
        this.existingEventIds.add(eventId);
      }

      return { success: true, meta: { changes: 1 } };
    });
  }

  statementsContaining(fragment: string) {
    return this.batchStatements.flat().filter((stmt) => stmt.sql.includes(fragment));
  }
}

function createMessage(body: QueueMessage) {
  return {
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createBatch(messages: Array<ReturnType<typeof createMessage>>) {
  return {
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

describe('aggregator queue batching', () => {
  it('acks the batch instead of replaying per-message fallback after rollup writes fail', async () => {
    const d1 = new FakeD1Database({ failOnRollup: true });
    const eventMessage = createMessage({
      type: 'event',
      data: {
        id: 'event-1',
        websiteId: 'website-1',
        sessionId: 'session-1',
        visitId: 'visit-1',
        createdAt: Date.UTC(2026, 0, 1, 12),
        urlPath: '/',
        eventType: EVENT_TYPE.pageView,
      },
    });
    const batch = createBatch([eventMessage]);

    await worker.queue(batch as unknown as MessageBatch<QueueMessage>, {
      DB: d1 as unknown as D1Database,
    } satisfies Env);

    expect(batch.ackAll).toHaveBeenCalledTimes(1);
    expect(eventMessage.ack).not.toHaveBeenCalled();
    expect(eventMessage.retry).not.toHaveBeenCalled();
  });

  it('does not update event rollups when an event was already inserted', async () => {
    const d1 = new FakeD1Database();
    d1.existingEventIds.add('event-1');
    const eventMessage = createMessage({
      type: 'event',
      data: {
        id: 'event-1',
        websiteId: 'website-1',
        sessionId: 'session-1',
        visitId: 'visit-1',
        createdAt: Date.UTC(2026, 0, 1, 12),
        urlPath: '/',
        eventType: EVENT_TYPE.pageView,
      },
    });

    await worker.queue(createBatch([eventMessage]) as unknown as MessageBatch<QueueMessage>, {
      DB: d1 as unknown as D1Database,
    } satisfies Env);

    expect(d1.statementsContaining('INSERT INTO rollup_session_day')).toHaveLength(0);
    expect(d1.statementsContaining('INSERT INTO rollup_pageview_series')).toHaveLength(0);
    expect(d1.statementsContaining('INSERT INTO rollup_dimension_daily')).toHaveLength(0);
  });

  it('stores error events without adding pageview or custom-event rollups', async () => {
    const d1 = new FakeD1Database();
    const errorMessage = createMessage({
      type: 'event',
      data: {
        id: 'error-1',
        websiteId: 'website-1',
        sessionId: 'session-1',
        visitId: 'visit-1',
        createdAt: Date.UTC(2026, 0, 1, 12),
        urlPath: '/checkout',
        eventType: EVENT_TYPE.error,
        eventName: 'Cannot read properties of undefined',
      },
      eventData: [
        {
          id: 'error-data-1',
          websiteId: 'website-1',
          websiteEventId: 'error-1',
          dataKey: 'release',
          stringValue: '1.2.3',
          dataType: 1,
          createdAt: Date.UTC(2026, 0, 1, 12),
        },
      ],
    });

    await worker.queue(createBatch([errorMessage]) as unknown as MessageBatch<QueueMessage>, {
      DB: d1 as unknown as D1Database,
    } satisfies Env);

    expect(d1.statementsContaining('INSERT INTO website_event')).toHaveLength(1);
    expect(d1.statementsContaining('INSERT INTO event_data')).toHaveLength(1);
    expect(d1.statementsContaining('INSERT INTO rollup_session_day')).toHaveLength(0);
    expect(d1.statementsContaining('INSERT INTO rollup_event_daily')).toHaveLength(0);
  });

  it('keeps separate daily session rollups for separate visits in the same session', async () => {
    const d1 = new FakeD1Database();
    const firstVisit = createMessage({
      type: 'event',
      data: {
        id: 'event-1',
        websiteId: 'website-1',
        sessionId: 'session-1',
        visitId: 'visit-1',
        createdAt: Date.UTC(2026, 0, 1, 9),
        urlPath: '/',
        eventType: EVENT_TYPE.pageView,
      },
    });
    const secondVisit = createMessage({
      type: 'event',
      data: {
        id: 'event-2',
        websiteId: 'website-1',
        sessionId: 'session-1',
        visitId: 'visit-2',
        createdAt: Date.UTC(2026, 0, 1, 15),
        urlPath: '/',
        eventType: EVENT_TYPE.pageView,
      },
    });

    await worker.queue(createBatch([firstVisit, secondVisit]) as unknown as MessageBatch<QueueMessage>, {
      DB: d1 as unknown as D1Database,
    } satisfies Env);

    const sessionDayRollups = d1.statementsContaining('INSERT INTO rollup_session_day');

    expect(sessionDayRollups).toHaveLength(2);
    expect(sessionDayRollups.map((stmt) => stmt.bindings[3]).sort()).toEqual(['visit-1', 'visit-2']);
  });

  it('creates a session stub before writing out-of-order session_data', async () => {
    const d1 = new FakeD1Database();
    const sessionDataMessage = createMessage({
      type: 'session_data',
      data: [
        {
          id: 'session-data-1',
          websiteId: 'website-1',
          sessionId: 'session-1',
          dataKey: 'plan',
          stringValue: 'pro',
          dataType: 1,
          createdAt: Date.UTC(2026, 0, 1, 12),
        },
      ],
    });

    await worker.queue(createBatch([sessionDataMessage]) as unknown as MessageBatch<QueueMessage>, {
      DB: d1 as unknown as D1Database,
    } satisfies Env);

    const sessionStubs = d1
      .statementsContaining('INSERT INTO session (session_id, website_id, created_at)')
      .filter((stmt) => stmt.bindings[0] === 'session-1');

    expect(sessionStubs).toHaveLength(1);
    expect(d1.statementsContaining('INSERT INTO session_data')).toHaveLength(1);
  });

  it('updates metadata when a full session message arrives after a stub', async () => {
    const d1 = new FakeD1Database();
    const sessionMessage = createMessage({
      type: 'session',
      data: {
        id: 'session-1',
        websiteId: 'website-1',
        browser: 'Chrome',
        os: 'macOS',
        device: 'desktop',
        language: 'en-US',
        country: 'US',
        createdAt: Date.UTC(2026, 0, 1, 12),
      },
    });

    await worker.queue(createBatch([sessionMessage]) as unknown as MessageBatch<QueueMessage>, {
      DB: d1 as unknown as D1Database,
    } satisfies Env);

    const fullSessionInsert = d1.statementsContaining('INSERT INTO session (session_id, website_id, browser')[0];

    expect(fullSessionInsert.sql).toContain('ON CONFLICT(session_id) DO UPDATE SET');
    expect(fullSessionInsert.sql).toContain('browser = COALESCE(excluded.browser, browser)');
  });
});
