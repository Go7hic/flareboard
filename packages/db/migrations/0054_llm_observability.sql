-- LLM analytics settings per website (config only, the AI events live in the website store).
-- capture_content: store prompt and response content of AI events (aiInput / aiOutput).
-- Off means ingest keeps only metadata (model, tokens, cost, latency, status, trace ids).
-- No row means on. Ingest caches the value in KV as llm-settings:<websiteId>.
CREATE TABLE IF NOT EXISTS `llm_website_setting` (
  `website_id` text PRIMARY KEY NOT NULL REFERENCES `website`(`website_id`),
  `capture_content` integer NOT NULL DEFAULT 1,
  `updated_at` integer NOT NULL
);

-- Per-website model prices (USD per 1M tokens) that replace the built-in price table for a
-- model id (normalized: lower case, no vendor prefix or date suffix).
CREATE TABLE IF NOT EXISTS `llm_model_price` (
  `website_id` text NOT NULL REFERENCES `website`(`website_id`),
  `model` text NOT NULL,
  `input_per_million` real NOT NULL,
  `output_per_million` real NOT NULL,
  `cache_read_per_million` real,
  `cache_write_per_million` real,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`website_id`, `model`)
);
