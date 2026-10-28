-- The order of the rooms as the owner arranged them in Settings → Property
-- (drag and drop). NULL until first saved: those keep the map's order.
ALTER TABLE rooms ADD COLUMN position INTEGER;
