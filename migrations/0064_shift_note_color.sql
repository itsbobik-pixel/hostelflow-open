-- Notes on the rota show on the shift itself, as a coloured chip like the
-- names: the colour is picked when the note is written (NULL = the default).
ALTER TABLE shift_notes ADD COLUMN color TEXT;
