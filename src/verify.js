// E-mail confirmation: a new account works only after its owner opens the
// link we e-mail (so nobody signs up with someone else's address, and a typo
// is caught before invitations and password resets go astray). Invited
// people and password resets prove the address the same way, so they count
// as confirmed. Without e-mail set up (local development) accounts are
// confirmed at once. Only the token's SHA-256 is stored.

import { HttpError, json, readJson, requireEmail } from './http.js';
import { b64url, sha256Hex, createSession, verifyPassword, checkLoginAllowed, recordLoginFailure, clearLoginFailures } from './auth.js';
import { mailEnabled, sendMail } from './mail.js';
import { redeemVoucher } from './billing.js';

const LINK_MS = 48 * 60 * 60 * 1000;
const MAX_PER_HOUR = 3;

export const needsConfirmation = env => mailEnabled(env);

// Sends (or re-sends) the link. Quietly does nothing past the hourly limit.
export async function sendConfirmation(env, request, user) {
  const db = env.DB;
  const now = Date.now();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM email_confirmations WHERE user_id = ? AND created_at > ?')
    .bind(user.id, now - 60 * 60 * 1000).first();
  if (recent.n >= MAX_PER_HOUR) return;
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT INTO email_confirmations (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), user.id, now + LINK_MS, now).run();
  const link = `${new URL(request.url).origin}/#confirm=${token}`;
  try {
    await sendMail(env, {
      to: user.email,
      subject: 'Confirm your e-mail for HostelFlow',
      text: `Hi ${user.name || ''},\n\nwelcome to HostelFlow! Open this link to confirm your e-mail address and start using your account (it works for two days):\n\n${link}\n\nIf you didn't sign up, just ignore this e-mail.\n\nHostelFlow`,
    });
  } catch {
    throw new HttpError(502, 'the e-mail could not be sent — try again later');
  }
}

// POST { token } → confirmed and signed in.
// The password is asked too: the link proves the inbox, the password that
// whoever set it is the inbox's owner (else someone could register another
// person's address, wait for them to click a confirmation e-mail, and then
// sign in with the password they chose). Don't know it? Forgot password:
// the reset link proves the inbox and sets a new one.
export async function confirmEmail(env, request) {
  const db = env.DB;
  const body = await readJson(request);
  const token = body.token;
  const row = typeof token === 'string' && token && await db.prepare('SELECT user_id, expires_at FROM email_confirmations WHERE token_hash = ?')
    .bind(await sha256Hex(token)).first();
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'this link has expired or was already used — sign in to get a new one');
  const user = await db.prepare('SELECT email, password_hash FROM users WHERE id = ?').bind(row.user_id).first();
  if (!user) throw new HttpError(400, 'this link has expired or was already used — sign in to get a new one');
  await checkLoginAllowed(db, user.email);
  if (String(body.email || '').trim().toLowerCase() !== user.email.toLowerCase() || !user.password_hash || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
    await recordLoginFailure(db, user.email);
    throw new HttpError(401, 'type the password of this account to confirm it — or use “Forgot your password?”', 'confirm-password');
  }
  await clearLoginFailures(db, user.email);
  await db.batch([
    db.prepare('UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE id = ?').bind(Date.now(), row.user_id),
    db.prepare('DELETE FROM email_confirmations WHERE user_id = ?').bind(row.user_id),
  ]);
  // A voucher typed at sign-up counts now that the address is real.
  const { results: waiting } = await db.prepare(
    "SELECT p.id, p.pending_voucher FROM memberships m JOIN properties p ON p.id = m.property_id WHERE m.user_id = ? AND m.role = 'owner' AND p.pending_voucher IS NOT NULL",
  ).bind(row.user_id).all();
  for (const p of waiting) {
    await redeemVoucher(db, p.pending_voucher, p.id).catch(() => { /* used up meanwhile: the normal trial */ });
    await db.prepare('UPDATE properties SET pending_voucher = NULL WHERE id = ?').bind(p.id).run();
  }
  const { cookie } = await createSession(db, row.user_id);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}

// POST { email } → a new link, if that account still waits for one. The
// answer is the same either way (doesn't reveal which addresses have accounts).
export async function resendConfirmation(env, request) {
  const email = requireEmail(await readJson(request));
  if (!needsConfirmation(env)) return json({ ok: true });
  const user = await env.DB.prepare('SELECT id, name, email, email_confirmed_at FROM users WHERE email = ?').bind(email).first();
  if (user && !user.email_confirmed_at) await sendConfirmation(env, request, user);
  return json({ ok: true });
}

export const markConfirmed = (db, userId) =>
  db.prepare('UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE id = ?').bind(Date.now(), userId);
