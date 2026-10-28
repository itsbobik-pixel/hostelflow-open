-- The colour a person chose (from the user menu): their badge on notes,
-- replies and ticked tasks. NULL = one picked from their name.
ALTER TABLE users ADD COLUMN color TEXT;

-- Messages sent from Settings → Help & support (also e-mailed to us).
CREATE TABLE support_messages (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX support_messages_by_user ON support_messages(user_id, created_at);
