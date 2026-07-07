CREATE TABLE IF NOT EXISTS `dead_event` (
  `dead_event_id` text PRIMARY KEY NOT NULL,
  `queue` text NOT NULL,
  `message_type` text,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `dead_event_created_idx` ON `dead_event` (`created_at`);
