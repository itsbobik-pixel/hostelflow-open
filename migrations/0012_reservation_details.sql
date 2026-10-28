-- The details Costello's calendar keeps per booking: a status (up to two,
-- comma-separated, e.g. "checkin,lower-bed"), the expected arrival time and
-- the guest's nationality. Also set on bookings from a channel calendar
-- (whose feed has no names), and kept when the feed is read again.
ALTER TABLE reservations ADD COLUMN status TEXT;
ALTER TABLE reservations ADD COLUMN arrival_time TEXT;
ALTER TABLE reservations ADD COLUMN nationality TEXT;
