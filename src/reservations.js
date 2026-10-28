// HostelOne (beta): reservations.
//
// Free channel data comes from iCal: Booking.com, Airbnb and others give each
// listing an "export calendar" link. It carries the booked/closed dates (and
// for Airbnb a reservation code), but no guest names or prices — those need
// a channel manager later. Reservations can also be typed in by hand.

import { HttpError, json, readJson } from './http.js';
import { requireUser, requireRole, access } from './auth.js';
import { encryptCredentials, decryptCredentials } from './secrets.js';
import { requireHostelOne } from './billing.js';
import { pullBookings, pushAvailability } from './channex.js';

const DAY = 86400000;
const MAX_FEED_BYTES = 2_000_000;
const MAX_CALENDARS = 30;

// ===== iCal =====

// RFC 5545 just enough for booking feeds: unfolded lines, VEVENTs with
// UID / DTSTART / DTEND / SUMMARY / DESCRIPTION, dates as YYYY-MM-DD.
export function parseICS(text) {
  const lines = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase();
    const value = line.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    if (name === 'UID') ev.uid = value.trim();
    else if (name === 'DTSTART') ev.start = icsDate(value);
    else if (name === 'DTEND') ev.end = icsDate(value);
    else if (name === 'SUMMARY') ev.summary = value.trim();
    else if (name === 'DESCRIPTION') ev.description = value.trim();
  }
  return events.filter(e => e.start && e.end && e.end > e.start);
}

function icsDate(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function sourceOf(url) {
  const host = new URL(url).hostname;
  if (/(^|\.)booking\.com$/.test(host)) return 'booking';
  if (/(^|\.)airbnb\./.test(host)) return 'airbnb';
  if (/(^|\.)hostelworld\.com$/.test(host)) return 'hostelworld';
  if (/(^|\.)expedia|vrbo\./.test(host)) return 'expedia';
  return 'other';
}

// What an event is: Airbnb writes "Reserved" for bookings and "Airbnb (Not
// available)" for dates the host closed; Booking.com writes "CLOSED - Not
// available" for both, so its events count as bookings.
export function readEvent(ev, source) {
  const summary = ev.summary || '';
  const blocked = source === 'airbnb' && /not available/i.test(summary);
  const code = ((ev.description || '').match(/reservations\/details\/([A-Z0-9]+)/i) || [])[1]
    || ((ev.description || '').match(/\b(HM[A-Z0-9]{6,})\b/) || [])[1] || null;
  const generic = /^(reserved|closed - not available|not available|blocked|booked|airbnb \(not available\))$/i.test(summary);
  return {
    kind: blocked ? 'block' : 'booking',
    guest: generic || !summary ? null : summary.slice(0, 100),
    code,
  };
}

function checkFeedUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new HttpError(400, 'that is not a link'); }
  if (url.protocol !== 'https:') throw new HttpError(400, 'the calendar link must start with https://');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) throw new HttpError(400, 'that is not a public link');
  return url.toString();
}

async function fetchFeed(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { Accept: 'text/calendar' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`the channel answered ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('the calendar is too big');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('this link does not give a calendar (iCal)');
  return parseICS(text);
}

// Replaces this calendar's reservations with what the feed says now (a booking
// that disappeared was cancelled). Only the next ~18 months are kept.
export async function syncCalendar(env, cal, fetchImpl) {
  const db = env.DB;
  const now = Date.now();
  try {
    const { url } = await decryptCredentials(env, cal.property_id, cal.url_enc);
    const events = await fetchFeed(url, fetchImpl);
    const from = new Date(now - 60 * DAY).toISOString().slice(0, 10);
    const to = new Date(now + 550 * DAY).toISOString().slice(0, 10);
    const keep = events.filter(e => e.end >= from && e.start <= to && e.uid);
    const stmts = [db.prepare('DELETE FROM reservations WHERE calendar_id = ? AND uid NOT IN (SELECT value FROM json_each(?))')
      .bind(cal.id, JSON.stringify(keep.map(e => e.uid)))];
    for (const e of keep) {
      const r = readEvent(e, cal.source);
      stmts.push(db.prepare(
        `INSERT INTO reservations (id, property_id, calendar_id, uid, source, kind, guest, arrival, departure, room_id, code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (calendar_id, uid) DO UPDATE SET kind = excluded.kind, guest = COALESCE(reservations.guest, excluded.guest),
           arrival = excluded.arrival, departure = excluded.departure, room_id = COALESCE(reservations.room_id, excluded.room_id),
           code = excluded.code, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), cal.property_id, cal.id, e.uid, cal.source, r.kind, r.guest, e.start, e.end, cal.room_id, r.code, now, now));
    }
    stmts.push(db.prepare('UPDATE calendars SET last_sync = ?, last_error = NULL WHERE id = ?').bind(now, cal.id));
    await db.batch(stmts);
    // Dates booked through an iCal-only channel close the place at Channex too.
    await pushAvailability(env, cal.property_id, fetchImpl);
    return { ok: true, count: keep.length };
  } catch (err) {
    const message = String(err && err.message || err).slice(0, 200);
    await db.prepare('UPDATE calendars SET last_sync = ?, last_error = ? WHERE id = ?').bind(now, message, cal.id).run();
    return { ok: false, error: message };
  }
}

// Hourly, from the cron: every calendar of every property.
export async function syncAllCalendars(env) {
  const { results } = await env.DB.prepare('SELECT * FROM calendars ORDER BY last_sync LIMIT 200').all();
  for (const cal of results) await syncCalendar(env, cal);
}

// ===== API =====

// Every calendar route is HostelOne (or the trial / a free property).
// roles: ['owner'] for the channel calendars; else Settings → Team decides
// (the Calendar: looking is 'read', adding and changing reservations 'edit').
async function context(env, request, propertyId, roles = null, edit = true) {
  const user = await requireUser(env.DB, request);
  let role;
  if (roles) role = await requireRole(env.DB, user.id, propertyId, roles);
  else {
    const a = await access(env.DB, user.id, propertyId);
    if (!(edit ? a.can : a.sees).has('calendar')) throw new HttpError(403, "you don't have permission for this — ask the owner");
    role = a.role;
  }
  await requireHostelOne(env, propertyId);
  return { user, role };
}

function calendarView(c) {
  return { id: c.id, name: c.name, source: c.source, roomId: c.room_id, lastSync: c.last_sync, lastError: c.last_error };
}

export async function listCalendars(env, request, propertyId) {
  await context(env, request, propertyId, ['owner']);
  const { results } = await env.DB.prepare('SELECT * FROM calendars WHERE property_id = ? ORDER BY created_at').bind(propertyId).all();
  return json(results.map(calendarView));
}

// Body: { name, url, roomId? } — checked by syncing it right away.
export async function addCalendar(env, request, propertyId, fetchImpl) {
  await context(env, request, propertyId, ['owner']);
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) throw new HttpError(400, 'give the calendar a name');
  const url = checkFeedUrl(body.url);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendars WHERE property_id = ?').bind(propertyId).first('n');
  if (count >= MAX_CALENDARS) throw new HttpError(400, `at most ${MAX_CALENDARS} calendars`);
  const roomId = typeof body.roomId === 'string' && body.roomId ? body.roomId : null;
  if (roomId && !(await env.DB.prepare('SELECT 1 FROM rooms WHERE id = ? AND property_id = ?').bind(roomId, propertyId).first())) {
    throw new HttpError(400, 'unknown room');
  }
  const cal = {
    id: crypto.randomUUID(), property_id: propertyId, name, source: sourceOf(url),
    url_enc: await encryptCredentials(env, propertyId, { url }), room_id: roomId,
  };
  await env.DB.prepare('INSERT INTO calendars (id, property_id, name, source, url_enc, room_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(cal.id, propertyId, name, cal.source, cal.url_enc, roomId, Date.now()).run();
  const sync = await syncCalendar(env, cal, fetchImpl);
  const row = await env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(cal.id).first();
  return json({ ...calendarView(row), sync }, 201);
}

export async function deleteCalendar(env, request, propertyId, calendarId) {
  await context(env, request, propertyId, ['owner']);
  const r = await env.DB.prepare('DELETE FROM calendars WHERE id = ? AND property_id = ?').bind(calendarId, propertyId).run();
  if (!r.meta.changes) throw new HttpError(404, 'calendar not found');
  return json({ ok: true });
}

export async function syncCalendars(env, request, propertyId, fetchImpl) {
  await context(env, request, propertyId);
  const { results } = await env.DB.prepare('SELECT * FROM calendars WHERE property_id = ?').bind(propertyId).all();
  const out = [];
  for (const cal of results) out.push({ id: cal.id, ...(await syncCalendar(env, cal, fetchImpl)) });
  // The channel manager too, if the property is connected.
  const p = await env.DB.prepare('SELECT channex_property_id FROM properties WHERE id = ?').bind(propertyId).first();
  if (p && p.channex_property_id) {
    const r = await pullBookings(env, propertyId, fetchImpl); // with new bookings it also sends the free places
    out.push({ id: 'channex', ...r });
    if (!r.count) await pushAvailability(env, propertyId, fetchImpl); // "Sync now" sends them anyway
  }
  return json(out);
}

function reservationView(r) {
  return {
    id: r.id, source: r.source, kind: r.kind, guest: r.guest, arrival: r.arrival, departure: r.departure,
    guests: r.guests, roomId: r.room_id, code: r.code, note: r.note, calendarId: r.calendar_id,
    status: r.status ? r.status.split(',') : [], arrivalTime: r.arrival_time, nationality: r.nationality,
    editable: !r.calendar_id && !r.channex_key, // dates of channel bookings change on the channel
  };
}

// The statuses of Costello's calendar (each has its colour in the page).
export const STATUSES = ['ok', 'checkin', 'unpaid', 'change', 'paid-noci', 'cancel', 'lower-bed', 'laundry'];

// Status (at most two), arrival time and nationality: on every reservation.
function cleanDetails(body) {
  const status = Array.isArray(body.status) ? [...new Set(body.status)] : [];
  if (status.length > 2 || !status.every(x => STATUSES.includes(x))) throw new HttpError(400, 'choose at most two statuses');
  const time = typeof body.arrivalTime === 'string' ? body.arrivalTime.trim().slice(0, 20) : '';
  const nat = typeof body.nationality === 'string' ? body.nationality.trim().toUpperCase().slice(0, 20) : '';
  return { status: status.join(',') || null, arrivalTime: time || null, nationality: nat || null };
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD — everything that overlaps those days.
export async function listReservations(env, request, propertyId) {
  await context(env, request, propertyId, null, false);
  const q = new URL(request.url).searchParams;
  const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const from = day(q.get('from')) || new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  const to = day(q.get('to')) || new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    'SELECT * FROM reservations WHERE property_id = ? AND departure > ? AND arrival <= ? ORDER BY arrival, guest LIMIT 2000',
  ).bind(propertyId, from, to).all();
  return json(results.map(reservationView));
}

function cleanReservation(body) {
  const guest = typeof body.guest === 'string' ? body.guest.trim().slice(0, 100) : '';
  if (!guest) throw new HttpError(400, 'guest name is required');
  const ok = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (!ok(body.arrival) || !ok(body.departure)) throw new HttpError(400, 'arrival and departure must be dates');
  if (body.departure <= body.arrival) throw new HttpError(400, 'departure must be after arrival');
  const guests = body.guests == null || body.guests === '' ? null : Number(body.guests);
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 99)) throw new HttpError(400, 'guests must be a number');
  return {
    guest, arrival: body.arrival, departure: body.departure, guests,
    roomId: typeof body.roomId === 'string' && body.roomId ? body.roomId : null,
    note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null,
  };
}

export async function addReservation(env, request, propertyId) {
  await context(env, request, propertyId);
  const body = await readJson(request);
  const r = cleanReservation(body);
  const d = cleanDetails(body);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO reservations (id, property_id, source, kind, guest, arrival, departure, guests, room_id, note,
       status, arrival_time, nationality, created_at, updated_at)
     VALUES (?, ?, 'manual', 'booking', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, propertyId, r.guest, r.arrival, r.departure, r.guests, r.roomId, r.note, d.status, d.arrivalTime, d.nationality, now, now).run();
  await pushAvailability(env, propertyId);
  return json(reservationView(await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()), 201);
}

async function findReservation(db, propertyId, id) {
  const r = await db.prepare('SELECT * FROM reservations WHERE id = ? AND property_id = ?').bind(id, propertyId).first();
  if (!r) throw new HttpError(404, 'reservation not found');
  return r;
}

async function manualReservation(db, propertyId, id) {
  const r = await findReservation(db, propertyId, id);
  if (r.calendar_id || r.channex_key) throw new HttpError(403, 'this one comes from a channel — change it there');
  return r;
}

// Typed-in bookings change completely. A channel's booking keeps its dates
// (they come from the channel) but takes a name, guests, room, note and the
// details — the feed has none of them, and a re-sync keeps them.
export async function updateReservation(env, request, propertyId, id) {
  await context(env, request, propertyId);
  const old = await findReservation(env.DB, propertyId, id);
  const body = await readJson(request);
  const fromChannel = old.calendar_id || old.channex_key;
  const r = cleanReservation(fromChannel ? { ...body, arrival: old.arrival, departure: old.departure } : body);
  const d = cleanDetails(body);
  await env.DB.prepare(
    `UPDATE reservations SET guest = ?, arrival = ?, departure = ?, guests = ?, room_id = ?, note = ?,
       status = ?, arrival_time = ?, nationality = ?, updated_at = ? WHERE id = ?`,
  ).bind(r.guest, r.arrival, r.departure, r.guests, r.roomId, r.note, d.status, d.arrivalTime, d.nationality, Date.now(), id).run();
  await pushAvailability(env, propertyId);
  return json(reservationView(await env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()));
}

export async function deleteReservation(env, request, propertyId, id) {
  await context(env, request, propertyId);
  await manualReservation(env.DB, propertyId, id);
  await env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(id).run();
  await pushAvailability(env, propertyId);
  return json({ ok: true });
}

// For the dashboard: today's arrivals and departures (bookings, not closed dates).
export async function todayMovements(db, propertyId, day) {
  const row = await db.prepare(
    `SELECT SUM(arrival = ?) AS arrivals, SUM(departure = ?) AS departures FROM reservations
     WHERE property_id = ? AND kind = 'booking' AND (arrival = ? OR departure = ?)`,
  ).bind(day, day, propertyId, day, day).first();
  return { arrivals: row.arrivals || 0, departures: row.departures || 0 };
}
