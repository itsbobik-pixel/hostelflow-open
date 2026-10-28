-- The owner can put a note into "Needs attention" on everyone's Dashboard.
ALTER TABLE notes ADD COLUMN attention INTEGER NOT NULL DEFAULT 0;
