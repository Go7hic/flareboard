-- Session replay activity counters, filled by ingest from each recorded chunk: clicks, input
-- changes, console messages by level (only when the website opted in to console capture) and
-- failed network requests (only with network capture). The summary row adds them up per visit
-- so the replay list can filter and sort without reading R2.
ALTER TABLE `session_replay` ADD COLUMN `click_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay` ADD COLUMN `input_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay` ADD COLUMN `console_log_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay` ADD COLUMN `console_warn_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay` ADD COLUMN `console_error_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay` ADD COLUMN `network_error_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay_summary` ADD COLUMN `click_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay_summary` ADD COLUMN `input_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay_summary` ADD COLUMN `console_log_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay_summary` ADD COLUMN `console_warn_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay_summary` ADD COLUMN `console_error_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `session_replay_summary` ADD COLUMN `network_error_count` integer NOT NULL DEFAULT 0;

-- Public links to one replay. Anyone with the token can watch that recording (and nothing
-- else) until it expires or is revoked. Revoking deletes the row. Rows go with the website
-- (website_id) and the author reference is cleared when the account is erased.
CREATE TABLE IF NOT EXISTS `session_replay_share` (
  `share_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `visit_id` text NOT NULL,
  `token` text NOT NULL,
  `created_by` text REFERENCES `user`(`user_id`),
  `expires_at` integer,
  `created_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `session_replay_share_token_idx` ON `session_replay_share` (`token`);
CREATE INDEX IF NOT EXISTS `session_replay_share_visit_idx` ON `session_replay_share` (`website_id`, `visit_id`);
