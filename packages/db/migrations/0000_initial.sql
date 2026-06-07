-- flareboard initial schema (legacy analytics export compatible, D1/SQLite)

CREATE TABLE IF NOT EXISTS `user` (
  `user_id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL UNIQUE,
  `password` text NOT NULL,
  `role` text NOT NULL,
  `logo_url` text,
  `display_name` text,
  `created_at` integer,
  `updated_at` integer,
  `deleted_at` integer
);

CREATE TABLE IF NOT EXISTS `team` (
  `team_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `access_code` text UNIQUE,
  `logo_url` text,
  `created_at` integer,
  `updated_at` integer,
  `deleted_at` integer
);
CREATE INDEX IF NOT EXISTS `team_access_code_idx` ON `team` (`access_code`);

CREATE TABLE IF NOT EXISTS `team_user` (
  `team_user_id` text PRIMARY KEY NOT NULL,
  `team_id` text NOT NULL REFERENCES `team`(`team_id`),
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `role` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);
CREATE INDEX IF NOT EXISTS `team_user_team_idx` ON `team_user` (`team_id`);
CREATE INDEX IF NOT EXISTS `team_user_user_idx` ON `team_user` (`user_id`);

CREATE TABLE IF NOT EXISTS `website` (
  `website_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `domain` text,
  `reset_at` integer,
  `user_id` text REFERENCES `user`(`user_id`),
  `team_id` text REFERENCES `team`(`team_id`),
  `created_by` text REFERENCES `user`(`user_id`),
  `created_at` integer,
  `updated_at` integer,
  `deleted_at` integer,
  `replay_enabled` integer DEFAULT 0,
  `replay_config` text
);
CREATE INDEX IF NOT EXISTS `website_user_idx` ON `website` (`user_id`);
CREATE INDEX IF NOT EXISTS `website_team_idx` ON `website` (`team_id`);
CREATE INDEX IF NOT EXISTS `website_created_at_idx` ON `website` (`created_at`);
CREATE INDEX IF NOT EXISTS `website_created_by_idx` ON `website` (`created_by`);

CREATE TABLE IF NOT EXISTS `session` (
  `session_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `browser` text,
  `os` text,
  `device` text,
  `screen` text,
  `language` text,
  `country` text,
  `region` text,
  `city` text,
  `distinct_id` text,
  `created_at` integer
);
CREATE INDEX IF NOT EXISTS `session_created_at_idx` ON `session` (`created_at`);
CREATE INDEX IF NOT EXISTS `session_website_idx` ON `session` (`website_id`);
CREATE INDEX IF NOT EXISTS `session_website_created_idx` ON `session` (`website_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `website_event` (
  `event_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `session_id` text NOT NULL REFERENCES `session`(`session_id`),
  `visit_id` text NOT NULL,
  `created_at` integer,
  `url_path` text NOT NULL,
  `url_query` text,
  `utm_source` text,
  `utm_medium` text,
  `utm_campaign` text,
  `utm_content` text,
  `utm_term` text,
  `referrer_path` text,
  `referrer_query` text,
  `referrer_domain` text,
  `page_title` text,
  `gclid` text,
  `fbclid` text,
  `msclkid` text,
  `ttclid` text,
  `li_fat_id` text,
  `twclid` text,
  `event_type` integer DEFAULT 1 NOT NULL,
  `event_name` text,
  `tag` text,
  `hostname` text,
  `lcp` real,
  `inp` real,
  `cls` real,
  `fcp` real,
  `ttfb` real
);
CREATE INDEX IF NOT EXISTS `website_event_created_at_idx` ON `website_event` (`created_at`);
CREATE INDEX IF NOT EXISTS `website_event_session_idx` ON `website_event` (`session_id`);
CREATE INDEX IF NOT EXISTS `website_event_visit_idx` ON `website_event` (`visit_id`);
CREATE INDEX IF NOT EXISTS `website_event_website_idx` ON `website_event` (`website_id`);
CREATE INDEX IF NOT EXISTS `website_event_website_created_idx` ON `website_event` (`website_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `website_event_website_path_idx` ON `website_event` (`website_id`, `created_at`, `url_path`);
CREATE INDEX IF NOT EXISTS `website_event_website_event_name_idx` ON `website_event` (`website_id`, `created_at`, `event_name`);

CREATE TABLE IF NOT EXISTS `event_data` (
  `event_data_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `website_event_id` text NOT NULL REFERENCES `website_event`(`event_id`),
  `data_key` text NOT NULL,
  `string_value` text,
  `number_value` real,
  `date_value` integer,
  `data_type` integer NOT NULL,
  `created_at` integer
);
CREATE INDEX IF NOT EXISTS `event_data_created_at_idx` ON `event_data` (`created_at`);
CREATE INDEX IF NOT EXISTS `event_data_website_idx` ON `event_data` (`website_id`);
CREATE INDEX IF NOT EXISTS `event_data_event_idx` ON `event_data` (`website_event_id`);
CREATE INDEX IF NOT EXISTS `event_data_website_created_idx` ON `event_data` (`website_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `session_data` (
  `session_data_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `session_id` text NOT NULL REFERENCES `session`(`session_id`),
  `data_key` text NOT NULL,
  `string_value` text,
  `number_value` real,
  `date_value` integer,
  `data_type` integer NOT NULL,
  `distinct_id` text,
  `created_at` integer
);
CREATE INDEX IF NOT EXISTS `session_data_created_at_idx` ON `session_data` (`created_at`);
CREATE INDEX IF NOT EXISTS `session_data_website_idx` ON `session_data` (`website_id`);
CREATE INDEX IF NOT EXISTS `session_data_session_idx` ON `session_data` (`session_id`);
CREATE INDEX IF NOT EXISTS `session_data_session_created_idx` ON `session_data` (`session_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `report` (
  `report_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `type` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `parameters` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);
CREATE INDEX IF NOT EXISTS `report_user_idx` ON `report` (`user_id`);
CREATE INDEX IF NOT EXISTS `report_website_idx` ON `report` (`website_id`);
CREATE INDEX IF NOT EXISTS `report_type_idx` ON `report` (`type`);
CREATE INDEX IF NOT EXISTS `report_name_idx` ON `report` (`name`);

CREATE TABLE IF NOT EXISTS `segment` (
  `segment_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `type` text NOT NULL,
  `name` text NOT NULL,
  `parameters` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);
CREATE INDEX IF NOT EXISTS `segment_website_idx` ON `segment` (`website_id`);

CREATE TABLE IF NOT EXISTS `revenue` (
  `revenue_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `session_id` text NOT NULL REFERENCES `session`(`session_id`),
  `event_id` text NOT NULL,
  `event_name` text NOT NULL,
  `currency` text NOT NULL,
  `revenue` real,
  `created_at` integer
);
CREATE INDEX IF NOT EXISTS `revenue_website_idx` ON `revenue` (`website_id`);
CREATE INDEX IF NOT EXISTS `revenue_session_idx` ON `revenue` (`session_id`);
CREATE INDEX IF NOT EXISTS `revenue_website_created_idx` ON `revenue` (`website_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `link` (
  `link_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `url` text NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `user_id` text REFERENCES `user`(`user_id`),
  `team_id` text REFERENCES `team`(`team_id`),
  `created_at` integer,
  `updated_at` integer,
  `deleted_at` integer
);
CREATE INDEX IF NOT EXISTS `link_slug_idx` ON `link` (`slug`);
CREATE INDEX IF NOT EXISTS `link_user_idx` ON `link` (`user_id`);
CREATE INDEX IF NOT EXISTS `link_team_idx` ON `link` (`team_id`);

CREATE TABLE IF NOT EXISTS `pixel` (
  `pixel_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `user_id` text REFERENCES `user`(`user_id`),
  `team_id` text REFERENCES `team`(`team_id`),
  `created_at` integer,
  `updated_at` integer,
  `deleted_at` integer
);
CREATE INDEX IF NOT EXISTS `pixel_slug_idx` ON `pixel` (`slug`);
CREATE INDEX IF NOT EXISTS `pixel_user_idx` ON `pixel` (`user_id`);
CREATE INDEX IF NOT EXISTS `pixel_team_idx` ON `pixel` (`team_id`);

CREATE TABLE IF NOT EXISTS `board` (
  `board_id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `parameters` text NOT NULL,
  `user_id` text REFERENCES `user`(`user_id`),
  `team_id` text REFERENCES `team`(`team_id`),
  `created_at` integer,
  `updated_at` integer
);
CREATE INDEX IF NOT EXISTS `board_user_idx` ON `board` (`user_id`);
CREATE INDEX IF NOT EXISTS `board_team_idx` ON `board` (`team_id`);
CREATE INDEX IF NOT EXISTS `board_created_at_idx` ON `board` (`created_at`);

CREATE TABLE IF NOT EXISTS `share` (
  `share_id` text PRIMARY KEY NOT NULL,
  `entity_id` text NOT NULL,
  `name` text NOT NULL,
  `share_type` integer NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `parameters` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);
CREATE INDEX IF NOT EXISTS `share_entity_idx` ON `share` (`entity_id`);

CREATE TABLE IF NOT EXISTS `session_replay` (
  `replay_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `session_id` text NOT NULL,
  `visit_id` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `events` blob NOT NULL,
  `event_count` integer NOT NULL,
  `started_at` integer NOT NULL,
  `ended_at` integer NOT NULL,
  `created_at` integer
);
CREATE INDEX IF NOT EXISTS `session_replay_website_idx` ON `session_replay` (`website_id`);
CREATE INDEX IF NOT EXISTS `session_replay_session_idx` ON `session_replay` (`session_id`);
CREATE INDEX IF NOT EXISTS `session_replay_visit_idx` ON `session_replay` (`visit_id`);
CREATE INDEX IF NOT EXISTS `session_replay_website_created_idx` ON `session_replay` (`website_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `session_replay_saved` (
  `saved_replay_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `visit_id` text NOT NULL,
  `created_at` integer,
  `updated_at` integer
);
CREATE INDEX IF NOT EXISTS `session_replay_saved_website_idx` ON `session_replay_saved` (`website_id`);
CREATE INDEX IF NOT EXISTS `session_replay_saved_visit_idx` ON `session_replay_saved` (`visit_id`);
CREATE INDEX IF NOT EXISTS `session_replay_saved_website_created_idx` ON `session_replay_saved` (`website_id`, `created_at`);
