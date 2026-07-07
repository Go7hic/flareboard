CREATE TABLE IF NOT EXISTS `person` (
  `person_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `distinct_id` text NOT NULL,
  `properties_json` text NOT NULL DEFAULT '{}',
  `first_seen_at` integer,
  `last_seen_at` integer,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE UNIQUE INDEX IF NOT EXISTS `person_website_distinct_idx`
  ON `person` (`website_id`, `distinct_id`);

CREATE TABLE IF NOT EXISTS `person_group_membership` (
  `membership_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `person_id` text NOT NULL,
  `group_type` text NOT NULL,
  `group_key` text NOT NULL,
  `created_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`person_id`) REFERENCES `person`(`person_id`)
);

CREATE UNIQUE INDEX IF NOT EXISTS `person_group_membership_unique_idx`
  ON `person_group_membership` (`website_id`, `person_id`, `group_type`, `group_key`);
