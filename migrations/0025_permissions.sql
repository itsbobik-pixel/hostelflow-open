-- What a team member may do, ticked by the owner in Settings → Team
-- (src/auth.js PERMISSIONS): a JSON list. NULL = the defaults of their role.
ALTER TABLE memberships ADD COLUMN permissions TEXT;
