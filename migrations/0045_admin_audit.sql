-- The admin centre (src/admin.js): every change made there — who, when, what.
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,        -- the admin's e-mail
  action TEXT NOT NULL,       -- extendTrial | setComp | setScanLimit | createVoucher
  property_id TEXT,
  detail TEXT                 -- JSON
);
CREATE INDEX admin_audit_at ON admin_audit (at);
