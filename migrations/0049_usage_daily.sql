-- Document scans and their AI cost per property and day (Italian date), for the
-- admin centre's ranking by day / 7 days / 30 days. usage_monthly stays the
-- source for scan limits.
CREATE TABLE usage_daily (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,            -- YYYY-MM-DD, Europe/Rome
  scans       INTEGER NOT NULL DEFAULT 0,
  cost_micro  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, day)
);
-- The last 45 days, as well as we can tell: guests whose photo was read, each
-- at its month's average cost per scan (Italy is on summer time, +2 h, all that time).
-- Scans of guests deleted since are missing.
INSERT INTO usage_daily (property_id, day, scans, cost_micro)
SELECT g.property_id, date(g.created_at / 1000, 'unixepoch', '+2 hours') AS d, COUNT(*),
  CAST(COUNT(*) * COALESCE((SELECT 1.0 * u.cost_micro / u.scans FROM usage_monthly u
    WHERE u.property_id = g.property_id AND u.month = strftime('%Y-%m', g.created_at / 1000, 'unixepoch') AND u.scans > 0), 0) AS INTEGER)
FROM guests g
WHERE g.ocr IS NOT NULL AND g.ocr NOT LIKE '%"error"%' AND g.created_at >= (strftime('%s', 'now') - 45 * 86400) * 1000
GROUP BY g.property_id, d;
