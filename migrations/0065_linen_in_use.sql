-- Housekeeping: "Only count the days when the bed is marked as In use" (with
-- daily sheets on). Off by default; the owner turns it on in Settings →
-- Housekeeping, under the bed linen.
ALTER TABLE properties ADD COLUMN linen_in_use INTEGER NOT NULL DEFAULT 0;

-- How long each bed has been In use altogether (ms), added up whenever its
-- sheets leave In use; the stretch going on now is sheets_at → now. Counted
-- from this migration on: nothing older is known.
ALTER TABLE beds ADD COLUMN in_use_ms INTEGER NOT NULL DEFAULT 0;

-- The bed's In use total when this item was changed: what the bed has been In
-- use since is the total now minus this. NULL = changed before the count began
-- (or the day was typed by hand).
ALTER TABLE bed_linen ADD COLUMN in_use_base INTEGER;
