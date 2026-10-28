import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { parseICS, readEvent, sourceOf, syncAllCalendars } from '../src/reservations.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
let env;
let feeds; // url -> iCal text the fake channel serves
let realFetch;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY };
  feeds = {};
  realFetch = globalThis.fetch;
  globalThis.fetch = async url => (url in feeds
    ? new Response(feeds[url], { headers: { 'Content-Type': 'text/calendar' } })
    : new Response('nope', { status: 404 }));
});
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

async function team() {
  const owner = client();
  const r = await owner('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  const pid = r.data.properties[0].id;
  const gaiaId = (await owner('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'staffpass1' })).data.id;
  await owner('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { calendar: 'edit', attention: 'read' } });
  const staff = client();
  await staff('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'staffpass1' });
  return { owner, staff, pid };
}

// Days as the property sees them (Rome), not UTC — they differ around midnight.
// Counted on the calendar, not by adding 24 hours: across a change of the
// clocks (the end of October) that would give the same day twice at night.
const day = n => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10).replace(/-/g, '');
};
const AIRBNB = () => `BEGIN:VCALENDAR\r
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:${day(0)}\r
DTEND;VALUE=DATE:${day(3)}\r
SUMMARY:Reserved\r
UID:a1@airbnb.com\r
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC12345\\nPhone Number (Last 4\r
  Digits): 1234\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:${day(10)}\r
DTEND;VALUE=DATE:${day(12)}\r
SUMMARY:Airbnb (Not available)\r
UID:a2@airbnb.com\r
END:VEVENT\r
END:VCALENDAR\r
`;
const BOOKING = () => `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:b1@booking.com
DTSTART:${day(1)}
DTEND:${day(2)}
SUMMARY:CLOSED - Not available
END:VEVENT
END:VCALENDAR
`;

test('iCal: folded lines, dates, Airbnb bookings vs closed dates, codes', () => {
  const ev = parseICS(AIRBNB());
  assert.equal(ev.length, 2);
  assert.match(ev[0].description, /Last 4 Digits/);
  assert.deepEqual(readEvent(ev[0], 'airbnb'), { kind: 'booking', guest: null, code: 'HMABC12345' });
  assert.equal(readEvent(ev[1], 'airbnb').kind, 'block');
  assert.deepEqual(readEvent(parseICS(BOOKING())[0], 'booking'), { kind: 'booking', guest: null, code: null });
  assert.equal(readEvent({ summary: 'Mario Rossi' }, 'other').guest, 'Mario Rossi');
  assert.equal(sourceOf('https://admin.booking.com/hotel/hoteladmin/ical.html?t=x'), 'booking');
  assert.equal(sourceOf('https://www.airbnb.it/calendar/ical/1.ics?s=y'), 'airbnb');
});

test('adding a calendar syncs it; the link is stored encrypted and never shown', async () => {
  const { owner, staff, pid } = await team();
  const url = 'https://www.airbnb.com/calendar/ical/123.ics?s=secret';
  feeds[url] = AIRBNB();
  assert.equal((await staff('POST', `/api/properties/${pid}/calendars`, { name: 'x', url })).status, 403);
  assert.equal((await owner('POST', `/api/properties/${pid}/calendars`, { name: 'x', url: 'http://x.com/a.ics' })).status, 400);
  const r = await owner('POST', `/api/properties/${pid}/calendars`, { name: 'Airbnb – Dorm A', url });
  assert.equal(r.status, 201);
  assert.equal(r.data.source, 'airbnb');
  assert.equal(r.data.sync.ok, true);
  assert.ok(!JSON.stringify(r.data).includes('secret'));
  const row = await env.DB.prepare('SELECT url_enc FROM calendars').first();
  assert.ok(!row.url_enc.includes('secret'));

  const list = await staff('GET', `/api/properties/${pid}/reservations`);
  assert.deepEqual(list.data.map(x => [x.source, x.kind, x.code, x.editable]), [
    ['airbnb', 'booking', 'HMABC12345', false], ['airbnb', 'block', null, false],
  ]);
  // Today's arrival shows on the dashboard.
  // Arrivals on the Dashboard: the calendar is still in preview.
  await env.DB.prepare('UPDATE properties SET preview = 1 WHERE id = ?').bind(pid).run();
  const board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(board.attention.filter(a => a.type === 'arrivals'), [{ type: 'arrivals', count: 1 }]);
});

test('re-sync: changed dates update, removed events (cancellations) disappear, errors are kept', async () => {
  const { owner, pid } = await team();
  const url = 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc';
  feeds[url] = BOOKING();
  await owner('POST', `/api/properties/${pid}/calendars`, { name: 'Booking', url });
  assert.equal((await owner('GET', `/api/properties/${pid}/reservations`)).data.length, 1);

  feeds[url] = BOOKING().replace(day(2), day(4)) + '';
  await syncAllCalendars(env);
  let list = (await owner('GET', `/api/properties/${pid}/reservations`)).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].departure.replace(/-/g, ''), day(4));

  feeds[url] = 'BEGIN:VCALENDAR\nEND:VCALENDAR\n';
  await owner('POST', `/api/properties/${pid}/calendars/sync`, {});
  assert.equal((await owner('GET', `/api/properties/${pid}/reservations`)).data.length, 0);

  delete feeds[url];
  const sync = await owner('POST', `/api/properties/${pid}/calendars/sync`, {});
  assert.equal(sync.data[0].ok, false);
  const cals = (await owner('GET', `/api/properties/${pid}/calendars`)).data;
  assert.match(cals[0].lastError, /404/);

  assert.equal((await owner('DELETE', `/api/properties/${pid}/calendars/${cals[0].id}`)).status, 200);
  assert.equal((await owner('GET', `/api/properties/${pid}/calendars`)).data.length, 0);
});

test('manual reservations: add, edit, delete; channel ones are read-only', async () => {
  const { owner, staff, pid } = await team();
  const d = n => `${day(n).slice(0, 4)}-${day(n).slice(4, 6)}-${day(n).slice(6)}`;
  assert.equal((await staff('POST', `/api/properties/${pid}/reservations`, { guest: '', arrival: d(0), departure: d(1) })).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/reservations`, { guest: 'Ann', arrival: d(2), departure: d(1) })).status, 400);
  const r = await staff('POST', `/api/properties/${pid}/reservations`, { guest: 'Ann Smith', arrival: d(0), departure: d(2), guests: 2, note: 'late' });
  assert.equal(r.status, 201);
  assert.equal(r.data.editable, true);
  const up = await staff('PUT', `/api/properties/${pid}/reservations/${r.data.id}`, { guest: 'Ann Smith', arrival: d(0), departure: d(3), guests: 2 });
  assert.equal(up.data.departure, d(3));

  const url = 'https://admin.booking.com/x.ics';
  feeds[url] = BOOKING();
  await owner('POST', `/api/properties/${pid}/calendars`, { name: 'B', url });
  const fromChannel = (await staff('GET', `/api/properties/${pid}/reservations`)).data.find(x => !x.editable);
  assert.equal((await staff('DELETE', `/api/properties/${pid}/reservations/${fromChannel.id}`)).status, 403);
  // A channel booking takes a name and details, keeps its dates, and a re-sync keeps what was typed.
  const named = await staff('PUT', `/api/properties/${pid}/reservations/${fromChannel.id}`, {
    guest: 'Kim Lee', arrival: d(9), departure: d(12), status: ['checkin', 'lower-bed'], arrivalTime: '15:00', nationality: 'kr',
  });
  assert.equal(named.status, 200);
  assert.equal(named.data.guest, 'Kim Lee');
  assert.equal(named.data.arrival, fromChannel.arrival);
  assert.deepEqual([named.data.status, named.data.arrivalTime, named.data.nationality], [['checkin', 'lower-bed'], '15:00', 'KR']);
  await owner('POST', `/api/properties/${pid}/calendars/sync`, {});
  const again = (await staff('GET', `/api/properties/${pid}/reservations`)).data.find(x => x.id === fromChannel.id);
  assert.equal(again.guest, 'Kim Lee');
  assert.deepEqual(again.status, ['checkin', 'lower-bed']);
  assert.equal((await staff('PUT', `/api/properties/${pid}/reservations/${fromChannel.id}`, { guest: 'x', status: ['a', 'b', 'c'] })).status, 400);
  assert.equal((await staff('DELETE', `/api/properties/${pid}/reservations/${r.data.id}`)).status, 200);

  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('GET', `/api/properties/${pid}/reservations`)).status, 404);
});
