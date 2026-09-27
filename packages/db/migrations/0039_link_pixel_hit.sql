-- Link redirects and pixel views were queued as website_event rows keyed by the
-- link/pixel id, which fails the website_id foreign key, so every hit dead-lettered.
-- They get their own table instead.
CREATE TABLE IF NOT EXISTS `link_pixel_hit` (
  `hit_id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `visitor_id` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `link_pixel_hit_source_idx` ON `link_pixel_hit` (`source_type`, `source_id`, `created_at`);
