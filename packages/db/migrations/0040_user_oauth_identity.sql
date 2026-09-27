-- OAuth identities were linked by matching the provider login to a local username
-- and remembered only in KV (1-year TTL). A provider account named like a local user
-- (e.g. "admin") took that account over. Links are now explicit and durable.
CREATE TABLE IF NOT EXISTS `user_oauth_identity` (
  `provider` text NOT NULL,
  `provider_user_id` text NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`user_id`) ON DELETE CASCADE,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`provider`, `provider_user_id`)
);

CREATE INDEX IF NOT EXISTS `user_oauth_identity_user_idx` ON `user_oauth_identity` (`user_id`);
