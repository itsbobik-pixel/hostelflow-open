-- Short replies under a team note on the Dashboard.
CREATE TABLE note_replies (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX note_replies_by_note ON note_replies(note_id, created_at);
