-- End-of-shift notes: the handover to the next shift, shown above
-- "Needs attention" on the Dashboard for a day. Anyone on the team may write one.
ALTER TABLE notes ADD COLUMN handover INTEGER NOT NULL DEFAULT 0;
