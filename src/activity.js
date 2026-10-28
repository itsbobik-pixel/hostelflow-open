// The activity log (Settings → Activity, owners only): who did what in a
// property. Only people and kinds of event, with at most a count or a role —
// never guest data, passwords or keys (GDPR). Kept 180 days.
//
// Logging must never break the action it describes, so it swallows errors.

import { json } from './http.js';
import { requireUser, requireRole } from './auth.js';

const KEEP_MS = 180 * 86400000;
const PAGE = 100;

// action: a short code the app shows as a sentence (public/js/settings.js ACTIVITY_TEXT);
// detail: one small value for it (a name, a count, a role) or null.
export async function logActivity(db, propertyId, user, action, detail = null) {
  try {
    await db.prepare('INSERT INTO activity_log (property_id, user_id, user_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(propertyId, user ? user.id : null, user ? (user.name || null) : null, action, detail == null ? null : String(detail).slice(0, 120), Date.now()).run();
  } catch { /* the log is a convenience */ }
}

// A sign-in belongs to every property the person works in.
export async function logSignIn(db, user) {
  try {
    const { results } = await db.prepare('SELECT property_id FROM memberships WHERE user_id = ?').bind(user.id).all();
    for (const m of results) await logActivity(db, m.property_id, user, 'signed_in');
  } catch { /* see above */ }
}

export async function listActivity(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requireRole(db, user.id, propertyId, ['owner']);
  const before = Number(new URL(request.url).searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const { results } = await db.prepare(
    'SELECT id, user_name, action, detail, created_at FROM activity_log WHERE property_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
  ).bind(propertyId, before, PAGE + 1).all();
  const more = results.length > PAGE;
  return json({
    items: results.slice(0, PAGE).map(r => ({ id: r.id, who: r.user_name, action: r.action, detail: r.detail, at: r.created_at })),
    more,
  });
}

export async function pruneActivity(db, now = Date.now()) {
  await db.prepare('DELETE FROM activity_log WHERE created_at < ?').bind(now - KEEP_MS).run();
}
