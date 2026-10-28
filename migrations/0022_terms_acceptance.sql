-- When the owner accepted the Terms of Service (with the data processing
-- agreement) and which version — ticked at sign-up (src/api.js register).
-- NULL for everyone who signed up before the box existed.
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE users ADD COLUMN terms_version TEXT;
