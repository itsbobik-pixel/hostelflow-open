-- Beds now belong to a room directly (listed under the map), instead of
-- being placed on the map. Old beds without a room fall back to the room
-- their position is in.
ALTER TABLE bed_frames ADD COLUMN room_id TEXT;
