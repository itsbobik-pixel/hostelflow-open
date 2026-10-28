-- A voucher typed at sign-up waits here until the e-mail is confirmed
-- (src/verify.js confirmEmail), so made-up addresses can't use it up.
ALTER TABLE properties ADD COLUMN pending_voucher TEXT;
