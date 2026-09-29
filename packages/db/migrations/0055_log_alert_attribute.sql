-- Log alerts can also match on one record or resource attribute (key, and optionally its value).
-- OpenTelemetry logs and spans themselves live in each website's store, not in D1
-- (log_record and trace_span, apps/api/src/store/schema.ts).
ALTER TABLE `log_alert_rule` ADD COLUMN `attribute_key` text;
ALTER TABLE `log_alert_rule` ADD COLUMN `attribute_value` text;
