-- Hosted SaaS: email registration, Stripe subscriptions, monthly usage
ALTER TABLE `user` ADD COLUMN `email` text;
ALTER TABLE `user` ADD COLUMN `email_verified_at` integer;

CREATE UNIQUE INDEX IF NOT EXISTS `user_email_idx` ON `user` (`email`);

CREATE TABLE IF NOT EXISTS `user_subscription` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `user`(`user_id`),
  `plan_id` text NOT NULL DEFAULT 'free',
  `stripe_customer_id` text,
  `stripe_subscription_id` text,
  `stripe_price_id` text,
  `status` text NOT NULL DEFAULT 'active',
  `current_period_end` integer,
  `created_at` integer,
  `updated_at` integer
);

CREATE TABLE IF NOT EXISTS `usage_monthly` (
  `user_id` text NOT NULL REFERENCES `user`(`user_id`),
  `month_key` text NOT NULL,
  `events_count` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `month_key`)
);
