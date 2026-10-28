-- An invite whose link was shown to the person who made it (e-mail off or
-- failed): accepting it doesn't prove the address (src/invites.js).
ALTER TABLE invites ADD COLUMN link_shown INTEGER NOT NULL DEFAULT 0;
-- Until now every link was shown.
UPDATE invites SET link_shown = 1;
