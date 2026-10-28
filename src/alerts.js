// Something broke: tell us by e-mail before a hostel has to.
// One e-mail per kind of problem per hour at most; the rest are counted and
// the next e-mail says how many there were. Never throws — an alert must not
// turn into a second error.
// Env: ALERT_EMAIL (var; falls back to SUPPORT_EMAIL), RESEND_API_KEY.
import { mailEnabled, sendMail } from './mail.js';

const QUIET_MS = 3600 * 1000;

export async function alert(env, kind, detail) {
  try {
    const now = Date.now();
    const text = String(detail || '').slice(0, 2000);
    const row = await env.DB.prepare('SELECT last_sent_at, missed FROM alerts WHERE kind = ?').bind(kind).first();
    if (row && now - row.last_sent_at < QUIET_MS) {
      await env.DB.prepare('UPDATE alerts SET missed = missed + 1, last_detail = ? WHERE kind = ?').bind(text, kind).run();
      return false;
    }
    const missed = row ? row.missed : 0;
    await env.DB.prepare(`INSERT INTO alerts (kind, last_sent_at, missed, last_detail) VALUES (?, ?, 0, ?)
      ON CONFLICT (kind) DO UPDATE SET last_sent_at = excluded.last_sent_at, missed = 0, last_detail = excluded.last_detail`)
      .bind(kind, now, text).run();
    const to = env.ALERT_EMAIL || env.SUPPORT_EMAIL;
    if (!mailEnabled(env) || !to) return false;
    await sendMail(env, {
      to,
      subject: `HostelFlow alert: ${kind}`,
      text: `${text}\n\n${missed ? `Since the last e-mail: ${missed} more like this (only the latest is kept).\n` : ''}`
        + `Time: ${new Date(now).toISOString()}\nNo more e-mails about "${kind}" for an hour.`,
    });
    return true;
  } catch (err) {
    console.error('alert failed', err);
    return false;
  }
}
