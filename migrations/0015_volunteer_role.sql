-- A third role: volunteer (Dashboard, Housekeeping, reading the Calendar;
-- no check-in, no guest documents, no settings). SQLite can't change a
-- CHECK constraint, so the two tables with roles are rebuilt.

CREATE TABLE memberships_new (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'volunteer')),
  PRIMARY KEY (user_id, property_id)
);
INSERT INTO memberships_new (user_id, property_id, role) SELECT user_id, property_id, role FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;

CREATE TABLE invites_new (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'volunteer')),
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
INSERT INTO invites_new SELECT id, token_hash, property_id, email, role, invited_by, expires_at, created_at FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX invites_by_property ON invites(property_id, created_at);
