CREATE TABLE IF NOT EXISTS `survey` (
  `survey_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `name` text NOT NULL,
  `question` text NOT NULL,
  `type` text NOT NULL DEFAULT 'text',
  `enabled` integer NOT NULL DEFAULT 1,
  `trigger_path` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `survey_website_idx` ON `survey` (`website_id`);
CREATE INDEX IF NOT EXISTS `survey_website_enabled_idx` ON `survey` (`website_id`, `enabled`);

CREATE TABLE IF NOT EXISTS `survey_response` (
  `response_id` text PRIMARY KEY NOT NULL,
  `survey_id` text NOT NULL,
  `website_id` text NOT NULL,
  `session_id` text,
  `visit_id` text,
  `answer` text NOT NULL,
  `url_path` text,
  `created_at` integer,
  FOREIGN KEY (`survey_id`) REFERENCES `survey`(`survey_id`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `survey_response_survey_idx` ON `survey_response` (`survey_id`);
CREATE INDEX IF NOT EXISTS `survey_response_website_created_idx` ON `survey_response` (`website_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `survey_response_session_idx` ON `survey_response` (`session_id`);
