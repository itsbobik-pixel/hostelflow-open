-- Housekeeping: "Track daily sheets" replaces the per-bed Clean / Dirty switch
-- (0058). Off by default; the owner turns it on in Settings → Housekeeping.
-- sheets_days: remind when the same sheets have been "in use" this many days
-- (NULL = no reminder).
ALTER TABLE properties ADD COLUMN sheets_track INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN sheets_days INTEGER;

-- The sheets of one bed: clean | dirty | in_use, since when and who set it
-- (NULL = no record yet).
ALTER TABLE beds ADD COLUMN sheets TEXT;
ALTER TABLE beds ADD COLUMN sheets_at INTEGER;
ALTER TABLE beds ADD COLUMN sheets_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Places that already used the switch keep it as daily sheets, with what they
-- had set (clean_since / state_by are written only by that switch).
UPDATE properties SET sheets_track = 1, sheets_days = 3
  WHERE id IN (SELECT property_id FROM beds WHERE clean_since IS NOT NULL OR state_by IS NOT NULL);
UPDATE beds SET sheets = CASE WHEN dirty_since IS NOT NULL THEN 'dirty' ELSE 'clean' END,
  sheets_at = COALESCE(dirty_since, clean_since), sheets_by = state_by
  WHERE dirty_since IS NOT NULL OR clean_since IS NOT NULL;

-- The old columns stay (state_by can't be dropped while it is a foreign key)
-- but nothing reads them any more.
UPDATE beds SET dirty_since = NULL, clean_since = NULL, state_by = NULL;
