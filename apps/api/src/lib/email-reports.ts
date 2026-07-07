import { EVENT_TYPE, getPlan } from '@flareboard/shared';
import type { Env } from '../env';
import { isHostedMode } from './billing';
import { sendEmail } from './email';
import { queryPeriodStats } from './period-stats';

type ReportRow = {
  websiteId: string;
  websiteName: string;
  userId: string;
  planId: string | null;
  frequency: string;
  recipientEmail: string;
  timezone: string;
  lastSentAt: number | null;
};

function parseRecipients(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        return arr.filter((e): e is string => typeof e === 'string' && e.includes('@'));
      }
    } catch {
      /* fall through */
    }
  }
  return trimmed
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));
}

async function websiteDigest(env: Env, websiteId: string, startAt: number, endAt: number) {
  const stats = await queryPeriodStats(env, websiteId, startAt, endAt);

  const topPages = await env.DB.prepare(
    `SELECT url_path as path, COUNT(*) as views
     FROM website_event
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
       AND event_type = ?4
     GROUP BY url_path
     ORDER BY views DESC
     LIMIT 10`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.pageView)
    .all<{ path: string; views: number }>();

  const topReferrers = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(referrer_domain, ''), '(direct)') as referrer, COUNT(*) as views
     FROM website_event
     WHERE website_id = ?1 AND created_at >= ?2 AND created_at <= ?3
       AND event_type = ?4
     GROUP BY referrer_domain
     ORDER BY views DESC
     LIMIT 5`,
  )
    .bind(websiteId, startAt, endAt, EVENT_TYPE.pageView)
    .all<{ referrer: string; views: number }>();

  const bounceRate =
    stats.visits > 0 ? Math.round((stats.bounces / stats.visits) * 1000) / 10 : 0;

  return {
    pageviews: stats.pageviews,
    visitors: stats.visitors,
    sessions: stats.visits,
    bounceRate,
    topPages: topPages.results ?? [],
    topReferrers: topReferrers.results ?? [],
  };
}

function periodForFrequency(frequency: string) {
  const endAt = Date.now();
  const days = frequency === 'daily' ? 1 : frequency === 'monthly' ? 30 : 7;
  const startAt = endAt - days * 24 * 60 * 60 * 1000;
  const label =
    frequency === 'daily' ? 'Daily' : frequency === 'monthly' ? 'Monthly' : 'Weekly';
  return { startAt, endAt, label, days };
}

function formatDigest(
  websiteName: string,
  periodLabel: string,
  digest: Awaited<ReturnType<typeof websiteDigest>>,
  prev?: Awaited<ReturnType<typeof websiteDigest>> | null,
) {
  const topLines =
    digest.topPages.map((p) => `  ${p.path}: ${p.views}`).join('\n') || '  (none)';
  const refLines =
    digest.topReferrers.map((r) => `  ${r.referrer}: ${r.views}`).join('\n') || '  (none)';
  const compare =
    prev && prev.pageviews > 0
      ? `\n\nvs previous period:\n  Pageviews: ${digest.pageviews} (${Math.round(((digest.pageviews - prev.pageviews) / prev.pageviews) * 100)}%)\n  Visitors: ${digest.visitors} (${prev.visitors > 0 ? Math.round(((digest.visitors - prev.visitors) / prev.visitors) * 100) : 0}%)`
      : '';

  const text = `${websiteName} — ${periodLabel} summary\n\nPageviews: ${digest.pageviews}\nUnique visitors: ${digest.visitors}\nSessions: ${digest.sessions}\nBounce rate: ${digest.bounceRate}%\n\nTop pages:\n${topLines}\n\nTop referrers:\n${refLines}${compare}`;

  const htmlTop =
    digest.topPages
      .map((p) => `<li>${p.path}: <strong>${p.views}</strong></li>`)
      .join('') || '<li>(none)</li>';
  const htmlRef =
    digest.topReferrers
      .map((r) => `<li>${r.referrer}: <strong>${r.views}</strong></li>`)
      .join('') || '<li>(none)</li>';
  const htmlCompare =
    prev && prev.pageviews > 0
      ? `<p>vs previous: pageviews <strong>${digest.pageviews}</strong> (${Math.round(((digest.pageviews - prev.pageviews) / prev.pageviews) * 100)}%), visitors <strong>${digest.visitors}</strong></p>`
      : '';

  const html = `<h2>${websiteName}</h2><p>${periodLabel} summary</p><ul>
<li>Pageviews: <strong>${digest.pageviews}</strong></li>
<li>Unique visitors: <strong>${digest.visitors}</strong></li>
<li>Sessions: <strong>${digest.sessions}</strong></li>
<li>Bounce rate: <strong>${digest.bounceRate}%</strong></li>
</ul><h3>Top pages</h3><ul>${htmlTop}</ul><h3>Top referrers</h3><ul>${htmlRef}</ul>${htmlCompare}`;

  return { text, html };
}

function localHour(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value;
    return hour ? parseInt(hour, 10) : new Date().getUTCHours();
  } catch {
    return new Date().getUTCHours();
  }
}

function localWeekday(timezone: string): number {
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
      new Date(),
    );
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[day] ?? new Date().getUTCDay();
  } catch {
    return new Date().getUTCDay();
  }
}

function localMonthDay(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      day: 'numeric',
    }).formatToParts(new Date());
    const day = parts.find((p) => p.type === 'day')?.value;
    return day ? parseInt(day, 10) : new Date().getUTCDate();
  } catch {
    return new Date().getUTCDate();
  }
}

function localDateKey(timezone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function shouldSend(row: ReportRow) {
  const recipients = parseRecipients(row.recipientEmail);
  if (!recipients.length) return false;

  const tz = row.timezone || 'UTC';
  if (localHour(tz) !== 8) return false;

  const now = Date.now();
  const todayKey = localDateKey(tz);

  if (row.lastSentAt) {
    const lastDayKey = localDateKey(tz, new Date(row.lastSentAt));
    if (row.frequency === 'daily' && lastDayKey === todayKey) return false;

    const minGap =
      row.frequency === 'daily'
        ? 20 * 60 * 60 * 1000
        : row.frequency === 'monthly'
          ? 27 * 24 * 60 * 60 * 1000
          : 6 * 24 * 60 * 60 * 1000;
    if (now - row.lastSentAt < minGap) return false;
  }

  if (row.frequency === 'weekly' && localWeekday(tz) !== 1) return false;
  if (row.frequency === 'monthly' && localMonthDay(tz) !== 1) return false;
  return true;
}

export async function runScheduledEmailReports(env: Env, cron: string) {
  const rows = await env.DB.prepare(
    `SELECT r.website_id as websiteId, w.name as websiteName, w.user_id as userId,
            s.plan_id as planId, r.frequency,
            COALESCE(r.recipient_email, u.email) as recipientEmail,
            COALESCE(r.timezone, 'UTC') as timezone,
            r.last_sent_at as lastSentAt
     FROM website_email_report r
     INNER JOIN website w ON w.website_id = r.website_id
     LEFT JOIN user u ON u.user_id = w.user_id
     LEFT JOIN user_subscription s ON s.user_id = w.user_id
     WHERE r.enabled = 1 AND w.deleted_at IS NULL`,
  ).all<ReportRow>();

  const all = rows.results ?? [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let notDue = 0;

  console.log(
    JSON.stringify({
      event: 'email_report_cron_start',
      cron,
      enabledSites: all.length,
    }),
  );

  for (const row of all) {
    if (isHostedMode(env) && !getPlan(row.planId).emailReportsEnabled) {
      skipped++;
      console.log(
        JSON.stringify({ event: 'email_report_skipped_free_plan', websiteId: row.websiteId }),
      );
      continue;
    }

    if (!shouldSend(row)) {
      notDue++;
      continue;
    }

    const recipients = parseRecipients(row.recipientEmail);
    if (!recipients.length) {
      skipped++;
      continue;
    }

    try {
      const { startAt, endAt, label, days } = periodForFrequency(row.frequency);
      const digest = await websiteDigest(env, row.websiteId, startAt, endAt);

      if (digest.pageviews === 0 && digest.sessions === 0) {
        console.log(
          JSON.stringify({ event: 'email_report_skipped_no_data', websiteId: row.websiteId }),
        );
        skipped++;
        continue;
      }

      const prevStart = startAt - days * 24 * 60 * 60 * 1000;
      const prevEnd = startAt;
      const prev = await websiteDigest(env, row.websiteId, prevStart, prevEnd);
      const { text, html } = formatDigest(row.websiteName, label, digest, prev);

      for (const to of recipients) {
        const ok = await sendEmail(env, {
          to,
          subject: `${row.websiteName} — Flareboard ${label} report`,
          text,
          html,
        });
        if (!ok) {
          failed++;
          console.error(
            JSON.stringify({ event: 'email_report_send_failed', websiteId: row.websiteId, to }),
          );
        }
      }

      await env.DB.prepare(
        `UPDATE website_email_report SET last_sent_at = ?1, updated_at = ?1 WHERE website_id = ?2`,
      )
        .bind(Date.now(), row.websiteId)
        .run();
      sent++;
    } catch (err) {
      failed++;
      console.error(
        JSON.stringify({
          event: 'email_report_error',
          websiteId: row.websiteId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      event: 'email_report_cron_done',
      sent,
      skipped,
      failed,
      notDue,
    }),
  );

  return { sent, skipped, failed, notDue };
}
