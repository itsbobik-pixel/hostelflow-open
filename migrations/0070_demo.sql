-- The demo (src/demo.js): "Try the demo" on the sign-in page makes a property
-- with made-up guests, rooms and team. It is deleted after this time; NULL =
-- a real property.
ALTER TABLE properties ADD COLUMN demo_until INTEGER;
