-- The welcome tour (public/js/tour.js): shown once, at a person's first
-- sign-in. Everyone who already uses HostelFlow counts as having seen it.
ALTER TABLE users ADD COLUMN tour_done_at INTEGER;
UPDATE users SET tour_done_at = created_at;
