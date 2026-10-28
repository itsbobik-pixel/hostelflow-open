// "Forgot password": a one-time link by e-mail, valid for an hour. Only the
// token's SHA-256 is stored, and the answer never reveals whether an
// account exists for the address.

import { HttpError, json, readJson, requireEmail, requirePassword } from './http.js';
import { b64url, sha256Hex, hashPassword, createSession, clearLoginFailures } from './auth.js';
import { mailEnabled, sendMail } from './mail.js';

const LINK_MS = 60 * 60 * 1000;
const WELCOME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_HOUR = 3;

export async function forgotPassword(env, request) {
  const db = env.DB;
  if (!mailEnabled(env)) throw new HttpError(503, 'password reset by e-mail is not available yet — ask the owner to set a new password for you');
  const email = requireEmail(await readJson(request));
  const user = await db.prepare('SELECT id, name, email FROM users WHERE email = ?').bind(email).first();
  const now = Date.now();
  if (user) {
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?')
      .bind(user.id, now - 60 * 60 * 1000).first();
    if (recent.n < MAX_PER_HOUR) {
      const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
      await db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(await sha256Hex(token), user.id, now + LINK_MS, now).run();
      const link = `${new URL(request.url).origin}/#reset=${token}`;
      try {
        await sendMail(env, {
          to: user.email,
          subject: 'Reset your HostelFlow password',
          text: `Hi ${user.name || ''},\n\nsomeone (hopefully you) asked to reset the password of your HostelFlow account. Open this link within an hour to choose a new one:\n\n${link}\n\nIf it wasn't you, just ignore this e-mail — your password stays the same.\n\nHostelFlow`,
        });
      } catch {
        throw new HttpError(502, 'the e-mail could not be sent — try again later');
      }
    }
  }
  return json({ ok: true }); // same answer whether or not the account exists
}

// Someone just given an e-mail (Settings → Team): a link to choose their
// password, valid for a week. Opening it also proves the address.
export async function sendWelcomeLink(env, request, user) {
  const now = Date.now();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), user.id, now + WELCOME_MS, now).run();
  const link = `${new URL(request.url).origin}/#reset=${token}`;
  await sendMail(env, {
    to: user.email,
    subject: 'Choose your HostelFlow password',
    text: `Hi ${user.name || ''},\n\nyou can now sign in to HostelFlow with this e-mail. Open this link within a week to choose your password:\n\n${link}\n\nHostelFlow`,
  });
}

export async function resetPassword(env, request) {
  const db = env.DB;
  const body = await readJson(request);
  const token = typeof body.token === 'string' ? body.token : '';
  const password = requirePassword(body);
  const row = token && await db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?')
    .bind(await sha256Hex(token)).first();
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'this link has expired or was already used — ask for a new one');
  const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(row.user_id).first();
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id), // sign out everywhere
    db.prepare('DELETE FROM devices WHERE owner_id = ?').bind(user.id), // the hostel's devices ask for the e-mail again
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(user.id), // every link dies
    db.prepare('UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE id = ?').bind(Date.now(), user.id), // the link proved the address
  ]);
  await clearLoginFailures(db, user.email);
  const { cookie } = await createSession(db, user.id);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}
