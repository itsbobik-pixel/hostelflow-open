-- The hostel's own devices (src/devices.js): an owner signed in here once with
-- the main e-mail, so the sign-in screen lists the team by name. Only a hash of
-- the cookie is stored, like sessions.
CREATE TABLE devices (
  id_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX devices_owner ON devices(owner_id);
