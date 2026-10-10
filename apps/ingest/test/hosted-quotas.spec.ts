import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { currentMonthKey } from '@flareboard/shared';
import { applyTestMigrations } from './helpers/migrations';
import { fetchWorkerWithEnv, recordingQueue, seedProjectKey } from './helpers/queue';
import { testSiteDb } from './helpers/site-db';
import { forgetIsolateMemo } from '../src/lib/isolate-memo';

const OWNER = 'quota-owner';
const SITE = '00000000-0000-0000-0000-0000000000d7';
const KEY = `fb_pk_${'QuotaSpecKey'.padEnd(24, '0')}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const HOSTED = { HOSTED_MODE: 'true' };

async function setAccount(planId: 'free' | 'cloud', usage: { events?: number; replays?: number; otel?: number }) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO user_subscription (user_id, plan_id, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)
     ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id`,
  )
    .bind(OWNER, planId, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO usage_monthly (user_id, month_key, events_count, replays_count, otel_rows) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id, month_key) DO UPDATE SET events_count = excluded.events_count,
       replays_count = excluded.replays_count, otel_rows = excluded.otel_rows`,
  )
    .bind(OWNER, currentMonthKey(), usage.events ?? 0, usage.replays ?? 0, usage.otel ?? 0)
    .run();
  await env.CACHE.delete(`quota:${OWNER}:${currentMonthKey()}`);
  forgetIsolateMemo();
}

async function usage() {
  return env.DB.prepare(`SELECT events_count AS events, replays_count AS replays, otel_rows AS otel FROM usage_monthly WHERE user_id = ?1 AND month_key = ?2`)
    .bind(OWNER, currentMonthKey())
    .first<{ events: number; replays: number; otel: number }>();
}

async function send() {
  const recorder = recordingQueue();
  const response = await fetchWorkerWithEnv(
    '/api/send',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '192.0.2.170' },
      body: JSON.stringify({ type: 'event', payload: { website: SITE, hostname: 'quota.example.com', url: '/' } }),
    },
    { EVENT_QUEUE: recorder.queue, ...HOSTED },
  );
  return { status: response.status, events: recorder.events() };
}

async function record(visitId: string, chunkIndex: number) {
  const response = await fetchWorkerWithEnv(
    '/api/record',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '192.0.2.171' },
      body: JSON.stringify({
        type: 'record',
        payload: {
          website: SITE,
          sessionId: `session-${visitId}`,
          visitId,
          chunkIndex,
          events: [{ type: 2, data: {}, timestamp: 1 }],
          startedAt: Date.now() - 1000,
          endedAt: Date.now(),
        },
      }),
    },
    HOSTED,
  );
  return (await response.json()) as { ok: boolean; skipped?: boolean; replayId?: string };
}

async function exportLogs(count: number) {
  const now = BigInt(Date.now()) * 1_000_000n;
  return fetchWorkerWithEnv(
    '/v1/logs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'quota-svc' } }] },
            scopeLogs: [
              {
                logRecords: Array.from({ length: count }, (_, i) => ({
                  timeUnixNano: `${now + BigInt(i)}`,
                  severityText: 'INFO',
                  body: { stringValue: `line ${i}` },
                })),
              },
            ],
          },
        ],
      }),
    },
    HOSTED,
  );
}

describe('hosted monthly allowances', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await env.DB.prepare(`INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, ?1, 'hash', 'user', ?2, ?2)`)
      .bind(OWNER, now)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, replay_enabled, created_at, updated_at)
       VALUES (?1, 'Quota', 'quota.example.com', ?2, 1, ?3, ?3)`,
    )
      .bind(SITE, OWNER, now)
      .run();
    await seedProjectKey(env.DB, SITE, KEY);
  });

  beforeEach(async () => {
    await env.CACHE.delete(`website:${SITE}`);
  });

  it('keeps heatmaps to plans that include them, in the data and in tracker-config', async () => {
    const click = async () => {
      const recorder = recordingQueue();
      const response = await fetchWorkerWithEnv(
        '/api/send',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '192.0.2.175' },
          body: JSON.stringify({
            type: 'heatmap',
            payload: { website: SITE, hostname: 'quota.example.com', url: '/', kind: 'click', x: 10, y: 20, viewportWidth: 1280, viewportHeight: 800 },
          }),
        },
        { EVENT_QUEUE: recorder.queue, ...HOSTED },
      );
      return { status: response.status, heatmaps: recorder.messages.filter((message) => message.type === 'heatmap') };
    };
    const trackerConfig = async () => {
      await env.CACHE.delete(`tracker-config:${SITE}`);
      const response = await fetchWorkerWithEnv(`/api/tracker-config?website=${SITE}`, {}, HOSTED);
      return ((await response.json()) as { heatmapEnabled: boolean }).heatmapEnabled;
    };

    await setAccount('free', {});
    expect(await click()).toEqual({ status: 200, heatmaps: [] });
    expect(await trackerConfig()).toBe(false);

    await setAccount('cloud', {});
    expect((await click()).heatmaps).toHaveLength(1);
    expect(await trackerConfig()).toBe(true);
  });

  it('stops Free at its event allowance', async () => {
    await setAccount('free', { events: 99_999 });
    expect((await send()).status).toBe(200);
    await setAccount('free', { events: 100_000 });
    const refused = await send();
    expect(refused.status).toBe(402);
    expect(refused.events).toHaveLength(0);
  });

  it('keeps collecting for Cloud past the allowance, up to 20 % over it', async () => {
    await setAccount('cloud', { events: 1_150_000 });
    const over = await send();
    expect(over.status).toBe(200);
    expect(over.events).toHaveLength(1);
    await setAccount('cloud', { events: 1_200_000 });
    expect((await send()).status).toBe(402);
  });

  it('reads usage through a short cache instead of counting each event in KV', async () => {
    await setAccount('cloud', { events: 10 });
    await send();
    await send();
    expect(await env.CACHE.get(`usage:${OWNER}:${currentMonthKey()}`)).toBeNull();
    // Product events are counted by the aggregator, not by ingest.
    expect((await usage())!.events).toBe(10);
  });

  it('counts a replay once, when its first chunk arrives', async () => {
    await setAccount('cloud', { replays: 3 });
    expect((await record('quota-visit-a', 0)).replayId).toBeTruthy();
    expect((await record('quota-visit-a', 1)).replayId).toBeTruthy();
    expect((await usage())!.replays).toBe(4);
  });

  it('past the replay ceiling, refuses new recordings but finishes ones under way', async () => {
    await setAccount('cloud', { replays: 3 });
    await record('quota-visit-b', 0);
    await setAccount('cloud', { replays: 10_000 });
    expect(await record('quota-visit-c', 0)).toEqual({ ok: true, skipped: true });
    expect(await record('quota-visit-c', 1)).toEqual({ ok: true, skipped: true });
    expect((await record('quota-visit-b', 1)).replayId).toBeTruthy();
    const stored = await testSiteDb(SITE)
      .prepare(`SELECT COUNT(*) AS n FROM session_replay WHERE visit_id = 'quota-visit-c'`)
      .first<{ n: number }>();
    expect(stored!.n).toBe(0);
  });

  it('counts log records apart from events and stops them at their own ceiling', async () => {
    await setAccount('free', { events: 100_000, otel: 5 });
    expect((await exportLogs(3)).status).toBe(200);
    expect((await usage())!.otel).toBe(8);
    await setAccount('free', { otel: 50_000 });
    expect((await exportLogs(1)).status).toBe(402);
  });
});

describe('a team website whose creator was erased', () => {
  const TEAM = 'quota-team';
  const TEAM_OWNER = 'quota-team-owner';
  const TEAM_SITE = '00000000-0000-0000-0000-0000000000d8';

  async function sendToTeamSite() {
    const recorder = recordingQueue();
    const response = await fetchWorkerWithEnv(
      '/api/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'cf-connecting-ip': '192.0.2.172' },
        body: JSON.stringify({ type: 'event', payload: { website: TEAM_SITE, hostname: 'team.example.com', url: '/' } }),
      },
      { EVENT_QUEUE: recorder.queue, ...HOSTED },
    );
    return { status: response.status, body: await response.text(), events: recorder.events() };
  }

  async function setTeamOwnerEvents(events: number) {
    await env.DB.prepare(
      `INSERT INTO usage_monthly (user_id, month_key, events_count) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, month_key) DO UPDATE SET events_count = excluded.events_count`,
    )
      .bind(TEAM_OWNER, currentMonthKey(), events)
      .run();
    await env.CACHE.delete(`quota:${TEAM_OWNER}:${currentMonthKey()}`);
    forgetIsolateMemo();
  }

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    await env.DB.prepare(`INSERT OR IGNORE INTO user (user_id, username, password, role, created_at, updated_at) VALUES (?1, ?1, 'hash', 'user', ?2, ?2)`)
      .bind(TEAM_OWNER, now)
      .run();
    await env.DB.prepare(`INSERT OR IGNORE INTO team (team_id, name, created_at, updated_at) VALUES (?1, 'Team', ?2, ?2)`).bind(TEAM, now).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO team_user (team_user_id, team_id, user_id, role, created_at, updated_at) VALUES ('quota-tu', ?1, ?2, 'team-owner', ?3, ?3)`,
    )
      .bind(TEAM, TEAM_OWNER, now)
      .run();
    // As the API's data deletion leaves it: the creator cleared, billing handed to the team owner
    // (handOverTeamWebsites). A website without user_id is refused as "Website not found".
    await env.DB.prepare(
      `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, team_id, created_by, created_at, updated_at)
       VALUES (?1, 'Team site', 'team.example.com', ?2, ?3, NULL, ?4, ?4)`,
    )
      .bind(TEAM_SITE, TEAM_OWNER, TEAM, now)
      .run();
  });

  it("keeps collecting under the team owner's plan and usage", async () => {
    await setTeamOwnerEvents(99_999);
    const collected = await sendToTeamSite();
    expect(collected.status).toBe(200);
    expect(collected.events).toHaveLength(1);
    await setTeamOwnerEvents(100_000);
    const refused = await sendToTeamSite();
    expect(refused.status).toBe(402);
    expect(refused.body).toContain('Monthly event limit exceeded.');
  });
});
