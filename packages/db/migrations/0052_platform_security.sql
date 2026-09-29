-- Two-factor authentication (TOTP). The shared secret is AES-GCM encrypted with a key derived
-- from APP_SECRET. enabled_at stays NULL until the user confirms enrollment with a first code.
-- last_used_step blocks replaying a code inside its 30-second window.
CREATE TABLE IF NOT EXISTS `user_two_factor` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `user`(`user_id`),
  `secret_enc` text NOT NULL,
  `enabled_at` integer,
  `last_used_step` integer,
  `created_at` integer NOT NULL
);

-- One-time recovery codes, stored only as HMAC-SHA256 hashes. A used code is deleted.
CREATE TABLE IF NOT EXISTS `user_recovery_code` (
  `code_hash` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `user_recovery_code_user_idx` ON `user_recovery_code` (`user_id`);

-- Signed-in dashboard sessions. The session id travels inside the encrypted session token
-- (sid). device is a coarse browser and OS summary such as Chrome on macOS: no IP address
-- and no full user agent is stored. Rows are deleted on revocation and after expires_at.
CREATE TABLE IF NOT EXISTS `user_session` (
  `session_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `device` text,
  `method` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `user_session_user_idx` ON `user_session` (`user_id`);
CREATE INDEX IF NOT EXISTS `user_session_expires_idx` ON `user_session` (`expires_at`);

-- Team owners can require two-factor authentication for every member.
ALTER TABLE `team` ADD COLUMN `require_two_factor` integer NOT NULL DEFAULT 0;
