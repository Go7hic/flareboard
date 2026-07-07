CREATE TABLE IF NOT EXISTS `insight` (
  `insight_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text NOT NULL,
  `type` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `query` text NOT NULL,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `insight_website_idx` ON `insight` (`website_id`);
CREATE INDEX IF NOT EXISTS `insight_user_idx` ON `insight` (`user_id`);
CREATE INDEX IF NOT EXISTS `insight_type_idx` ON `insight` (`website_id`, `type`);
