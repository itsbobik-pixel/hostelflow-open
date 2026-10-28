-- Registered guests keep no personal data: only what ISTAT needs
-- (nationality, arrival, nights, guest type) plus a keyed fingerprint of
-- the document number, so the same document can't be sent twice unnoticed.

ALTER TABLE guests ADD COLUMN doc_hash TEXT;
CREATE INDEX guests_by_doc ON guests(property_id, doc_hash);

-- Guests registered before this change: strip them the same way (no
-- fingerprint for these — it needs the Worker's key).
UPDATE guests SET
  fields = json_remove(fields, '$.surname', '$.given', '$.sex', '$.dob', '$.birthCountry', '$.birthPlace',
    '$.birthProvince', '$.docType', '$.docNumber', '$.country', '$.issuePlace', '$.issueProvince',
    '$.expiry', '$.groupLeader'),
  ocr = NULL
WHERE status = 'sent';
