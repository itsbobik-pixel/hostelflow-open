-- Housekeeping: a top-down map of the property (rooms and beds on a grid)
-- and when each piece of bed linen was last changed.

-- Rooms and other areas (bathroom, kitchen…), in grid cells.
CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'room',          -- room | other (no beds counted)
  x INTEGER NOT NULL, y INTEGER NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL
);
CREATE INDEX rooms_by_property ON rooms(property_id);

-- A piece of furniture on the map: a single bed, a bunk (2 or 3 levels) or a double bed.
CREATE TABLE bed_frames (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                         -- single | bunk | triple | double
  x INTEGER NOT NULL, y INTEGER NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL
);
CREATE INDEX bed_frames_by_property ON bed_frames(property_id);

-- One sleeping place (a bunk has one per level), with the number guests know.
CREATE TABLE beds (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  frame_id    TEXT NOT NULL REFERENCES bed_frames(id) ON DELETE CASCADE,
  level       INTEGER NOT NULL DEFAULT 0,            -- 0 = bottom
  label       TEXT NOT NULL,
  dirty_since INTEGER                                -- set when the guest left, cleared when made up
);
CREATE INDEX beds_by_property ON beds(property_id);

CREATE TABLE bed_linen (
  bed_id     TEXT NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,                          -- key from properties.linen
  changed_at INTEGER NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (bed_id, item)
);

-- JSON [{ key, label, days }]: change at the latest after this many days (or when dirty).
ALTER TABLE properties ADD COLUMN linen TEXT;
