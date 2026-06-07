-- Full gap features: normalized heatmaps, email timezone, cohort definitions

ALTER TABLE `website` ADD COLUMN `heatmap_config` text;

ALTER TABLE `website_email_report` ADD COLUMN `timezone` text NOT NULL DEFAULT 'UTC';

ALTER TABLE `cohort` ADD COLUMN `definition` text;

-- Recreate heatmap_cell: device-independent normalized coords (0–999), optional device_class filter
CREATE TABLE `heatmap_cell_v2` (
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `url_path` text NOT NULL,
  `day` text NOT NULL,
  `kind` text NOT NULL,
  `norm_x` integer NOT NULL,
  `norm_y` integer NOT NULL,
  `device_class` text NOT NULL DEFAULT '',
  `viewport_w` integer NOT NULL DEFAULT 0,
  `viewport_h` integer NOT NULL DEFAULT 0,
  `count` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`website_id`, `url_path`, `day`, `kind`, `norm_x`, `norm_y`, `device_class`)
);

INSERT INTO `heatmap_cell_v2` (
  `website_id`, `url_path`, `day`, `kind`, `norm_x`, `norm_y`, `device_class`, `viewport_w`, `viewport_h`, `count`
)
SELECT
  `website_id`,
  `url_path`,
  `day`,
  `kind`,
  CASE WHEN `grid_x` * 50 > 999 THEN 999 ELSE `grid_x` * 50 END AS `norm_x`,
  CASE WHEN `grid_y` * 50 > 999 THEN 999 ELSE `grid_y` * 50 END AS `norm_y`,
  '' AS `device_class`,
  MAX(`viewport_w`) AS `viewport_w`,
  MAX(`viewport_h`) AS `viewport_h`,
  SUM(`count`) AS `count`
FROM `heatmap_cell`
GROUP BY `website_id`, `url_path`, `day`, `kind`, `grid_x`, `grid_y`;

DROP TABLE `heatmap_cell`;
ALTER TABLE `heatmap_cell_v2` RENAME TO `heatmap_cell`;

CREATE INDEX IF NOT EXISTS `heatmap_cell_lookup_idx` ON `heatmap_cell` (`website_id`, `url_path`, `day`);
