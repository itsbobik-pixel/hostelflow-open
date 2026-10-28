-- France (fiche individuelle de police): the fiche of a foreign guest is kept
-- for six months, encrypted like the police credentials, then deleted by the
-- hourly cleanup. NULL for every other country.
ALTER TABLE guests ADD COLUMN fiche TEXT;
ALTER TABLE guests ADD COLUMN fiche_until INTEGER;
