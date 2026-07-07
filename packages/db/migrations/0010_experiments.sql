CREATE TABLE IF NOT EXISTS `experiment` (
  `experiment_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `feature_flag_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'draft',
  `goal_event` text NOT NULL,
  `started_at` integer,
  `ended_at` integer,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`feature_flag_id`) REFERENCES `feature_flag`(`flag_id`)
);

CREATE INDEX IF NOT EXISTS `experiment_website_idx` ON `experiment` (`website_id`);
CREATE INDEX IF NOT EXISTS `experiment_flag_idx` ON `experiment` (`feature_flag_id`);
CREATE INDEX IF NOT EXISTS `experiment_status_idx` ON `experiment` (`website_id`, `status`);
