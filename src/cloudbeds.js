// Settings → Integrations → Cloudbeds: a property that keeps its bookings in
// Cloudbeds pastes its own API key (Cloudbeds → Settings → API credentials),
// and HostelFlow reads its reservations — read only, nothing is ever written
// back. Switched on for now: the nights at check-in, taken from the guest's
// booking (arriving that day or the day before) when the scanned name finds
// exactly one.
//
// Booking data is only looked at, never stored: the day's arrivals stay a few
// minutes in this Worker's memory (a family scanned one after the other asks
// Cloudbeds once), as names reduced to matching tokens and the stay's dates.

import { HttpError, json, readJson } from './http.js';
import { requireUser, requireRole } from './auth.js';
import { encryptCredentials, decryptCredentials } from './secrets.js';

const API = 'https://api.cloudbeds.com/api/v1.2';
const CACHE_MS = 5 * 60 * 1000;
const WAIT_MS = 4000; // after the document is read (the bookings are asked for alongside)
// Asked again from Check-in when that was too short: the scan is already on
// screen, so waiting longer holds nobody up (Cloudbeds can take 10 s and more).
export const RETRY_WAIT_MS = 25000;
const MAX_NIGHTS = 30; // what the police (and HostelFlow) take

// The key is sealed to the property and to Cloudbeds, so it can't be moved
// onto another property's row or mistaken for the police login.
const aad = propertyId => `cloudbeds:${propertyId}`;

async function cb(env, apiKey, method, params = {}) {
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    // A call that hangs would be kept (and waited on) for the whole cache time.
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(RETRY_WAIT_MS + 5000) });
  } catch {
    throw new HttpError(502, 'Cloudbeds could not be reached — try again in a moment');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Cloudbeds did not accept this API key');
  if (!res.ok || data.success === false) throw new HttpError(502, `Cloudbeds: ${String(data.message || res.status).slice(0, 120)}`);
  return data;
}

async function ownerContext(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requireRole(env.DB, user.id, propertyId, ['owner']);
  return user;
}

async function status(db, propertyId) {
  const p = await db.prepare(
    'SELECT cloudbeds_credentials, cloudbeds_property_name, cloudbeds_nights, cloudbeds_last_error FROM properties WHERE id = ?',
  ).bind(propertyId).first();
  return {
    connected: !!p.cloudbeds_credentials,
    propertyName: p.cloudbeds_property_name,
    nights: !!p.cloudbeds_nights,
    lastError: p.cloudbeds_last_error,
  };
}

export async function cloudbedsStatus(env, request, propertyId) {
  await ownerContext(env, request, propertyId);
  return json(await status(env.DB, propertyId));
}

// Body: { apiKey?, nights? }. A new key is tried first (which Cloudbeds
// property it opens); a key Cloudbeds turns down is never saved.
export async function saveCloudbeds(env, request, propertyId) {
  await ownerContext(env, request, propertyId);
  const body = await readJson(request);
  const db = env.DB;
  if (body.apiKey !== undefined) {
    const apiKey = String(body.apiKey || '').trim();
    if (!apiKey || apiKey.length > 200) throw new HttpError(400, 'Paste the API key from Cloudbeds');
    const hotels = (await cb(env, apiKey, 'getHotels')).data || [];
    const hotel = hotels[0];
    if (!hotel || !hotel.propertyID) throw new HttpError(400, 'This API key has no access to any Cloudbeds property');
    const sealed = await encryptCredentials(env, aad(propertyId), { apiKey });
    // Connecting switches the nights on: it's what connecting is for.
    await db.prepare(
      `UPDATE properties SET cloudbeds_credentials = ?, cloudbeds_property_id = ?, cloudbeds_property_name = ?,
         cloudbeds_nights = 1, cloudbeds_last_error = NULL WHERE id = ?`,
    ).bind(sealed, String(hotel.propertyID), String(hotel.propertyName || '').slice(0, 100) || null, propertyId).run();
  }
  if (body.nights !== undefined) {
    await db.prepare('UPDATE properties SET cloudbeds_nights = ? WHERE id = ?').bind(body.nights ? 1 : 0, propertyId).run();
  }
  return json(await status(db, propertyId));
}

// Disconnect: the key is deleted.
export async function deleteCloudbeds(env, request, propertyId) {
  await ownerContext(env, request, propertyId);
  await env.DB.prepare(
    `UPDATE properties SET cloudbeds_credentials = NULL, cloudbeds_property_id = NULL, cloudbeds_property_name = NULL,
       cloudbeds_nights = 0, cloudbeds_last_error = NULL WHERE id = ?`,
  ).bind(propertyId).run();
  return json(await status(env.DB, propertyId));
}

// ===== Nights at check-in =====

// Little words inside names ("Silva dos Santos", "van der Berg"): in many
// names, so they'd tie the guest to strangers.
const PARTICLES = new Set(['DA', 'DAS', 'DE', 'DEL', 'DELLA', 'DEI', 'DER', 'DEN', 'DI', 'DO', 'DOS', 'DU', 'LA', 'LE', 'LOS', 'VAN', 'VON', 'AL', 'EL', 'BIN', 'BEN']);
// Upper-case letters only, accents dropped: "Müller-López" → ["MULLER", "LOPEZ"].
export function nameTokens(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[^A-Z]+/g, ' ').split(' ').filter(w => w.length >= 2 && !PARTICLES.has(w));
}

// One letter typed wrong, missing or extra ("Beateiz" for "Beatriz"), in
// names long enough for that not to make them someone else's.
function nearly(a, b) {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1;
}

const isoOf = ddmmyyyy => {
  const m = String(ddmmyyyy || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const dayBefore = day => new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);

// One reservation → a stay per guest (tokens of the name, from, to). A guest's
// own room dates win over the booking's (split stays, someone leaving early).
export function staysOf(reservations) {
  const stays = [];
  for (const r of reservations || []) {
    if (/cancel|no.?show/i.test(r.status || '')) continue;
    const booking = { from: String(r.startDate).slice(0, 10), to: String(r.endDate).slice(0, 10) };
    const guests = [];
    for (const g of Object.values(r.guestList || {})) {
      const rooms = [...(g.rooms || []), ...(g.unassignedRooms || [])].filter(x => x.roomCheckIn && x.roomCheckOut);
      const dates = rooms.length
        ? { from: rooms.map(x => x.roomCheckIn).sort()[0].slice(0, 10), to: rooms.map(x => x.roomCheckOut).sort().at(-1).slice(0, 10) }
        : booking;
      guests.push({ tokens: nameTokens(`${g.guestFirstName || ''} ${g.guestLastName || ''} ${g.guestName || ''}`), ...dates });
    }
    stays.push(...guests);
    // Whoever booked, in case they're not in the guest list. When they are,
    // a second entry of the same person with the booking's dates would only
    // contradict their own (a stay extended in Cloudbeds) and leave it empty.
    const booker = nameTokens(r.guestName);
    if (booker.length && !guests.some(g => booker.every(w => g.tokens.includes(w)))) stays.push({ tokens: booker, ...booking });
  }
  return stays.filter(s => s.tokens.length && !isNaN(Date.parse(s.from)) && !isNaN(Date.parse(s.to)));
}

// The nights only when the name points to one answer: the bookings sharing a
// surname with the guest, and of those the ones sharing the most of the name
// (long Portuguese or Spanish names share a word with other guests; a name
// typed with one wrong letter still counts, a little less). Anything unclear
// stays empty — staff pick the nights as before. Always the whole stay, also
// for someone who came yesterday and is registered today (Bob, 26. 10.).
export function matchNights(stays, fields) {
  const surname = nameTokens(fields.surname);
  if (!surname.length) return null;
  const given = nameTokens(fields.given);
  const nightsOf = s => daysBetween(s.from, s.to);
  stays = stays.filter(s => { const n = nightsOf(s); return Number.isInteger(n) && n >= 1 && n <= MAX_NIGHTS; });
  const exact = (s, w) => s.tokens.includes(w);
  const near = (s, w) => s.tokens.some(t => nearly(t, w));
  const score = s => [...surname, ...given].reduce((n, w) => n + (exact(s, w) ? 2 : near(s, w) ? 1 : 0), 0);
  // The surname as written, or nearly so when a given name is exact too.
  const candidates = stays.filter(s => surname.some(w => exact(s, w))
    || (surname.some(w => near(s, w)) && given.some(w => exact(s, w))));
  if (!candidates.length) return null;
  const best = Math.max(...candidates.map(score));
  const n = [...new Set(candidates.filter(s => score(s) === best).map(nightsOf))];
  return n.length === 1 ? n[0] : null;
}

const arrivals = new Map(); // `${propertyId}:${day}` → { at, stays: Promise }

// The stays of everyone arriving on that day (DD.MM.YYYY) or the day before
// (guests who came late and are registered the next morning), or null when the
// property doesn't use this. Started before the document is read, so it is
// ready by the time the name is.
export function arrivalsFor(env, property, arrival) {
  if (!property.cloudbeds_nights || !property.cloudbeds_credentials || !property.cloudbeds_property_id) return null;
  const day = isoOf(arrival);
  if (!day) return null;
  const key = `${property.id}:${day}`;
  const hit = arrivals.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stays;
  for (const [k, v] of arrivals) if (Date.now() - v.at >= CACHE_MS) arrivals.delete(k);
  const stays = (async () => {
    const { apiKey } = await decryptCredentials(env, aad(property.id), property.cloudbeds_credentials);
    const data = await cb(env, apiKey, 'getReservations', {
      propertyID: property.cloudbeds_property_id, checkInFrom: dayBefore(day), checkInTo: day,
      includeGuestsDetails: 'true', pageSize: '100',
    });
    return staysOf(data.data);
  })();
  arrivals.set(key, { at: Date.now(), stays });
  stays.catch(() => arrivals.delete(key));
  return stays;
}

// The nights for a freshly read guest, or null. Never fails the scan: a
// Cloudbeds problem is noted for Settings (no guest data in it) and the scan
// goes on without.
// `why` gets, when nothing is found, the reason and how many stays Cloudbeds
// gave (no names: kept with the guest, to see later why it was missed).
export async function nightsFromCloudbeds(env, property, pending, fields, why = {}, waitMs = WAIT_MS) {
  if (!pending) return null;
  try {
    // Never holds the scan up: Cloudbeds slower than this, and the nights stay
    // empty (Check-in then asks again, waiting longer: RETRY_WAIT_MS).
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs); });
    const stays = await Promise.race([pending, late]).finally(() => clearTimeout(timer));
    if (!stays) { why.reason = 'slow'; return null; }
    const nights = matchNights(stays, fields);
    if (!nights) {
      const surname = nameTokens(fields.surname);
      why.stays = stays.length;
      why.reason = !stays.length ? 'no bookings'
        : !stays.some(s => surname.some(w => s.tokens.some(t => t === w || nearly(t, w)))) ? 'no such name' : 'unclear';
    }
    if (property.cloudbeds_last_error) {
      await env.DB.prepare('UPDATE properties SET cloudbeds_last_error = NULL WHERE id = ?').bind(property.id).run();
    }
    return nights;
  } catch (err) {
    why.reason = 'error';
    console.error('cloudbeds lookup failed', err.message || err);
    await env.DB.prepare('UPDATE properties SET cloudbeds_last_error = ? WHERE id = ?')
      .bind(err instanceof HttpError ? err.message : 'Cloudbeds could not be reached — try again in a moment', property.id).run();
    return null;
  }
}

// Tests: a fresh memory.
export function forgetArrivals() { arrivals.clear(); }
