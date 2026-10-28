-- The header picture follows the person, not the device: town or their own
-- photo, and which part of the photo shows (background position, "x% y%").
CREATE TABLE user_headers (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  art        TEXT NOT NULL DEFAULT 'town',
  pos        TEXT,
  image      TEXT,              -- data URL (JPEG), at most about 1.5 MB
  updated_at INTEGER NOT NULL
);
