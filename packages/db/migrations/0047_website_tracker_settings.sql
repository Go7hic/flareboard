-- Tracker settings per website, read by /api/tracker-config and the ingest worker.
-- autocapture: clicks, form submits, field changes and page leaves. On for websites created
-- from now on, off for existing websites so their event volume and plan usage do not change
-- without the owner opting in.
-- persist_visitors: keep a random anonymous id in localStorage and count visitors by it
-- instead of the monthly IP + user agent hash. Off by default (cookieless).
-- respect_dnt: send nothing from browsers with Do Not Track or Global Privacy Control.
ALTER TABLE `website` ADD COLUMN `autocapture` integer NOT NULL DEFAULT 1;
UPDATE `website` SET `autocapture` = 0;
ALTER TABLE `website` ADD COLUMN `persist_visitors` integer NOT NULL DEFAULT 0;
ALTER TABLE `website` ADD COLUMN `respect_dnt` integer NOT NULL DEFAULT 0;
