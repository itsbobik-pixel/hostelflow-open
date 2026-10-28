-- A nickname per person, and whether the name tags show it instead of the
-- full name (Settings → Team, a tap on the name; or Settings → Your account).
ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN show_nickname INTEGER NOT NULL DEFAULT 0;
