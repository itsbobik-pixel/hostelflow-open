// Shifts: who works when (the Shifts tab). Everyone on the team sees the
// rota; whoever may edit it (the 'shifts' permission, owners always) drags
// people onto shifts and puts short notes on them (shift_notes). The kinds of
// shift, their hours and their order are set in Settings → Shifts
// (properties.shift_types).

import { HttpError, json, readJson } from './http.js';
import { requireUser, access, requirePermission } from './auth.js';

export const DEFAULT_SHIFT_TYPES = [
  { key: 'morning', name: 'Morning', start: '07:00', end: '15:00' },
  { key: 'evening', name: 'Evening', start: '15:00', end: '23:00' },
];
const MAX_TYPES = 12;
const MAX_DAYS = 42;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function shiftTypesOf(p) {
  try {
    const list = JSON.parse(p.shift_types);
    if (Array.isArray(list) && list.length) return list;
  } catch { /* none set: the defaults */ }
  return DEFAULT_SHIFT_TYPES;
}

// Settings → Shifts: [{ key?, name, start, end }] (an end before the start is overnight).
export function checkShiftTypes(list, current) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'add at least one shift');
  if (list.length > MAX_TYPES) throw new HttpError(400, 'too many shift types');
  const keys = new Set();
  return list.map(item => {
    const name = typeof (item && item.name) === 'string' ? item.name.trim() : '';
    if (!name || name.length > 30) throw new HttpError(400, 'every shift needs a name (up to 30 characters)');
    if (!TIME_RE.test(item.start) || !TIME_RE.test(item.end) || item.start === item.end) {
      throw new HttpError(400, 'a shift needs a start and an end time');
    }
    let key = typeof item.key === 'string' && /^[\w-]{1,20}$/.test(item.key) ? item.key : null;
    if (!key) key = (current.find(c => c.name === name) || {}).key || Math.random().toString(36).slice(2, 8);
    if (keys.has(key)) throw new HttpError(400, 'two shifts with the same name');
    keys.add(key);
    return { key, name, start: item.start, end: item.end };
  });
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function team(db, propertyId) {
  const { results } = await db.prepare(
    `SELECT u.id, COALESCE(u.name, u.email) AS name, u.color FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.property_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name`,
  ).bind(propertyId).all();
  return results;
}

// ?from=YYYY-MM-DD&days=7
export async function getShifts(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const { can, sees } = await access(db, user.id, propertyId);
  if (!sees.has('shifts')) throw new HttpError(403, "you don't have permission for this — ask the owner");
  const url = new URL(request.url);
  const from = DAY_RE.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : new Date().toISOString().slice(0, 10);
  const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const p = await db.prepare('SELECT shift_types FROM properties WHERE id = ?').bind(propertyId).first();
  const { results } = await db.prepare('SELECT id, day, type_key, user_id, start_time, end_time FROM shifts WHERE property_id = ? AND day >= ? AND day < ? ORDER BY created_at')
    .bind(propertyId, from, addDays(from, days)).all();
  const notes = await db.prepare('SELECT id, day, type_key, text, color FROM shift_notes WHERE property_id = ? AND day >= ? AND day < ? ORDER BY created_at')
    .bind(propertyId, from, addDays(from, days)).all();
  return json({
    from, days, me: user.id, canEdit: can.has('shifts'),
    types: shiftTypesOf(p),
    members: await team(db, propertyId),
    // start/end only when someone's hours differ from the usual ones of the shift.
    shifts: results.map(s => ({
      id: s.id, day: s.day, type: s.type_key, userId: s.user_id,
      ...(s.start_time ? { start: s.start_time, end: s.end_time } : {}),
    })),
    notes: notes.results.map(n => ({ id: n.id, day: n.day, type: n.type_key, text: n.text, color: n.color || null })),
  });
}

// A real calendar day (Date.parse lets 2026-02-31 through as 3 March), from
// 2000 to two years ahead: the rota has no use for year 9999.
const AHEAD_DAYS = 731;
function realDay(day) {
  if (!DAY_RE.test(day || '') || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || addDays(day, 0) !== day) return false;
  return day >= '2000-01-01' && day <= addDays(new Date().toISOString().slice(0, 10), AHEAD_DAYS);
}

async function checkShift(db, propertyId, body) {
  if (!realDay(body.day)) throw new HttpError(400, 'which day?');
  const p = await db.prepare('SELECT shift_types FROM properties WHERE id = ?').bind(propertyId).first();
  if (!shiftTypesOf(p).some(t => t.key === body.type)) throw new HttpError(400, 'unknown shift');
}

const once = err => {
  if (/UNIQUE/i.test(String(err && err.message))) throw new HttpError(409, 'already on this shift');
  throw err;
};

// Body: { day, type, userId }
export async function addShift(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  const body = await readJson(request);
  await checkShift(db, propertyId, body);
  const member = await db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND property_id = ?').bind(String(body.userId || ''), propertyId).first();
  if (!member) throw new HttpError(400, 'not on this team');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO shifts (id, property_id, day, type_key, user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, propertyId, body.day, body.type, body.userId, user.id, Date.now()).run().catch(once);
  return json({ id, day: body.day, type: body.type, userId: body.userId }, 201);
}

// Body: { day, type } — dragged to another day or shift (own hours stay only
// on the same kind of shift). Or { start, end } — this person's own hours on
// it (both null: back to the usual hours).
export async function moveShift(env, request, propertyId, shiftId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  const body = await readJson(request);
  let r;
  if ('start' in body || 'end' in body) {
    const own = body.start !== null || body.end !== null;
    if (own && (!TIME_RE.test(body.start || '') || !TIME_RE.test(body.end || '') || body.start === body.end)) {
      throw new HttpError(400, 'give a start and an end time');
    }
    r = await db.prepare('UPDATE shifts SET start_time = ?, end_time = ? WHERE id = ? AND property_id = ?')
      .bind(own ? body.start : null, own ? body.end : null, shiftId, propertyId).run();
  } else {
    await checkShift(db, propertyId, body);
    r = await db.prepare(`UPDATE shifts SET start_time = CASE WHEN type_key = ?2 THEN start_time END,
        end_time = CASE WHEN type_key = ?2 THEN end_time END, day = ?1, type_key = ?2 WHERE id = ?3 AND property_id = ?4`)
      .bind(body.day, body.type, shiftId, propertyId).run().catch(once);
  }
  if (!r.meta.changes) throw new HttpError(404, 'shift not found');
  return json({ ok: true });
}

export async function deleteShift(env, request, propertyId, shiftId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  await db.prepare('DELETE FROM shifts WHERE id = ? AND property_id = ?').bind(shiftId, propertyId).run();
  return json({ ok: true });
}

// Body: { from, action } for the week starting on that day (Shifts, bottom
// left). 'copy': the week after gets the same shifts, own hours included —
// its own shifts go first (Bob, 27. 10.: replaced, not added to); notes stay
// where they are, they're about their day. 'clear': the week's shifts and
// notes go.
export async function shiftsWeek(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  const body = await readJson(request);
  if (!realDay(body.from)) throw new HttpError(400, 'which day?');
  const to = addDays(body.from, 7);
  if (body.action === 'copy') {
    if (!realDay(addDays(body.from, 13))) throw new HttpError(400, 'which day?');
    // Only people still on the team; the date moves by 7 days.
    const [, r] = await db.batch([
      db.prepare('DELETE FROM shifts WHERE property_id = ? AND day >= ? AND day < ?').bind(propertyId, to, addDays(to, 7)),
      db.prepare(
        `INSERT INTO shifts (id, property_id, day, type_key, user_id, start_time, end_time, created_by, created_at)
         SELECT lower(hex(randomblob(16))), s.property_id, date(s.day, '+7 days'), s.type_key, s.user_id, s.start_time, s.end_time, ?, ?
         FROM shifts s JOIN memberships m ON m.user_id = s.user_id AND m.property_id = s.property_id
         WHERE s.property_id = ? AND s.day >= ? AND s.day < ?`,
      ).bind(user.id, Date.now(), propertyId, body.from, to),
    ]);
    return json({ copied: r.meta.changes || 0 });
  }
  if (body.action === 'clear') {
    await db.batch([
      db.prepare('DELETE FROM shifts WHERE property_id = ? AND day >= ? AND day < ?').bind(propertyId, body.from, to),
      db.prepare('DELETE FROM shift_notes WHERE property_id = ? AND day >= ? AND day < ?').bind(propertyId, body.from, to),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(400, 'copy or clear?');
}

// Notes on the rota: short, so they fit a chip next to the names. And not
// endless: a property gets this many in all (years of a busy rota).
const NOTE_MAX = 200;
const NOTES_PER_PROPERTY = 5000;
function noteText(body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'write the note');
  if (text.length > NOTE_MAX) throw new HttpError(400, 'a note can have up to 200 characters');
  return text;
}
// The chip's colour: one like #3a8fd4 (the picker's), or none for the default.
function noteColor(body) {
  if (body.color == null || body.color === '') return null;
  if (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color)) throw new HttpError(400, 'invalid colour');
  return body.color.toLowerCase();
}

// Body: { day, type, text, color? }
export async function addShiftNote(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  const body = await readJson(request);
  await checkShift(db, propertyId, body);
  const text = noteText(body);
  const color = noteColor(body);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM shift_notes WHERE property_id = ?').bind(propertyId).first();
  if (n >= NOTES_PER_PROPERTY) throw new HttpError(409, 'too many notes on the rota — delete some old ones first');
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare('INSERT INTO shift_notes (id, property_id, day, type_key, text, color, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, propertyId, body.day, body.type, text, color, user.id, now, now).run();
  return json({ id, day: body.day, type: body.type, text, color }, 201);
}

// Body: { text, color? } — rewritten; or { day, type } — dragged to another shift.
export async function updateShiftNote(env, request, propertyId, noteId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  const body = await readJson(request);
  let r;
  if ('text' in body) {
    r = 'color' in body
      ? await db.prepare('UPDATE shift_notes SET text = ?, color = ?, updated_at = ? WHERE id = ? AND property_id = ?')
        .bind(noteText(body), noteColor(body), Date.now(), noteId, propertyId).run()
      : await db.prepare('UPDATE shift_notes SET text = ?, updated_at = ? WHERE id = ? AND property_id = ?')
        .bind(noteText(body), Date.now(), noteId, propertyId).run();
  } else {
    await checkShift(db, propertyId, body);
    r = await db.prepare('UPDATE shift_notes SET day = ?, type_key = ?, updated_at = ? WHERE id = ? AND property_id = ?')
      .bind(body.day, body.type, Date.now(), noteId, propertyId).run();
  }
  if (!r.meta.changes) throw new HttpError(404, 'note not found');
  return json({ ok: true });
}

export async function deleteShiftNote(env, request, propertyId, noteId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'shifts');
  await db.prepare('DELETE FROM shift_notes WHERE id = ? AND property_id = ?').bind(noteId, propertyId).run();
  return json({ ok: true });
}
