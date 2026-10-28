-- Which tabs a person wants to see, on a phone and on a computer
-- (Settings → Your account). JSON {"phone": [...], "computer": [...]};
-- NULL = all of them.
ALTER TABLE users ADD COLUMN tabs TEXT;
