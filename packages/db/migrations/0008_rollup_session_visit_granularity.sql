CREATE TABLE IF NOT EXISTS rollup_session_day_visit_granularity (
  website_id TEXT NOT NULL,
  day TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (website_id, day, session_id, visit_id)
);

INSERT OR REPLACE INTO rollup_session_day_visit_granularity (
  website_id,
  day,
  session_id,
  visit_id,
  pageviews,
  first_at,
  last_at
)
SELECT
  website_id,
  strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch')),
  session_id,
  visit_id,
  COUNT(*),
  MIN(created_at),
  MAX(created_at)
FROM website_event
WHERE event_type = 1
GROUP BY
  website_id,
  strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch')),
  session_id,
  visit_id;

DROP TABLE rollup_session_day;
ALTER TABLE rollup_session_day_visit_granularity RENAME TO rollup_session_day;

DELETE FROM rollup_stats_daily;

INSERT INTO rollup_stats_daily (website_id, day, pageviews, visitors, visits, bounces, totaltime_sec)
SELECT
  website_id,
  day,
  COALESCE(SUM(pageviews), 0),
  COUNT(DISTINCT session_id),
  COUNT(*),
  SUM(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END),
  COALESCE(SUM((last_at - first_at) / 1000), 0)
FROM rollup_session_day
GROUP BY website_id, day;
