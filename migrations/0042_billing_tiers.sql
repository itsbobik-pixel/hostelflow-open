-- Plans (13. 10.): Check-in 9 €, Hostel 19 € (29 € when the last month had
-- more than 400 registered guests), Several apartments 3 € each (at least 15 €)
-- under one subscription; a subscription can be paused for the closed season.
ALTER TABLE properties ADD COLUMN price_tier TEXT;      -- 'large': the hostel pays the 29 € price
ALTER TABLE properties ADD COLUMN billing_parent TEXT;  -- an apartment paid for by this property's subscription
ALTER TABLE properties ADD COLUMN paused_at INTEGER;    -- the subscription is paused (closed for the season)
