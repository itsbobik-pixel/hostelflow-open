-- Hostel One (beta): reservations, from booking channels' iCal links and
-- typed in by hand.

-- An iCal feed (Booking.com / Airbnb / … "export calendar" link). The link
-- works like a password, so it's stored encrypted (CREDENTIALS_KEY).
CREATE TABLE calendars (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                       -- "Booking.com – Dorm A"
  source      TEXT NOT NULL,                       -- booking | airbnb | hostelworld | other (from the link)
  url_enc     TEXT NOT NULL,
  room_id     TEXT,                                -- the room this listing sells, if known
  last_sync   INTEGER,
  last_error  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX calendars_by_property ON calendars(property_id);

CREATE TABLE reservations (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  calendar_id TEXT REFERENCES calendars(id) ON DELETE CASCADE, -- NULL = typed in
  uid         TEXT,                                -- the iCal event's UID
  source      TEXT NOT NULL,                       -- booking | airbnb | … | manual
  kind        TEXT NOT NULL DEFAULT 'booking',     -- booking | block (dates closed, no guest)
  guest       TEXT,
  arrival     TEXT NOT NULL,                       -- YYYY-MM-DD
  departure   TEXT NOT NULL,                       -- YYYY-MM-DD (check-out day)
  guests      INTEGER,
  room_id     TEXT,
  code        TEXT,                                -- channel's reservation code, if the feed has it
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (calendar_id, uid)
);
CREATE INDEX reservations_by_dates ON reservations(property_id, arrival, departure);
