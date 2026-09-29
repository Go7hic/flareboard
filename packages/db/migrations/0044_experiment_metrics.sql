-- Experiment metrics: one primary metric and up to five secondary metrics (JSON), the relative
-- minimum detectable effect (percent) behind the sample-size guidance, and the feature flag
-- allocation captured when the experiment starts (the expected split for the sample ratio
-- mismatch check, so later flag edits such as shipping a winner do not rewrite history).
ALTER TABLE `experiment` ADD COLUMN `primary_metric` text;
ALTER TABLE `experiment` ADD COLUMN `secondary_metrics` text NOT NULL DEFAULT '[]';
ALTER TABLE `experiment` ADD COLUMN `minimum_detectable_effect` real;
ALTER TABLE `experiment` ADD COLUMN `allocation` text;

-- Existing experiments keep measuring their goal event, now as a primary conversion metric.
UPDATE `experiment`
SET `primary_metric` = json_object('type', 'conversion', 'event', `goal_event`)
WHERE `primary_metric` IS NULL;

-- Running and paused experiments capture the split their flag serves today.
UPDATE `experiment`
SET `allocation` = (
  SELECT json_object(
    'enabled', CASE WHEN f.`enabled` THEN json('true') ELSE json('false') END,
    'rollout', f.`rollout`,
    'variants', CASE
      WHEN json_valid(f.`variants`) AND json_type(f.`variants`) = 'array' THEN json(f.`variants`)
      ELSE json('[]')
    END,
    'targeted', CASE
      WHEN json_valid(f.`targeting_rules`) AND json_type(f.`targeting_rules`) = 'array'
        AND json_array_length(f.`targeting_rules`) > 0 THEN json('true')
      ELSE json('false')
    END
  )
  FROM `feature_flag` f
  WHERE f.`flag_id` = `experiment`.`feature_flag_id`
)
WHERE `status` IN ('running', 'paused') AND `allocation` IS NULL;
