-- What happened in a property, for its owners (Settings → Activity). Who and
-- what only: never guest data (names, documents), values of passwords or keys.
CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id     TEXT,
  user_name   TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX activity_log_property ON activity_log (property_id, created_at DESC);
