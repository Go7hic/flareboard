-- Public project keys (fb_pk_...) identify a website to ingest in place of its id, for
-- tracking snippets and PostHog SDKs. One per website, created on first use, replaced on
-- rotation. Ingest caches key -> website in KV as project-key:<key>.
CREATE TABLE IF NOT EXISTS `website_project_key` (
  `website_id` text PRIMARY KEY NOT NULL REFERENCES `website`(`website_id`),
  `project_key` text NOT NULL,
  `created_at` integer NOT NULL,
  `rotated_at` integer
);

CREATE UNIQUE INDEX IF NOT EXISTS `website_project_key_key_idx` ON `website_project_key` (`project_key`);

-- Personal API keys (fb_sk_...) authenticate API calls as their user. Only a SHA-256 hash
-- and a short display prefix are stored. Revoking deletes the row, and the account
-- deletion purge erases the rest.
CREATE TABLE IF NOT EXISTS `personal_api_key` (
  `key_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `name` text NOT NULL,
  `key_hash` text NOT NULL,
  `key_prefix` text NOT NULL,
  `scopes` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_used_at` integer
);

CREATE UNIQUE INDEX IF NOT EXISTS `personal_api_key_hash_idx` ON `personal_api_key` (`key_hash`);
CREATE INDEX IF NOT EXISTS `personal_api_key_user_idx` ON `personal_api_key` (`user_id`);
