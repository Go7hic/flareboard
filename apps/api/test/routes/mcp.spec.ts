import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken, ROLES } from '@flareboard/shared';
import type { Env } from '../../src/env';
import { createPersonalApiKey } from '../../src/lib/personal-api-keys';
import { MCP_PROTOCOL_VERSIONS, MCP_RATE_LIMIT } from '../../src/routes/mcp';
import { fetchWorker } from '../helpers/fetch-worker';
import { FIXTURE_SITE, seedInsightFixture } from '../helpers/insight-fixture';

const ADMIN = '00000000-0000-0000-0000-000000000001'; // owns FIXTURE_SITE (seedTestWebsite)
const OWNER = 'mcp-owner';
const STRANGER = 'mcp-stranger';
const VIEWER = 'mcp-viewer';
const OWNER_SITE = 'mcp-owner-site';
const BASE = Date.UTC(2026, 8, 1);

type RpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: Record<string, any>;
  error?: { code: number; message: string };
};

async function keyFor(userId: string, scopes: Array<'read' | 'write'>) {
  const created = await createPersonalApiKey(env as unknown as Env, userId, { name: `mcp ${scopes.join('+')}`, scopes });
  return created.key;
}

async function rpc(key: string | null, method: string, params?: unknown, init: { headers?: Record<string, string>; id?: number | null } = {}) {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (init.id !== null) body.id = init.id ?? 1;
  if (params !== undefined) body.params = params;
  const response = await fetchWorker('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...init.headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, body: (text ? JSON.parse(text) : null) as RpcResponse | null };
}

async function callTool(key: string, name: string, args: Record<string, unknown>) {
  const { response, body } = await rpc(key, 'tools/call', { name, arguments: args });
  expect(response.status).toBe(200);
  return body!.result as { content: Array<{ type: string; text: string }>; structuredContent?: any; isError: boolean };
}

describe('MCP server', () => {
  let adminRead: string;
  let ownerRead: string;
  let ownerWrite: string;
  let strangerRead: string;
  let viewerWrite: string;

  beforeAll(async () => {
    await seedInsightFixture();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES
         (?1, 'mcp-owner@example.com', 'hash', ?4, ?6, ?6),
         (?2, 'mcp-stranger@example.com', 'hash', ?4, ?6, ?6),
         (?3, 'mcp-viewer@example.com', 'hash', ?5, ?6, ?6)`,
    )
      .bind(OWNER, STRANGER, VIEWER, ROLES.user, ROLES.viewOnly, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at)
       VALUES (?1, 'Owner site', 'owner.example', ?2, ?3, ?3)`,
    )
      .bind(OWNER_SITE, OWNER, BASE)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, created_at, updated_at)
       VALUES ('mcp-flag', ?1, 'new-checkout', 'New checkout', '', 0, 100, ?2, ?2)`,
    )
      .bind(OWNER_SITE, BASE)
      .run();
    adminRead = await keyFor(ADMIN, ['read']);
    ownerRead = await keyFor(OWNER, ['read']);
    ownerWrite = await keyFor(OWNER, ['read', 'write']);
    strangerRead = await keyFor(STRANGER, ['read']);
    viewerWrite = await keyFor(VIEWER, ['read', 'write']);
  });

  it('initializes over Streamable HTTP and negotiates the protocol version', async () => {
    const { response, body } = await rpc(ownerRead, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'flareboard' },
      },
    });
    expect(body!.result!.instructions).toMatch(/list_websites/);

    const unknownVersion = await rpc(ownerRead, 'initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    expect(unknownVersion.body!.result!.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);

    const initialized = await rpc(ownerRead, 'notifications/initialized', undefined, { id: null });
    expect(initialized.response.status).toBe(202);

    const ping = await rpc(ownerRead, 'ping', undefined, { headers: { 'MCP-Protocol-Version': '2025-06-18' } });
    expect(ping.body).toMatchObject({ id: 1, result: {} });
  });

  it('requires a personal API key', async () => {
    const missing = await rpc(null, 'initialize', {});
    expect(missing.response.status).toBe(401);
    expect(missing.response.headers.get('WWW-Authenticate')).toMatch(/^Bearer/);

    const invalid = await rpc('fb_sk_00000000000000000000000000000000', 'tools/list');
    expect(invalid.response.status).toBe(401);

    // Session tokens are not accepted: MCP clients authenticate with keys only.
    const token = await createSecureToken({ userId: OWNER, role: ROLES.user }, env.APP_SECRET);
    const session = await rpc(token, 'tools/list');
    expect(session.response.status).toBe(401);

    const writeOnly = await rpc(await keyFor(OWNER, ['write']), 'tools/list');
    expect(writeOnly.response.status).toBe(403);
  });

  it('rejects foreign origins, batches, bad JSON and unsupported protocol headers', async () => {
    const origin = await rpc(ownerRead, 'ping', undefined, { headers: { Origin: 'https://evil.example' } });
    expect(origin.response.status).toBe(403);

    const version = await rpc(ownerRead, 'ping', undefined, { headers: { 'MCP-Protocol-Version': '1999-01-01' } });
    expect(version.response.status).toBe(400);

    const batch = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerRead}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
    });
    expect(batch.status).toBe(400);

    const parse = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerRead}`, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(parse.status).toBe(400);
    expect(((await parse.json()) as RpcResponse).error?.code).toBe(-32700);

    const get = await fetchWorker('/mcp', { headers: { Authorization: `Bearer ${ownerRead}` } });
    expect(get.status).toBe(405);

    const method = await rpc(ownerRead, 'resources/list');
    expect(method.body!.error?.code).toBe(-32601);
  });

  it('lists read tools for read keys and write tools only with the write scope', async () => {
    const read = await rpc(ownerRead, 'tools/list');
    const readNames = (read.body!.result!.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(readNames).toEqual(
      expect.arrayContaining(['list_websites', 'run_insight', 'run_sql', 'search_people', 'list_error_issues', 'list_experiments']),
    );
    expect(readNames).not.toContain('create_annotation');
    expect(readNames).not.toContain('toggle_feature_flag');
    const runInsight = (read.body!.result!.tools as Array<any>).find((tool) => tool.name === 'run_insight');
    expect(runInsight.inputSchema).toMatchObject({ type: 'object', required: ['websiteId', 'type', 'query'] });
    expect(runInsight.annotations).toMatchObject({ readOnlyHint: true });

    const write = await rpc(ownerWrite, 'tools/list');
    const writeTools = write.body!.result!.tools as Array<{ name: string; annotations: { readOnlyHint: boolean } }>;
    expect(writeTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['create_annotation', 'toggle_feature_flag']));
    expect(writeTools.find((tool) => tool.name === 'toggle_feature_flag')!.annotations.readOnlyHint).toBe(false);

    // A view-only account never gets write tools, whatever its key says.
    const viewer = await rpc(viewerWrite, 'tools/list');
    expect((viewer.body!.result!.tools as Array<{ name: string }>).map((tool) => tool.name)).not.toContain('create_annotation');
  });

  it('lists only the websites the key user can access', async () => {
    const result = await callTool(ownerRead, 'list_websites', {});
    expect(result.isError).toBe(false);
    expect(result.structuredContent.websites.map((site: { id: string }) => site.id)).toEqual([OWNER_SITE]);
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });

  it('runs a trend insight validated against the insight query schema', async () => {
    const result = await callTool(adminRead, 'run_insight', {
      websiteId: FIXTURE_SITE,
      type: 'trend',
      query: { series: [{ kind: 'event', event: 'signup' }], interval: 'day' },
      dateFrom: '2026-02-02',
      dateTo: '2026-02-04',
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      kind: 'trend',
      interval: 'day',
      labels: ['2026-02-02', '2026-02-03', '2026-02-04'],
      series: [{ key: 'A', total: 6, data: [4, 2, 0] }],
    });

    const funnel = await callTool(adminRead, 'run_insight', {
      websiteId: FIXTURE_SITE,
      type: 'funnel',
      query: { funnel: { steps: [{ kind: 'event', event: 'signup' }, { kind: 'event', event: 'purchase' }] } },
      dateFrom: '2026-02-02',
      dateTo: '2026-02-04',
    });
    expect(funnel.isError).toBe(false);
    expect(funnel.structuredContent.kind).toBe('funnel');
    expect(funnel.structuredContent.steps).toHaveLength(2);

    const invalid = await callTool(adminRead, 'run_insight', {
      websiteId: FIXTURE_SITE,
      type: 'trend',
      query: { series: [{ kind: 'event', event: 'signup', math: 'sum' }] },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]!.text).toMatch(/mathProperty|numeric property/i);
  });

  it('discovers event names and property keys and values', async () => {
    const range = { dateFrom: '2026-02-01', dateTo: '2026-02-05' };
    const events = await callTool(adminRead, 'list_event_names', { websiteId: FIXTURE_SITE, ...range });
    expect(events.structuredContent.events.map((event: { name: string }) => event.name)).toEqual(
      expect.arrayContaining(['signup', 'purchase']),
    );
    const keys = await callTool(adminRead, 'list_property_keys', { websiteId: FIXTURE_SITE, type: 'event', ...range });
    expect(keys.structuredContent.keys.map((key: { key: string }) => key.key)).toEqual(expect.arrayContaining(['source', 'amount']));
    const values = await callTool(adminRead, 'list_property_values', { websiteId: FIXTURE_SITE, type: 'event', key: 'source', ...range });
    expect(values.structuredContent.values[0]).toMatchObject({ value: 'ads' });
  });

  it('searches people and evaluates tools only on accessible websites', async () => {
    const people = await callTool(adminRead, 'search_people', {
      websiteId: FIXTURE_SITE,
      search: 'alice',
      dateFrom: '2026-02-01',
      dateTo: '2026-02-05',
    });
    expect(people.isError).toBe(false);
    expect(people.structuredContent.people[0]).toMatchObject({ id: 'alice', email: 'alice@acme.com' });

    for (const name of ['run_insight', 'search_people', 'list_error_issues', 'run_sql', 'list_feature_flags']) {
      const denied = await callTool(strangerRead, name, {
        websiteId: FIXTURE_SITE,
        type: 'trend',
        query: { series: [{ kind: 'pageview' }] },
        sql: 'SELECT 1',
      });
      expect(denied.isError).toBe(true);
      expect(denied.content[0]!.text).toMatch(/not found or not accessible/);
    }
  });

  it('runs read-only SQL with the warehouse guards', async () => {
    const ok = await callTool(adminRead, 'run_sql', {
      websiteId: FIXTURE_SITE,
      sql: "SELECT event_name, COUNT(*) AS n FROM website_event WHERE website_id = ?1 AND event_name = 'signup' GROUP BY event_name",
    });
    expect(ok.isError).toBe(false);
    expect(ok.structuredContent.rows).toEqual([{ event_name: 'signup', n: 7 }]);

    const write = await callTool(adminRead, 'run_sql', { websiteId: FIXTURE_SITE, sql: 'DELETE FROM website_event WHERE website_id = ?1' });
    expect(write.isError).toBe(true);
  });

  it('returns errors, flags and experiments', async () => {
    const errors = await callTool(ownerRead, 'list_error_issues', { websiteId: OWNER_SITE });
    expect(errors.isError).toBe(false);
    expect(errors.structuredContent).toMatchObject({ totals: { errors: 0 }, issues: [] });

    const flags = await callTool(ownerRead, 'list_feature_flags', { websiteId: OWNER_SITE });
    expect(flags.structuredContent.flags).toEqual([expect.objectContaining({ key: 'new-checkout', enabled: false })]);

    const evaluated = await callTool(ownerRead, 'evaluate_feature_flag', { websiteId: OWNER_SITE, key: 'new-checkout', distinctId: 'u1' });
    expect(evaluated.isError).toBe(false);
    expect(evaluated.structuredContent).toMatchObject({ key: 'new-checkout', value: false });

    const missing = await callTool(ownerRead, 'evaluate_feature_flag', { websiteId: OWNER_SITE, key: 'nope', distinctId: 'u1' });
    expect(missing.isError).toBe(true);

    const experiments = await callTool(ownerRead, 'list_experiments', { websiteId: OWNER_SITE });
    expect(experiments.structuredContent).toEqual({ experiments: [] });
  });

  it('needs the write scope and write access for write tools, and audits them', async () => {
    const denied = await callTool(ownerRead, 'create_annotation', { websiteId: OWNER_SITE, title: 'Launch' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toMatch(/write scope/);

    const viewer = await callTool(viewerWrite, 'toggle_feature_flag', { websiteId: OWNER_SITE, key: 'new-checkout', enabled: true });
    expect(viewer.isError).toBe(true);

    const created = await callTool(ownerWrite, 'create_annotation', {
      websiteId: OWNER_SITE,
      title: 'Launch',
      category: 'release',
      happenedAt: '2026-09-01T10:00:00Z',
    });
    expect(created.isError).toBe(false);
    const annotation = await env.DB.prepare('SELECT title, category, happened_at AS happenedAt, user_id AS userId FROM annotation WHERE annotation_id = ?1')
      .bind(created.structuredContent.id)
      .first();
    expect(annotation).toMatchObject({ title: 'Launch', category: 'release', happenedAt: Date.parse('2026-09-01T10:00:00Z'), userId: OWNER });

    const toggled = await callTool(ownerWrite, 'toggle_feature_flag', { websiteId: OWNER_SITE, key: 'new-checkout', enabled: true });
    expect(toggled.structuredContent).toEqual({ key: 'new-checkout', enabled: true, changed: true });
    const flag = await env.DB.prepare(`SELECT enabled FROM feature_flag WHERE flag_id = 'mcp-flag'`).first<{ enabled: number }>();
    expect(flag?.enabled).toBe(1);
    const audit = await env.DB.prepare(
      `SELECT action, metadata FROM audit_log WHERE entity_type = 'feature_flag' AND entity_id = 'mcp-flag' ORDER BY created_at DESC LIMIT 1`,
    ).first<{ action: string; metadata: string }>();
    expect(audit?.action).toBe('update');
    expect(JSON.parse(audit!.metadata)).toMatchObject({ via: 'mcp', changes: ['enabled'] });
    const annotationAudit = await env.DB.prepare(`SELECT metadata FROM audit_log WHERE entity_type = 'annotation' AND entity_id = ?1`)
      .bind(created.structuredContent.id)
      .first<{ metadata: string }>();
    expect(JSON.parse(annotationAudit!.metadata)).toMatchObject({ websiteId: OWNER_SITE, via: 'mcp' });

    // A read-write key of another user cannot write to this website either.
    const strangerWrite = await keyFor(STRANGER, ['read', 'write']);
    const foreign = await callTool(strangerWrite, 'toggle_feature_flag', { websiteId: OWNER_SITE, key: 'new-checkout', enabled: false });
    expect(foreign.isError).toBe(true);
  });

  it('answers unknown tools and bad arguments with protocol errors or tool errors', async () => {
    const unknown = await rpc(ownerRead, 'tools/call', { name: 'drop_database', arguments: {} });
    expect(unknown.body!.error?.code).toBe(-32602);

    const noName = await rpc(ownerRead, 'tools/call', { arguments: {} });
    expect(noName.body!.error?.code).toBe(-32602);

    const badArgs = await callTool(ownerRead, 'list_property_keys', { websiteId: OWNER_SITE, type: 'session' });
    expect(badArgs.isError).toBe(true);
    expect(badArgs.content[0]!.text).toMatch(/^Invalid input/);

    const noWebsite = await callTool(ownerRead, 'list_event_names', {});
    expect(noWebsite.isError).toBe(true);
    expect(noWebsite.content[0]!.text).toMatch(/websiteId is required/);
  });

  it('rate-limits each key', async () => {
    const key = await keyFor(OWNER, ['read']);
    let limited: Response | null = null;
    for (let i = 0; i <= MCP_RATE_LIMIT.requests; i++) {
      const { response } = await rpc(key, 'ping');
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get('Retry-After')).toBe(String(MCP_RATE_LIMIT.windowSec));
    // Other keys are unaffected.
    const other = await rpc(ownerRead, 'ping');
    expect(other.response.status).toBe(200);
  });
});
