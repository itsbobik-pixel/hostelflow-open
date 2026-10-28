-- Pricing by guests (24. 10. 2026): each month is charged afterwards by the
-- guests sent to the police (src/billing.js reportUsage). A guest counts once:
-- metered_at is when it was reported to Stripe. paid_from: when the paid
-- subscription starts (the trial's end) — guests sent before it are free.
ALTER TABLE guests ADD COLUMN metered_at INTEGER;
ALTER TABLE properties ADD COLUMN paid_from INTEGER;
CREATE INDEX idx_guests_unmetered ON guests (property_id, sent_at) WHERE status = 'sent' AND metered_at IS NULL;
