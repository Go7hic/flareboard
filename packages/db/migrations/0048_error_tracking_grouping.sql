-- Error tracking: stack-based fingerprints, issue merges, regressions and source maps in R2.
--
-- Issue state and comments written before this release are keyed by the old `name|message`
-- fingerprint. The new fingerprint is a hash of the normalized message that SQL cannot compute,
-- so the API rekeys those rows (migrateLegacyErrorIssueKeys in apps/api/src/lib/errors.ts) the
-- first time a website's errors are read or written, and the hourly cron sweeps the rest.
-- Nothing is deleted here: legacy rows stay readable until they are rekeyed.

ALTER TABLE `error_issue_state` ADD COLUMN `resolved_at` integer;
ALTER TABLE `error_issue_state` ADD COLUMN `regressed_at` integer;
ALTER TABLE `error_issue_state` ADD COLUMN `regression_checked_at` integer;

UPDATE `error_issue_state`
SET `resolved_at` = COALESCE(`updated_at`, `created_at`)
WHERE `status` = 'resolved' AND `resolved_at` IS NULL;

-- Merging B into A stores B -> A. Events keep their own fingerprint and are mapped at query time,
-- so future occurrences of B land in A and a merge can be undone.
CREATE TABLE IF NOT EXISTS `error_issue_merge` (
  `website_id` text NOT NULL,
  `source_fingerprint` text NOT NULL,
  `target_fingerprint` text NOT NULL,
  `source_name` text,
  `source_message` text,
  `merged_by` text,
  `created_at` integer,
  PRIMARY KEY (`website_id`, `source_fingerprint`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`merged_by`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `error_issue_merge_target_idx`
  ON `error_issue_merge` (`website_id`, `target_fingerprint`);

-- One row per time a resolved issue occurred again.
CREATE TABLE IF NOT EXISTS `error_issue_regression` (
  `regression_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `fingerprint` text NOT NULL,
  `event_id` text,
  `release` text,
  `environment` text,
  `resolved_at` integer,
  `occurred_at` integer NOT NULL,
  `detected_at` integer NOT NULL,
  `notified_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `error_issue_regression_issue_idx`
  ON `error_issue_regression` (`website_id`, `fingerprint`, `detected_at`);

-- Map content moves to R2 (`sourcemaps/<websiteId>/<sourceMapId>.map`). `content` keeps legacy
-- rows readable until the cron copies them to R2 and clears it.
ALTER TABLE `error_source_map` ADD COLUMN `object_key` text;

ALTER TABLE `error_alert_rule` ADD COLUMN `notify_regressions` integer NOT NULL DEFAULT 1;
