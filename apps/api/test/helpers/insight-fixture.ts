import { env } from 'cloudflare:workers';
import { EVENT_TYPE } from '@flareboard/shared';
import { applyTestMigrations, seedTestWebsite } from './migrations';
import { testSiteDb } from './site-db';

/**
 * A small product-analytics dataset with hand-computed answers (see insight-engines.spec.ts).
 *
 * Day 0 = Monday 2026-02-02 (UTC). People (person.properties_json):
 *   alice {plan: pro, seats: 5, beta: true, email: alice@acme.com}  first seen day 0
 *   bob   {plan: free, seats: 1, email: bob@example.com}             first seen day 0
 *   carol {plan: pro, seats: 12}                                     first seen day -10
 *   dave  {plan: team}                                               first seen day -5
 *   s_x1 is an anonymous session (no distinct id).
 *
 * Events (custom unless noted), offsets in minutes:
 *   day -1 dave  d0: signup
 *   day 0  alice a1: pageview /pricing +0, signup {source: ads, amount: 10} +10, purchase {amount: 100} +30
 *   day 0  bob   b1: pageview /home +0, signup {source: organic, amount: 20} +5
 *   day 0  carol c1: purchase {amount: 50} +1, signup {source: ads} +2
 *   day 0  anon  x1: pageview /blog/post-1 +0, signup {source: Ads_2} +1
 *   day 1  alice a2: signup {source: ads} +0, pageview /pricing +1
 *   day 1  dave  d1: signup +0
 *   day 2  bob   b2: purchase {amount: 30} +5
 */
export const FIXTURE_SITE = '00000000-0000-4000-8000-00000000c0de';
export const DAY = 86_400_000;
export const MIN = 60_000;
export const DAY0 = Date.UTC(2026, 1, 2);
export const T0 = DAY0 + 10 * 60 * MIN; // 10:00 UTC
/** Three whole UTC days: day 0 .. day 2. */
export const RANGE = { startAt: DAY0, endAt: DAY0 + 3 * DAY - 1 };

type Prop = string | number;

let seeded = false;

export async function seedInsightFixture() {
  if (seeded) return;
  await applyTestMigrations(env.DB);
  await seedTestWebsite(env.DB);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO website (website_id, name, domain, user_id, created_at, updated_at, timezone)
     VALUES (?1, 'Insights fixture', 'insights.example', '00000000-0000-0000-0000-000000000001', ?2, ?2, 'UTC')`,
  )
    .bind(FIXTURE_SITE, DAY0)
    .run();

  const db = testSiteDb(FIXTURE_SITE);
  const people: Array<[string, Record<string, unknown>, number]> = [
    ['alice', { plan: 'pro', seats: 5, beta: true, email: 'alice@acme.com' }, T0],
    ['bob', { plan: 'free', seats: 1, email: 'bob@example.com' }, T0],
    ['carol', { plan: 'pro', seats: 12 }, T0 - 10 * DAY],
    ['dave', { plan: 'team' }, T0 - 5 * DAY],
  ];
  for (const [distinctId, props, firstSeen] of people) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO person (person_id, website_id, distinct_id, properties_json, first_seen_at, last_seen_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?5)`,
      )
      .bind(`fx-person-${distinctId}`, FIXTURE_SITE, distinctId, JSON.stringify(props), firstSeen)
      .run();
  }

  const sessions: Array<[string, string | null, number, string]> = [
    ['fx-d0', 'dave', T0 - DAY, 'DE'],
    ['fx-a1', 'alice', T0, 'US'],
    ['fx-b1', 'bob', T0, 'US'],
    ['fx-c1', 'carol', T0, 'FR'],
    ['fx-x1', null, T0, 'US'],
    ['fx-a2', 'alice', T0 + DAY, 'US'],
    ['fx-d1', 'dave', T0 + DAY, 'DE'],
    ['fx-b2', 'bob', T0 + 2 * DAY, 'US'],
  ];
  for (const [id, distinctId, createdAt, country] of sessions) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO session (session_id, website_id, distinct_id, country, browser, created_at)
         VALUES (?1, ?2, ?3, ?4, 'Chrome', ?5)`,
      )
      .bind(id, FIXTURE_SITE, distinctId, country, createdAt)
      .run();
  }

  let n = 0;
  async function event(session: string, at: number, name: string | null, props: Record<string, Prop> = {}, path = '/app') {
    n += 1;
    const id = `fx-ev-${n}`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO website_event (event_id, website_id, session_id, visit_id, created_at, url_path, event_type, event_name)
         VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(id, FIXTURE_SITE, session, at, path, name ? EVENT_TYPE.customEvent : EVENT_TYPE.pageView, name)
      .run();
    for (const [key, value] of Object.entries(props)) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO event_data (event_data_id, website_id, website_event_id, data_key, string_value, number_value, data_type, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          `${id}-${key}`,
          FIXTURE_SITE,
          id,
          key,
          typeof value === 'string' ? value : null,
          typeof value === 'number' ? value : null,
          typeof value === 'number' ? 2 : 1,
          at,
        )
        .run();
    }
  }

  await event('fx-d0', T0 - DAY, 'signup');
  await event('fx-a1', T0, null, {}, '/pricing');
  await event('fx-a1', T0 + 10 * MIN, 'signup', { source: 'ads', amount: 10 });
  await event('fx-a1', T0 + 30 * MIN, 'purchase', { amount: 100, currency: 'USD' });
  await event('fx-b1', T0, null, {}, '/home');
  await event('fx-b1', T0 + 5 * MIN, 'signup', { source: 'organic', amount: 20 });
  await event('fx-c1', T0 + 1 * MIN, 'purchase', { amount: 50 });
  await event('fx-c1', T0 + 2 * MIN, 'signup', { source: 'ads' });
  await event('fx-x1', T0, null, {}, '/blog/post-1');
  await event('fx-x1', T0 + 1 * MIN, 'signup', { source: 'Ads_2' });
  await event('fx-a2', T0 + DAY, 'signup', { source: 'ads' });
  await event('fx-a2', T0 + DAY + 1 * MIN, null, {}, '/pricing');
  await event('fx-d1', T0 + DAY, 'signup');
  await event('fx-b2', T0 + 2 * DAY + 5 * MIN, 'purchase', { amount: 30 });

  // Twelve values of `k` on `tick` events for top-10 + Other: v1 three times, the rest once.
  for (let i = 1; i <= 12; i++) {
    for (let r = 0; r < (i === 1 ? 3 : 1); r++) await event('fx-a1', T0 + (i * 3 + r) * MIN, 'tick', { k: `v${i}` });
  }
  seeded = true;
}
