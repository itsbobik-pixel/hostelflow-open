-- Trying a cheaper model for document scans: each scan is also read by
-- env.OCR_SHADOW_MODEL and only the names of the fields it read differently
-- are kept (never their values). Dropped once the choice is made.
CREATE TABLE ocr_shadow (
  id            TEXT PRIMARY KEY,
  model         TEXT NOT NULL,          -- 'ok' or 'error'
  created_at    INTEGER NOT NULL,
  differs       TEXT,                   -- JSON list of field names that differ from the main model
  error         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  ms            INTEGER NOT NULL DEFAULT 0
);
