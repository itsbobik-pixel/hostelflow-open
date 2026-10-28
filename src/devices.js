// HostelFlow — the hostel's own devices: the main e-mail once, then just names.
//
// When an owner signs in on a device (the reception computer, the hostel
// phone), it gets a second cookie that outlives signing out. Its sign-in
// screen then lists the team by name: a tap is enough for someone without a
// password, the others type just theirs — nobody types an e-mail. The names
// are never on a public page: with a link anyone could walk into a profile
// without a password and see the guests' documents. Only a device the owner
// unlocked knows them.

import { b64url, sha256Hex, readCookie, SHOWN_NAME } from './auth.js';

export const DEVICE_COOKIE = 'hf_device';
const DEVICE_DAYS = 365;
// A device nobody has opened for this long forgets the team (and src/auth.js
// pruneAuth deletes it).
const DEVICE_IDLE_MS = 90 * 86400000;

// Only the API reads it.
export function deviceCookie(token, maxAge) {
  return `${DEVICE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${maxAge}`;
}
export const clearDeviceCookie = () => deviceCookie('', 0);

// The owner whose team this device shows, or null.
export async function deviceOwner(db, request, now = Date.now()) {
  const token = readCookie(request, DEVICE_COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await db.prepare('SELECT owner_id, last_used_at FROM devices WHERE id_hash = ?').bind(hash).first();
  if (!row || now - row.last_used_at > DEVICE_IDLE_MS) return null;
  // Is it still theirs to hand out? Someone who no longer owns anything shows nobody.
  const owns = await db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND role = 'owner'").bind(row.owner_id).first();
  if (!owns) return null;
  if (now - row.last_used_at > 3600000) await db.prepare('UPDATE devices SET last_used_at = ? WHERE id_hash = ?').bind(now, hash).run();
  return row.owner_id;
}

// After an owner's sign-in: this device becomes their hostel's. Returns the
// cookie to set, or null when it already is.
export async function rememberDevice(db, request, ownerId, now = Date.now()) {
  const owns = await db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND role = 'owner'").bind(ownerId).first();
  if (!owns) return null;
  if (await deviceOwner(db, request, now) === ownerId) return null;
  const old = readCookie(request, DEVICE_COOKIE);
  if (old) await db.prepare('DELETE FROM devices WHERE id_hash = ?').bind(await sha256Hex(old)).run();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT INTO devices (id_hash, owner_id, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), ownerId, now, now).run();
  return deviceCookie(token, DEVICE_DAYS * 86400);
}

export async function forgetDevice(db, request) {
  const token = readCookie(request, DEVICE_COOKIE);
  if (token) await db.prepare('DELETE FROM devices WHERE id_hash = ?').bind(await sha256Hex(token)).run();
}

// The owner's places and everyone on their teams: names and colours, and
// whether they type a password — never e-mails.
export async function deviceTeam(db, ownerId) {
  const { results } = await db.prepare(
    `SELECT p.id AS property_id, p.name AS property_name, u.id, u.name, ${SHOWN_NAME()} AS shown, u.color, u.password_hash IS NOT NULL AS password, m.role
     FROM memberships o JOIN properties p ON p.id = o.property_id
     JOIN memberships m ON m.property_id = p.id JOIN users u ON u.id = m.user_id
     WHERE o.user_id = ? AND o.role = 'owner'
     ORDER BY p.created_at, CASE m.role WHEN 'owner' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, u.name`,
  ).bind(ownerId).all();
  const places = new Map();
  for (const r of results) {
    if (!places.has(r.property_id)) places.set(r.property_id, { id: r.property_id, name: r.property_name, people: [] });
    places.get(r.property_id).people.push({ id: r.id, name: r.name, shown: r.shown, color: r.color || null, password: !!r.password, owner: r.role === 'owner' });
  }
  return [...places.values()];
}

// Is this person on one of the owner's teams? (Who a device may sign in.)
export async function onDeviceTeam(db, ownerId, userId) {
  return !!await db.prepare(
    `SELECT 1 FROM memberships o JOIN memberships m ON m.property_id = o.property_id
     WHERE o.user_id = ? AND o.role = 'owner' AND m.user_id = ?`,
  ).bind(ownerId, userId).first();
}
