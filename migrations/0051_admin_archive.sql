-- The admin centre's archive: what an automatic item said when it was ticked
-- off, and when (the rows stay after they run out).
ALTER TABLE admin_dismissed ADD COLUMN dismissed_at INTEGER;
ALTER TABLE admin_dismissed ADD COLUMN name TEXT;
ALTER TABLE admin_dismissed ADD COLUMN text TEXT;
ALTER TABLE admin_dismissed ADD COLUMN level TEXT;
UPDATE admin_dismissed SET dismissed_at = until - 7 * 86400000 WHERE dismissed_at IS NULL;
