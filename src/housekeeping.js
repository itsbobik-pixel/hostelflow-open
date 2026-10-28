// Housekeeping: the property drawn from above on a grid (rooms, bathrooms…),
// the beds of each room (listed under the map; a bunk is one frame with a bed
// per level), the daily sheets of each bed (Clean / Dirty / In use, when the
// property tracks them), and when each piece of bed linen was last changed. Each property lists its own items (Costello: pillow
// protector, mattress protector, blanket cover) with a "change at the latest
// after N days" limit; they're also changed whenever dirty.
//
// The owner edits the map and the beds together and saves them whole; ids of
// rooms and beds that stay are kept, so the linen history survives edits.

import { HttpError, json, readJson } from './http.js';
import { requireUser, requireRole, access } from './auth.js';

const DAY = 24 * 3600 * 1000;
const LEVELS = { single: 1, double: 1, bunk: 2, triple: 3 };
const MAX_COLS = 60;
const MAX_ROWS = 200;
const MAX_ROOMS = 100;
const MAX_FRAMES = 300;

// No items until the owner adds them: every place changes different things.
export function linenOf(property) {
  try {
    const v = JSON.parse(property.linen || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Body value from Settings: [{ key?, label, days }].
export function checkLinen(input, current = []) {
  if (!Array.isArray(input) || input.length > 8) throw new HttpError(400, 'linen: at most 8 items');
  const keys = new Set();
  return input.map(item => {
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label || label.length > 40) throw new HttpError(400, 'linen: every item needs a name (up to 40 characters)');
    const days = Number(item.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'linen: days must be between 1 and 365');
    let key = typeof item.key === 'string' && /^[\w-]{1,20}$/.test(item.key) ? item.key : null;
    if (!key) key = (current.find(c => c.label === label) || {}).key || Math.random().toString(36).slice(2, 8);
    if (keys.has(key)) throw new HttpError(400, 'linen: this item is already on the list');
    keys.add(key);
    return { key, label, days };
  });
}

// ----- Daily sheets -----

export const SHEETS = ['clean', 'dirty', 'in_use'];

// { track, days, linenInUse }: days = remind after the same sheets were in use that long
// (null = never); linenInUse = the linen's days count only while the bed is In use.
export function sheetsOf(property) {
  return { track: !!property.sheets_track, days: property.sheets_days || null, linenInUse: !!property.linen_in_use };
}

// Body value from Settings: { track: bool, days: 1–60 | null, linenInUse?: bool }.
// Counting In use days needs the daily sheets: without them it stays off.
export function checkSheets(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'sheets: on or off');
  const days = input.days === null || input.days === undefined || input.days === '' ? null : Number(input.days);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 60)) throw new HttpError(400, 'sheets: days must be between 1 and 60');
  return { track: !!input.track, days, linenInUse: !!input.track && !!input.linenInUse };
}

// How long a bed has been In use altogether, the stretch going on now included.
const inUseTotal = (b, now) => (b.in_use_ms || 0) + (b.sheets === 'in_use' && b.sheets_at ? Math.max(0, now - b.sheets_at) : 0);

// How old a piece of linen counts as: the time since it was changed, or with
// linenInUse only the time the bed has been In use since. Changed before the
// count began: the In use time we know, never more than the days since.
function linenAge(sheets, l, total, now) {
  const since = now - l.changed_at;
  if (!sheets.track || !sheets.linenInUse) return since;
  if (l.in_use_base !== null && l.in_use_base !== undefined) return Math.max(0, total - l.in_use_base);
  return Math.max(0, Math.min(since, total));
}

// In use, unchanged, for the property's number of days (half a day early, so
// sheets put on in the evening are due in the morning, as tasks are).
export const sheetsDue = (sheets, bed, now = Date.now()) => !!(sheets.track && sheets.days
  && bed.sheets && bed.sheets.state === 'in_use' && bed.sheets.at && now - bed.sheets.at >= sheets.days * DAY - DAY / 2);

// roles: ['owner'] for the map and the linen settings; else Settings → Team
// decides (looking: 'read', ticking things done: 'edit').
async function context(env, request, propertyId, roles = null, edit = false) {
  const user = await requireUser(env.DB, request);
  let role;
  if (roles) role = await requireRole(env.DB, user.id, propertyId, roles);
  else {
    const a = await access(env.DB, user.id, propertyId);
    if (!(edit ? a.can : a.sees).has('housekeeping')) throw new HttpError(403, "you don't have permission for this — ask the owner");
    role = a.role;
  }
  const property = await env.DB.prepare('SELECT id, linen, sheets_track, sheets_days, linen_in_use FROM properties WHERE id = ?').bind(propertyId).first();
  return { user, role, property };
}

// Each linen record comes with its age (linenAge), so the app and the
// Dashboard count the same way.
async function loadMap(db, property, now = Date.now()) {
  const propertyId = property.id;
  const sheetsSet = sheetsOf(property);
  const [rooms, frames, beds, linen] = await Promise.all([
    db.prepare('SELECT id, name, kind, x, y, w, h FROM rooms WHERE property_id = ? ORDER BY position IS NULL, position, y, x').bind(propertyId).all(),
    db.prepare('SELECT id, kind, x, y, w, h, room_id FROM bed_frames WHERE property_id = ? ORDER BY y, x').bind(propertyId).all(),
    db.prepare('SELECT b.id, b.frame_id, b.level, b.label, b.sheets, b.sheets_at, b.in_use_ms, COALESCE(u.name, u.email) AS by_name FROM beds b LEFT JOIN users u ON u.id = b.sheets_by WHERE b.property_id = ? ORDER BY b.level').bind(propertyId).all(),
    db.prepare(
      `SELECT l.bed_id, l.item, l.changed_at, l.in_use_base, COALESCE(u.name, u.email) AS by_name FROM bed_linen l
       JOIN beds b ON b.id = l.bed_id LEFT JOIN users u ON u.id = l.changed_by WHERE b.property_id = ?`,
    ).bind(propertyId).all(),
  ]);
  return {
    rooms: rooms.results,
    frames: frames.results.map(({ room_id, ...f }) => ({
      ...f,
      roomId: room_id,
      beds: beds.results.filter(b => b.frame_id === f.id).map(b => {
        const total = inUseTotal(b, now);
        return {
          id: b.id, level: b.level, label: b.label,
          sheets: b.sheets ? { state: b.sheets, at: b.sheets_at, by: b.by_name || '' } : null,
          linen: Object.fromEntries(linen.results.filter(l => l.bed_id === b.id)
            .map(l => [l.item, { at: l.changed_at, by: l.by_name || '', age: linenAge(sheetsSet, l, total, now) }])),
        };
      }),
    })),
  };
}

// ===== Recurring tasks =====

const MAX_TASKS = 50;

async function loadTasks(db, propertyId) {
  const { results } = await db.prepare(
    `SELECT t.id, t.name, t.every_days, t.room_id, t.done_at, COALESCE(u.name, u.email) AS by_name
     FROM hk_tasks t LEFT JOIN users u ON u.id = t.done_by WHERE t.property_id = ? ORDER BY t.position`,
  ).bind(propertyId).all();
  return results.map(r => ({ id: r.id, name: r.name, everyDays: r.every_days, roomId: r.room_id, doneAt: r.done_at, doneBy: r.by_name || '' }));
}

// Due on the day its days are up (half a day early, so a task done in the
// evening is due again in the morning), and right away if never done.
export const taskDue = (task, now = Date.now()) => !task.doneAt || now - task.doneAt >= task.everyDays * DAY - DAY / 2;

// For the dashboard: beds with dirty sheets, sheets in use too long (both only
// when the property tracks daily sheets), beds with linen past its date, tasks due.
export async function bedsNeedingWork(db, property, now = Date.now()) {
  const items = linenOf(property);
  const sheets = sheetsOf(property);
  const [{ frames }, tasks] = await Promise.all([loadMap(db, property, now), loadTasks(db, property.id)]);
  let dirty = 0;
  let overdue = 0;
  let sheetsDueCount = 0;
  for (const b of frames.flatMap(f => f.beds)) {
    if (sheets.track && b.sheets && b.sheets.state === 'dirty') dirty++;
    if (sheetsDue(sheets, b, now)) sheetsDueCount++;
    if (items.some(i => b.linen[i.key] && b.linen[i.key].age >= i.days * DAY)) overdue++;
  }
  return { dirty, overdue, sheets: sheetsDueCount, tasks: tasks.filter(t => taskDue(t, now)).length };
}

export async function getHousekeeping(env, request, propertyId) {
  const { role, property } = await context(env, request, propertyId);
  const now = Date.now();
  const [map, tasks] = await Promise.all([loadMap(env.DB, property, now), loadTasks(env.DB, propertyId)]);
  return json({ role, linen: linenOf(property), sheets: sheetsOf(property), now, ...map, tasks });
}

// Owner: the whole list. Body: { tasks: [{ id?, name, everyDays, roomId? }] };
// a task that stays keeps when it was last done.
export async function saveTasks(env, request, propertyId) {
  const db = env.DB;
  await context(env, request, propertyId, ['owner']);
  const body = await readJson(request);
  const list = Array.isArray(body.tasks) ? body.tasks : [];
  if (list.length > MAX_TASKS) throw new HttpError(400, 'too many tasks');
  const rooms = new Set((await db.prepare('SELECT id FROM rooms WHERE property_id = ?').bind(propertyId).all()).results.map(r => r.id));
  const old = new Set((await db.prepare('SELECT id FROM hk_tasks WHERE property_id = ?').bind(propertyId).all()).results.map(r => r.id));
  const now = Date.now();
  const clean = list.map((t, position) => {
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name || name.length > 60) throw new HttpError(400, 'every task needs a name (up to 60 characters)');
    const everyDays = int(t.everyDays, 1, 365, 'days');
    const roomId = t.roomId == null || t.roomId === '' ? null : String(t.roomId);
    if (roomId && !rooms.has(roomId)) throw new HttpError(400, 'unknown room');
    return { id: typeof t.id === 'string' && old.has(t.id) ? t.id : crypto.randomUUID(), name, everyDays, roomId, position };
  });
  await db.batch([
    db.prepare('DELETE FROM hk_tasks WHERE property_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(propertyId, JSON.stringify(clean.map(t => t.id))),
    ...clean.map(t => db.prepare(
      `INSERT INTO hk_tasks (id, property_id, name, every_days, room_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, every_days = excluded.every_days, room_id = excluded.room_id, position = excluded.position`,
    ).bind(t.id, propertyId, t.name, t.everyDays, t.roomId, t.position, now)),
  ]);
  return json({ tasks: await loadTasks(db, propertyId) });
}

// Anyone on the team: done now (by them). Body: { undo?: true } puts back the
// time it was done before, for a tap by mistake; { day } sets the day it was
// last done by hand (Edit).
export async function taskDone(env, request, propertyId, taskId) {
  const db = env.DB;
  const { user } = await context(env, request, propertyId, null, true);
  const body = await readJson(request).catch(() => ({}));
  const task = await db.prepare('SELECT id FROM hk_tasks WHERE id = ? AND property_id = ?').bind(taskId, propertyId).first();
  if (!task) throw new HttpError(404, 'task not found');
  if (body && body.day !== undefined) {
    await db.prepare('UPDATE hk_tasks SET done_at = ?, done_by = ? WHERE id = ?').bind(dayAt(body.day, Date.now()), user.id, taskId).run();
  } else if (body && body.undo) {
    const prev = body.previous && Number.isInteger(body.previous.at) ? body.previous : null;
    await db.prepare('UPDATE hk_tasks SET done_at = ?, done_by = NULL WHERE id = ?').bind(prev ? prev.at : null, taskId).run();
  } else {
    await db.prepare('UPDATE hk_tasks SET done_at = ?, done_by = ? WHERE id = ?').bind(Date.now(), user.id, taskId).run();
  }
  return json({ tasks: await loadTasks(db, propertyId) });
}

// ===== Map editor (owner) =====

function int(v, min, max, what) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${what} is out of range`);
  return n;
}

function box(o, what) {
  return {
    x: int(o.x, 0, MAX_COLS - 1, what), y: int(o.y, 0, MAX_ROWS - 1, what),
    w: int(o.w, 1, MAX_COLS, what), h: int(o.h, 1, MAX_ROWS, what),
  };
}

// Body: { rooms: [{ id?, name, kind, x, y, w, h }], frames: [{ id?, kind, roomId, beds: [{ id?, label }] }] }
// (beds listed bottom level first; roomId is the id the room has in this
// body, so new rooms can get beds in the same save; x/y/w/h of a frame is
// only kept for old maps that placed beds).
export async function saveMap(env, request, propertyId) {
  const db = env.DB;
  await context(env, request, propertyId, ['owner']);
  const body = await readJson(request);
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];
  const frames = Array.isArray(body.frames) ? body.frames : [];
  if (rooms.length > MAX_ROOMS || frames.length > MAX_FRAMES) throw new HttpError(400, 'the map is too big');

  const existing = async table => new Set((await db.prepare(`SELECT id FROM ${table} WHERE property_id = ?`)
    .bind(propertyId).all()).results.map(r => r.id));
  const [oldRooms, oldFrames, oldBeds] = await Promise.all([existing('rooms'), existing('bed_frames'), existing('beds')]);
  const keep = (old, id) => (typeof id === 'string' && old.has(id) ? id : crypto.randomUUID());

  const labels = new Set();
  const roomIds = new Map(); // id in the body -> stored id
  const cleanRooms = rooms.map(r => {
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || name.length > 40) throw new HttpError(400, 'every room needs a name (up to 40 characters)');
    const id = keep(oldRooms, r.id);
    if (typeof r.id === 'string') roomIds.set(r.id, id);
    return { id, name, kind: r.kind === 'other' ? 'other' : 'room', ...box(r, 'room size') };
  });
  const cleanFrames = frames.map(f => {
    if (!LEVELS[f.kind]) throw new HttpError(400, 'unknown bed type');
    const beds = Array.isArray(f.beds) ? f.beds : [];
    if (beds.length !== LEVELS[f.kind]) throw new HttpError(400, 'wrong number of beds in a bunk');
    const roomId = f.roomId == null ? null : roomIds.get(f.roomId);
    if (roomId === undefined) throw new HttpError(400, 'a bed belongs to a room that is not on the map');
    const at = f.x === undefined ? { x: 0, y: 0, w: 1, h: 1 } : box(f, 'bed size');
    return {
      id: keep(oldFrames, f.id), kind: f.kind, roomId, ...at,
      beds: beds.map((b, level) => {
        const label = typeof b.label === 'string' ? b.label.trim() : '';
        if (!label || label.length > 10) throw new HttpError(400, 'every bed needs a number (up to 10 characters)');
        // Numbers start from 1 in every room: unique within the room.
        const key = `${roomId || ''}\n${label.toLowerCase()}`;
        if (labels.has(key)) throw new HttpError(400, `bed number ${label} is used twice in one room`);
        labels.add(key);
        return { id: keep(oldBeds, b.id), level, label };
      }),
    };
  });

  const frameIds = JSON.stringify(cleanFrames.map(f => f.id));
  const bedIds = JSON.stringify(cleanFrames.flatMap(f => f.beds.map(b => b.id)));
  const roomIdList = JSON.stringify(cleanRooms.map(r => r.id));
  const stmts = [
    db.prepare('DELETE FROM rooms WHERE property_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(propertyId, roomIdList),
    db.prepare('DELETE FROM beds WHERE property_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(propertyId, bedIds),
    db.prepare('DELETE FROM bed_frames WHERE property_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(propertyId, frameIds),
    // Upsert, so a room keeps what else hangs on it (its Channex room type).
    // The order of the list is the rooms' order (Settings → Property, drag and drop).
    ...cleanRooms.map((r, position) => db.prepare(
      `INSERT INTO rooms (id, property_id, name, kind, x, y, w, h, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
         position = excluded.position`,
    ).bind(r.id, propertyId, r.name, r.kind, r.x, r.y, r.w, r.h, position)),
  ];
  for (const f of cleanFrames) {
    // Upsert, not INSERT OR REPLACE: a replace would cascade-delete the beds and their history.
    stmts.push(db.prepare(
      `INSERT INTO bed_frames (id, property_id, kind, x, y, w, h, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
         room_id = excluded.room_id`,
    ).bind(f.id, propertyId, f.kind, f.x, f.y, f.w, f.h, f.roomId));
    for (const b of f.beds) {
      stmts.push(db.prepare(
        `INSERT INTO beds (id, property_id, frame_id, level, label) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET frame_id = excluded.frame_id, level = excluded.level, label = excluded.label`,
      ).bind(b.id, propertyId, f.id, b.level, b.label));
    }
  }
  await db.batch(stmts);
  return getHousekeeping(env, request, propertyId);
}

// ===== Bed actions (whole team) =====

// A day typed by hand (YYYY-MM-DD) as a time: its noon, never in the future.
function dayAt(day, now) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? Date.parse(`${day}T12:00:00Z`) : NaN;
  if (Number.isNaN(at) || at > now + DAY / 2 || at < Date.UTC(2020, 0, 1)) throw new HttpError(400, 'that date is not possible');
  return at;
}

// Body: { sheets?: 'clean' | 'dirty' | 'in_use', sheetsDay?: day (when the sheets got their state,
// to correct it by hand), changed?: [item keys], set?: { key: day | null } }
export async function bedAction(env, request, propertyId, bedId) {
  const { user, property } = await context(env, request, propertyId, null, true);
  const bed = await env.DB.prepare('SELECT id, sheets, sheets_at, in_use_ms FROM beds WHERE id = ? AND property_id = ?').bind(bedId, propertyId).first();
  if (!bed) throw new HttpError(404, 'bed not found');
  const body = await readJson(request);
  const now = Date.now();
  const stmts = [];
  // Sheets leaving In use at a time: that stretch is added to the bed's In use total.
  const leftInUse = (state, at) => (bed.sheets === 'in_use' && state !== 'in_use' && bed.sheets_at ? Math.max(0, at - bed.sheets_at) : 0);
  const sheetsUpdate = (state, at) => env.DB.prepare('UPDATE beds SET sheets = ?, sheets_at = ?, sheets_by = ?, in_use_ms = in_use_ms + ? WHERE id = ? AND property_id = ?')
    .bind(state, at, user.id, leftInUse(state, at), bedId, propertyId);
  // Phones still on the old version send the Clean / Dirty switch's checkout / made
  // (made also comes with "Everything changed"): only where sheets are tracked.
  const legacy = !sheetsOf(property).track ? undefined : body.checkout ? 'dirty' : body.made ? 'clean' : undefined;
  const sheets = body.sheets !== undefined ? body.sheets : legacy;
  if (sheets !== undefined) {
    if (!SHEETS.includes(sheets)) throw new HttpError(400, 'unknown sheets state');
    if (!sheetsOf(property).track) throw new HttpError(400, 'daily sheets are not tracked here — turn it on in Settings → Housekeeping');
    // The date is when the sheets got this state: tapping the same state again keeps it,
    // so "in use" keeps counting the days of the same sheets.
    if (sheets !== bed.sheets && body.sheetsDay === undefined) stmts.push(sheetsUpdate(sheets, now));
  }
  // The day of the sheets' state, corrected by hand (with a new state, or for the one there is).
  if (body.sheetsDay !== undefined) {
    const state = sheets !== undefined ? sheets : bed.sheets;
    if (!sheetsOf(property).track) throw new HttpError(400, 'daily sheets are not tracked here — turn it on in Settings → Housekeeping');
    if (!state) throw new HttpError(400, 'unknown sheets state');
    stmts.push(sheetsUpdate(state, dayAt(body.sheetsDay, now)));
  }
  if (body.changed !== undefined) {
    const keys = new Set(linenOf(property).map(i => i.key));
    if (!Array.isArray(body.changed) || !body.changed.length || !body.changed.every(k => keys.has(k))) {
      throw new HttpError(400, 'unknown linen item');
    }
    // The bed's In use total now (before any change of sheets in this same tap).
    const base = inUseTotal(bed, now);
    for (const k of body.changed) {
      stmts.push(env.DB.prepare(
        `INSERT INTO bed_linen (bed_id, item, changed_at, changed_by, in_use_base) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (bed_id, item) DO UPDATE SET changed_at = excluded.changed_at, changed_by = excluded.changed_by, in_use_base = excluded.in_use_base`,
      ).bind(bedId, k, now, user.id, base));
    }
  }
  // Edit: when each item was really changed last ({ key: 'YYYY-MM-DD' | null }),
  // e.g. after a busy day nobody ticked. null forgets the record.
  if (body.set !== undefined) {
    const keys = new Set(linenOf(property).map(i => i.key));
    if (!body.set || typeof body.set !== 'object' || Array.isArray(body.set)) throw new HttpError(400, 'unknown linen item');
    for (const [k, day] of Object.entries(body.set)) {
      if (!keys.has(k)) throw new HttpError(400, 'unknown linen item');
      if (day === null) {
        stmts.push(env.DB.prepare('DELETE FROM bed_linen WHERE bed_id = ? AND item = ?').bind(bedId, k));
        continue;
      }
      // A day typed by hand: how long the bed was In use since then isn't known,
      // so all of it counts — a date a month back is a month old (Bob, 26. 10.:
      // only the In use time HostelFlow had seen left it green). From now on
      // only the In use days are added, as after a tick.
      const at = dayAt(day, now);
      stmts.push(env.DB.prepare(
        `INSERT INTO bed_linen (bed_id, item, changed_at, changed_by, in_use_base) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (bed_id, item) DO UPDATE SET changed_at = excluded.changed_at, changed_by = excluded.changed_by, in_use_base = excluded.in_use_base`,
      ).bind(bedId, k, at, user.id, inUseTotal(bed, now) - (now - at)));
    }
  }
  if (!stmts.length && sheets === undefined) throw new HttpError(400, 'nothing to do');
  if (stmts.length) await env.DB.batch(stmts);
  return getHousekeeping(env, request, propertyId);
}
