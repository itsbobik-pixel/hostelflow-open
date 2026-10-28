// Channel manager (HostelOne): Channex (https://channex.io) connects us to
// Booking.com, Hostelworld, Airbnb, Expedia… One HostelFlow account at
// Channex (the CHANNEX_API_KEY secret) holds every connected property.
//
// Connecting a property creates, at Channex: the property, one room type per
// room (a room with 3+ beds is sold as a dorm, by the bed) with one rate plan,
// and a webhook. Bookings then come back in through the booking revisions
// feed — on the webhook, on "Sync now" and every hour — and land in the
// Calendar. Each revision is acknowledged so Channex doesn't send it again.
// Env: CHANNEX_API_KEY (secret), CHANNEX_URL (var; default: staging).

import { HttpError, json } from './http.js';
import { requireUser, requireRole, b64url, sha256Hex } from './auth.js';
import { requireHostelOne } from './billing.js';

const STAGING = 'https://staging.channex.io';
// A first price per night, so the rate plans are valid; the owner sets real
// prices in Channex (later from HostelFlow).
const START_RATE = { dorm: '25.00', room: '70.00' };

export const channexEnabled = env => !!env.CHANNEX_API_KEY;

async function cx(env, method, path, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${env.CHANNEX_URL || STAGING}/api/v1${path}`, {
    method,
    headers: { 'user-api-key': env.CHANNEX_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.errors || {};
    const detail = e.details ? ` (${JSON.stringify(e.details).slice(0, 200)})` : '';
    throw new HttpError(502, `Channex: ${e.title || res.status}${detail}`);
  }
  return data;
}

async function ownerContext(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requireRole(env.DB, user.id, propertyId, ['owner']);
  await requireHostelOne(env, propertyId);
  if (!channexEnabled(env)) throw new HttpError(503, 'the channel manager is not set up yet');
  return user;
}

// Rooms with their number of beds, and of people (a double bed sleeps two).
// Rooms without beds aren't sold.
async function roomsWithBeds(db, propertyId) {
  const { results } = await db.prepare(
    `SELECT r.id, r.name, r.channex_room_type_id, r.channex_rate_plan_id, COUNT(b.id) AS beds,
       SUM(CASE WHEN b.id IS NULL THEN 0 WHEN f.kind = 'double' THEN 2 ELSE 1 END) AS people
     FROM rooms r LEFT JOIN bed_frames f ON f.room_id = r.id LEFT JOIN beds b ON b.frame_id = f.id
     WHERE r.property_id = ? AND r.kind = 'room' GROUP BY r.id ORDER BY r.name`,
  ).bind(propertyId).all();
  return results.filter(r => r.beds > 0);
}

export const isDorm = beds => beds >= 3;

export async function channexStatus(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requireRole(env.DB, user.id, propertyId, ['owner']);
  const p = await env.DB.prepare('SELECT channex_property_id, channex_last_sync, channex_last_error FROM properties WHERE id = ?')
    .bind(propertyId).first();
  const rooms = await roomsWithBeds(env.DB, propertyId);
  return json({
    available: channexEnabled(env),
    connected: !!p.channex_property_id,
    channexPropertyId: p.channex_property_id,
    appUrl: `${env.CHANNEX_URL || STAGING}`,
    staging: isStaging(env),
    lastSync: p.channex_last_sync,
    lastError: p.channex_last_error,
    rooms: rooms.map(r => ({ id: r.id, name: r.name, beds: r.beds, people: r.people, dorm: isDorm(r.beds), connected: !!r.channex_room_type_id })),
  });
}

// Creates what's missing at Channex (safe to press again: new rooms get added).
export async function connectChannex(env, request, propertyId, fetchImpl = fetch) {
  await ownerContext(env, request, propertyId);
  const db = env.DB;
  const p = await db.prepare('SELECT id, name, country, timezone, channex_property_id FROM properties WHERE id = ?').bind(propertyId).first();
  const rooms = await roomsWithBeds(db, propertyId);
  if (!rooms.length) throw new HttpError(400, 'add your rooms and their beds first (Settings → Property)');
  let cpid = p.channex_property_id;
  if (!cpid) {
    const r = await cx(env, 'POST', '/properties', {
      property: { title: p.name, currency: 'EUR', property_type: 'hotel', country: p.country || 'IT', timezone: p.timezone || 'Europe/Rome' },
    }, fetchImpl);
    cpid = r.data.id;
    // The webhook: Channex tells us a booking arrived; we then read the feed.
    const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
    await cx(env, 'POST', '/webhooks', {
      webhook: {
        property_id: cpid, callback_url: `${new URL(request.url).origin}/api/channex/webhook/${token}`,
        event_mask: 'booking', is_active: true, send_data: false,
      },
    }, fetchImpl);
    await db.prepare('UPDATE properties SET channex_property_id = ?, channex_hook_hash = ? WHERE id = ?')
      .bind(cpid, await sha256Hex(token), propertyId).run();
  }
  for (const room of rooms) {
    if (room.channex_room_type_id) continue;
    const dorm = isDorm(room.beds);
    const rt = await cx(env, 'POST', '/room_types', {
      room_type: {
        property_id: cpid, title: room.name, count_of_rooms: 1,
        occ_adults: dorm ? 1 : room.people, occ_children: 0, occ_infants: 0,
        room_kind: dorm ? 'dorm' : 'room', ...(dorm ? { capacity: room.beds } : {}),
      },
    }, fetchImpl);
    const rp = await cx(env, 'POST', '/rate_plans', {
      rate_plan: {
        property_id: cpid, room_type_id: rt.data.id, title: dorm ? 'Bed' : 'Room', currency: 'EUR',
        sell_mode: dorm ? 'per_person' : 'per_room', rate_mode: 'manual',
        options: [{ occupancy: dorm ? 1 : room.people, is_primary: true, rate: dorm ? START_RATE.dorm : START_RATE.room }],
      },
    }, fetchImpl);
    await db.prepare('UPDATE rooms SET channex_room_type_id = ?, channex_rate_plan_id = ? WHERE id = ?')
      .bind(rt.data.id, rp.data.id, room.id).run();
  }
  await pullBookings(env, propertyId, fetchImpl);
  await pushAvailability(env, propertyId, fetchImpl);
  return channexStatus(env, request, propertyId);
}

// Staging only: a made-up booking for tomorrow, one night, in the first
// connected room, created at Channex as a channel would — to see the whole
// way (Channex → webhook → Calendar) without a Booking.com test hotel.
export const isStaging = env => !env.CHANNEX_URL || env.CHANNEX_URL === STAGING;
export async function testBooking(env, request, propertyId, fetchImpl = fetch) {
  await ownerContext(env, request, propertyId);
  if (!isStaging(env)) throw new HttpError(403, 'test bookings only work on the Channex test system');
  const p = await env.DB.prepare('SELECT channex_property_id FROM properties WHERE id = ?').bind(propertyId).first();
  const room = (await roomsWithBeds(env.DB, propertyId)).find(r => r.channex_room_type_id && r.channex_rate_plan_id);
  if (!p.channex_property_id || !room) throw new HttpError(400, 'connect to Channex first');
  const day = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  await cx(env, 'POST', '/bookings', {
    booking: {
      property_id: p.channex_property_id, ota_name: 'Offline', ota_reservation_code: `HF-TEST-${Date.now().toString(36).toUpperCase()}`,
      arrival_date: day(1), departure_date: day(2), currency: 'EUR', payment_collect: 'property', payment_type: 'bank_transfer',
      customer: { name: 'Test', surname: 'Guest', country: 'IT' },
      notes: 'Test booking from HostelFlow',
      rooms: [{
        room_type_id: room.channex_room_type_id, rate_plan_id: room.channex_rate_plan_id,
        days: { [day(1)]: isDorm(room.beds) ? START_RATE.dorm : START_RATE.room },
        occupancy: { adults: 1, children: 0, infants: 0, ages: [] },
      }],
    },
  }, fetchImpl);
  // Channex files the booking a moment later (reading at once can miss it);
  // if it's not in yet, the webhook brings it.
  await new Promise(done => setTimeout(done, env.CHANNEX_SETTLE_MS ?? 2000));
  const r = await pullBookings(env, propertyId, fetchImpl);
  return json({ ok: true, arrival: day(1), room: room.name, received: r.count });
}

// ===== Availability: how many beds (dorm) or rooms (private) are free =====

const AHEAD_DAYS = 365;
const addDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Free places per room and night, for `days` nights from `from` (YYYY-MM-DD).
// rooms: [{ id, beds, roomTypeId }]; reservations: [{ roomId, kind, guests, arrival, departure }].
// A dorm sells its beds one by one: free = beds − guests staying (a booking
// without a number counts as one). A private room is free or not. Closed
// dates (blocks) close the room. The result is in ranges, as Channex takes them.
export function freePlaces(rooms, reservations, from, days) {
  const values = [];
  for (const room of rooms) {
    const dorm = isDorm(room.beds);
    const total = dorm ? room.beds : 1;
    const taken = new Array(days).fill(0);
    for (const r of reservations) {
      if (r.roomId !== room.id) continue;
      for (let d = 0; d < days; d++) {
        const night = addDay(from, d);
        if (r.arrival <= night && night < r.departure) taken[d] += r.kind === 'block' ? total : dorm ? (r.guests || 1) : total;
      }
    }
    let start = 0;
    for (let d = 1; d <= days; d++) {
      const free = i => Math.max(0, total - taken[i]);
      if (d === days || free(d) !== free(start)) {
        values.push({ room_type_id: room.roomTypeId, date_from: addDay(from, start), date_to: addDay(from, d - 1), availability: free(start) });
        start = d;
      }
    }
  }
  return values;
}

// Today in the property's time zone.
function localToday(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Sends the next year's availability of every connected room to Channex
// (which passes it on to Booking.com, Hostelworld…). Called after every
// change to the reservations, and hourly. Never throws: a failure is noted
// on the property (shown in Settings) and the next push repairs it.
export async function pushAvailability(env, propertyId, fetchImpl = fetch) {
  const db = env.DB;
  if (!channexEnabled(env)) return { ok: true, sent: 0 };
  const p = await db.prepare('SELECT channex_property_id, timezone FROM properties WHERE id = ?').bind(propertyId).first();
  if (!p || !p.channex_property_id) return { ok: true, sent: 0 };
  try {
    const rooms = (await roomsWithBeds(db, propertyId)).filter(r => r.channex_room_type_id)
      .map(r => ({ id: r.id, beds: r.beds, roomTypeId: r.channex_room_type_id }));
    if (!rooms.length) return { ok: true, sent: 0 };
    const from = localToday(p.timezone);
    const to = addDay(from, AHEAD_DAYS);
    const { results } = await db.prepare(
      'SELECT room_id, kind, guests, arrival, departure FROM reservations WHERE property_id = ? AND departure > ? AND arrival < ?',
    ).bind(propertyId, from, to).all();
    const values = freePlaces(rooms, results.map(r => ({ roomId: r.room_id, kind: r.kind, guests: r.guests, arrival: r.arrival, departure: r.departure })), from, AHEAD_DAYS)
      .map(v => ({ property_id: p.channex_property_id, ...v }));
    await cx(env, 'POST', '/availability', { values }, fetchImpl);
    return { ok: true, sent: values.length };
  } catch (err) {
    await db.prepare('UPDATE properties SET channex_last_error = ? WHERE id = ?').bind(String(err.message).slice(0, 300), propertyId).run();
    return { ok: false, error: err.message };
  }
}

// Booking.com → "booking", like the iCal sources.
export function sourceOfOta(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('booking')) return 'booking';
  if (n.includes('airbnb')) return 'airbnb';
  if (n.includes('hostelworld')) return 'hostelworld';
  if (n.includes('expedia') || n.includes('vrbo')) return 'expedia';
  return 'other';
}

// One revision → our reservations (one per booked room). Our own details
// (status, arrival time, our note) survive a modification.
export async function applyRevision(db, propertyId, rev) {
  const a = rev.attributes || rev;
  const bookingId = a.booking_id;
  const { results: old } = await db.prepare('SELECT id, channex_key FROM reservations WHERE property_id = ? AND channex_key LIKE ?')
    .bind(propertyId, `${bookingId}:%`).all();
  if (a.status === 'cancelled') {
    if (old.length) await db.prepare('DELETE FROM reservations WHERE property_id = ? AND channex_key LIKE ?').bind(propertyId, `${bookingId}:%`).run();
    return;
  }
  const { results: rooms } = await db.prepare('SELECT id, channex_room_type_id FROM rooms WHERE property_id = ? AND channex_room_type_id IS NOT NULL')
    .bind(propertyId).all();
  const roomOf = new Map(rooms.map(r => [r.channex_room_type_id, r.id]));
  const c = a.customer || {};
  const guest = [c.name, c.surname].filter(Boolean).join(' ').trim() || null;
  const nationality = typeof c.country === 'string' && /^[A-Z]{2}$/.test(c.country) ? c.country : null;
  const now = Date.now();
  const keep = new Set();
  const stmts = [];
  (a.rooms || []).forEach((r, i) => {
    const key = `${bookingId}:${i}`;
    keep.add(key);
    const occ = r.occupancy || {};
    const guests = (occ.adults || 0) + (occ.children || 0) || null;
    const arrival = r.checkin_date || a.arrival_date;
    const departure = r.checkout_date || a.departure_date;
    stmts.push(db.prepare(
      `INSERT INTO reservations (id, property_id, source, kind, guest, arrival, departure, guests, room_id, code, note, nationality, channex_key, created_at, updated_at)
       VALUES (?, ?, ?, 'booking', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channex_key) WHERE channex_key IS NOT NULL DO UPDATE SET
         guest = excluded.guest, arrival = excluded.arrival, departure = excluded.departure, guests = excluded.guests,
         room_id = excluded.room_id, code = excluded.code, note = COALESCE(reservations.note, excluded.note),
         nationality = COALESCE(reservations.nationality, excluded.nationality), updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), propertyId, sourceOfOta(a.ota_name), guest, arrival, departure, guests,
      roomOf.get(r.room_type_id) || null, a.ota_reservation_code || null, a.notes ? String(a.notes).slice(0, 500) : null,
      nationality, key, now, now));
  });
  // Rooms dropped from a modified booking.
  for (const o of old) if (!keep.has(o.channex_key)) stmts.push(db.prepare('DELETE FROM reservations WHERE id = ?').bind(o.id));
  if (stmts.length) await db.batch(stmts);
}

// Reads every unacknowledged revision of the property and acknowledges it.
export async function pullBookings(env, propertyId, fetchImpl = fetch) {
  const db = env.DB;
  const p = await db.prepare('SELECT channex_property_id FROM properties WHERE id = ?').bind(propertyId).first();
  if (!p || !p.channex_property_id || !channexEnabled(env)) return { ok: true, count: 0 };
  let count = 0;
  try {
    for (let page = 0; page < 20; page++) {
      const feed = await cx(env, 'GET', `/booking_revisions/feed?filter[property_id]=${p.channex_property_id}&order[inserted_at]=asc`, null, fetchImpl);
      const revs = feed.data || [];
      if (!revs.length) break;
      for (const rev of revs) {
        await applyRevision(db, propertyId, rev);
        await cx(env, 'POST', `/booking_revisions/${rev.id}/ack`, null, fetchImpl);
        count++;
      }
    }
    await db.prepare('UPDATE properties SET channex_last_sync = ?, channex_last_error = NULL WHERE id = ?').bind(Date.now(), propertyId).run();
    // A booking on one channel closes the place on the others.
    if (count) await pushAvailability(env, propertyId, fetchImpl);
    return { ok: true, count };
  } catch (err) {
    await db.prepare('UPDATE properties SET channex_last_error = ? WHERE id = ?').bind(String(err.message).slice(0, 300), propertyId).run();
    return { ok: false, count, error: err.message };
  }
}

// Channex → us: "something happened to a booking". The token in the path
// says which property; the booking itself we fetch ourselves.
export async function channexWebhook(env, token, ctx, fetchImpl = fetch) {
  if (!token) throw new HttpError(404, 'not found');
  const p = await env.DB.prepare('SELECT id FROM properties WHERE channex_hook_hash = ?').bind(await sha256Hex(token)).first();
  if (!p) throw new HttpError(404, 'not found');
  const work = pullBookings(env, p.id, fetchImpl);
  if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  return json({ ok: true });
}

// Hourly: bookings in case a webhook got lost, and the whole year of availability.
export async function pullAllChannex(env) {
  if (!channexEnabled(env)) return;
  const { results } = await env.DB.prepare('SELECT id FROM properties WHERE channex_property_id IS NOT NULL').all();
  for (const p of results) {
    await pullBookings(env, p.id);
    await pushAvailability(env, p.id);
  }
}
