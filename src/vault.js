// The Vault (opens from the user menu): everything the team needs to know —
// procedures, contacts, house rules — as text pages and uploaded files
// (PDF, pictures, office documents), in folders, with search. Everyone on the
// team reads it; whoever has the 'vault' permission (owners always) adds,
// renames, moves and deletes. An owner can keep a folder to chosen roles or
// people: for everyone else it doesn't exist — not listed, not found, every
// route answers 404 for it and what's in it (checked here, on the server).
//
// Files live in R2 (binding VAULT) under "<property>/<item>", never at a
// public address: they come only through these routes, after the membership
// check. Not for guests' documents — those are deleted after 48 h (guests.js);
// the page says so. Names and contents of files never go to logs or alerts.

import { HttpError, json, readJson } from './http.js';
import { requireUser, access } from './auth.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// All of a property's files together. One number, so it can later differ per plan.
export const VAULT_LIMIT_BYTES = 500 * 1024 * 1024;
const MAX_ITEMS = 2000;
const MAX_FOLDERS = 100;
const MAX_TITLE = 120;
const MAX_BODY = 20000;

// What may be uploaded, and the type it is served with — decided here from the
// name, never taken from the browser. Only PDFs and pictures open in the app
// (inline); everything else always downloads. No HTML or SVG: they could run
// scripts on our address.
const TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};
const INLINE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const extOf = name => (String(name).match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase() || '';
const objectKey = (propertyId, itemId) => `${propertyId}/${itemId}`;

function storage(env) {
  if (!env.VAULT) throw new HttpError(503, 'file uploads aren\'t available yet. Text pages work.');
  return env.VAULT;
}

function cleanTitle(value, label = 'title') {
  // Control characters out (they would break the download header).
  const v = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (!v) throw new HttpError(400, `${label} is required`);
  if (v.length > MAX_TITLE) throw new HttpError(400, `${label} is too long`);
  return v;
}

// May this member see a folder? Owners see all; NULL = everyone.
export function maySee(role, userId, rule) {
  if (role === 'owner' || !rule) return true;
  try {
    const r = JSON.parse(rule);
    return (r.roles || []).includes(role) || (r.users || []).includes(userId);
  } catch { return false; } // a broken rule hides rather than shows
}

// The caller at this property: role, permissions, and the folders hidden from them.
async function viewer(db, request, propertyId, { edit = false } = {}) {
  const user = await requireUser(db, request);
  const a = await access(db, user.id, propertyId);
  if (!(edit ? a.can : a.sees).has('vault')) throw new HttpError(403, "you don't have permission for this — ask the owner");
  const { results } = await db.prepare('SELECT id, access FROM vault_folders WHERE property_id = ? AND access IS NOT NULL').bind(propertyId).all();
  const hidden = new Set(results.filter(f => !maySee(a.role, user.id, f.access)).map(f => f.id));
  return { user, ...a, hidden };
}

async function folderOr400(db, v, propertyId, folderId) {
  if (folderId === null || folderId === undefined || folderId === '') return null;
  const f = await db.prepare('SELECT id FROM vault_folders WHERE id = ? AND property_id = ?').bind(String(folderId), propertyId).first();
  if (!f || v.hidden.has(f.id)) throw new HttpError(400, 'that folder does not exist');
  return f.id;
}

async function visibleFolderOr404(db, v, propertyId, folderId) {
  const f = await db.prepare('SELECT * FROM vault_folders WHERE id = ? AND property_id = ?').bind(folderId, propertyId).first();
  if (!f || v.hidden.has(f.id)) throw new HttpError(404, 'not found');
  return f;
}

async function itemOr404(db, v, propertyId, itemId) {
  const item = await db.prepare('SELECT * FROM vault_items WHERE id = ? AND property_id = ?').bind(itemId, propertyId).first();
  if (!item || (item.folder_id && v.hidden.has(item.folder_id))) throw new HttpError(404, 'not found');
  return item;
}

// SQL: items not in a hidden folder (?: the hidden ids as JSON).
const NOT_HIDDEN = '(i.folder_id IS NULL OR i.folder_id NOT IN (SELECT value FROM json_each(?)))';
const hiddenJson = v => JSON.stringify([...v.hidden]);

async function roomForItem(db, propertyId) {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM vault_items WHERE property_id = ?').bind(propertyId).first('n');
  if (n >= MAX_ITEMS) throw new HttpError(409, 'the Vault is full — delete something first');
}

// For lists: no page text (it can be long), just what a row shows.
const brief = i => ({
  id: i.id, kind: i.kind, title: i.title, folderId: i.folder_id,
  ...(i.kind === 'file' ? { type: i.file_type, size: i.file_size, inline: INLINE.has(i.file_type) } : {}),
  updatedAt: i.updated_at, updatedBy: i.updated_by_name || null,
});
const ITEM_COLUMNS = `i.id, i.kind, i.title, i.folder_id, i.file_type, i.file_size, i.updated_at,
  (SELECT COALESCE(u.name, u.email) FROM users u WHERE u.id = i.updated_by) AS updated_by_name`;

// GET ?q=… — everything this person may see (folders and items, without page
// text), or with q the items whose title, file name or page text contain it.
// Owners also get the team (to choose who sees a folder) and each folder's rule.
export async function getVault(env, request, propertyId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 100).toLowerCase();
  const owner = v.role === 'owner';
  const { results: allFolders } = await db.prepare('SELECT id, name, access FROM vault_folders WHERE property_id = ? ORDER BY name COLLATE NOCASE')
    .bind(propertyId).all();
  const folders = allFolders.filter(f => !v.hidden.has(f.id)).map(f => ({
    id: f.id, name: f.name,
    ...(owner ? { access: f.access ? JSON.parse(f.access) : null } : {}),
  }));
  const { results: items } = q
    ? await db.prepare(`SELECT ${ITEM_COLUMNS} FROM vault_items i WHERE i.property_id = ? AND ${NOT_HIDDEN}
        AND (instr(lower(i.title), ?) > 0 OR instr(lower(COALESCE(i.body, '')), ?) > 0) ORDER BY i.updated_at DESC LIMIT 100`)
      .bind(propertyId, hiddenJson(v), q, q).all()
    : await db.prepare(`SELECT ${ITEM_COLUMNS} FROM vault_items i WHERE i.property_id = ? AND ${NOT_HIDDEN} ORDER BY i.title COLLATE NOCASE`)
      .bind(propertyId, hiddenJson(v)).all();
  const used = await db.prepare('SELECT COALESCE(SUM(file_size), 0) AS n FROM vault_items WHERE property_id = ?').bind(propertyId).first('n');
  let members;
  if (owner) {
    ({ results: members } = await db.prepare(
      `SELECT u.id, COALESCE(u.name, u.email) AS name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.property_id = ? AND m.role != 'owner' ORDER BY u.name COLLATE NOCASE`,
    ).bind(propertyId).all());
  }
  return json({
    canEdit: v.can.has('vault'), owner, files: !!env.VAULT, q,
    folders, items: items.map(brief),
    used, limit: VAULT_LIMIT_BYTES, maxFile: MAX_FILE_BYTES,
    ...(owner ? { members } : {}),
  });
}

// One item; a page with its text.
export async function getItem(env, request, propertyId, itemId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId);
  await itemOr404(db, v, propertyId, itemId);
  const i = await db.prepare(`SELECT ${ITEM_COLUMNS}, i.body FROM vault_items i WHERE i.id = ? AND i.property_id = ?`).bind(itemId, propertyId).first();
  return json({ ...brief(i), ...(i.kind === 'page' ? { body: i.body || '' } : {}) });
}

// ----- Folders -----

// Body: { name }
export async function addFolder(env, request, propertyId) {
  const db = env.DB;
  const { user } = await viewer(db, request, propertyId, { edit: true });
  const name = cleanTitle((await readJson(request)).name, 'name');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM vault_folders WHERE property_id = ?').bind(propertyId).first('n');
  if (n >= MAX_FOLDERS) throw new HttpError(409, 'too many folders');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO vault_folders (id, property_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, propertyId, name, user.id, Date.now()).run();
  return json({ id, name }, 201);
}

// Body: { name }
export async function renameFolder(env, request, propertyId, folderId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId, { edit: true });
  await visibleFolderOr404(db, v, propertyId, folderId);
  const name = cleanTitle((await readJson(request)).name, 'name');
  await db.prepare('UPDATE vault_folders SET name = ? WHERE id = ? AND property_id = ?').bind(name, folderId, propertyId).run();
  return json({ id: folderId, name });
}

// Who sees a folder — owners only. Body: { access: null (everyone) |
// { roles: ['staff', 'volunteer'], users: [ids] } }. Owners always see it.
export async function setFolderAccess(env, request, propertyId, folderId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId);
  if (v.role !== 'owner') throw new HttpError(403, 'only the owner can do this');
  await visibleFolderOr404(db, v, propertyId, folderId);
  const b = await readJson(request);
  let rule = null;
  if (b.access !== null) {
    const a = b.access;
    const bad = () => new HttpError(400, 'who should see the folder?');
    if (!a || typeof a !== 'object' || !Array.isArray(a.roles || []) || !Array.isArray(a.users || [])) throw bad();
    const roles = [...new Set(a.roles || [])];
    if (roles.some(r => !['staff', 'volunteer'].includes(r))) throw bad();
    const users = [...new Set((a.users || []).map(String))];
    if (users.length > 200) throw bad();
    if (users.length) {
      const { results } = await db.prepare('SELECT user_id FROM memberships WHERE property_id = ? AND user_id IN (SELECT value FROM json_each(?))')
        .bind(propertyId, JSON.stringify(users)).all();
      if (results.length !== users.length) throw new HttpError(400, 'not on this team');
    }
    rule = JSON.stringify({ roles, users });
  }
  await db.prepare('UPDATE vault_folders SET access = ? WHERE id = ? AND property_id = ?').bind(rule, folderId, propertyId).run();
  return json({ id: folderId, access: rule ? JSON.parse(rule) : null });
}

// A folder goes with everything in it (the page asks first).
export async function deleteFolder(env, request, propertyId, folderId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId, { edit: true });
  await visibleFolderOr404(db, v, propertyId, folderId);
  const { results } = await db.prepare("SELECT file_key FROM vault_items WHERE property_id = ? AND folder_id = ? AND kind = 'file'")
    .bind(propertyId, folderId).all();
  await deleteObjects(env, results.map(r => r.file_key));
  await db.prepare('DELETE FROM vault_folders WHERE id = ? AND property_id = ?').bind(folderId, propertyId).run(); // items cascade
  return json({ ok: true, deleted: results.length });
}

// ----- Pages and files -----

// Body: { title, body, folderId }
export async function addPage(env, request, propertyId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId, { edit: true });
  const { user } = v;
  const b = await readJson(request);
  const title = cleanTitle(b.title);
  const body = typeof b.body === 'string' ? b.body : '';
  if (body.length > MAX_BODY) throw new HttpError(400, 'the text is too long');
  const folderId = await folderOr400(db, v, propertyId, b.folderId);
  await roomForItem(db, propertyId);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`INSERT INTO vault_items (id, property_id, folder_id, kind, title, body, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, 'page', ?, ?, ?, ?, ?, ?)`).bind(id, propertyId, folderId, title, body, user.id, user.id, now, now).run();
  return json({ id, kind: 'page', title, folderId }, 201);
}

// The file itself is the request body (not JSON, it can be 10 MB); its name
// comes in the X-Vault-Name header, the folder in ?folder=. That custom header
// is what keeps other sites out: a cross-site form can't send it without a
// CORS preflight, which we never allow (the same role readJson's type check has).
export async function uploadFile(env, request, propertyId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId, { edit: true });
  const { user } = v;
  let raw = request.headers.get('X-Vault-Name');
  if (!raw) throw new HttpError(400, 'which file?');
  try { raw = decodeURIComponent(raw); } catch { throw new HttpError(400, 'which file?'); }
  const title = cleanTitle(raw.split(/[\\/]/).pop(), 'file name');
  const type = TYPES[extOf(title)];
  if (!type) throw new HttpError(415, 'this file type isn\'t supported. Use PDF, images or Office documents.');
  const bucket = storage(env);
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_FILE_BYTES) throw new HttpError(413, 'the file is too big (at most 10 MB)');
  const folderId = await folderOr400(db, v, propertyId, new URL(request.url).searchParams.get('folder'));
  await roomForItem(db, propertyId);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, 'the file is empty');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(413, 'the file is too big (at most 10 MB)');
  const used = await db.prepare('SELECT COALESCE(SUM(file_size), 0) AS n FROM vault_items WHERE property_id = ?').bind(propertyId).first('n');
  if (used + bytes.byteLength > VAULT_LIMIT_BYTES) throw new HttpError(409, 'not enough space left in the Vault for this file — delete some files first');
  const id = crypto.randomUUID();
  const key = objectKey(propertyId, id);
  await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  const now = Date.now();
  // The checks above ran before the upload; files sent at the same moment all
  // pass them. So the row goes in only if there is still room when it is
  // written (one statement, so nothing slips in between) — else the file goes.
  let r;
  try {
    r = await db.prepare(`INSERT INTO vault_items (id, property_id, folder_id, kind, title, file_key, file_type, file_size, created_by, updated_by, created_at, updated_at)
      SELECT ?1, ?2, ?3, 'file', ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?9
      WHERE (SELECT COUNT(*) FROM vault_items WHERE property_id = ?2) < ?10
        AND (SELECT COALESCE(SUM(file_size), 0) FROM vault_items WHERE property_id = ?2) + ?7 <= ?11`)
      .bind(id, propertyId, folderId, title, key, type, bytes.byteLength, user.id, now, MAX_ITEMS, VAULT_LIMIT_BYTES).run();
  } catch (err) {
    await bucket.delete(key); // no file without its row
    throw err;
  }
  if (!r.meta.changes) {
    await bucket.delete(key);
    throw new HttpError(409, 'not enough space left in the Vault for this file — delete some files first');
  }
  return json({ id, kind: 'file', title, folderId, type, size: bytes.byteLength, inline: INLINE.has(type) }, 201);
}

// Body: any of { title, body (pages), folderId } — rename, edit, move.
export async function updateItem(env, request, propertyId, itemId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId, { edit: true });
  const { user } = v;
  const item = await itemOr404(db, v, propertyId, itemId);
  const b = await readJson(request);
  let { title, body, folder_id: folderId } = item;
  if ('title' in b) {
    title = cleanTitle(b.title, item.kind === 'file' ? 'file name' : 'title');
    // A file keeps its kind: the ending stays (it decides how it's served).
    const ext = extOf(item.title);
    if (item.kind === 'file' && ext && extOf(title) !== ext) title = `${title}.${ext}`.slice(-MAX_TITLE);
  }
  if ('body' in b && item.kind === 'page') {
    if (typeof b.body !== 'string') throw new HttpError(400, 'the text must be text');
    if (b.body.length > MAX_BODY) throw new HttpError(400, 'the text is too long');
    body = b.body;
  }
  if ('folderId' in b) folderId = await folderOr400(db, v, propertyId, b.folderId);
  await db.prepare('UPDATE vault_items SET title = ?, body = ?, folder_id = ?, updated_by = ?, updated_at = ? WHERE id = ? AND property_id = ?')
    .bind(title, body, folderId, user.id, Date.now(), itemId, propertyId).run();
  return json({ id: itemId, kind: item.kind, title, folderId });
}

export async function deleteItem(env, request, propertyId, itemId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId, { edit: true });
  const item = await itemOr404(db, v, propertyId, itemId);
  if (item.file_key) await deleteObjects(env, [item.file_key]);
  await db.prepare('DELETE FROM vault_items WHERE id = ? AND property_id = ?').bind(itemId, propertyId).run();
  return json({ ok: true });
}

// The file. ?download=1 always downloads; otherwise PDFs and pictures open in
// the browser and everything else downloads anyway.
export async function getFile(env, request, propertyId, itemId) {
  const db = env.DB;
  const v = await viewer(db, request, propertyId);
  const item = await itemOr404(db, v, propertyId, itemId);
  if (item.kind !== 'file') throw new HttpError(404, 'not found');
  const obj = await storage(env).get(item.file_key);
  if (!obj) throw new HttpError(404, 'the file is missing');
  const inline = INLINE.has(item.file_type) && !new URL(request.url).searchParams.get('download');
  return new Response(obj.body, {
    headers: {
      'Content-Type': item.file_type,
      'Content-Disposition': disposition(inline ? 'inline' : 'attachment', item.title),
      'Content-Length': String(item.file_size),
      // Private to the signed-in person: never kept by shared caches.
      'Cache-Control': 'private, no-store',
    },
  });
}

// RFC 6266: a plain ASCII name for old browsers, the real one (UTF-8) for the rest.
export function disposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

async function deleteObjects(env, keys) {
  const list = keys.filter(Boolean);
  if (!list.length || !env.VAULT) return;
  // R2 deletes up to 1000 keys at once.
  for (let i = 0; i < list.length; i += 1000) await env.VAULT.delete(list.slice(i, i + 1000));
}

// A property is deleted (admin centre): its files go first, the rows cascade.
export async function deleteVaultOf(env, propertyId) {
  const { results } = await env.DB.prepare("SELECT file_key FROM vault_items WHERE property_id = ? AND kind = 'file'").bind(propertyId).all();
  await deleteObjects(env, results.map(r => r.file_key));
  return results.length;
}
