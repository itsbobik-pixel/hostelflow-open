-- One-off shifts ("Extra" on the rota): someone in for two hours, or hours
-- that differ from the usual kinds. type_key is 'extra:HH:MM-HH:MM'; the
-- times and an optional note are stored with the shift itself.
ALTER TABLE shifts ADD COLUMN start_time TEXT;
ALTER TABLE shifts ADD COLUMN end_time TEXT;
ALTER TABLE shifts ADD COLUMN note TEXT;
