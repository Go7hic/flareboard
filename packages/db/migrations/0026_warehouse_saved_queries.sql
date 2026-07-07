CREATE TABLE IF NOT EXISTS `warehouse_saved_query` (
  `saved_query_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `sql` text NOT NULL,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `warehouse_saved_query_website_idx`
  ON `warehouse_saved_query` (`website_id`, `created_at`);
