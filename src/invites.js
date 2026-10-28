// Team invites. The owner gives an e-mail and a role; we send a link (or the
// owner copies it into WhatsApp). The person opens it and sets their own name
// and password — or, with an account already, signs in with it. One link per
// person, valid a week, gone once used; only its SHA-256 is stored.
// (No e-mail at hand: add them as a profile instead, see src/api.js addProfile.)

import { HttpError, json, readJson, requireEmail, requirePassword, requireString } from './http.js';
import {
  b64url, sha256Hex, hashPassword, verifyPassword, createSession, requireUser, requirePermission, DEFAULT_LEVELS,
  checkLoginAllowed, recordLoginFailure, clearLoginFailures,
} from './auth.js';
import { mailEnabled, sendMail } from './mail.js';
import { sendConfirmation } from './verify.js';
import { logActivity } from './activity.js';

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const ROLES = ['staff', 'volunteer', 'owner'];

export async function listInvites(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requirePermission(env.DB, user.id, propertyId, 'team');
  const { results } = await env.DB.prepare(
    "SELECT id, email, role, expires_at FROM invites WHERE property_id = ? AND expires_at > ? AND email != '' ORDER BY created_at DESC",
  ).bind(propertyId, Date.now()).all();
  return json(results.map(i => ({ id: i.id, email: i.email || null, role: i.role === 'owner' ? 'owner' : 'member', expiresAt: i.expires_at })));
}

export async function createInvite(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const { role: myRole } = await requirePermission(db, user.id, propertyId, 'team');
  const body = await readJson(request);
  // An owner, or someone on the team (what they may do is set in Team →
  // Access; they start with DEFAULT_LEVELS). 'member' and the old 'volunteer'
  // are kept as 'staff', the name the database has for everyone but owners.
  const role = body.role === 'owner' ? 'owner' : 'staff';
  if (body.role != null && !ROLES.includes(body.role) && body.role !== 'member') throw new HttpError(400, 'unknown role');
  if (role === 'owner' && myRole !== 'owner') throw new HttpError(403, 'only an owner can invite another owner');
  const email = requireEmail(body);
  const member = await db.prepare(
    'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.property_id = ? AND u.email = ?',
  ).bind(propertyId, email).first();
  if (member) throw new HttpError(409, 'this person is already on the team');
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const inviteId = crypto.randomUUID();
  await db.batch([
    // A new invite for the same address replaces the old one.
    db.prepare('DELETE FROM invites WHERE property_id = ? AND email = ?').bind(propertyId, email),
    db.prepare('INSERT INTO invites (id, token_hash, property_id, email, role, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(inviteId, await sha256Hex(token), propertyId, email, role, user.id, now + INVITE_MS, now),
  ]);
  const link = `${new URL(request.url).origin}/#invite=${token}`;
  await logActivity(db, propertyId, user, 'invited', email);
  let emailed = false;
  if (mailEnabled(env)) {
    const p = await db.prepare('SELECT name FROM properties WHERE id = ?').bind(propertyId).first();
    try {
      await sendMail(env, {
        to: email,
        subject: `${user.name || 'Your colleague'} invited you to ${p.name} on HostelFlow`,
        text: `Hi,\n\n${user.name || user.email} invited you to the team of ${p.name} on HostelFlow — check-in, housekeeping and notes for the whole team.\n\nOpen this link within a week and choose your password:\n\n${link}\n\nIf you didn't expect this, just ignore the e-mail.\n\nHostelFlow`,
      });
      emailed = true;
    } catch { /* the owner still gets the link to send another way */ }
  }
  // Sent by e-mail: only the inbox has the link, so accepting it proves the
  // address. Shown here instead: the one who made it could use it for any
  // address, so it proves nothing (the address is confirmed by e-mail later).
  if (emailed) return json({ link: null, emailed }, 201);
  await db.prepare('UPDATE invites SET link_shown = 1 WHERE id = ?').bind(inviteId).run();
  return json({ link, emailed }, 201);
}

export async function deleteInvite(env, request, propertyId, inviteId) {
  const user = await requireUser(env.DB, request);
  await requirePermission(env.DB, user.id, propertyId, 'team');
  await env.DB.prepare('DELETE FROM invites WHERE id = ? AND property_id = ?').bind(inviteId, propertyId).run();
  return json({ ok: true });
}

async function findInvite(db, token) {
  const row = typeof token === 'string' && token && await db.prepare(
    `SELECT i.id, i.property_id, i.email, i.role, i.expires_at, i.link_shown, p.name AS property FROM invites i
     JOIN properties p ON p.id = i.property_id WHERE i.token_hash = ?`,
  ).bind(await sha256Hex(token)).first();
  if (!row || !row.email || row.expires_at < Date.now()) throw new HttpError(400, 'this invite has expired or was already used — ask for a new one');
  return row;
}

// What the invite page shows before anything is typed. POST, so the token
// stays out of URLs and logs.
export async function showInvite(env, request) {
  const inv = await findInvite(env.DB, (await readJson(request)).token);
  const account = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(inv.email).first();
  return json({ property: inv.property, email: inv.email, role: inv.role === 'owner' ? 'owner' : 'member', hasAccount: !!account });
}

export async function acceptInvite(env, request) {
  const db = env.DB;
  const body = await readJson(request);
  const inv = await findInvite(db, body.token);
  const email = inv.email;
  // Only a link that went just to the inbox proves the address.
  const proven = !inv.link_shown;
  let user = await db.prepare('SELECT id, name, email, password_hash, email_confirmed_at FROM users WHERE email = ?').bind(email).first();
  if (user) {
    // Already has an account (works somewhere else too): their own password, as at sign-in.
    await checkLoginAllowed(db, email);
    if (!user.password_hash || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
      await recordLoginFailure(db, email);
      throw new HttpError(401, 'wrong password');
    }
    await clearLoginFailures(db, email);
  } else {
    const name = requireString(body, 'name', { max: 100, label: 'name' });
    const password = requirePassword(body);
    user = { id: crypto.randomUUID(), name, email, created: true };
    // An e-mailed invitation reached this address: it counts as confirmed.
    // Not so an open link or a link shown to its maker — confirmed by e-mail below.
    await db.prepare('INSERT INTO users (id, email, name, password_hash, email_confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, email, name, await hashPassword(password), proven ? Date.now() : null, Date.now()).run();
  }
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO memberships (user_id, property_id, role, permissions) VALUES (?, ?, ?, ?)')
      .bind(user.id, inv.property_id, inv.role === 'owner' ? 'owner' : 'staff', inv.role === 'owner' ? null : JSON.stringify(DEFAULT_LEVELS)),
    db.prepare('DELETE FROM invites WHERE id = ?').bind(inv.id),
    ...(proven ? [db.prepare('UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE id = ?').bind(Date.now(), user.id)] : []),
  ]);
  await logActivity(db, inv.property_id, user, 'member_joined');
  // A link the inviter saw proves nothing about the address: the account is
  // signed in only once its address is confirmed (the link in the e-mail signs
  // them in) — else anyone could claim someone else's address.
  if (!proven && !user.email_confirmed_at && mailEnabled(env)) {
    try { await sendConfirmation(env, request, user); } catch { /* they can ask for a new link at sign-in */ }
    return json({ ok: true, confirm: true });
  }
  const { cookie } = await createSession(db, user.id);
  return json({ ok: true, confirm: false }, 200, { 'Set-Cookie': cookie });
}
