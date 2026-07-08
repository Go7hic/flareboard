CREATE TABLE IF NOT EXISTS `heatmap_ingest_dedup` (
  `id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `heatmap_ingest_dedup_website_idx` ON `heatmap_ingest_dedup` (`website_id`);
