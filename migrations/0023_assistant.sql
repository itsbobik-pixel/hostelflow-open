-- Flowy, the help assistant in Settings → Help & support (src/assistant.js):
-- questions per property and day (the daily cap) and the AI tokens they cost.
CREATE TABLE assistant_usage (
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  messages      INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, day)
);
