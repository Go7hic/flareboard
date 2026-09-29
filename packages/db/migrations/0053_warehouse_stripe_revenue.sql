-- Warehouse: honest connectors, encrypted credentials, and the Stripe connector.
--
-- warehouse_credential holds connector secrets (Stripe restricted API keys) encrypted with a key
-- derived from APP_SECRET. warehouse_sync_state keeps each source's incremental cursor.
-- Both carry website_id, so the deletion job erases them with the website.
--
-- The stripe_* tables are website analytics tables (SITE_TABLES). They are created here for the
-- legacy D1 storage mode and in the website store (apps/api/src/store/schema.ts, version 3).
-- Timestamps are milliseconds. Amounts are Stripe minor units, *_major columns are decimal units.

CREATE TABLE IF NOT EXISTS `warehouse_credential` (
  `data_source_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `kind` text NOT NULL,
  `ciphertext` text NOT NULL,
  `hint` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `warehouse_credential_website_idx` ON `warehouse_credential` (`website_id`);

CREATE TABLE IF NOT EXISTS `warehouse_sync_state` (
  `data_source_id` text PRIMARY KEY NOT NULL,
  `website_id` text NOT NULL,
  `state_json` text NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `warehouse_sync_state_website_idx` ON `warehouse_sync_state` (`website_id`);

CREATE TABLE IF NOT EXISTS `stripe_customer` (
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `customer_id` text NOT NULL,
  `email` text,
  `name` text,
  `distinct_id` text,
  `deleted` integer NOT NULL DEFAULT 0,
  `metadata_json` text,
  `payload_json` text NOT NULL,
  `created_at` integer,
  `synced_at` integer NOT NULL,
  PRIMARY KEY (`data_source_id`, `customer_id`)
);
CREATE INDEX IF NOT EXISTS `stripe_customer_website_idx` ON `stripe_customer` (`website_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `stripe_customer_distinct_idx` ON `stripe_customer` (`website_id`, `distinct_id`);

CREATE TABLE IF NOT EXISTS `stripe_charge` (
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `charge_id` text NOT NULL,
  `customer_id` text,
  `invoice_id` text,
  `status` text,
  `paid` integer NOT NULL DEFAULT 0,
  `amount` integer NOT NULL DEFAULT 0,
  `amount_refunded` integer NOT NULL DEFAULT 0,
  `currency` text NOT NULL,
  `amount_major` real NOT NULL DEFAULT 0,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `synced_at` integer NOT NULL,
  PRIMARY KEY (`data_source_id`, `charge_id`)
);
CREATE INDEX IF NOT EXISTS `stripe_charge_website_created_idx` ON `stripe_charge` (`website_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `stripe_charge_customer_idx` ON `stripe_charge` (`website_id`, `customer_id`);

CREATE TABLE IF NOT EXISTS `stripe_refund` (
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `refund_id` text NOT NULL,
  `charge_id` text,
  `status` text,
  `amount` integer NOT NULL DEFAULT 0,
  `currency` text NOT NULL,
  `amount_major` real NOT NULL DEFAULT 0,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `synced_at` integer NOT NULL,
  PRIMARY KEY (`data_source_id`, `refund_id`)
);
CREATE INDEX IF NOT EXISTS `stripe_refund_website_created_idx` ON `stripe_refund` (`website_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `stripe_invoice` (
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `customer_id` text,
  `subscription_id` text,
  `status` text,
  `currency` text NOT NULL,
  `total` integer NOT NULL DEFAULT 0,
  `amount_paid` integer NOT NULL DEFAULT 0,
  `amount_paid_major` real NOT NULL DEFAULT 0,
  `period_start` integer,
  `period_end` integer,
  `paid_at` integer,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `synced_at` integer NOT NULL,
  PRIMARY KEY (`data_source_id`, `invoice_id`)
);
CREATE INDEX IF NOT EXISTS `stripe_invoice_website_created_idx` ON `stripe_invoice` (`website_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `stripe_invoice_line` (
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `line_id` text NOT NULL,
  `customer_id` text,
  `subscription_id` text,
  `price_id` text,
  `interval` text,
  `interval_count` integer,
  `quantity` integer,
  `proration` integer NOT NULL DEFAULT 0,
  `amount` integer NOT NULL DEFAULT 0,
  `currency` text NOT NULL,
  `amount_major` real NOT NULL DEFAULT 0,
  `mrr_major` real NOT NULL DEFAULT 0,
  `period_start` integer,
  `period_end` integer,
  `synced_at` integer NOT NULL,
  PRIMARY KEY (`data_source_id`, `invoice_id`, `line_id`)
);
CREATE INDEX IF NOT EXISTS `stripe_invoice_line_period_idx` ON `stripe_invoice_line` (`website_id`, `period_end`);

CREATE TABLE IF NOT EXISTS `stripe_subscription` (
  `website_id` text NOT NULL,
  `data_source_id` text NOT NULL,
  `subscription_id` text NOT NULL,
  `customer_id` text,
  `status` text,
  `currency` text,
  `mrr_major` real NOT NULL DEFAULT 0,
  `start_date` integer,
  `canceled_at` integer,
  `ended_at` integer,
  `cancel_at_period_end` integer NOT NULL DEFAULT 0,
  `current_period_start` integer,
  `current_period_end` integer,
  `trial_end` integer,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `synced_at` integer NOT NULL,
  PRIMARY KEY (`data_source_id`, `subscription_id`)
);
CREATE INDEX IF NOT EXISTS `stripe_subscription_website_idx` ON `stripe_subscription` (`website_id`, `created_at`);

-- r2_json, d1, postgres and mysql sources were offered by the UI but never synced anything
-- (a sync only flipped the status to connected). The types are gone, so park any saved ones.
UPDATE `warehouse_data_source`
SET `enabled` = 0,
    `last_status` = 'failed',
    `last_error` = 'This connector type was never implemented and has been removed. Delete this source.'
WHERE `type` IN ('r2_json', 'd1', 'postgres', 'mysql');
