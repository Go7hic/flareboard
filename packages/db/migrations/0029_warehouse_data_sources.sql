CREATE TABLE IF NOT EXISTS `warehouse_data_source` (
  `data_source_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `config_json` text NOT NULL,
  `last_sync_at` integer,
  `last_status` text,
  `last_error` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `warehouse_data_source_website_idx`
  ON `warehouse_data_source` (`website_id`, `created_at`);
