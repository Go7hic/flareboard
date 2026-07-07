ALTER TABLE `survey` ADD COLUMN `trigger_event` text;
ALTER TABLE `survey` ADD COLUMN `display_delay_seconds` integer NOT NULL DEFAULT 0;
