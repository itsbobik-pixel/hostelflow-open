-- Real AI usage per property and month, to see what document reading costs.
ALTER TABLE usage_monthly ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_monthly ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
