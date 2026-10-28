-- Notes on the rota (the Shifts tab): a short text on a day's shift, e.g.
-- "inventory after breakfast", dragged around like the names. The order of
-- the kinds of shift needs no column: properties.shift_types is a list,
-- kept in the order set in Settings → Shifts.
CREATE TABLE shift_notes (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,          -- YYYY-MM-DD
  type_key    TEXT NOT NULL,          -- which kind of shift (shift_types[].key)
  text        TEXT NOT NULL,          -- up to 200 characters
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX shift_notes_by_day ON shift_notes(property_id, day);
