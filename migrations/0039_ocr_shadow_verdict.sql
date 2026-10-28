-- Who was right when the two models read a field differently: at the scan the
-- fields that differ keep a keyed fingerprint (HMAC) of each model's reading;
-- when the guest is sent they are compared with what staff actually sent, only
-- the verdict stays (main / shadow / neither per field) and the prints go.
ALTER TABLE ocr_shadow ADD COLUMN guest_id TEXT;
ALTER TABLE ocr_shadow ADD COLUMN prints TEXT;
ALTER TABLE ocr_shadow ADD COLUMN verdict TEXT;
