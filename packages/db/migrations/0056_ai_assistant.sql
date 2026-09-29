-- "Ask Flareboard" assistant conversations, one owner per conversation and website.
-- History is bounded in code (conversations per user and website, messages per conversation),
-- idle conversations are pruned by the hourly cron, and the user can delete them at any time.
-- Rows are erased with the website (website_id) and with the account (USER_OWNED_TABLES).
CREATE TABLE IF NOT EXISTS `ai_conversation` (
  `conversation_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `title` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `ai_conversation_owner_idx` ON `ai_conversation` (`user_id`, `website_id`, `updated_at`);
CREATE INDEX IF NOT EXISTS `ai_conversation_updated_idx` ON `ai_conversation` (`updated_at`);

-- content is JSON: the user's text, or the assistant's answer with the tool calls it made and
-- the results the dashboard renders (capped in size).
CREATE TABLE IF NOT EXISTS `ai_message` (
  `message_id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `ai_conversation`(`conversation_id`),
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `role` text NOT NULL,
  `content` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `ai_message_conversation_idx` ON `ai_message` (`conversation_id`, `created_at`);

-- Per-account daily assistant usage, for the hosted-mode daily cap. Counts only, no content.
CREATE TABLE IF NOT EXISTS `ai_usage_daily` (
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `day` text NOT NULL,
  `requests` integer NOT NULL DEFAULT 0,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `day`)
);
