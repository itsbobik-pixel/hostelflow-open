-- Settings → Integrations → Cloudbeds (src/cloudbeds.js). The property's own
-- Cloudbeds API key, encrypted like the police login; the Cloudbeds property
-- it opens; and which helpers are switched on (for now: nights at check-in).
ALTER TABLE properties ADD COLUMN cloudbeds_credentials TEXT;
ALTER TABLE properties ADD COLUMN cloudbeds_property_id TEXT;
ALTER TABLE properties ADD COLUMN cloudbeds_property_name TEXT;
ALTER TABLE properties ADD COLUMN cloudbeds_nights INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN cloudbeds_last_error TEXT;
