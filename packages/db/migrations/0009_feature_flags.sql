CREATE TABLE IF NOT EXISTS `feature_flag` (
  `flag_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `key` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `enabled` integer NOT NULL DEFAULT 1,
  `rollout` integer NOT NULL DEFAULT 100,
  `variants` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `feature_flag_website_idx` ON `feature_flag` (`website_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `feature_flag_website_key_unique_idx` ON `feature_flag` (`website_id`, `key`);
