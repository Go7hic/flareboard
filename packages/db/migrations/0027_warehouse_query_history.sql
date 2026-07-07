CREATE TABLE IF NOT EXISTS `warehouse_query_history` (
  `history_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text,
  `sql` text NOT NULL,
  `status` text NOT NULL,
  `row_count` integer NOT NULL DEFAULT 0,
  `error` text,
  `duration_ms` integer NOT NULL DEFAULT 0,
  `created_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `warehouse_query_history_website_idx`
  ON `warehouse_query_history` (`website_id`, `created_at`);
