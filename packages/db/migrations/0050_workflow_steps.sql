-- Workflows: trigger filters, multi-step flows, signed webhooks and per-attempt delivery logs.
-- trigger_filters is a JSON array of AND-ed conditions on the triggering event:
--   [{"field": "property", "key": "plan", "operator": "equals", "value": "pro"}]
-- steps is the ordered JSON array of flow steps (delay, condition, webhook, email, slack).
-- An empty steps array records executions only. action_type and action_config are kept as a
-- summary for older readers (session timeline, warehouse) and are no longer read by delivery.
-- signing_secret is the per-workflow HMAC key for the X-Flareboard-Signature header.
ALTER TABLE `workflow` ADD COLUMN `description` text NOT NULL DEFAULT '';
ALTER TABLE `workflow` ADD COLUMN `trigger_filters` text;
ALTER TABLE `workflow` ADD COLUMN `steps` text;
ALTER TABLE `workflow` ADD COLUMN `signing_secret` text;
ALTER TABLE `workflow` ADD COLUMN `signing_secret_rotated_at` integer;

-- Every existing workflow becomes an unfiltered flow with its single action as the only step.
-- Empty webhook body and email templates fall back to the default payload and message,
-- so existing receivers keep getting the fields they got before.
UPDATE `workflow`
SET
  `description` = COALESCE(
    CASE WHEN json_valid(`action_config`) THEN json_extract(`action_config`, '$.note') END,
    ''
  ),
  `trigger_filters` = json('[]'),
  `steps` = CASE
    WHEN `action_type` = 'webhook' THEN json_array(
      json_object(
        'id', 'legacy-webhook',
        'type', 'webhook',
        'url', COALESCE(CASE WHEN json_valid(`action_config`) THEN json_extract(`action_config`, '$.url') END, ''),
        'method', 'POST',
        'headers', json('[]'),
        'body', ''
      )
    )
    WHEN `action_type` = 'email' THEN json_array(
      json_object(
        'id', 'legacy-email',
        'type', 'email',
        'to', COALESCE(CASE WHEN json_valid(`action_config`) THEN json_extract(`action_config`, '$.email') END, ''),
        'subject', '',
        'body', ''
      )
    )
    ELSE json('[]')
  END
WHERE `steps` IS NULL;

UPDATE `workflow`
SET `signing_secret` = 'whsec_' || lower(hex(randomblob(24)))
WHERE `signing_secret` IS NULL;

-- Execution progress. status is one of: recorded, queued, running, waiting, retrying,
-- success, failed, stopped, throttled, cancelled.
ALTER TABLE `workflow_execution` ADD COLUMN `distinct_id` text;
ALTER TABLE `workflow_execution` ADD COLUMN `current_step` integer;
ALTER TABLE `workflow_execution` ADD COLUMN `attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `workflow_execution` ADD COLUMN `response_code` integer;
ALTER TABLE `workflow_execution` ADD COLUMN `next_retry_at` integer;
ALTER TABLE `workflow_execution` ADD COLUMN `updated_at` integer;
ALTER TABLE `workflow_execution` ADD COLUMN `completed_at` integer;

CREATE INDEX IF NOT EXISTS `workflow_execution_created_idx` ON `workflow_execution` (`created_at`);
CREATE INDEX IF NOT EXISTS `workflow_execution_workflow_created_idx` ON `workflow_execution` (`workflow_id`, `created_at`);

-- One row per step outcome: every delivery attempt of an action step (with response code,
-- truncated response body and the time of the next retry), condition results and delays.
CREATE TABLE IF NOT EXISTS `workflow_execution_attempt` (
  `attempt_id` text PRIMARY KEY NOT NULL,
  `execution_id` text NOT NULL,
  `workflow_id` text NOT NULL,
  `website_id` text NOT NULL,
  `step_index` integer NOT NULL,
  `step_type` text NOT NULL,
  `attempt` integer NOT NULL DEFAULT 1,
  `status` text NOT NULL,
  `response_code` integer,
  `error` text,
  `response_body` text,
  `duration_ms` integer,
  `next_retry_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`execution_id`) REFERENCES `workflow_execution`(`execution_id`),
  FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`workflow_id`),
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`)
);

CREATE INDEX IF NOT EXISTS `workflow_execution_attempt_execution_idx` ON `workflow_execution_attempt` (`execution_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `workflow_execution_attempt_website_created_idx` ON `workflow_execution_attempt` (`website_id`, `created_at`);
