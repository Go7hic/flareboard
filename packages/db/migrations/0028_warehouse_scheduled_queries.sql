CREATE TABLE IF NOT EXISTS `warehouse_scheduled_query` (
  `scheduled_query_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `sql` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `interval_minutes` integer NOT NULL,
  `next_run_at` integer NOT NULL,
  `last_run_at` integer,
  `last_status` text,
  `last_error` text,
  `last_row_count` integer NOT NULL DEFAULT 0,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `warehouse_scheduled_query_due_idx`
  ON `warehouse_scheduled_query` (`website_id`, `enabled`, `next_run_at`);
