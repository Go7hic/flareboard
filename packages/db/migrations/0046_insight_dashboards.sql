-- Dashboards stream: insight alerts, scheduled subscriptions and notebooks.
-- Board-level filters and layout live in board.parameters and insight shares reuse the share table
-- (share_type 5), so neither needs a schema change.

CREATE TABLE IF NOT EXISTS `insight_alert` (
  `alert_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `insight_id` text NOT NULL,
  `name` text NOT NULL,
  `condition` text NOT NULL,
  `threshold` real NOT NULL,
  `series_key` text NOT NULL DEFAULT 'A',
  `check_interval` text NOT NULL DEFAULT 'day',
  `channel` text NOT NULL DEFAULT 'email',
  `target` text,
  `enabled` integer NOT NULL DEFAULT 1,
  `snoozed_until` integer,
  `last_checked_at` integer,
  `last_state` text,
  `created_by` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`insight_id`) REFERENCES `insight`(`insight_id`),
  FOREIGN KEY (`created_by`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `insight_alert_website_idx` ON `insight_alert` (`website_id`, `enabled`);
CREATE INDEX IF NOT EXISTS `insight_alert_insight_idx` ON `insight_alert` (`insight_id`);

-- One row per alert and evaluated interval: the unique key makes evaluation idempotent.
CREATE TABLE IF NOT EXISTS `insight_alert_check` (
  `check_id` text PRIMARY KEY NOT NULL,
  `alert_id` text NOT NULL,
  `website_id` text NOT NULL,
  `interval_start` integer NOT NULL,
  `interval_end` integer NOT NULL,
  `value` real,
  `previous_value` real,
  `state` text NOT NULL,
  `delivered` integer NOT NULL DEFAULT 0,
  `error` text,
  `created_at` integer,
  FOREIGN KEY (`alert_id`) REFERENCES `insight_alert`(`alert_id`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE UNIQUE INDEX IF NOT EXISTS `insight_alert_check_interval_idx`
  ON `insight_alert_check` (`alert_id`, `interval_start`);

-- Scheduled email summaries of a board (website_id NULL) or an insight.
CREATE TABLE IF NOT EXISTS `report_subscription` (
  `subscription_id` text PRIMARY KEY NOT NULL,
  `website_id` text,
  `user_id` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `title` text NOT NULL,
  `frequency` text NOT NULL,
  `weekday` integer NOT NULL DEFAULT 1,
  `hour` integer NOT NULL DEFAULT 8,
  `timezone` text NOT NULL DEFAULT 'UTC',
  `recipients` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `next_run_at` integer NOT NULL,
  `last_sent_at` integer,
  `last_error` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `report_subscription_due_idx` ON `report_subscription` (`enabled`, `next_run_at`);
CREATE INDEX IF NOT EXISTS `report_subscription_target_idx` ON `report_subscription` (`target_type`, `target_id`);

CREATE TABLE IF NOT EXISTS `notebook` (
  `notebook_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `created_by` text,
  `updated_by` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`created_by`) REFERENCES `user`(`user_id`),
  FOREIGN KEY (`updated_by`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `notebook_website_idx` ON `notebook` (`website_id`, `updated_at`);
