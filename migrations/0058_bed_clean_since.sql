-- Housekeeping: a simple Clean / Dirty mark on each bed. Dirty reuses
-- dirty_since (set = dirty since then); clean_since is the day it was made up
-- and state_by who flipped it last. Linen tracking (bed_linen) is untouched.
ALTER TABLE beds ADD COLUMN clean_since INTEGER;
ALTER TABLE beds ADD COLUMN state_by TEXT REFERENCES users(id) ON DELETE SET NULL;
