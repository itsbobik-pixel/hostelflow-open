-- The Start here list on the Dashboard (public/js/tour.js): which "Get to
-- know" parts a person has already been shown (a JSON list of short codes).
-- users.tour_done_at now means the list was put away.
ALTER TABLE users ADD COLUMN tour_seen TEXT;
