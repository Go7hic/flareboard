ALTER TABLE website ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';

UPDATE website
SET timezone = (
  SELECT timezone
  FROM website_email_report
  WHERE website_email_report.website_id = website.website_id
)
WHERE EXISTS (
  SELECT 1
  FROM website_email_report
  WHERE website_email_report.website_id = website.website_id
    AND website_email_report.timezone IS NOT NULL
);
