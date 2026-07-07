CREATE TABLE IF NOT EXISTS `workflow` (
  `workflow_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `name` text NOT NULL,
  `trigger_event` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `action_type` text NOT NULL DEFAULT 'record',
  `action_config` text,
  `created_at` integer,
  `updated_at` integer,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `workflow_website_idx` ON `workflow` (`website_id`);
CREATE INDEX IF NOT EXISTS `workflow_website_enabled_idx` ON `workflow` (`website_id`, `enabled`);
CREATE INDEX IF NOT EXISTS `workflow_trigger_idx` ON `workflow` (`website_id`, `trigger_event`);

CREATE TABLE IF NOT EXISTS `workflow_execution` (
  `execution_id` text PRIMARY KEY NOT NULL,
  `workflow_id` text NOT NULL,
  `website_id` text NOT NULL,
  `session_id` text,
  `visit_id` text,
  `event_id` text,
  `event_name` text,
  `status` text NOT NULL DEFAULT 'recorded',
  `error` text,
  `created_at` integer,
  FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`workflow_id`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `workflow_execution_workflow_idx` ON `workflow_execution` (`workflow_id`);
CREATE INDEX IF NOT EXISTS `workflow_execution_website_created_idx` ON `workflow_execution` (`website_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `workflow_execution_session_idx` ON `workflow_execution` (`session_id`);
