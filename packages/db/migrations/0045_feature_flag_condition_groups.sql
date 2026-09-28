-- Feature flags: release condition groups, payloads and early access.
-- condition_groups is a JSON array of groups, OR-ed in order. Each group has AND-ed
-- conditions, its own rollout and an optional variant override:
--   [{"conditions": [...], "rollout": 100, "variant": null}]
-- The rollout and targeting_rules columns are kept as a mirror of the first group for
-- older readers. Rows whose condition_groups is NULL are evaluated from those columns.
-- payload is the raw JSON payload of a boolean flag. Variant payloads live in variants.
ALTER TABLE `feature_flag` ADD COLUMN `condition_groups` text;
ALTER TABLE `feature_flag` ADD COLUMN `payload` text;
ALTER TABLE `feature_flag` ADD COLUMN `early_access` integer NOT NULL DEFAULT 0;
ALTER TABLE `feature_flag` ADD COLUMN `early_access_name` text NOT NULL DEFAULT '';
ALTER TABLE `feature_flag` ADD COLUMN `early_access_description` text NOT NULL DEFAULT '';

-- Every existing flag becomes one group made of its targeting rules and rollout.
-- Malformed targeting_rules (never written by the API) become an empty condition list.
UPDATE `feature_flag`
SET `condition_groups` = json_array(
  json_object(
    'conditions',
    CASE
      WHEN json_valid(`targeting_rules`) THEN
        CASE WHEN json_type(`targeting_rules`) = 'array' THEN json(`targeting_rules`) ELSE json('[]') END
      ELSE json('[]')
    END,
    'rollout',
    MAX(0, MIN(100, COALESCE(`rollout`, 100)))
  )
)
WHERE `condition_groups` IS NULL;

CREATE INDEX IF NOT EXISTS `feature_flag_website_early_access_idx` ON `feature_flag` (`website_id`, `early_access`);
