-- The Vault (opens from the user menu): what a property's team needs to know —
-- procedures, contacts, rules — as text pages and uploaded files, in folders.
-- Files themselves live in R2 (binding VAULT, key = vault_items.file_key);
-- only their name, type and size are here. Not for guests' documents.
CREATE TABLE vault_folders (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Who sees it: NULL = everyone on the team; else JSON {"roles": [...],
  -- "users": [...]} set by an owner. Owners always see every folder.
  access      TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX vault_folders_by_property ON vault_folders(property_id);

CREATE TABLE vault_items (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  folder_id   TEXT REFERENCES vault_folders(id) ON DELETE CASCADE, -- NULL = not in a folder
  kind        TEXT NOT NULL CHECK (kind IN ('page', 'file')),
  title       TEXT NOT NULL,       -- a page's title, or the file's name as shown
  body        TEXT,                -- pages: the text
  file_key    TEXT,                -- files: the R2 object
  file_type   TEXT,                -- files: the Content-Type it is served with
  file_size   INTEGER,             -- files: bytes
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX vault_items_by_folder ON vault_items(property_id, folder_id);
