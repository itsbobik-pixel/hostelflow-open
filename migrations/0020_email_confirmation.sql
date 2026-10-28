-- New accounts confirm their e-mail before they can sign in (src/verify.js).
ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER;
-- Everyone so far signed up before this existed.
UPDATE users SET email_confirmed_at = created_at;

CREATE TABLE email_confirmations (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX email_confirmations_by_user ON email_confirmations(user_id, created_at);
