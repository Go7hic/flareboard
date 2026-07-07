ALTER TABLE `error_issue_state` ADD COLUMN `assignee_user_id` text REFERENCES `user`(`user_id`);

CREATE TABLE IF NOT EXISTS `error_issue_comment` (
  `comment_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `fingerprint` text NOT NULL,
  `user_id` text,
  `body` text NOT NULL,
  `created_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `error_issue_comment_issue_idx`
  ON `error_issue_comment` (`website_id`, `fingerprint`, `created_at`);
