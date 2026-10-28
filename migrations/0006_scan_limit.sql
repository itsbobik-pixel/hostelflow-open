-- Monthly limit on AI document scans per property (cost control).
-- NULL = the default (SCAN_LIMIT var, else 1000); 'comp' properties have none.
ALTER TABLE properties ADD COLUMN scan_limit INTEGER;
