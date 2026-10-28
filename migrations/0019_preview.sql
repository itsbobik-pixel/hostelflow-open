-- What a property sees: the finished parts (Dashboard, Check-in with police
-- registration) for everyone; the parts still being built (Calendar,
-- Housekeeping, ISTAT, channel manager, rooms, bed linen) only with preview = 1.
ALTER TABLE properties ADD COLUMN preview INTEGER NOT NULL DEFAULT 0;
-- The properties so far are the pilot's.
UPDATE properties SET preview = 1;
