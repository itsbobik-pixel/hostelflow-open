-- Team members without an e-mail or password: a "profile" belongs to one
-- property and is only entered by switching to it from the user menu of a
-- device that is already signed in there. NULL = an ordinary account.
ALTER TABLE users ADD COLUMN profile_property TEXT;

-- The open invite links (QR code) are gone; any still waiting are withdrawn.
DELETE FROM invites WHERE email = '';
