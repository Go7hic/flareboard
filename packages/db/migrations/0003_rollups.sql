CREATE TABLE IF NOT EXISTS rollup_stats_daily (
  website_id TEXT NOT NULL,
  day TEXT NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  totaltime_sec INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (website_id, day)
);

CREATE INDEX IF NOT EXISTS rollup_stats_daily_website_day_idx
  ON rollup_stats_daily(website_id, day);

CREATE TABLE IF NOT EXISTS rollup_pageview_series (
  website_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  bucket TEXT NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (website_id, unit, bucket)
);

CREATE TABLE IF NOT EXISTS rollup_dimension_daily (
  website_id TEXT NOT NULL,
  day TEXT NOT NULL,
  dimension TEXT NOT NULL,
  value TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (website_id, day, dimension, value)
);

CREATE INDEX IF NOT EXISTS rollup_dimension_daily_lookup_idx
  ON rollup_dimension_daily(website_id, day, dimension);

CREATE TABLE IF NOT EXISTS rollup_event_daily (
  website_id TEXT NOT NULL,
  day TEXT NOT NULL,
  event_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (website_id, day, event_name)
);

CREATE TABLE IF NOT EXISTS rollup_session_day (
  website_id TEXT NOT NULL,
  day TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (website_id, day, session_id)
);

CREATE TABLE IF NOT EXISTS session_replay_summary (
  website_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (website_id, visit_id)
);

CREATE INDEX IF NOT EXISTS session_replay_summary_website_started_idx
  ON session_replay_summary(website_id, started_at DESC);
