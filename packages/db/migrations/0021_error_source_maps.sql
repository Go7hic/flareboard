CREATE TABLE IF NOT EXISTS `error_source_map` (
  `source_map_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `release` text NOT NULL,
  `file` text NOT NULL,
  `content` text NOT NULL,
  `size` integer NOT NULL,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE UNIQUE INDEX IF NOT EXISTS `error_source_map_unique_idx`
  ON `error_source_map` (`website_id`, `release`, `file`);

CREATE INDEX IF NOT EXISTS `error_source_map_release_idx`
  ON `error_source_map` (`website_id`, `release`);
