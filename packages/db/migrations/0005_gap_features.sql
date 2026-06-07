-- Gap features: heatmaps, email reports, cohorts

CREATE TABLE IF NOT EXISTS `heatmap_cell` (
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `url_path` text NOT NULL,
  `day` text NOT NULL,
  `kind` text NOT NULL,
  `grid_x` integer NOT NULL,
  `grid_y` integer NOT NULL,
  `viewport_w` integer NOT NULL DEFAULT 0,
  `viewport_h` integer NOT NULL DEFAULT 0,
  `count` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`website_id`, `url_path`, `day`, `kind`, `grid_x`, `grid_y`, `viewport_w`, `viewport_h`)
);

CREATE INDEX IF NOT EXISTS `heatmap_cell_lookup_idx` ON `heatmap_cell` (`website_id`, `url_path`, `day`);

CREATE TABLE IF NOT EXISTS `website_email_report` (
  `website_id` text PRIMARY KEY NOT NULL REFERENCES `website`(`website_id`),
  `enabled` integer NOT NULL DEFAULT 0,
  `frequency` text NOT NULL DEFAULT 'weekly',
  `recipient_email` text,
  `last_sent_at` integer,
  `created_at` integer,
  `updated_at` integer
);

CREATE TABLE IF NOT EXISTS `cohort` (
  `cohort_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `name` text NOT NULL,
  `type` text NOT NULL,
  `value` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);

CREATE INDEX IF NOT EXISTS `cohort_website_idx` ON `cohort` (`website_id`);
