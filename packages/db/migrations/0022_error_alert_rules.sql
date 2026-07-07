CREATE TABLE IF NOT EXISTS `error_alert_rule` (
  `alert_rule_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `name` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `threshold` integer NOT NULL,
  `window_minutes` integer NOT NULL,
  `severity` text,
  `release` text,
  `environment` text,
  `channel` text NOT NULL DEFAULT 'record',
  `target` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `error_alert_rule_website_idx`
  ON `error_alert_rule` (`website_id`, `enabled`);

CREATE TABLE IF NOT EXISTS `error_alert_event` (
  `alert_event_id` text PRIMARY KEY NOT NULL,
  `alert_rule_id` text NOT NULL,
  `website_id` text NOT NULL,
  `count` integer NOT NULL,
  `threshold` integer NOT NULL,
  `window_start_at` integer NOT NULL,
  `window_end_at` integer NOT NULL,
  `created_at` integer,
  FOREIGN KEY (`alert_rule_id`) REFERENCES `error_alert_rule`(`alert_rule_id`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `error_alert_event_rule_idx`
  ON `error_alert_event` (`website_id`, `alert_rule_id`, `created_at`);
