-- A second structure in one property: e.g. a room on another floor that the
-- police and ISTAT count as a property of its own, with its own Alloggiati Web
-- account and its own statistics codes. The property's own columns stay the
-- first ("main") structure; this table holds the others (src/structures.js).
-- Credentials and statistics settings are encrypted like the property's.
CREATE TABLE structures (
  id                       TEXT PRIMARY KEY,
  property_id              TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  registration_credentials TEXT,
  registration_status      TEXT,
  police_login_fp          TEXT,
  stats_settings           TEXT,
  created_at               INTEGER NOT NULL
);
CREATE INDEX structures_property ON structures (property_id);
CREATE INDEX structures_login_fp ON structures (police_login_fp);

-- What the main structure is called once there is a second one ("Main" if empty).
ALTER TABLE properties ADD COLUMN structure_name TEXT;
-- Which structure a guest stays in: NULL = the main one (every guest so far).
ALTER TABLE guests ADD COLUMN structure_id TEXT;
