-- Why Sonnet read a scan again: the needed fields the first reading (Haiku)
-- left empty — names of fields only, never their values. Empty list = one of
-- the occasional side-by-side comparisons.
ALTER TABLE ocr_shadow ADD COLUMN gaps TEXT;
