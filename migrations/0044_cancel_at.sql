-- A subscription cancelled for the end of its period keeps running until
-- then: when it ends (from Stripe's webhook), for Settings → Subscription.
ALTER TABLE properties ADD COLUMN cancel_at INTEGER;
