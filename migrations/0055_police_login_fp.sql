-- A keyed fingerprint of the police login user name (src/secrets.js
-- loginFingerprint), so the same login can't be saved at two properties
-- (the same registration would go to the police twice).
ALTER TABLE properties ADD COLUMN police_login_fp TEXT;
