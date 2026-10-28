-- Team invites: the owner enters an e-mail and a role; the person opens the
-- link and finishes the account themselves. Only the token's SHA-256 is stored.
CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX invites_by_property ON invites(property_id, created_at);
