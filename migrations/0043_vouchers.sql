-- Voucher codes (13. 10.): a code given at sign-up (or later, in Settings →
-- Subscription) makes the free trial last until free_until. Each code can be
-- used max_uses times, until redeem_by; a property uses a code once.
CREATE TABLE vouchers (
  code        TEXT PRIMARY KEY COLLATE NOCASE,
  free_until  INTEGER NOT NULL,
  redeem_by   INTEGER NOT NULL,
  max_uses    INTEGER NOT NULL,
  uses        INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE voucher_uses (
  code        TEXT NOT NULL COLLATE NOCASE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  used_at     INTEGER NOT NULL,
  PRIMARY KEY (code, property_id)
);
-- The places written to near La Spezia (e-mails, waves 1 and 2, and WhatsApp):
-- free until the end of 2026, as promised.
INSERT INTO vouchers (code, free_until, redeem_by, max_uses, note, created_at)
VALUES ('LASPEZIA2026', 1798761599000, 1798761599000, 40, 'Outreach La Spezia (e-mails waves 1-2, WhatsApp): free until 31 Dec 2026', 1791910832034);
