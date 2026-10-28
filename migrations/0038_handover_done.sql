-- End-of-shift notes: ticked off on the Dashboard by whoever read it, so the
-- next shift sees only what is still open (the note itself stays in Notes).
ALTER TABLE notes ADD COLUMN handover_done_at INTEGER;
