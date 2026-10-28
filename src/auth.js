// Passwords, sessions and login rate limiting.
//
// Passwords: PBKDF2-SHA256 with a random salt. 100k iterations is the Workers
// maximum; the count is stored in each hash, so it can be raised later and
// old hashes upgraded on the next successful login.
// Sessions: the cookie holds 32 random bytes; the database only stores their
// SHA-256, so a leaked database doesn't leak working sessions.

import { HttpError } from './http.js';

export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_COOKIE = 'hf_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
export function b64url(bytes) {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const hash = await pbkdf2(password, unb64(parts[2]), iterations);
  return timingSafeEqual(hash, unb64(parts[3]));
}

export function needsRehash(stored) {
  return Number(String(stored || '').split('$')[1]) < PBKDF2_ITERATIONS;
}

// ===== Sessions =====

export async function createSession(db, userId, now = Date.now()) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = now + SESSION_DAYS * 86400000;
  await db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, expires).run();
  return { token, cookie: sessionCookie(token, SESSION_DAYS * 86400) };
}

export function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export const clearSessionCookie = () => sessionCookie('', 0);

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Returns {id, email, name} or null.
export async function getSessionUser(db, request, now = Date.now()) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(token), now).first();
}

export async function requireUser(db, request) {
  const user = await getSessionUser(db, request);
  if (!user) throw new HttpError(401, 'not signed in');
  return user;
}

export async function requireRole(db, userId, propertyId, roles) {
  const m = await db.prepare('SELECT role FROM memberships WHERE user_id = ? AND property_id = ?')
    .bind(userId, propertyId).first();
  // 404 rather than 403: don't reveal that someone else's property exists.
  if (!m) throw new HttpError(404, 'property not found');
  if (!roles.includes(m.role)) throw new HttpError(403, 'only the owner can do this');
  return m.role;
}

// What each person may do at a property (Bob, 23. 10.: no more Staff and
// Volunteer roles). Owners may do everything; everyone else has, for each
// area, no access, 'read' or 'edit', as the owner set it in Settings → Team
// (memberships.permissions, a JSON object { area: level }). Billing, the
// property itself and who may do what stay with the owners.
// 'moderate' only has edit: changing and deleting other people's notes.
// The name on someone's name tag: their nickname when they chose to show it,
// else the full name (users.nickname / show_nickname). `u` is the users alias.
export const SHOWN_NAME = (u = 'u') => `CASE WHEN ${u}.show_nickname = 1 AND ${u}.nickname IS NOT NULL THEN ${u}.nickname ELSE ${u}.name END`;

export const AREAS = ['checkin', 'notes', 'moderate', 'attention', 'guidelines', 'housekeeping', 'shifts', 'calendar', 'vault', 'police', 'team'];
export const EDIT_ONLY = ['moderate'];
// The old names of the edit rights (the permissions before 23. 10.).
export const PERMISSIONS = ['checkin', 'attention', 'moderate', 'guidelines', 'shifts', 'police', 'team', 'vault'];
// Someone new on the team: sees everything but check-in, writes notes, does the housekeeping.
export const DEFAULT_LEVELS = {
  notes: 'edit', attention: 'read', guidelines: 'read', housekeeping: 'edit',
  shifts: 'read', calendar: 'read', vault: 'read', police: 'read', team: 'read',
};

// Saved before 23. 10.: a list of edit rights (or nothing: the role's
// defaults, staff = check-in). Everyone could read everything but the
// police login and the team, write notes and do the housekeeping;
// volunteers only looked at the calendar.
function fromOldList(role, list) {
  const has = p => (list ? list.includes(p) : role === 'staff' && p === 'checkin');
  const levels = { notes: 'edit', housekeeping: 'edit', calendar: role === 'volunteer' ? 'read' : 'edit' };
  for (const p of ['attention', 'guidelines', 'shifts', 'vault']) levels[p] = has(p) ? 'edit' : 'read';
  for (const p of ['checkin', 'moderate', 'police', 'team']) if (has(p)) levels[p] = 'edit';
  return levels;
}

// { area: 'read' | 'edit' } for every area someone has (no key: no access).
export function levelsOf(role, saved) {
  if (role === 'owner') return Object.fromEntries(AREAS.map(a => [a, 'edit']));
  let raw = null;
  try { raw = saved ? JSON.parse(saved) : null; } catch { /* bad value: as if nothing was saved */ }
  if (!raw || Array.isArray(raw)) return fromOldList(role, Array.isArray(raw) ? raw : null);
  return cleanLevels(raw);
}

// Only known areas and levels; 'moderate' can't be just read.
export function cleanLevels(raw) {
  const out = {};
  for (const a of AREAS) {
    const v = raw && raw[a];
    if (v === 'edit' || (v === 'read' && !EDIT_ONLY.includes(a))) out[a] = v;
  }
  return out;
}

// What someone may change (the areas at 'edit').
export function permissionsOf(role, saved) {
  const levels = levelsOf(role, saved);
  return AREAS.filter(a => levels[a] === 'edit');
}

// What someone may at least look at.
export function seesOf(role, saved) {
  const levels = levelsOf(role, saved);
  return AREAS.filter(a => levels[a]);
}

// { role, levels, can: Set (edit), sees: Set (read or edit) } for a member; 404 for anyone else.
export async function access(db, userId, propertyId) {
  const m = await db.prepare('SELECT role, permissions FROM memberships WHERE user_id = ? AND property_id = ?')
    .bind(userId, propertyId).first();
  if (!m) throw new HttpError(404, 'property not found');
  const levels = levelsOf(m.role, m.permissions);
  return {
    role: m.role, levels,
    can: new Set(AREAS.filter(a => levels[a] === 'edit')),
    sees: new Set(AREAS.filter(a => levels[a])),
  };
}

// May change things in this area.
export async function requirePermission(db, userId, propertyId, permission) {
  const a = await access(db, userId, propertyId);
  if (!a.can.has(permission)) throw new HttpError(403, "you don't have permission for this — ask the owner");
  return a;
}

// May at least look at this area.
export async function requireSees(db, userId, propertyId, area) {
  const a = await access(db, userId, propertyId);
  if (!a.sees.has(area)) throw new HttpError(403, "you don't have permission for this — ask the owner");
  return a;
}

export async function deleteSession(db, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(token)).run();
}

// ===== Login rate limiting (per e-mail) =====

export async function checkLoginAllowed(db, email, now = Date.now()) {
  const row = await db.prepare('SELECT failures, window_start FROM login_attempts WHERE email = ?').bind(email).first();
  if (row && now - row.window_start < FAILURE_WINDOW_MS && row.failures >= MAX_FAILURES) {
    throw new HttpError(429, 'too many failed attempts — try again in 15 minutes');
  }
}

export async function recordLoginFailure(db, email, now = Date.now()) {
  const row = await db.prepare('SELECT failures, window_start FROM login_attempts WHERE email = ?').bind(email).first();
  if (!row || now - row.window_start >= FAILURE_WINDOW_MS) {
    await db.prepare('INSERT OR REPLACE INTO login_attempts (email, failures, window_start) VALUES (?, 1, ?)').bind(email, now).run();
  } else {
    await db.prepare('UPDATE login_attempts SET failures = failures + 1 WHERE email = ?').bind(email).run();
  }
}

// Hourly: sessions, reset links and failed-login counts that no longer count
// (src/worker.js). Without this every sign-in would stay in the database for good.
export async function pruneAuth(db, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE window_start <= ?').bind(now - FAILURE_WINDOW_MS),
    // A hostel device nobody opened for 90 days (src/devices.js).
    db.prepare('DELETE FROM devices WHERE last_used_at <= ?').bind(now - 90 * 86400000),
  ]);
}

export async function clearLoginFailures(db, email) {
  await db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
}
