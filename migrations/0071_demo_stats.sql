-- The demo in numbers for the admin centre (src/demo.js): per day in Italy,
-- how many demos were started, how many tried a scan or Send, how many went
-- on to "Create your own account". Only counts: demos are anonymous and go
-- after a day, so the flags on the property make each count once.
CREATE TABLE demo_daily (
  day TEXT PRIMARY KEY,               -- YYYY-MM-DD, Europe/Rome
  started INTEGER NOT NULL DEFAULT 0,
  tried INTEGER NOT NULL DEFAULT 0,
  signups INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE properties ADD COLUMN demo_tried INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN demo_signup INTEGER NOT NULL DEFAULT 0;
