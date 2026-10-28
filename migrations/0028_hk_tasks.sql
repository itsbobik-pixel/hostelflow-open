-- Recurring housekeeping tasks ("Clean the fridge, every 7 days"), set up in
-- Settings → Housekeeping, ticked off by the team in Housekeeping.
CREATE TABLE hk_tasks (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  every_days  INTEGER NOT NULL,
  room_id     TEXT REFERENCES rooms(id) ON DELETE SET NULL, -- NULL = the whole property
  position    INTEGER NOT NULL DEFAULT 0,
  done_at     INTEGER,                                       -- last time it was done
  done_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX hk_tasks_by_property ON hk_tasks(property_id, position);
