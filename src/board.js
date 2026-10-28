// Dashboard: one screen that tells the shift what needs doing.
//
//   - "Needs attention": guests still to register (late ones first), a missing
//     police login, beds to make up (dirty sheets) or with sheets / linen to change, and routine
//     tasks whose time has passed but nobody ticked.
//   - The daily routine: time blocks of tasks the owner writes as plain text
//     in Settings; anyone on the team ticks them off, per day.
//   - Team notes: short messages with a category, likes, delete.
//
// Times are the property's local time (properties.timezone).

import { HttpError, json, readJson, parseJson } from './http.js';
import { requireUser, access } from './auth.js';
import { parseDay } from './stats/istat.js';
import { bedsNeedingWork } from './housekeeping.js';
import { todayMovements } from './reservations.js';
import { loginBroken } from './policecheck.js';
import { hasHostelOne } from './billing.js';

export const NOTE_CATEGORIES = ['checkins', 'guests', 'laundry', 'broken', 'shopping', 'payments', 'other'];
const MAX_NOTE = 1000;
const MAX_ROUTINE = 10000;
const MAX_BLOCKS = 30;
const MAX_TASKS = 60;
const MAX_TASK = 200;

// ===== Routine text =====
//
//   8:00-9:00 Opening
//   Open the terrace
//   - Switch on the doorbell
//
//   11:00 Cleaning          (no end time: lasts until the next block starts)
//
// A line starting with a time starts a block; every other line is a task.

const BLOCK_LINE = /^(\d{1,2})[:.](\d{2})(?:\s*[-–—]\s*(\d{1,2})[:.](\d{2}))?(?:\s*[·|:\-–—]?\s+(.*))?$/;

function minutes(h, m) {
  const v = Number(h) * 60 + Number(m);
  return Number(h) <= 24 && Number(m) < 60 && v <= 24 * 60 ? v : null;
}

// Short stable id from the text, so ticks survive the owner editing other lines.
function hash(s) {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

export function formatTime(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

export function parseRoutine(text) {
  const blocks = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(BLOCK_LINE);
    if (m) {
      const from = minutes(m[1], m[2]);
      const to = m[3] !== undefined ? minutes(m[3], m[4]) : undefined;
      if (from === null || to === null || (to !== undefined && to <= from)) {
        errors.push(`line ${i + 1}: the time is not valid`);
        return;
      }
      blocks.push({ from, to, label: (m[5] || '').trim().slice(0, 80), tasks: [] });
      return;
    }
    if (!blocks.length) {
      errors.push(`line ${i + 1}: start with a time, e.g. "8:00-9:00 Opening"`);
      return;
    }
    const task = line.replace(/^[-•*·]\s*/, '').slice(0, MAX_TASK);
    if (task) blocks[blocks.length - 1].tasks.push(task);
  });
  if (blocks.length > MAX_BLOCKS) errors.push(`at most ${MAX_BLOCKS} time blocks`);
  if (blocks.some(b => b.tasks.length > MAX_TASKS)) errors.push(`at most ${MAX_TASKS} tasks in one block`);

  blocks.sort((a, b) => a.from - b.from);
  blocks.forEach((b, i) => {
    if (b.to === undefined) b.to = i + 1 < blocks.length ? Math.max(blocks[i + 1].from, b.from + 1) : 24 * 60;
    const seen = new Set();
    b.tasks = b.tasks.map(t => {
      let id = `${b.from}-${hash(t)}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      return { id, text: t };
    });
  });
  return { blocks, errors };
}

export function checkRoutine(text) {
  if (typeof text !== 'string') throw new HttpError(400, 'routine must be text');
  if (text.length > MAX_ROUTINE) throw new HttpError(400, 'routine is too long');
  const { errors } = parseRoutine(text);
  if (errors.length) throw new HttpError(400, `routine: ${errors[0]}`);
  return text.trim() || null;
}

// ===== Time =====

// { day: "2026-09-28", date: "28.09.2026", minutes: 545 } in the property's zone.
export function localNow(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    date: `${get('day')}.${get('month')}.${get('year')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

// ===== Board =====

async function context(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  const { role, can, sees } = await access(env.DB, user.id, propertyId);
  const property = await env.DB.prepare('SELECT id, timezone, registration, registration_status, routine, linen, sheets_track, sheets_days, linen_in_use, plan, billing_status, trial_ends_at, preview FROM properties WHERE id = ?')
    .bind(propertyId).first();
  return { user, role, can, sees, property, now: localNow(property.timezone || 'Europe/Rome') };
}

// Settings → Team: who sees which part of the Dashboard, and who writes notes.
const NO = () => new HttpError(403, "you don't have permission for this — ask the owner");
function need(ctx, area, edit) {
  if (!(edit ? ctx.can : ctx.sees).has(area)) throw NO();
  return ctx;
}

async function notesView(db, propertyId, user, can) {
  const { results: notes } = await db.prepare(
    `SELECT n.id, n.author_id, n.category, n.text, n.created_at, n.edited_at, n.attention, n.handover, n.handover_done_at, COALESCE(u.name, u.email) AS author, u.color AS author_color
     FROM notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.property_id = ? ORDER BY n.created_at DESC LIMIT 100`,
  ).bind(propertyId).all();
  const { results: likes } = await db.prepare(
    `SELECT l.note_id, l.user_id, COALESCE(u.name, u.email) AS name FROM note_likes l
     JOIN notes n ON n.id = l.note_id JOIN users u ON u.id = l.user_id WHERE n.property_id = ?`,
  ).bind(propertyId).all();
  const { results: replies } = await db.prepare(
    `SELECT r.id, r.note_id, r.author_id, r.text, r.created_at, COALESCE(u.name, u.email) AS author, u.color AS author_color FROM note_replies r
     JOIN notes n ON n.id = r.note_id LEFT JOIN users u ON u.id = r.author_id
     WHERE n.property_id = ? ORDER BY r.created_at`,
  ).bind(propertyId).all();
  return notes.map(n => {
    const mine = likes.filter(l => l.note_id === n.id);
    return {
      id: n.id,
      author: n.author || '—',
      authorColor: n.author_color || null,
      category: n.category,
      text: n.text,
      createdAt: n.created_at,
      editedAt: n.edited_at,
      likes: mine.map(l => l.name),
      liked: mine.some(l => l.user_id === user.id),
      canDelete: n.author_id === user.id ? can.has('notes') : can.has('moderate'),
      attention: !!n.attention,
      handover: !!n.handover,
      handoverDone: !!n.handover_done_at,
      canFlag: can.has('attention'),
      replies: replies.filter(r => r.note_id === n.id).map(r => ({
        id: r.id, author: r.author || '—', authorColor: r.author_color || null, text: r.text, createdAt: r.created_at,
        canDelete: r.author_id === user.id ? can.has('notes') : can.has('moderate'),
      })),
    };
  });
}

async function routineView(db, property, now) {
  const { blocks } = parseRoutine(property.routine);
  const { results } = await db.prepare(
    `SELECT d.task_id, d.done_at, COALESCE(u.name, u.email) AS name FROM routine_done d
     LEFT JOIN users u ON u.id = d.user_id WHERE d.property_id = ? AND d.day = ?`,
  ).bind(property.id, now.day).all();
  const done = new Map(results.map(r => [r.task_id, { by: r.name || '', at: r.done_at }]));
  return blocks.map(b => ({
    from: b.from, to: b.to, label: b.label, time: `${formatTime(b.from)}–${formatTime(b.to)}`,
    tasks: b.tasks.map(t => ({ ...t, done: done.get(t.id) || null })),
  }));
}

async function attentionView(db, property, now, routine, withCalendar, can) {
  const items = [];
  // Notes the owner put here come first, for everyone.
  const { results: flagged } = await db.prepare(
    `SELECT n.id, n.text, COALESCE(u.name, u.email) AS author FROM notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.property_id = ? AND n.attention = 1 ORDER BY n.created_at DESC`,
  ).bind(property.id).all();
  for (const n of flagged) items.push({ type: 'note', id: n.id, text: n.text, author: n.author || '' });
  // Volunteers don't do the police registration: none of it is theirs to see.
  const checkin = can.has('checkin');
  if (checkin && !property.registration) items.push({ type: 'setup' });
  if (checkin && property.registration && loginBroken(parseJson(property.registration_status))) items.unshift({ type: 'login' });

  const { results } = checkin ? await db.prepare("SELECT fields FROM guests WHERE property_id = ? AND status != 'sent'")
    .bind(property.id).all() : { results: [] };
  const today = parseDay(now.date);
  let late = 0;
  for (const r of results) {
    let arrival = null;
    try { arrival = parseDay(JSON.parse(r.fields).arrival); } catch {}
    if (arrival !== null && arrival < today) late++;
  }
  if (late) items.push({ type: 'late', count: late });
  if (results.length - late) items.push({ type: 'waiting', count: results.length - late });

  // Housekeeping is for everyone; the calendar (below) is still in preview.
  const beds = await bedsNeedingWork(db, property);
  if (beds.dirty) items.push({ type: 'beds', count: beds.dirty });
  if (beds.sheets) items.push({ type: 'sheets', count: beds.sheets });
  if (beds.overdue) items.push({ type: 'linen', count: beds.overdue });
  if (beds.tasks) items.push({ type: 'hktasks', count: beds.tasks });

  const moves = withCalendar ? await todayMovements(db, property.id, now.day) : {};
  if (moves.arrivals) items.push({ type: 'arrivals', count: moves.arrivals });
  if (moves.departures) items.push({ type: 'departures', count: moves.departures });

  for (const b of routine) {
    if (b.to > now.minutes) continue; // this block's time hasn't fully passed yet
    for (const t of b.tasks) {
      if (!t.done) items.push({ type: 'task', id: t.id, text: t.text, block: b.label || formatTime(b.from) });
    }
  }
  return items;
}

export async function getBoard(env, request, propertyId) {
  const { user, role, can, sees, property, now } = await context(env, request, propertyId);
  // Each part only for whoever may see it (Settings → Team).
  const routine = await routineView(env.DB, property, now);
  return json({
    now,
    role,
    can: [...can],
    sees: [...sees],
    routine: sees.has('guidelines') ? routine : [],
    attention: sees.has('attention') ? await attentionView(env.DB, property, now, routine, !!property.preview && hasHostelOne(env, property), can) : [],
    notes: sees.has('notes') ? await notesView(env.DB, propertyId, user, can) : [],
    categories: NOTE_CATEGORIES,
  });
}

// Body: { taskIds: [...], done: true|false } — for today.
export async function tickRoutine(env, request, propertyId) {
  const { user, property, now } = need(await context(env, request, propertyId), 'guidelines');
  const body = await readJson(request);
  const valid = new Set(parseRoutine(property.routine).blocks.flatMap(b => b.tasks.map(t => t.id)));
  const ids = Array.isArray(body.taskIds) ? body.taskIds.filter(id => valid.has(id)) : [];
  if (!ids.length) throw new HttpError(400, 'no such task');
  const stmts = ids.map(id => body.done === false
    ? env.DB.prepare('DELETE FROM routine_done WHERE property_id = ? AND day = ? AND task_id = ?').bind(propertyId, now.day, id)
    : env.DB.prepare(
      `INSERT INTO routine_done (property_id, day, task_id, user_id, done_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (property_id, day, task_id) DO NOTHING`,
    ).bind(propertyId, now.day, id, user.id, Date.now()));
  await env.DB.batch(stmts);
  return json({ ok: true, count: ids.length });
}

// Same rules as deleting: the author or the owner. Body: { text, category, attention? }
// (attention: owner only; others leave it as it is).
export async function editNote(env, request, propertyId, noteId) {
  const { user, can } = need(await context(env, request, propertyId), 'notes', true);
  const n = await loadNote(env.DB, propertyId, noteId);
  if (n.author_id !== user.id && !can.has('moderate')) throw new HttpError(403, 'only the author or the owner can change this note');
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'write something first');
  if (text.length > MAX_NOTE) throw new HttpError(400, 'note is too long');
  const category = body.category == null || body.category === '' ? null : body.category;
  if (category !== null && !NOTE_CATEGORIES.includes(category)) throw new HttpError(400, 'unknown category');
  const attention = can.has('attention') && body.attention !== undefined ? (body.attention ? 1 : 0) : null;
  const handover = body.handover !== undefined ? (body.handover ? 1 : 0) : null;
  await env.DB.prepare('UPDATE notes SET text = ?, category = ?, attention = COALESCE(?, attention), handover = COALESCE(?, handover), edited_at = ? WHERE id = ? AND property_id = ?')
    .bind(text, category, attention, handover, Date.now(), noteId, propertyId).run();
  return json({ ok: true });
}

export async function addNote(env, request, propertyId) {
  const { user, can } = need(await context(env, request, propertyId), 'notes', true);
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'write something first');
  if (text.length > MAX_NOTE) throw new HttpError(400, 'note is too long');
  const category = body.category == null || body.category === '' ? null : body.category;
  if (category !== null && !NOTE_CATEGORIES.includes(category)) throw new HttpError(400, 'unknown category');
  // Owner only: straight into "Needs attention" on everyone's Dashboard.
  if (body.attention && !can.has('attention')) throw new HttpError(403, "you don't have permission for this — ask the owner");
  const id = crypto.randomUUID();
  // End of shift (anyone): the handover the next shift sees first.
  await env.DB.prepare('INSERT INTO notes (id, property_id, author_id, category, text, attention, handover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, propertyId, user.id, category, text, body.attention ? 1 : 0, body.handover ? 1 : 0, Date.now()).run();
  return json({ id }, 201);
}

async function loadNote(db, propertyId, noteId) {
  const n = await db.prepare('SELECT id, author_id FROM notes WHERE id = ? AND property_id = ?').bind(noteId, propertyId).first();
  if (!n) throw new HttpError(404, 'note not found');
  return n;
}

export async function deleteNote(env, request, propertyId, noteId) {
  const { user, can } = await context(env, request, propertyId);
  const n = await loadNote(env.DB, propertyId, noteId);
  if (n.author_id === user.id ? !can.has('notes') : !can.has('moderate')) throw new HttpError(403, 'only the author or the owner can delete this note');
  await env.DB.prepare('DELETE FROM notes WHERE id = ? AND property_id = ?').bind(noteId, propertyId).run();
  return json({ ok: true });
}

const MAX_REPLY = 500;
export async function addReply(env, request, propertyId, noteId) {
  const { user } = need(await context(env, request, propertyId), 'notes', true);
  await loadNote(env.DB, propertyId, noteId);
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'write something first');
  if (text.length > MAX_REPLY) throw new HttpError(400, 'reply is too long');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO note_replies (id, note_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, noteId, user.id, text, Date.now()).run();
  return json({ id }, 201);
}

export async function deleteReply(env, request, propertyId, noteId, replyId) {
  const { user, can } = await context(env, request, propertyId);
  await loadNote(env.DB, propertyId, noteId);
  const r = await env.DB.prepare('SELECT author_id FROM note_replies WHERE id = ? AND note_id = ?').bind(replyId, noteId).first();
  if (!r) throw new HttpError(404, 'reply not found');
  if (r.author_id === user.id ? !can.has('notes') : !can.has('moderate')) throw new HttpError(403, 'only the author or the owner can delete this reply');
  await env.DB.prepare('DELETE FROM note_replies WHERE id = ?').bind(replyId).run();
  return json({ ok: true });
}

// Owner: puts a note into "Needs attention" (or takes it out). Body: { on }
export async function flagNote(env, request, propertyId, noteId) {
  const { can } = await context(env, request, propertyId);
  if (!can.has('attention')) throw new HttpError(403, "you don't have permission for this — ask the owner");
  await loadNote(env.DB, propertyId, noteId);
  const on = !!(await readJson(request)).on;
  await env.DB.prepare('UPDATE notes SET attention = ? WHERE id = ? AND property_id = ?').bind(on ? 1 : 0, noteId, propertyId).run();
  return json({ attention: on });
}

// Ticks an end-of-shift note off the Dashboard (anyone on the team), or back on.
export async function handoverDone(env, request, propertyId, noteId) {
  need(await context(env, request, propertyId), 'notes', true);
  await loadNote(env.DB, propertyId, noteId);
  const body = await readJson(request);
  const done = body.done !== false;
  await env.DB.prepare('UPDATE notes SET handover_done_at = ? WHERE id = ? AND property_id = ?').bind(done ? Date.now() : null, noteId, propertyId).run();
  return json({ handoverDone: done });
}

// Toggles the caller's like.
export async function likeNote(env, request, propertyId, noteId) {
  const { user } = need(await context(env, request, propertyId), 'notes', true);
  await loadNote(env.DB, propertyId, noteId);
  const r = await env.DB.prepare('DELETE FROM note_likes WHERE note_id = ? AND user_id = ?').bind(noteId, user.id).run();
  if (!r.meta.changes) {
    await env.DB.prepare('INSERT INTO note_likes (note_id, user_id) VALUES (?, ?)').bind(noteId, user.id).run();
  }
  return json({ liked: !r.meta.changes });
}

// Ticks older than a week are of no use to anyone.
export async function boardCleanup(db, now = Date.now()) {
  const cutoff = new Date(now - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare('DELETE FROM routine_done WHERE day < ?').bind(cutoff).run();
}
