-- Subscriptions (Stripe) and password reset by e-mail.

-- Billing state per property, mirrored from Stripe webhooks.
--   billing_status: trial (our own free month, no card) | trialing | active |
--                   past_due | canceled | unpaid | incomplete | comp (free, e.g. the pilot)
ALTER TABLE properties ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE properties ADD COLUMN trial_ends_at INTEGER;
ALTER TABLE properties ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE properties ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE properties ADD COLUMN current_period_end INTEGER;
CREATE INDEX properties_by_stripe_customer ON properties(stripe_customer_id);

-- Existing properties get 30 days from now.
UPDATE properties SET trial_ends_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 30 * 86400000;

-- One-time reset links: only the SHA-256 of the token is stored.
CREATE TABLE password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX password_resets_by_user ON password_resets(user_id, created_at);
