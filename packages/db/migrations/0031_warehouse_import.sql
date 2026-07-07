CREATE TABLE IF NOT EXISTS `warehouse_import` (
  `import_row_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `primary_key` text NOT NULL,
  `payload_json` text NOT NULL,
  `imported_at` integer NOT NULL,
  FOREIGN KEY (`website_id`) REFERENCES `website`(`website_id`),
  FOREIGN KEY (`data_source_id`) REFERENCES `warehouse_data_source`(`data_source_id`)
);

CREATE UNIQUE INDEX IF NOT EXISTS `warehouse_import_source_key_idx`
  ON `warehouse_import` (`website_id`, `data_source_id`, `primary_key`);

CREATE INDEX IF NOT EXISTS `warehouse_import_website_idx`
  ON `warehouse_import` (`website_id`, `imported_at`);
