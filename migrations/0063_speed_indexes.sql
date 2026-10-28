-- Indexes for what is read most often or every hour, so these reads stay
-- small as registered guests pile up (they are never deleted).

-- Check-in list and the Dashboard: the unsent guests of a property.
CREATE INDEX IF NOT EXISTS guests_drafts ON guests(property_id, created_at) WHERE status != 'sent';

-- After Test/Send: which model read a guest right (src/guests.js judgeShadow).
CREATE INDEX IF NOT EXISTS ocr_shadow_guest ON ocr_shadow(guest_id) WHERE prints IS NOT NULL;

-- The hourly cleanup of expired sign-ins (src/auth.js pruneAuth).
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
