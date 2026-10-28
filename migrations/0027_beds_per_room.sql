-- Bed numbers start from 1 in every room (they were counted across the whole
-- property). Existing beds are renumbered room by room, in their old order;
-- beds that belong to no room keep their number.
UPDATE beds SET label = (
  SELECT n FROM (
    SELECT b.id, ROW_NUMBER() OVER (PARTITION BY f.room_id ORDER BY CAST(b.label AS INTEGER), b.label, b.level) AS n
    FROM beds b JOIN bed_frames f ON f.id = b.frame_id
    WHERE f.room_id IS NOT NULL
  ) numbered WHERE numbered.id = beds.id
)
WHERE id IN (SELECT b.id FROM beds b JOIN bed_frames f ON f.id = b.frame_id WHERE f.room_id IS NOT NULL);
