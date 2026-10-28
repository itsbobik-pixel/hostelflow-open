-- Result of the last "check connection" to the police portal:
-- JSON {ok, at, message?}. Cleared whenever the credentials change.
ALTER TABLE properties ADD COLUMN registration_status TEXT;
