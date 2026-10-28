-- The admin centre has its own accounts (admin.hostelflow.it), apart from the
-- app's users: an app account never opens it. Created with
-- `node scripts/admin-user.mjs` (the password is typed on the admin's own
-- computer; only its PBKDF2 hash is stored).
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',   -- admin | support
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE admin_sessions (
  id_hash TEXT PRIMARY KEY,             -- SHA-256 of the cookie token
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
