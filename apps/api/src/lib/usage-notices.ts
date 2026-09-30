import {
  currentMonthKey,
  getPlan,
  includedUsage,
  PLANS,
  USAGE_METRICS,
  usageCeiling,
  type PlanDefinition,
  type UsageMetric,
} from '@flareboard/shared';
import type { Env } from '../env';
import { isDemoUserId } from './demo-access';
import { sendEmail } from './email';

/**
 * Emails the account owner as a monthly allowance fills up: at 80 %, at 100 % (plans with grace
 * keep collecting) and when collection stops. Each level is sent once per metric and month.
 */
const LEVELS = ['80', '100', 'stop'] as const;
type Level = (typeof LEVELS)[number];

const NOTICE_KEY = (userId: string, monthKey: string, metric: UsageMetric) => `usage-notice:${userId}:${monthKey}:${metric}`;
const NOTICE_TTL_SEC = 40 * 24 * 60 * 60;
const MAX_ACCOUNTS_PER_TICK = 500;

const LABELS: Record<UsageMetric, string> = {
  events: 'events',
  replays: 'session replays',
  otel: 'log records and spans',
};

const number = (value: number) => value.toLocaleString('en-US');

/** First day of the next UTC month, when allowances reset. */
function resetDate(now: number) {
  const date = new Date(now);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
}

export function usageLevel(plan: PlanDefinition, metric: UsageMetric, used: number): Level | null {
  const included = includedUsage(plan, metric);
  if (included <= 0) return null;
  if (used >= usageCeiling(plan, metric)) return 'stop';
  if (used >= included) return '100';
  if (used >= included * 0.8) return '80';
  return null;
}

export function usageNoticeEmail(
  plan: PlanDefinition,
  metric: UsageMetric,
  level: Level,
  used: number,
  now: number,
  billingUrl: string,
) {
  const label = LABELS[metric];
  const included = number(includedUsage(plan, metric));
  const ceiling = number(usageCeiling(plan, metric));
  const reset = resetDate(now);
  const grace = plan.usageGraceMultiple > 1;
  const upgrade = plan.id === 'free' ? `Upgrade to Cloud for higher limits: ${billingUrl}` : `Need a higher limit? Contact hello@flareboard.dev.`;

  let subject: string;
  let lines: string[];
  if (level === '80') {
    subject = `You've used 80% of this month's ${label}`;
    lines = [
      `Your ${plan.name} plan includes ${included} ${label} a month, and ${number(used)} have been collected so far this month.`,
      grace
        ? `If you go over, collection continues up to ${ceiling} and then pauses until ${reset}. There is no automatic charge for the extra usage.`
        : `At ${included}, new ${label} are no longer collected until ${reset}.`,
      upgrade,
    ];
  } else if (level === '100') {
    subject = `You've reached this month's ${label} allowance`;
    lines = [
      `Your ${plan.name} plan includes ${included} ${label} a month, and this month has reached it (${number(used)}).`,
      `Collection continues up to ${ceiling} and then pauses until ${reset}. There is no automatic charge for the extra usage.`,
      upgrade,
    ];
  } else {
    subject = `Flareboard has paused collecting ${label} until ${reset}`;
    lines = [
      `This month has reached ${ceiling} ${label}, the most your ${plan.name} plan collects, so new ${label} are dropped until ${reset}.`,
      `Everything collected before the pause stays available.`,
      upgrade,
    ];
  }
  lines.push(`Usage: ${billingUrl}`);
  return {
    subject,
    text: lines.join('\n\n'),
    html: lines.map((line) => `<p>${line.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).join(''),
  };
}

/** Lowest 80 % threshold of any plan, so the query only returns accounts near an allowance. */
function queryFloor(metric: UsageMetric) {
  const allowances = Object.values(PLANS)
    .map((plan) => includedUsage(plan, metric))
    .filter((n) => n > 0);
  return Math.floor(Math.min(...allowances) * 0.8);
}

export async function runUsageNotices(env: Env, now = Date.now()) {
  if (env.HOSTED_MODE !== 'true') return { sent: 0 };
  const monthKey = currentMonthKey(new Date(now));
  const billingUrl = `${env.DASHBOARD_URL?.trim().replace(/\/$/, '') || 'https://flareboard.dev'}/billing`;
  const rows = await env.DB.prepare(
    `SELECT u.user_id AS userId, u.events_count AS events, u.replays_count AS replays, u.otel_rows AS otel,
            s.plan_id AS planId, a.email AS email
     FROM usage_monthly u
     JOIN user a ON a.user_id = u.user_id AND a.deleted_at IS NULL
     LEFT JOIN user_subscription s ON s.user_id = u.user_id
     WHERE u.month_key = ?1 AND (u.events_count >= ?2 OR u.replays_count >= ?3 OR u.otel_rows >= ?4)
     LIMIT ${MAX_ACCOUNTS_PER_TICK}`,
  )
    .bind(monthKey, queryFloor('events'), queryFloor('replays'), queryFloor('otel'))
    .all<{ userId: string; events: number; replays: number; otel: number; planId: string | null; email: string | null }>();

  let sent = 0;
  for (const row of rows.results ?? []) {
    if (!row.email || isDemoUserId(row.userId)) continue;
    const plan = getPlan(row.planId);
    for (const metric of USAGE_METRICS) {
      const used = row[metric];
      const level = usageLevel(plan, metric, used);
      if (!level) continue;
      const key = NOTICE_KEY(row.userId, monthKey, metric);
      const previous = (await env.CACHE.get(key)) as Level | null;
      if (previous && LEVELS.indexOf(previous) >= LEVELS.indexOf(level)) continue;
      try {
        // A jump straight past a level sends only the latest one.
        if (!(await sendEmail(env, { to: row.email, ...usageNoticeEmail(plan, metric, level, used, now, billingUrl) }))) continue;
        await env.CACHE.put(key, level, { expirationTtl: NOTICE_TTL_SEC });
        sent++;
      } catch (error) {
        console.error(JSON.stringify({ event: 'usage_notice_failed', metric, level, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
  console.log(JSON.stringify({ event: 'usage_notices_complete', accounts: rows.results?.length ?? 0, sent }));
  return { sent };
}
