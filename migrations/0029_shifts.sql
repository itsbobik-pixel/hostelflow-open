-- Shifts: the team's rota (the Shifts tab). The kinds of shift and their
-- hours are set per property (Settings → Shifts); NULL = the defaults in
-- src/shifts.js.
ALTER TABLE properties ADD COLUMN shift_types TEXT;

CREATE TABLE shifts (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,          -- YYYY-MM-DD
  type_key    TEXT NOT NULL,          -- which kind of shift (shift_types[].key)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX shifts_once ON shifts(property_id, day, type_key, user_id);
CREATE INDEX shifts_by_day ON shifts(property_id, day);
