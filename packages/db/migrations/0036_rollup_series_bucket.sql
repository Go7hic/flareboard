CREATE TABLE IF NOT EXISTS rollup_series_bucket (
  website_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  bucket TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  PRIMARY KEY (website_id, unit, bucket, session_id, visit_id)
);

CREATE INDEX IF NOT EXISTS rollup_series_bucket_lookup_idx
  ON rollup_series_bucket(website_id, unit, bucket);
