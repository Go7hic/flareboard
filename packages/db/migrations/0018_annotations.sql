CREATE TABLE IF NOT EXISTS `annotation` (
  `annotation_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `user_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `category` text NOT NULL DEFAULT 'note',
  `happened_at` integer NOT NULL,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)
);

CREATE INDEX IF NOT EXISTS `annotation_website_idx` ON `annotation` (`website_id`);
CREATE INDEX IF NOT EXISTS `annotation_website_happened_idx` ON `annotation` (`website_id`, `happened_at`);
CREATE INDEX IF NOT EXISTS `annotation_user_idx` ON `annotation` (`user_id`);
