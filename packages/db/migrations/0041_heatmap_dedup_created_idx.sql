-- Dedup rows only guard against queue redelivery. The retention cron now prunes them
-- by age, which needs this index.
CREATE INDEX IF NOT EXISTS `heatmap_ingest_dedup_created_idx` ON `heatmap_ingest_dedup` (`created_at`);
