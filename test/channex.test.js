import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { sourceOfOta, isDorm, freePlaces } from '../src/channex.js';

// A fake Channex: records the calls, hands out ids, serves a revisions feed.
let env, calls, feed, acked, pushes;
function fakeChannex(url, init = {}) {
  const u = new URL(url);
  const path = u.pathname.replace('/api/v1', '');
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method: init.method, path, body, key: init.headers['user-api-key'] });
  const created = id => new Response(JSON.stringify({ data: { id } }), { status: 201 });
  if (path === '/properties') return created('cx-prop');
  if (path === '/webhooks') return created('cx-hook');
  if (path === '/room_types') return created(`rt-${body.room_type.title}`);
  if (path === '/rate_plans') return created(`rp-${body.rate_plan.room_type_id}`);
  if (path === '/availability') { pushes.push(body.values); return new Response('{}'); }
  if (path === '/booking_revisions/feed') return new Response(JSON.stringify({ data: feed.splice(0) }));
  if (path === '/bookings') {
    const b = body.booking;
    feed.push({ id: 'rev-test', attributes: { booking_id: 'b-test', status: 'new', ...b } });
    return created('b-test');
  }
  const ack = path.match(/^\/booking_revisions\/(.+)\/ack$/);
  if (ack) { acked.push(ack[1]); return new Response('{}'); }
  return new Response(JSON.stringify({ errors: { title: 'unexpected' } }), { status: 422 });
}

beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CHANNEX_API_KEY: 'cx-test-key', CHANNEX_SETTLE_MS: 0 };
  calls = [];
  feed = [];
  acked = [];
  pushes = [];
  globalThis.fetch = async (url, init) => fakeChannex(url, init);
});

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hostelflow.it' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

async function hostel() {
  const owner = client();
  const pid = (await owner('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const map = await owner('PUT', `/api/properties/${pid}/housekeeping/map`, {
    rooms: [
      { id: 'n1', name: 'Dorm 6', kind: 'room', x: 0, y: 0, w: 6, h: 6 },
      { id: 'n2', name: 'Double', kind: 'room', x: 6, y: 0, w: 4, h: 4 },
      { id: 'n3', name: 'Empty', kind: 'room', x: 10, y: 0, w: 4, h: 4 },
    ],
    frames: [
      { kind: 'bunk', roomId: 'n1', beds: [{ label: '1' }, { label: '2' }] },
      { kind: 'bunk', roomId: 'n1', beds: [{ label: '3' }, { label: '4' }] },
      { kind: 'bunk', roomId: 'n1', beds: [{ label: '5' }, { label: '6' }] },
      { kind: 'double', roomId: 'n2', beds: [{ label: 'D1' }] },
    ],
  });
  assert.equal(map.status, 200);
  return { owner, pid, rooms: map.data.rooms };
}

const revision = (id, attrs) => ({ id, type: 'booking_revision', attributes: { booking_id: 'b-1', ota_name: 'Booking.com', ota_reservation_code: '9996013801', ...attrs } });

test('connect: property, a dorm sold by the bed, a private room, a webhook; rooms without beds are left out', async () => {
  const { owner, pid, rooms } = await hostel();
  const r = await owner('POST', `/api/properties/${pid}/channex/connect`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.connected, true);
  assert.ok(calls.every(c => c.key === 'cx-test-key'));
  const prop = calls.find(c => c.path === '/properties');
  assert.deepEqual(prop.body.property, { title: 'Costello', currency: 'EUR', property_type: 'hotel', country: 'IT', timezone: 'Europe/Rome' });
  const hook = calls.find(c => c.path === '/webhooks').body.webhook;
  assert.equal(hook.property_id, 'cx-prop');
  assert.match(hook.callback_url, /^https:\/\/hostelflow\.it\/api\/channex\/webhook\/[\w-]{20,}$/);
  const types = calls.filter(c => c.path === '/room_types').map(c => c.body.room_type);
  assert.deepEqual(types.map(t => [t.title, t.room_kind, t.occ_adults, t.capacity]), [['Dorm 6', 'dorm', 1, 6], ['Double', 'room', 2, undefined]]);
  const plans = calls.filter(c => c.path === '/rate_plans').map(c => c.body.rate_plan);
  assert.deepEqual(plans.map(p => [p.room_type_id, p.sell_mode, p.options[0].occupancy]), [['rt-Dorm 6', 'per_person', 1], ['rt-Double', 'per_room', 2]]);

  // Pressing again creates nothing new; the link survives a re-save of the rooms.
  calls = [];
  await owner('PUT', `/api/properties/${pid}/housekeeping/map`, { rooms, frames: (await owner('GET', `/api/properties/${pid}/housekeeping`)).data.frames });
  await owner('POST', `/api/properties/${pid}/channex/connect`, {});
  assert.deepEqual(calls.map(c => c.path), ['/booking_revisions/feed', '/availability']);
  const status = (await owner('GET', `/api/properties/${pid}/channex`)).data;
  assert.deepEqual(status.rooms.map(x => [x.name, x.beds, x.people, x.dorm, x.connected]), [['Dorm 6', 6, 6, true, true], ['Double', 1, 2, false, true]]);
});

test('bookings: new, modified and cancelled revisions land in the Calendar and are acknowledged', async () => {
  const { owner, pid, rooms } = await hostel();
  await owner('POST', `/api/properties/${pid}/channex/connect`, {});
  const dorm = rooms.find(r => r.name === 'Dorm 6').id;
  const hookUrl = calls.find(c => c.path === '/webhooks').body.webhook.callback_url.replace('https://hostelflow.it', '');

  feed.push(revision('rev-1', {
    status: 'new', arrival_date: '2026-10-10', departure_date: '2026-10-12', notes: 'Late arrival',
    customer: { name: 'Anna', surname: 'Novak', country: 'CZ' },
    rooms: [{ room_type_id: 'rt-Dorm 6', occupancy: { adults: 2, children: 0 } }],
  }));
  const hit = await client()('POST', hookUrl, { event: 'booking' });
  assert.equal(hit.status, 200);
  assert.deepEqual(acked, ['rev-1']);
  let list = (await owner('GET', `/api/properties/${pid}/reservations?from=2026-10-01&to=2026-10-31`)).data;
  assert.deepEqual(list.map(r => [r.guest, r.source, r.arrival, r.departure, r.guests, r.roomId, r.code, r.note, r.nationality, r.editable]),
    [['Anna Novak', 'booking', '2026-10-10', '2026-10-12', 2, dorm, '9996013801', 'Late arrival', 'CZ', false]]);

  // Our own details stay when the booking changes on the channel.
  const id = list[0].id;
  await owner('PUT', `/api/properties/${pid}/reservations/${id}`, { guest: 'Anna Novak', status: ['unpaid'], arrivalTime: '23:00', note: 'Our note' });
  feed.push(revision('rev-2', {
    status: 'modified', arrival_date: '2026-10-11', departure_date: '2026-10-13',
    customer: { name: 'Anna', surname: 'Novak' }, rooms: [{ room_type_id: 'rt-Dorm 6', occupancy: { adults: 1 } }],
  }));
  await owner('POST', `/api/properties/${pid}/calendars/sync`, {});
  list = (await owner('GET', `/api/properties/${pid}/reservations?from=2026-10-01&to=2026-10-31`)).data;
  assert.deepEqual(list.map(r => [r.id, r.arrival, r.departure, r.guests, r.status, r.arrivalTime, r.note]),
    [[id, '2026-10-11', '2026-10-13', 1, ['unpaid'], '23:00', 'Our note']]);
  // Its dates can't be moved or deleted here.
  assert.equal((await owner('DELETE', `/api/properties/${pid}/reservations/${id}`)).status, 403);

  feed.push(revision('rev-3', { status: 'cancelled', arrival_date: '2026-10-11', departure_date: '2026-10-13', rooms: [] }));
  await client()('POST', hookUrl, {});
  list = (await owner('GET', `/api/properties/${pid}/reservations?from=2026-10-01&to=2026-10-31`)).data;
  assert.deepEqual(list, []);
  assert.deepEqual(acked, ['rev-1', 'rev-2', 'rev-3']);
});

test('webhook with a wrong token is a 404; connecting needs the owner, rooms and the key', async () => {
  const { owner, pid } = await hostel();
  assert.equal((await client()('POST', '/api/channex/webhook/nope', {})).status, 404);
  delete env.CHANNEX_API_KEY;
  assert.equal((await owner('POST', `/api/properties/${pid}/channex/connect`, {})).status, 503);
  assert.equal((await owner('GET', `/api/properties/${pid}/channex`)).data.available, false);
  env.CHANNEX_API_KEY = 'k';
  const other = client();
  const pid2 = (await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'eve password', propertyName: 'No rooms', acceptTerms: true })).data.properties[0].id;
  assert.equal((await other('POST', `/api/properties/${pid2}/channex/connect`, {})).status, 400);
  assert.equal((await other('POST', `/api/properties/${pid}/channex/connect`, {})).status, 404);
});

test('channel names and dorms', () => {
  assert.equal(sourceOfOta('Booking.com'), 'booking');
  assert.equal(sourceOfOta('Hostelworld'), 'hostelworld');
  assert.equal(sourceOfOta('Airbnb'), 'airbnb');
  assert.equal(sourceOfOta('Open Channel'), 'other');
  assert.equal(isDorm(2), false);
  assert.equal(isDorm(3), true);
});

test('test booking (staging only): created at Channex, then read back into the Calendar', async () => {
  const { owner, pid } = await hostel();
  assert.equal((await owner('POST', `/api/properties/${pid}/channex/test-booking`, {})).status, 400);
  await owner('POST', `/api/properties/${pid}/channex/connect`, {});
  const r = await owner('POST', `/api/properties/${pid}/channex/test-booking`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.received, 1);
  const sent = calls.find(c => c.path === '/bookings').body.booking;
  assert.equal(sent.property_id, 'cx-prop');
  assert.equal(sent.rooms[0].room_type_id, 'rt-Dorm 6');
  const list = (await owner('GET', `/api/properties/${pid}/reservations?from=${r.data.arrival}&to=${r.data.arrival}`)).data;
  assert.deepEqual(list.map(x => [x.guest, x.source, x.arrival]), [['Test Guest', 'other', r.data.arrival]]);
  env.CHANNEX_URL = 'https://app.channex.io';
  assert.equal((await owner('POST', `/api/properties/${pid}/channex/test-booking`, {})).status, 403);
});

test('free places: dorm beds count down, a private room closes, blocks close; sent as ranges', () => {
  const rooms = [{ id: 'd', beds: 6, roomTypeId: 'rt-d' }, { id: 'p', beds: 1, roomTypeId: 'rt-p' }];
  const v = freePlaces(rooms, [
    { roomId: 'd', kind: 'booking', guests: 2, arrival: '2026-10-02', departure: '2026-10-04' },
    { roomId: 'd', kind: 'booking', guests: null, arrival: '2026-10-03', departure: '2026-10-04' },
    { roomId: 'p', kind: 'booking', guests: 2, arrival: '2026-10-01', departure: '2026-10-02' },
    { roomId: 'p', kind: 'block', guests: null, arrival: '2026-10-04', departure: '2026-10-05' },
    { roomId: null, kind: 'booking', guests: 3, arrival: '2026-10-01', departure: '2026-10-05' },
  ], '2026-10-01', 5);
  assert.deepEqual(v.map(x => [x.room_type_id, x.date_from, x.date_to, x.availability]), [
    ['rt-d', '2026-10-01', '2026-10-01', 6],
    ['rt-d', '2026-10-02', '2026-10-02', 4],
    ['rt-d', '2026-10-03', '2026-10-03', 3],
    ['rt-d', '2026-10-04', '2026-10-05', 6],
    ['rt-p', '2026-10-01', '2026-10-01', 0],
    ['rt-p', '2026-10-02', '2026-10-03', 1],
    ['rt-p', '2026-10-04', '2026-10-04', 0],
    ['rt-p', '2026-10-05', '2026-10-05', 1],
  ]);
});

test('availability goes to Channex on connect, after a channel booking and after a booking typed in', async () => {
  const { owner, pid, rooms } = await hostel();
  await owner('POST', `/api/properties/${pid}/channex/connect`, {});
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].every(v => v.property_id === 'cx-prop'));
  const first = pushes[0].filter(v => v.room_type_id === 'rt-Dorm 6');
  assert.equal(first.length, 1); // one range: the whole year free
  assert.equal(first[0].availability, 6);

  const day = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  feed.push(revision('rev-a', { status: 'new', arrival_date: day(5), departure_date: day(7), customer: { name: 'A' }, rooms: [{ room_type_id: 'rt-Dorm 6', occupancy: { adults: 2 } }] }));
  await owner('POST', `/api/properties/${pid}/calendars/sync`, {});
  assert.equal(pushes.length, 2);
  assert.ok(pushes[1].some(v => v.room_type_id === 'rt-Dorm 6' && v.availability === 4 && v.date_from === day(5) && v.date_to === day(6)));

  const dbl = rooms.find(r => r.name === 'Double').id;
  await owner('POST', `/api/properties/${pid}/reservations`, { guest: 'Walk-in', arrival: day(10), departure: day(11), guests: 2, roomId: dbl });
  assert.equal(pushes.length, 3);
  assert.ok(pushes[2].some(v => v.room_type_id === 'rt-Double' && v.availability === 0 && v.date_from === day(10) && v.date_to === day(10)));
});
