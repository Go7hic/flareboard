/**
 * Calendar of the demo world, derived from absolute time only (never from when the generator
 * ran), so any hour can be generated independently: campaigns, weekly releases, incidents and
 * the resolve / regress cycle of one error. Annotations are seeded from the same calendar.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function dayNumber(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

export function hourFloor(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 0 = Sunday (1970-01-01 was a Thursday). */
export function weekdayOf(day: number): number {
  return (day + 4) % 7;
}

const CAMPAIGN_PERIOD = 19;
const CAMPAIGN_OFFSET = 3;
const CAMPAIGN_BOOST = [1.55, 1.3, 1.12];

export const CAMPAIGNS = [
  { slug: 'autumn-sale', title: 'Autumn sale: 20% off outerwear', source: 'newsletter', medium: 'email' },
  { slug: 'free-shipping-weekend', title: 'Free shipping weekend', source: 'instagram', medium: 'paid_social' },
  { slug: 'repair-program-launch', title: 'Repair program launch', source: 'newsletter', medium: 'email' },
  { slug: 'creator-collab', title: 'Creator collaboration drop', source: 'tiktok', medium: 'influencer' },
  { slug: 'members-early-access', title: 'Members early access', source: 'newsletter', medium: 'email' },
  { slug: 'gift-guide', title: 'Gift guide', source: 'pinterest', medium: 'paid_social' },
] as const;

export type Campaign = (typeof CAMPAIGNS)[number];

/** The campaign running on this day, with its traffic boost, if any. */
export function campaignOn(day: number): { campaign: Campaign; boost: number; startDay: number } | null {
  const phase = (((day - CAMPAIGN_OFFSET) % CAMPAIGN_PERIOD) + CAMPAIGN_PERIOD) % CAMPAIGN_PERIOD;
  if (phase >= CAMPAIGN_BOOST.length) return null;
  const startDay = day - phase;
  const index = Math.floor((startDay - CAMPAIGN_OFFSET) / CAMPAIGN_PERIOD);
  const campaign = CAMPAIGNS[((index % CAMPAIGNS.length) + CAMPAIGNS.length) % CAMPAIGNS.length]!;
  return { campaign, boost: CAMPAIGN_BOOST[phase]!, startDay };
}

export function campaignStartDays(fromDay: number, toDay: number): number[] {
  const days: number[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    const running = campaignOn(day);
    if (running && running.startDay === day) days.push(day);
  }
  return days;
}

/** Store releases ship on Tuesdays; the version is the week number since a fixed epoch. */
export function storeReleaseOn(day: number): string {
  // Last Tuesday on or before `day`.
  const back = (weekdayOf(day) - 2 + 7) % 7;
  const tuesday = day - back;
  return `3.${Math.floor(tuesday / 7) - 2920}.0`;
}

export function isStoreReleaseDay(day: number): boolean {
  return weekdayOf(day) === 2;
}

/** Docs publish a changelog on the first Wednesday of a 28-day cycle. */
export function isDocsReleaseDay(day: number): boolean {
  return day % 28 === 6;
}

export function docsReleaseOn(day: number): string {
  return `2.${Math.floor((day - 6) / 28) - 700}.0`;
}

/** A payment-provider incident every 31 days, 14:00–16:00 UTC. */
export function incidentOn(day: number): { startAt: number; endAt: number } | null {
  if (day % 31 !== 17) return null;
  return { startAt: day * DAY_MS + 14 * HOUR_MS, endAt: day * DAY_MS + 16 * HOUR_MS };
}

/**
 * The checkout timeout error runs in 21-day cycles: active for 14 days, fixed (resolved at
 * noon of day 14, no events for three days), then it comes back — a regression.
 */
const REGRESSION_CYCLE = 21;
const REGRESSION_QUIET_FROM = 14;
const REGRESSION_QUIET_TO = 16;

export function regressionErrorActive(ms: number): boolean {
  const phase = dayNumber(ms) % REGRESSION_CYCLE;
  return phase < REGRESSION_QUIET_FROM || phase > REGRESSION_QUIET_TO;
}

/** Most recent moment the regressing issue was marked resolved, at or before `now`. */
export function lastRegressionResolveAt(now: number): number {
  const day = dayNumber(now);
  const cycleStart = day - (day % REGRESSION_CYCLE);
  let resolveAt = (cycleStart + REGRESSION_QUIET_FROM) * DAY_MS + 12 * HOUR_MS;
  if (resolveAt > now) resolveAt -= REGRESSION_CYCLE * DAY_MS;
  return resolveAt;
}

/**
 * Traffic multiplier for an hour: diurnal curve (peaks in the European evening / US afternoon),
 * weekday profile, slow logarithmic growth and campaign spikes.
 */
export function trafficFactor(hourStart: number, weekday: readonly number[], campaigns: boolean): number {
  const date = new Date(hourStart);
  const hour = date.getUTCHours();
  const day = dayNumber(hourStart);
  const diurnal = 1 + 0.58 * Math.cos((2 * Math.PI * (hour - 16)) / 24) + 0.14 * Math.cos((4 * Math.PI * (hour - 13)) / 24);
  const week = weekday[weekdayOf(day)] ?? 1;
  // Growth anchored on 2026-06-01 (day 20605): ~+15% after a month, ~+40% after four.
  const age = Math.max(0, day - 20605);
  const growth = 1 + 0.36 * Math.log(1 + age / 60);
  const campaign = campaigns ? (campaignOn(day)?.boost ?? 1) : 1;
  return Math.max(0.1, diurnal) * week * growth * campaign;
}
