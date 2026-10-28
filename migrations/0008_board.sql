-- Dashboard: team notes, the property's daily routine and who ticked off what.

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  category    TEXT,                                -- key from board.js NOTE_CATEGORIES
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX notes_by_property ON notes(property_id, created_at);

CREATE TABLE note_likes (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, user_id)
);

-- The daily routine as the owner typed it (plain text, parsed by board.js).
ALTER TABLE properties ADD COLUMN routine TEXT;

-- Routine tasks ticked off, per property-local day ("2026-09-28").
CREATE TABLE routine_done (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at     INTEGER NOT NULL,
  PRIMARY KEY (property_id, day, task_id)
);
