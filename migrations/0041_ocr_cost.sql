-- Scans may now use two models (Haiku first, Sonnet when it leaves a field
-- empty): the month's cost is summed in millionths of a dollar as it happens,
-- and a comparison row says which model was main and which the other.
ALTER TABLE usage_monthly ADD COLUMN cost_micro INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ocr_shadow ADD COLUMN pair TEXT;
