-- Monthly allowances beyond product events: recorded replays (counted by ingest when a visit's
-- first chunk arrives) and OpenTelemetry log records / spans (counted per accepted export).
ALTER TABLE `usage_monthly` ADD COLUMN `replays_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `usage_monthly` ADD COLUMN `otel_rows` integer NOT NULL DEFAULT 0;
