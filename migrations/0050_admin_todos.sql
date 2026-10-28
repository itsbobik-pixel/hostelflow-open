-- The admin centre's "Vyžaduje pozornost": own to-dos, and automatic items
-- ticked off for a while (they come back if the problem is still there).
CREATE TABLE admin_todos (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',   -- danger | warn | info
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  done_at     INTEGER,
  done_by     TEXT
);
CREATE INDEX admin_todos_open ON admin_todos (done_at, created_at);
CREATE TABLE admin_dismissed (
  key   TEXT PRIMARY KEY,                     -- kind:propertyId
  until INTEGER NOT NULL,
  by    TEXT NOT NULL
);
