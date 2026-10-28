-- Settings → Integrations → Claude (src/claudekey.js). The property's own
-- Anthropic API key, encrypted like the police login: scans and Flowy then run
-- on the property's own Claude credit. The last problem Claude reported with it
-- (key turned down, credit used up) is shown to the owner in Settings.
ALTER TABLE properties ADD COLUMN claude_credentials TEXT;
ALTER TABLE properties ADD COLUMN claude_last_error TEXT;
