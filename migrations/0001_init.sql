-- HostelFlow initial schema (Cloudflare D1 / SQLite).
-- Every piece of guest/property data carries property_id: one database,
-- many accommodations (tenants), and every query filters by it.

CREATE TABLE properties (
  id              TEXT PRIMARY KEY,                -- random id
  name            TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT 'IT',      -- ISO 3166-1 alpha-2
  timezone        TEXT NOT NULL DEFAULT 'Europe/Rome',
  registration    TEXT,                            -- registration module id, e.g. 'it-alloggiati'
  -- Police-portal credentials, AES-GCM encrypted with the CREDENTIALS_KEY
  -- Worker secret (never stored or returned in plain text).
  registration_credentials TEXT,
  plan            TEXT NOT NULL DEFAULT 'checkin', -- checkin | calendar | full
  created_at      INTEGER NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  -- "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>" — never the password itself.
  -- NULL for accounts that only sign in with Google (later).
  password_hash TEXT,
  created_at    INTEGER NOT NULL
);

-- Who works where, and as what.
CREATE TABLE memberships (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  PRIMARY KEY (user_id, property_id)
);

-- Failed logins per e-mail, to slow down password guessing.
CREATE TABLE login_attempts (
  email         TEXT PRIMARY KEY COLLATE NOCASE,
  failures      INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

-- The session cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE guests (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | scanned | verified | sent
  fields        TEXT NOT NULL DEFAULT '{}',        -- JSON: surname, given, dob, docNumber, ...
  photo_key     TEXT,                              -- R2 object key; deleted after sending (GDPR)
  last_check    TEXT,                              -- JSON result of the last registration test
  sent_at       INTEGER,
  created_by    TEXT REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX guests_by_property ON guests(property_id, created_at);
