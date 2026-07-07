CREATE TABLE IF NOT EXISTS `log_saved_filter` (
  `filter_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text,
  `name` text NOT NULL,
  `filters` text NOT NULL,
  `is_default` integer NOT NULL DEFAULT 0,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `log_saved_filter_website_idx`
  ON `log_saved_filter` (`website_id`, `created_at`);
