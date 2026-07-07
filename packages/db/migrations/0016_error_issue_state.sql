CREATE TABLE IF NOT EXISTS `error_issue_state` (
  `website_id` text NOT NULL,
  `fingerprint` text NOT NULL,
  `status` text NOT NULL DEFAULT 'open',
  `note` text,
  `created_at` integer,
  `updated_at` integer,
  PRIMARY KEY (`website_id`, `fingerprint`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `error_issue_state_website_status_idx`
  ON `error_issue_state` (`website_id`, `status`);
