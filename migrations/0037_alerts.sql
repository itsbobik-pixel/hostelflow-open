-- Error alerts by e-mail (src/alerts.js): when each kind last went out,
-- and how many of that kind came since (they wait for the next e-mail).
CREATE TABLE alerts (
  kind         TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL,
  missed       INTEGER NOT NULL DEFAULT 0,
  last_detail  TEXT
);
