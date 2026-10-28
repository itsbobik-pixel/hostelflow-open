import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { todayIn } from '../src/guests.js';
import { nameTokens, staysOf, matchNights, forgetArrivals } from '../src/cloudbeds.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const PHOTO = 'data:image/jpeg;base64,' + btoa('fake jpeg bytes');
const iso = ddmmyyyy => ddmmyyyy.split('.').reverse().join('-');
const plus = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);

// A fake Cloudbeds: one hotel, today's arrivals.
let env, realFetch, calls, reservations, read;
function fakeCloudbeds(url, init) {
  const u = new URL(url);
  calls.push({ method: u.pathname.split('/').pop(), params: Object.fromEntries(u.searchParams), auth: init.headers.Authorization });
  if (init.headers.Authorization !== 'Bearer cbat_good') return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
  if (u.pathname.endsWith('/getHotels')) return new Response(JSON.stringify({ success: true, data: [{ propertyID: '184655', propertyName: 'Hostel Costello' }] }));
  if (u.pathname.endsWith('/getReservations')) return new Response(JSON.stringify({ success: true, data: reservations }));
  return new Response('{}', { status: 404 });
}

beforeEach(() => {
  forgetArrivals();
  calls = [];
  read = { surname: 'Novák', given: 'Jan' };
  const today = iso(todayIn('Europe/Rome'));
  reservations = [
    { status: 'confirmed', startDate: today, endDate: plus(today, 3), guestName: 'Jan Novak', guestList: { a: { guestFirstName: 'Jan', guestLastName: 'Novak' }, b: { guestFirstName: 'Eva', guestLastName: 'Novakova' } } },
    { status: 'canceled', startDate: today, endDate: plus(today, 5), guestName: 'Anna Smith', guestList: {} },
  ];
  env = {
    DB: createD1(),
    ASSETS: { fetch: async () => new Response('app') },
    CREDENTIALS_KEY: KEY,
    readDocument: async () => ({ fields: { ...read }, confidence: 'high', notes: '', usage: {} }),
  };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => fakeCloudbeds(url, init);
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

async function setup() {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  return { call, pid: r.data.properties[0].id };
}

test('connect: a key Cloudbeds turns down is not saved; a good one is, sealed, with the nights on', async () => {
  const { call, pid } = await setup();
  assert.deepEqual((await call('GET', `/api/properties/${pid}/cloudbeds`)).data, { connected: false, propertyName: null, nights: false, lastError: null });
  const bad = await call('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: 'cbat_bad' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /did not accept/);
  const ok = await call('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: 'cbat_good' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { connected: true, propertyName: 'Hostel Costello', nights: true, lastError: null });
  const row = await env.DB.prepare('SELECT cloudbeds_credentials, cloudbeds_property_id FROM properties WHERE id = ?').bind(pid).first();
  assert.ok(!row.cloudbeds_credentials.includes('cbat_good'));
  assert.equal(row.cloudbeds_property_id, '184655');
  // The switch, and disconnecting.
  assert.equal((await call('PUT', `/api/properties/${pid}/cloudbeds`, { nights: false })).data.nights, false);
  assert.equal((await call('DELETE', `/api/properties/${pid}/cloudbeds`)).data.connected, false);
});

test('only the owner sees or changes it', async () => {
  const { call, pid } = await setup();
  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'correct horse', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('GET', `/api/properties/${pid}/cloudbeds`)).status, 404); // not theirs: not even there
  assert.equal((await stranger('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: 'cbat_good' })).status, 404);
  assert.equal((await call('GET', `/api/properties/${pid}/cloudbeds`)).status, 200);
});

test('scan: the nights come from the booking the name matches; one Cloudbeds call for the day', async () => {
  const { call, pid } = await setup();
  await call('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: 'cbat_good' });
  calls = [];
  const g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.equal(g.status, 201);
  assert.equal(g.data.fields.nights, '3');
  assert.equal(g.data.ocr.nightsFrom, 'cloudbeds');
  const q = calls.find(c => c.method === 'getReservations').params;
  assert.equal(q.propertyID, '184655');
  assert.equal(q.checkInFrom, plus(iso(todayIn('Europe/Rome')), -1)); // yesterday's arrivals too
  assert.equal(q.checkInTo, iso(todayIn('Europe/Rome')));
  // The next guest of the family: no second call.
  read = { surname: 'NOVAKOVA', given: 'EVA' };
  assert.equal((await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO })).data.fields.nights, '3');
  assert.equal(calls.filter(c => c.method === 'getReservations').length, 1);
});

test('scan: no match, switched off, or Cloudbeds down — the nights stay empty and the scan works', async () => {
  const { call, pid } = await setup();
  await call('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: 'cbat_good' });
  read = { surname: 'Smith', given: 'Anna' }; // only a cancelled booking
  let g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.equal(g.data.fields.nights, undefined);
  assert.equal(g.data.ocr.nightsFrom, undefined);
  assert.equal(g.data.ocr.nightsMissed, true); // Check-in asks for the nights by hand
  assert.deepEqual(g.data.ocr.nightsWhy, { stays: 2, reason: 'no such name' }); // only counts, no names
  assert.deepEqual(g.data.problems.slice(-1), ['pick the number of nights']); // not sent as 1 night unasked
  await env.DB.prepare("UPDATE properties SET registration = 'it-alloggiati' WHERE id = ?").bind(pid).run();
  const send = await call('POST', `/api/properties/${pid}/guests/send`, { ids: [g.data.id] });
  assert.equal(send.status, 400);
  assert.match(send.data.error, /pick their nights/);
  const picked = await call('PUT', `/api/properties/${pid}/guests/${g.data.id}`, { fields: { ...g.data.fields, nights: '2' } });
  assert.ok(!picked.data.problems.includes('pick the number of nights'));

  await call('PUT', `/api/properties/${pid}/cloudbeds`, { nights: false });
  forgetArrivals();
  calls = [];
  read = { surname: 'Novak', given: 'Jan' };
  g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.equal(g.data.fields.nights, undefined);
  assert.equal(g.data.ocr.nightsMissed, undefined); // not looked for: no warning
  assert.equal(calls.length, 0);

  await call('PUT', `/api/properties/${pid}/cloudbeds`, { nights: true });
  globalThis.fetch = async () => { throw new Error('offline'); };
  g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.equal(g.status, 201);
  assert.equal(g.data.fields.surname, 'Novak');
  assert.equal(g.data.fields.nights, undefined);
  assert.match((await call('GET', `/api/properties/${pid}/cloudbeds`)).data.lastError, /could not be reached/);
});

test('scan: asked again later (Cloudbeds was slow), the nights are filled in — never over ones picked by hand', async () => {
  const { call, pid } = await setup();
  await call('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: 'cbat_good' });
  read = { surname: 'Smith', given: 'Anna' };
  const g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.equal(g.data.ocr.nightsMissed, true);
  reservations[1].status = 'confirmed'; // Cloudbeds has it now
  forgetArrivals();
  const again = await call('POST', `/api/properties/${pid}/guests/${g.data.id}/nights`);
  assert.equal(again.status, 200);
  assert.equal(again.data.fields.nights, '5');
  assert.equal(again.data.fields.surname, 'Smith'); // the rest untouched
  assert.equal(again.data.ocr.nightsFrom, 'cloudbeds');
  assert.equal(again.data.ocr.nightsMissed, undefined);
  assert.ok(!again.data.problems.includes('pick the number of nights'));
  // Already has nights: nothing asked, nothing changed.
  calls = [];
  forgetArrivals();
  assert.equal((await call('POST', `/api/properties/${pid}/guests/${g.data.id}/nights`)).data.fields.nights, '5');
  assert.equal(calls.length, 0);
});

test('matching: accents, two bookings with one surname, a guest\'s own room dates', () => {
  assert.deepEqual(nameTokens('Müller-López, J.'), ['MULLER', 'LOPEZ']);
  const stays = staysOf([
    { status: 'confirmed', startDate: '2026-10-23', endDate: '2026-10-25', guestList: { a: { guestFirstName: 'Tom', guestLastName: 'Rossi' } } },
    { status: 'confirmed', startDate: '2026-10-23', endDate: '2026-10-27', guestList: { a: { guestFirstName: 'Ana', guestLastName: 'Rossi' } } },
    { status: 'checked_in', startDate: '2026-10-23', endDate: '2026-10-30', guestList: { a: { guestFirstName: 'Li', guestLastName: 'Wei', rooms: [{ roomCheckIn: '2026-10-23', roomCheckOut: '2026-10-24' }] } } },
    { status: 'no_show', startDate: '2026-10-23', endDate: '2026-10-24', guestName: 'Gone Away' },
  ]);
  assert.equal(matchNights(stays, { surname: 'ROSSI', given: 'ANA' }), 4);
  assert.equal(matchNights(stays, { surname: 'ROSSI', given: 'MARIO' }), null); // which one? don't guess
  assert.equal(matchNights(stays, { surname: 'WEI', given: 'LI' }), 1);
  assert.equal(matchNights(stays, { surname: 'AWAY', given: 'GONE' }), null);
  assert.equal(matchNights(stays, { surname: '', given: 'ANA' }), null);
});

test('matching: a long name sharing words with others, and a given name typed with one wrong letter', () => {
  const stays = staysOf([
    { status: 'confirmed', startDate: '2026-10-27', endDate: '2026-10-30', guestName: 'Beateiz Esteves', guestList: {} },
    { status: 'confirmed', startDate: '2026-10-27', endDate: '2026-10-29', guestName: 'João Santos', guestList: {} },
    { status: 'confirmed', startDate: '2026-10-26', endDate: '2026-10-31', guestName: 'Ana da Silva', guestList: {} },
  ]);
  const id = { surname: 'SILVA DOS SANTOS PEREIRA ESTEVES', given: 'MARIA BEATRIZ' };
  assert.equal(matchNights(stays, id), 3);
  assert.equal(matchNights(stays, { surname: 'SANTOS', given: 'JOAO' }), 2);
  // A near surname alone isn't enough: "Estevez" with another given name is someone else.
  assert.equal(matchNights(stays, { surname: 'ESTEVEZ', given: 'CARLA' }), null);
  assert.equal(matchNights(stays, { surname: 'ESTEVEZ', given: 'BEATEIZ' }), 3);
  assert.deepEqual(nameTokens('Ana da Silva dos Santos'), ['ANA', 'SILVA', 'SANTOS']);
});

test('matching: arrivals from yesterday get the whole stay; an extended booking still matches', () => {
  const stays = staysOf([
    // Came yesterday, registered today: still the whole stay.
    { status: 'checked_in', startDate: '2026-10-25', endDate: '2026-10-29', guestName: 'Ana Bianchi', guestList: {} },
    // Extended in Cloudbeds: the booker's own room dates and the booking's disagree.
    { status: 'confirmed', startDate: '2026-10-26', endDate: '2026-10-30', guestName: 'Alexis Martin',
      guestList: { a: { guestFirstName: 'Alexis', guestLastName: 'Martin', rooms: [{ roomCheckIn: '2026-10-26', roomCheckOut: '2026-10-30' }] } } },
  ]);
  assert.equal(matchNights(stays, { surname: 'BIANCHI', given: 'ANA' }), 4);
  assert.equal(matchNights(stays, { surname: 'MARTIN', given: 'ALEXIS' }), 4);
  const stale = staysOf([{ status: 'confirmed', startDate: '2026-10-26', endDate: '2026-10-30', guestName: 'Alexis Martin',
    guestList: { a: { guestFirstName: 'Alexis', guestLastName: 'Martin', rooms: [{ roomCheckIn: '2026-10-26', roomCheckOut: '2026-10-28' }] } } }]);
  assert.equal(matchNights(stale, { surname: 'MARTIN', given: 'ALEXIS' }), 2); // the guest's own room dates win
});
