import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { currentMonthKey, getPlan } from '@flareboard/shared';
import { runUsageNotices, usageLevel, usageNoticeEmail } from '../../src/lib/usage-notices';
import { applyTestMigrations } from '../helpers/migrations';

const NOW = Date.UTC(2026, 9, 15, 12);
const MONTH = currentMonthKey(new Date(NOW));
const FREE = 'notice-free-user';
const CLOUD = 'notice-cloud-user';

type Sent = { to: string | string[]; subject: string; text: string };

function hostedEnv(sent: Sent[]) {
  return {
    ...env,
    HOSTED_MODE: 'true',
    DASHBOARD_URL: 'https://app.example.test',
    EMAIL: { send: async (message: Sent) => void sent.push(message) },
  } as unknown as typeof env;
}

async function setUsage(userId: string, usage: { events?: number; replays?: number; otel?: number }) {
  await env.DB.prepare(
    `INSERT INTO usage_monthly (user_id, month_key, events_count, replays_count, otel_rows) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id, month_key) DO UPDATE SET events_count = excluded.events_count,
       replays_count = excluded.replays_count, otel_rows = excluded.otel_rows`,
  )
    .bind(userId, MONTH, usage.events ?? 0, usage.replays ?? 0, usage.otel ?? 0)
    .run();
}

describe('usage notices', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    const now = Date.now();
    for (const [userId, planId] of [[FREE, 'free'], [CLOUD, 'cloud']] as const) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user (user_id, username, password, role, email, created_at, updated_at) VALUES (?1, ?1, 'x', 'user', ?2, ?3, ?3)`,
      )
        .bind(userId, `${userId}@example.test`, now)
        .run();
      await env.DB.prepare(`INSERT OR REPLACE INTO user_subscription (user_id, plan_id, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)`)
        .bind(userId, planId, now)
        .run();
    }
  });

  beforeEach(async () => {
    for (const userId of [FREE, CLOUD]) {
      for (const metric of ['events', 'replays', 'otel']) await env.CACHE.delete(`usage-notice:${userId}:${MONTH}:${metric}`);
      await setUsage(userId, {});
    }
  });

  it('grades usage against the allowance and the grace ceiling', () => {
    const cloud = getPlan('cloud');
    expect(usageLevel(cloud, 'events', 799_999)).toBeNull();
    expect(usageLevel(cloud, 'events', 800_000)).toBe('80');
    expect(usageLevel(cloud, 'events', 1_000_000)).toBe('100');
    expect(usageLevel(cloud, 'events', 1_199_999)).toBe('100');
    expect(usageLevel(cloud, 'events', 1_200_000)).toBe('stop');
    // Free stops at the allowance, and has no replays to warn about.
    expect(usageLevel(getPlan('free'), 'events', 100_000)).toBe('stop');
    expect(usageLevel(getPlan('free'), 'replays', 10)).toBeNull();
  });

  it('sends each level once per metric and month, only the latest after a jump', async () => {
    const sent: Sent[] = [];
    await setUsage(CLOUD, { events: 850_000 });
    await runUsageNotices(hostedEnv(sent), NOW);
    await runUsageNotices(hostedEnv(sent), NOW);
    expect(sent.map((m) => m.subject)).toEqual(["You've used 80% of this month's events"]);
    expect(sent[0]!.to).toBe(`${CLOUD}@example.test`);
    expect(sent[0]!.text).toContain('continues up to 1,200,000');
    expect(sent[0]!.text).toContain('November 1, 2026');

    await setUsage(CLOUD, { events: 1_300_000, otel: 450_000 });
    await runUsageNotices(hostedEnv(sent), NOW);
    expect(sent.slice(1).map((m) => m.subject).sort()).toEqual([
      'Flareboard has paused collecting events until November 1, 2026',
      "You've used 80% of this month's log records and spans",
    ]);
  });

  it('tells Free accounts collection stops at the allowance and links to billing', async () => {
    const sent: Sent[] = [];
    await setUsage(FREE, { events: 100_000 });
    await runUsageNotices(hostedEnv(sent), NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Flareboard has paused collecting events until November 1, 2026');
    expect(sent[0]!.text).toContain('Upgrade to Cloud for higher limits: https://app.example.test/billing');
  });

  it('does nothing on self-hosted installs', async () => {
    await setUsage(CLOUD, { events: 1_300_000 });
    expect(await runUsageNotices({ ...env, HOSTED_MODE: 'false' }, NOW)).toEqual({ sent: 0 });
  });

  it('keeps the email text free of markup', () => {
    const email = usageNoticeEmail(getPlan('cloud'), 'replays', '100', 5_000, NOW, 'https://app.example.test/billing');
    expect(email.subject).toBe("You've reached this month's session replays allowance");
    expect(email.html).toContain('<a href="https://app.example.test/billing">');
  });
});
