-- Channel manager (Channex, HostelOne): each property can be connected to a
-- Channex property; each room becomes a Channex room type with one rate plan;
-- bookings come in from Channex (Booking.com, Hostelworld, Airbnb, ...).
ALTER TABLE properties ADD COLUMN channex_property_id TEXT;
-- Channex calls /api/channex/webhook/<token> when a booking arrives; only the
-- token's SHA-256 is kept.
ALTER TABLE properties ADD COLUMN channex_hook_hash TEXT;
ALTER TABLE properties ADD COLUMN channex_last_sync INTEGER;
ALTER TABLE properties ADD COLUMN channex_last_error TEXT;
ALTER TABLE rooms ADD COLUMN channex_room_type_id TEXT;
ALTER TABLE rooms ADD COLUMN channex_rate_plan_id TEXT;
-- A booking from Channex: one reservation per booked room, "<booking id>:<n>".
ALTER TABLE reservations ADD COLUMN channex_key TEXT;
CREATE UNIQUE INDEX reservations_by_channex ON reservations(channex_key) WHERE channex_key IS NOT NULL;
