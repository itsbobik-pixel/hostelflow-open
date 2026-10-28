-- Check-in: document photos, OCR result, scan counter.

-- Document photos, base64 JPEG (downscaled in the browser, well under D1's
-- 2 MB row limit). Deleted as soon as the guest is registered, and by the
-- hourly cleanup after 48 hours at the latest.
CREATE TABLE guest_photos (
  guest_id    TEXT PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  media_type  TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX guest_photos_by_age ON guest_photos(created_at);

-- JSON {confidence, notes} or {error} from reading the document.
ALTER TABLE guests ADD COLUMN ocr TEXT;

-- Document scans per property and month ("2026-09"), for costs and billing.
CREATE TABLE usage_monthly (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  scans       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, month)
);
