-- The scan bench (/ocr-compare): sample documents only, read by both models;
-- the readings are kept (they are not real people) with the verdict per field.
CREATE TABLE ocr_bench (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  label      TEXT,
  models     TEXT NOT NULL,   -- {"main": "...", "shadow": "..."}
  main       TEXT NOT NULL,   -- {fields, notes, ms, usage, error?}
  shadow     TEXT NOT NULL,
  verdict    TEXT             -- {field: 'same' | 'main' | 'shadow' | 'both' | 'neither'}
);
