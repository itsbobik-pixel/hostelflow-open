// Settings → Help & support: a message to us, by e-mail, with the details we
// need to help (who, which property, which browser). The reply goes straight
// to the person (Reply-To). Each message is also kept, so nothing gets lost
// if the e-mail does. Env: SUPPORT_EMAIL (var) — where messages go.

import { HttpError, json, readJson, requireEmail } from './http.js';
import { requireUser } from './auth.js';
import { mailEnabled, sendMail } from './mail.js';

const MAX_MESSAGE = 3000;
const MAX_PER_HOUR = 5;

export const supportEnabled = env => mailEnabled(env) && !!env.SUPPORT_EMAIL;

export async function sendSupport(env, request) {
  const db = env.DB;
  const user = await requireUser(db, request);
  if (!supportEnabled(env)) throw new HttpError(503, 'support by message is not available yet');
  const body = await readJson(request);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) throw new HttpError(400, 'write your message first');
  if (message.length > MAX_MESSAGE) throw new HttpError(400, 'the message is too long');
  // Where the answer goes: the account's e-mail unless they wrote another one.
  const replyTo = typeof body.email === 'string' && body.email.trim() ? requireEmail(body) : user.email;
  const name = (typeof body.name === 'string' && body.name.trim().slice(0, 100)) || user.name || '';
  const now = Date.now();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE user_id = ? AND created_at > ?')
    .bind(user.id, now - 60 * 60 * 1000).first();
  if (recent.n >= MAX_PER_HOUR) throw new HttpError(429, 'too many messages — please wait a bit, or write to us by e-mail');
  // Which property it's about: one the person really belongs to.
  const property = body.propertyId && await db.prepare(
    `SELECT p.name, m.role FROM memberships m JOIN properties p ON p.id = m.property_id WHERE m.user_id = ? AND m.property_id = ?`,
  ).bind(user.id, body.propertyId).first();
  await db.prepare('INSERT INTO support_messages (id, user_id, property_id, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, property ? body.propertyId : null, message, now).run();
  const agent = String(request.headers.get('User-Agent') || '').slice(0, 200);
  try {
    await sendMail(env, {
      to: env.SUPPORT_EMAIL,
      replyTo,
      subject: `HostelFlow support — ${property ? property.name : replyTo}`,
      text: `${message}\n\n—\nFrom: ${name} <${replyTo}>${replyTo !== user.email ? ` (account: ${user.email})` : ''}\nProperty: ${property ? `${property.name} (${property.role})` : '—'}\nBrowser: ${agent}`,
    });
  } catch {
    throw new HttpError(502, 'the message could not be sent — try again later, or write to us by e-mail');
  }
  return json({ ok: true });
}
