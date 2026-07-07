CREATE TABLE IF NOT EXISTS `action_definition` (
  `action_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `rules` text NOT NULL,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `action_definition_website_idx` ON `action_definition` (`website_id`);
CREATE INDEX IF NOT EXISTS `action_definition_website_name_idx` ON `action_definition` (`website_id`, `name`);
