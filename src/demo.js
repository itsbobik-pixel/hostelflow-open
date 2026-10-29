// The demo: "Try the demo" on the sign-in page (Bob, 27. 10.). It makes a
// property of its own for each visitor, with made-up guests, rooms, notes,
// shifts and bookings, picked at random so no two look the same, and signs
// them in as its owner. Nothing in it leaves HostelFlow or costs money: the
// scan fills in a made-up guest instead of asking Claude, Send only checks the
// guests here (src/guests.js), and whatever would reach the outside world
// (police and Ross1000 logins, e-mails, Stripe, uploads, booking channels,
// Flowy) is refused (refuseInDemo). After DEMO_HOURS it is deleted with its
// people (pruneDemos, hourly). The admin centre leaves demos out.

import { HttpError, readJson } from './http.js';
import { createSession, readCookie, sha256Hex, SESSION_COOKIE } from './auth.js';
import { DEFAULT_SHIFT_TYPES } from './shifts.js';

export const DEMO_HOURS = 24;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const MAX_DEMOS = 300;      // alive at once: plenty for visitors, a lid on scripts
const MAX_PER_IP = 5;       // per 15 minutes (the login_attempts window)
const DEMO_DOMAIN = '@demo.hostelflow.invalid';

// ===== Made-up people =====

const pick = list => list[Math.floor(Math.random() * list.length)];
const shuffle = list => list.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// [given, surname, sex, nationality] — Alloggiati knows these country codes.
const GUESTS = [
  ['Lena', 'Schmidt', 'F', 'DEU'], ['Jonas', 'Weber', 'M', 'DEU'], ['Chloé', 'Martin', 'F', 'FRA'],
  ['Hugo', 'Bernard', 'M', 'FRA'], ['Emily', 'Carter', 'F', 'USA'], ['Jake', 'Thompson', 'M', 'USA'],
  ['Sophie', 'Clarke', 'F', 'GBR'], ['Oliver', 'Hughes', 'M', 'GBR'], ['Lucía', 'García', 'F', 'ESP'],
  ['Pablo', 'Romero', 'M', 'ESP'], ['Emma', 'de Vries', 'F', 'NLD'], ['Daan', 'Bakker', 'M', 'NLD'],
  ['Tereza', 'Novotná', 'F', 'CZE'], ['Matěj', 'Dvořák', 'M', 'CZE'], ['Mia', 'Nowak', 'F', 'POL'],
  ['Kenji', 'Tanaka', 'M', 'JPN'], ['Ana', 'Silva', 'F', 'BRA'], ['Liam', 'Murphy', 'M', 'IRL'],
  ['Freya', 'Larsen', 'F', 'DNK'], ['Noah', 'Wilson', 'M', 'AUS'], ['Isla', 'Brown', 'F', 'CAN'],
  ['Mateo', 'Fernández', 'M', 'ARG'], ['Elsa', 'Lindqvist', 'F', 'SWE'], ['Felix', 'Gruber', 'M', 'AUT'],
];

const TEAM = [['Giulia', '#e07856'], ['Marco', '#3a6fd4'], ['Sofia', '#17c4aa'], ['Luca', '#9a5ad4'], ['Chiara', '#d4537e'], ['Tom', '#4a9d5f']];

const HOSTELS = ['Casa Limone', 'Hostel Mare Blu', 'Ostello del Faro', 'The Sunny Bunk', 'Villa Gabbiano', 'Hostel Vicolo Verde'];

const NOTES = [
  ['laundry', 'The washing machine on the 2nd floor is fixed 🎉 Towels go in at 40°.'],
  ['broken', 'Shower in Dorm 2 is dripping again. Plumber comes Thursday morning.'],
  ['shopping', 'We are out of coffee pods and toilet paper. I\'ll go after my shift.'],
  ['guests', 'The group from Lyon asked for an early breakfast tomorrow (7:00).'],
  ['checkins', 'Late arrival tonight around 23:30 — leave the key in the box.'],
  ['payments', 'Bed 4 in Dorm 1 still has to pay the city tax (2 nights).'],
  ['other', 'Pizza night on Friday for the team 🍕 Who\'s in?'],
  ['guests', 'Someone left a blue charger in the common room — it\'s in the lost & found box.'],
  ['broken', 'Wi-Fi in the kitchen is slow, I restarted the router. Tell me if it happens again.'],
];

const REPLIES = ['On it 👍', 'Thanks!', 'I can do it tomorrow morning.', 'Done ✅'];

const ROUTINE = `7:00-9:30 Breakfast
Set up the breakfast table
- Fill the coffee machine
- Put out the bread and jam
10:00-13:00 Cleaning
Make the beds of today's check-outs
Clean the bathrooms
Empty the bins
15:00-21:00 Check-in
Scan the documents of the new guests
Send the guests to the police before midnight
22:00 Night
Lock the front door
Switch off the lights in the common room`;

// The house: rooms on the Housekeeping map with their beds.
const ROOMS = [
  { name: 'Dorm 1', x: 0, y: 0, w: 12, h: 10, frames: [['bunk', 1, 1], ['bunk', 6, 1], ['bunk', 1, 6]] },
  { name: 'Dorm 2', x: 12, y: 0, w: 12, h: 10, frames: [['bunk', 13, 1], ['bunk', 18, 1], ['single', 13, 6]] },
  { name: 'Double', x: 0, y: 10, w: 12, h: 8, frames: [['double', 1, 11]] },
  { name: 'Bathroom', kind: 'other', x: 12, y: 10, w: 6, h: 8, frames: [] },
];
const LEVELS = { single: 1, double: 1, bunk: 2 };
// What Housekeeping reminds to change now and then (Settings → Housekeeping).
const LINEN = [{ key: 'blanket', label: 'Blanket', days: 14 }, { key: 'pillow', label: 'Pillow cover', days: 7 }];

// ===== Dates (the property is in Italy) =====

const romeDay = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(t); // YYYY-MM-DD
const italian = day => day.split('-').reverse().join('.');                                    // DD.MM.YYYY
const plusDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// A made-up guest as the scan would read them (also for the demo's scans).
export function demoGuest(arrival) {
  const [given, surname, sex, nationality] = pick(GUESTS);
  const year = between(1965, 2004);
  return {
    surname, given, sex, nationality, country: nationality,
    dob: `${String(between(1, 28)).padStart(2, '0')}.${String(between(1, 12)).padStart(2, '0')}.${year}`,
    docType: 'passport', docNumber: `${String.fromCharCode(65 + between(0, 25), 65 + between(0, 25))}${between(1000000, 9999999)}`,
    expiry: `${String(between(1, 28)).padStart(2, '0')}.${String(between(1, 12)).padStart(2, '0')}.${between(2027, 2035)}`,
    arrival, nights: String(between(1, 4)),
  };
}

// ===== Starting a demo =====

export async function startDemo(env, request) {
  const db = env.DB;
  const now = Date.now();
  await readJson(request); // JSON only: another site's form can't start one for someone
  // Per visitor, in the failed-login counter's table: pruned with it (src/auth.js pruneAuth).
  const key = `demo:${request.headers.get('CF-Connecting-IP') || 'local'}`;
  const tries = await db.prepare('SELECT failures, window_start FROM login_attempts WHERE email = ?').bind(key).first();
  const fresh = !tries || now - tries.window_start >= 15 * 60000;
  if (!fresh && tries.failures >= MAX_PER_IP) throw new HttpError(429, 'too many demos at once — try again in a few minutes');
  const alive = await db.prepare('SELECT COUNT(*) AS n FROM properties WHERE demo_until > ?').bind(now).first();
  if (alive.n >= MAX_DEMOS) throw new HttpError(503, 'the demo is busy right now — try again later');
  await (fresh
    ? db.prepare('INSERT OR REPLACE INTO login_attempts (email, failures, window_start) VALUES (?, 1, ?)').bind(key, now)
    : db.prepare('UPDATE login_attempts SET failures = failures + 1 WHERE email = ?').bind(key)).run();

  const propertyId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO properties (id, name, created_at, registration, plan, billing_status, routine, shift_types, linen, sheets_track, sheets_days, demo_until)
                VALUES (?, ?, ?, 'it-alloggiati', 'flow', 'comp', ?, ?, ?, 1, 3, ?)`)
      .bind(propertyId, pick(HOSTELS), now, ROUTINE, JSON.stringify(DEFAULT_SHIFT_TYPES), JSON.stringify(LINEN), now + DEMO_HOURS * HOUR),
    db.prepare('INSERT INTO users (id, email, name, password_hash, email_confirmed_at, color, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)')
      .bind(ownerId, `demo-${ownerId}${DEMO_DOMAIN}`, 'Alex', now, '#caa53a', now),
    db.prepare("INSERT INTO memberships (user_id, property_id, role) VALUES (?, ?, 'owner')").bind(ownerId, propertyId),
  ]);
  await seed(db, propertyId, ownerId, now);
  await bump(db, 'started', now);
  const { cookie } = await createSession(db, ownerId, now);
  return { cookie, user: { id: ownerId, email: `demo-${ownerId}${DEMO_DOMAIN}`, name: 'Alex' } };
}

async function seed(db, propertyId, ownerId, now) {
  const today = romeDay(now);
  const s = [];
  const P = propertyId;

  // The team: profiles without e-mail (like Settings → Team → Add a person).
  const team = shuffle(TEAM).slice(0, 4).map(([name, color]) => ({ id: crypto.randomUUID(), name, color }));
  const levels = JSON.stringify({ checkin: 'edit', notes: 'edit', attention: 'read', guidelines: 'read', housekeeping: 'edit', shifts: 'read', calendar: 'edit', vault: 'read', police: 'read', team: 'read' });
  for (const p of team) {
    s.push(
      db.prepare('INSERT INTO users (id, email, name, password_hash, email_confirmed_at, profile_property, color, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
        .bind(p.id, `profile-${p.id}@profiles.hostelflow.invalid`, p.name, now, P, p.color, now),
      db.prepare("INSERT INTO memberships (user_id, property_id, role, permissions) VALUES (?, ?, 'staff', ?)").bind(p.id, P, levels),
    );
  }
  const people = [ownerId, ...team.map(p => p.id)];

  // Rooms and beds: some made up, some waiting for the cleaning.
  const roomIds = [];
  ROOMS.forEach((r, position) => {
    const roomId = crypto.randomUUID();
    if (r.kind !== 'other') roomIds.push(roomId);
    s.push(db.prepare('INSERT INTO rooms (id, property_id, name, kind, x, y, w, h, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(roomId, P, r.name, r.kind || 'room', r.x, r.y, r.w, r.h, position));
    let label = 1;
    for (const [kind, x, y] of r.frames) {
      const frameId = crypto.randomUUID();
      s.push(db.prepare('INSERT INTO bed_frames (id, property_id, kind, x, y, w, h, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(frameId, P, kind, x, y, 4, kind === 'double' ? 3 : 2, roomId));
      for (let level = 0; level < LEVELS[kind]; level++) {
        // The daily sheets: mostly in use, some made up, a few to strip.
        const bedId = crypto.randomUUID();
        const sheets = pick(['in_use', 'in_use', 'in_use', 'in_use', 'clean', 'clean', 'clean', 'dirty']);
        const hours = { in_use: between(2, 60), clean: between(1, 20), dirty: between(1, 6) }[sheets];
        s.push(db.prepare('INSERT INTO beds (id, property_id, frame_id, level, label, sheets, sheets_at, sheets_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(bedId, P, frameId, level, String(label++), sheets, now - hours * HOUR, pick(people)));
        // Linen changed within its time, now and then a day or two late.
        for (const l of LINEN) {
          const days = Math.random() < 0.1 ? l.days + between(1, 2) : between(0, l.days - 1);
          s.push(db.prepare('INSERT INTO bed_linen (bed_id, item, changed_at, changed_by) VALUES (?, ?, ?, ?)')
            .bind(bedId, l.key, now - days * DAY - between(1, 10) * HOUR, pick(people)));
        }
      }
    }
  });
  // Housekeeping's regular jobs: one overdue, the others not yet.
  [['Clean the fridge', 7, 9], ['Wash the curtains', 30, 12], ['Defrost the freezer', 14, 3], ['Check the fire extinguishers', 90, 20]]
    .forEach(([name, every, ago], position) => s.push(
      db.prepare('INSERT INTO hk_tasks (id, property_id, name, every_days, position, done_at, done_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), P, name, every, position, now - ago * DAY, pick(people), now),
    ));

  // The Dashboard: notes from the last two days, one for "Needs attention", one handover.
  shuffle(NOTES).slice(0, 6).forEach(([category, text], i) => {
    const id = crypto.randomUUID();
    s.push(db.prepare('INSERT INTO notes (id, property_id, author_id, category, text, attention, handover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, P, pick(team).id, category, text, i === 0 ? 1 : 0, i === 1 ? 1 : 0, now - (i * 5 + between(1, 4)) * HOUR));
    if (i === 2 || i === 4) {
      s.push(db.prepare('INSERT INTO note_replies (id, note_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, pick(team).id, pick(REPLIES), now - i * 4 * HOUR));
    }
  });

  // Shifts: last few days and the next two weeks, morning and evening.
  for (let d = -3; d <= 13; d++) {
    for (const type of DEFAULT_SHIFT_TYPES) {
      if (Math.random() < 0.15) continue; // a few still free
      s.push(db.prepare('INSERT INTO shifts (id, property_id, day, type_key, user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), P, plusDays(today, d), type.key, pick(people), ownerId, now));
    }
  }

  // The Calendar: bookings around today from the usual channels.
  for (let i = 0; i < 12; i++) {
    const [given, surname, , nationality] = pick(GUESTS);
    const arrival = plusDays(today, between(-3, 12));
    s.push(db.prepare(
      `INSERT INTO reservations (id, property_id, source, kind, guest, arrival, departure, guests, room_id, nationality, created_at, updated_at)
       VALUES (?, ?, ?, 'booking', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), P, pick(['booking', 'hostelworld', 'airbnb', 'manual']), `${given} ${surname}`, arrival,
      plusDays(arrival, between(1, 4)), between(1, 3), pick(roomIds), nationality, now, now));
  }

  // Check-in: guests already sent in the last days (the statistics have something
  // to show) and three of today's waiting to be checked and sent.
  for (let d = -6; d <= 0; d++) {
    const day = plusDays(today, d);
    for (let n = between(1, 4); n > 0; n--) {
      const g = demoGuest(italian(day));
      const kept = { nationality: g.nationality, arrival: g.arrival, nights: g.nights, sex: g.sex, dob: g.dob };
      const sentAt = Date.parse(`${day}T${String(between(14, 21)).padStart(2, '0')}:00:00+01:00`);
      if (sentAt > now) continue;
      s.push(db.prepare(
        `INSERT INTO guests (id, property_id, status, fields, last_check, sent_at, created_by, created_at, updated_at)
         VALUES (?, ?, 'sent', ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), P, JSON.stringify(kept), JSON.stringify({ mode: 'send', ok: true, errors: [], at: sentAt }),
        sentAt, pick(people), sentAt - HOUR, sentAt));
    }
  }
  for (let n = 0; n < 3; n++) {
    s.push(db.prepare("INSERT INTO guests (id, property_id, status, fields, ocr, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), P, JSON.stringify(demoGuest(italian(today))), JSON.stringify({ confidence: 'high', notes: '' }), pick(people), now - n * 600000, now));
  }

  // The Vault: the house rules and the Wi-Fi.
  const folder = crypto.randomUUID();
  s.push(
    db.prepare('INSERT INTO vault_folders (id, property_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(folder, P, 'For the team', ownerId, now),
    db.prepare("INSERT INTO vault_items (id, property_id, folder_id, kind, title, body, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, 'page', ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), P, folder, 'House rules', 'Quiet hours 23:00–8:00.\nCheck-out by 10:00.\nThe kitchen closes at 22:30.\nNo food in the dorms.', ownerId, ownerId, now, now),
    db.prepare("INSERT INTO vault_items (id, property_id, folder_id, kind, title, body, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, 'page', ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), P, folder, 'Wi-Fi and codes', 'Wi-Fi: Hostel-Guests / password: sunnyday2026\nFront door code: 1234#\nLuggage room: key in the reception drawer', ownerId, ownerId, now, now),
  );

  await db.batch(s);
}

// ===== Counting (the admin centre) =====

// One more for today (in Italy): 'started' | 'tried' | 'signups'.
async function bump(db, what, now = Date.now()) {
  await db.prepare(`INSERT INTO demo_daily (day, ${what}) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET ${what} = ${what} + 1`)
    .bind(romeDay(now)).run();
}

// A demo that tried a scan or Send ('tried'), or went on to its own account
// ('signup'): counted once per demo.
export async function demoMark(db, propertyId, what) {
  const col = what === 'tried' ? 'demo_tried' : 'demo_signup';
  const r = await db.prepare(`UPDATE properties SET ${col} = 1 WHERE id = ? AND demo_until IS NOT NULL AND ${col} = 0`).bind(propertyId).run();
  if (r.meta.changes) await bump(db, what === 'tried' ? 'tried' : 'signups');
}

// "Create your own account" in the demo's line (before it signs out).
export async function demoSignup(db, userId) {
  const row = await db.prepare(
    'SELECT p.id FROM memberships m JOIN properties p ON p.id = m.property_id WHERE m.user_id = ? AND p.demo_until IS NOT NULL LIMIT 1',
  ).bind(userId).first();
  if (row) await demoMark(db, row.id, 'signup');
}

// ===== What a demo can't do =====

// Property routes that would reach the outside world or cost money.
const BLOCKED = [
  [/^billing\/./, 'POST'],
  [/^registration\/check$/, 'POST'],
  [/^ross1000$/, 'POST'],
  [/^channex\//, 'POST'],
  [/^cloudbeds$/, 'PUT'],
  [/^claude$/, 'PUT'],
  [/^calendars(\/sync)?$/, 'POST'],
  [/^invites$/, 'POST'],
  [/^staff$/, 'POST'],
  [/^vault\/files$/, 'POST'],
  [/^rimovcli\/read$/, 'POST'],
];
// Signed-in routes outside a property.
const BLOCKED_USER = [
  ['/api/assistant', 'POST'], ['/api/support', 'POST'], ['/api/properties', 'POST'], ['/api/auth/password', 'POST'],
];
// Settings that hold a login to somewhere else, or an e-mail that gets a link.
const BLOCKED_KEYS = ['credentials', 'clearCredentials', 'ross', 'addStructure', 'email'];

// The demo's owner has no password: on the demo's device (the name tags) a tap is enough.
export const isDemoOwner = person => !!person && String(person.email || '').endsWith(DEMO_DOMAIN);

export const NOT_IN_DEMO = 'this isn\'t available in the demo — create your own account to use it';

export async function isDemo(db, propertyId) {
  return !!(await db.prepare('SELECT 1 FROM properties WHERE id = ? AND demo_until IS NOT NULL').bind(propertyId).first());
}

// Throws for what a demo may not do; costs a database look-up only for those routes.
export async function refuseInDemo(db, request, pathname, method) {
  const m = pathname.match(/^\/api\/properties\/([\w-]+)\/(.+)$/);
  if (m) {
    let risky = BLOCKED.some(([re, verb]) => verb === method && re.test(m[2]));
    if (!risky && method === 'PUT' && /^(settings|staff\/[\w-]+)$/.test(m[2])) {
      const body = await request.clone().json().catch(() => null);
      risky = !!body && BLOCKED_KEYS.some(k => k in body);
    }
    if (risky && await isDemo(db, m[1])) throw new HttpError(403, NOT_IN_DEMO, 'demo');
    return;
  }
  if (!BLOCKED_USER.some(([p, verb]) => p === pathname && verb === method)) return;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  const demo = await db.prepare(
    `SELECT 1 FROM sessions s JOIN memberships m ON m.user_id = s.user_id JOIN properties p ON p.id = m.property_id
     WHERE s.id_hash = ? AND p.demo_until IS NOT NULL LIMIT 1`,
  ).bind(await sha256Hex(token)).first();
  if (demo) throw new HttpError(403, NOT_IN_DEMO, 'demo');
}

// ===== Cleaning up =====

// Hourly: demos past their time go, with their people (only ever the
// made-up accounts: *.invalid addresses, with no other property).
export async function pruneDemos(db, now = Date.now()) {
  const { results } = await db.prepare('SELECT id FROM properties WHERE demo_until IS NOT NULL AND demo_until <= ? LIMIT 50').bind(now).all();
  for (const { id } of results) {
    const { results: members } = await db.prepare('SELECT user_id FROM memberships WHERE property_id = ?').bind(id).all();
    const ids = JSON.stringify(members.map(r => r.user_id));
    // The property first: its guests point at the people (no cascade there).
    await db.batch([
      db.prepare('DELETE FROM properties WHERE id = ?').bind(id),
      db.prepare(`DELETE FROM users WHERE id IN (SELECT value FROM json_each(?)) AND email LIKE '%.invalid'
                  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)`).bind(ids),
    ]);
  }
  return results.length;
}
