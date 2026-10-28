import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

let env;
beforeEach(() => { env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') } }; });

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

// Bob owns Costello, Gaia is on his staff; Eva owns another hostel.
async function team() {
  const bob = client();
  const pid = (await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const gaiaId = (await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' })).data.id;
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  const eva = client();
  const evaPid = (await eva('POST', '/api/auth/register', { name: 'Eva', email: 'eva@example.com', password: 'eva password', propertyName: 'Other', acceptTerms: true })).data.properties[0].id;
  return { bob, gaia, eva, pid, gaiaId, evaPid };
}
const week = pid => `/api/properties/${pid}/shifts?from=2026-10-12&days=7`;

test('shift notes: added, rewritten, dragged and removed by who plans the rota; everyone reads them', async () => {
  const { bob, gaia, pid, gaiaId } = await team();
  const notes = `/api/properties/${pid}/shifts/notes`;

  // Gaia can't plan the rota: she sees notes but can't add one.
  assert.equal((await gaia('POST', notes, { day: '2026-10-12', type: 'morning', text: 'Inventory' })).status, 403);
  const add = await bob('POST', notes, { day: '2026-10-12', type: 'morning', text: '  Inventory after breakfast  ' });
  assert.equal(add.status, 201);
  assert.equal(add.data.text, 'Inventory after breakfast');
  let r = await gaia('GET', week(pid));
  assert.deepEqual(r.data.notes, [{ id: add.data.id, day: '2026-10-12', type: 'morning', text: 'Inventory after breakfast', color: null }]);
  assert.equal((await gaia('PUT', `${notes}/${add.data.id}`, { text: 'Mine now' })).status, 403);
  assert.equal((await gaia('DELETE', `${notes}/${add.data.id}`)).status, 403);

  // What a note must be.
  assert.equal((await bob('POST', notes, { day: '2026-10-12', type: 'morning', text: '   ' })).status, 400);
  assert.equal((await bob('POST', notes, { day: '2026-10-12', type: 'morning', text: 'x'.repeat(201) })).status, 400);
  assert.equal((await bob('POST', notes, { day: '2026-10-12', type: 'morning', text: 'x'.repeat(200) })).status, 201);
  assert.equal((await bob('POST', notes, { day: '2026-10-12', type: 'night', text: 'Hi' })).status, 400);
  assert.equal((await bob('POST', notes, { day: 'monday', type: 'morning', text: 'Hi' })).status, 400);
  assert.equal((await bob('POST', notes, { day: '2026-10-12', type: 'morning', text: 'Hi', color: 'red' })).status, 400);

  // With the Shifts permission Gaia rewrites it and drags it to Tuesday evening.
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'edit', shifts: 'edit' } });
  assert.equal((await gaia('PUT', `${notes}/${add.data.id}`, { text: 'Inventory at 10' })).status, 200);
  assert.equal((await gaia('PUT', `${notes}/${add.data.id}`, { text: '' })).status, 400);
  // A colour of its own (the chip on the rota), and back to the default.
  assert.equal((await gaia('PUT', `${notes}/${add.data.id}`, { text: 'Inventory at 10', color: '#3A8FD4' })).status, 200);
  assert.equal((await gaia('GET', week(pid))).data.notes.find(n => n.id === add.data.id).color, '#3a8fd4');
  assert.equal((await gaia('PUT', `${notes}/${add.data.id}`, { day: '2026-10-13', type: 'evening' })).status, 200);
  assert.equal((await gaia('PUT', `${notes}/${add.data.id}`, { day: '2026-10-13', type: 'night' })).status, 400);
  assert.equal((await gaia('PUT', `${notes}/nope`, { text: 'Hi' })).status, 404);
  r = await gaia('GET', week(pid));
  assert.deepEqual(r.data.notes.find(n => n.id === add.data.id), { id: add.data.id, day: '2026-10-13', type: 'evening', text: 'Inventory at 10', color: '#3a8fd4' });
  assert.equal((await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-19&days=7`)).data.notes.length, 0, 'next week is empty');

  // Dragged off the rota: gone.
  assert.equal((await gaia('DELETE', `${notes}/${add.data.id}`)).status, 200);
  r = await gaia('GET', week(pid));
  assert.equal(r.data.notes.length, 1);
  assert.ok(!r.data.notes.some(n => n.id === add.data.id));
});

test('shift notes: a kind of shift taken out in the settings takes its notes', async () => {
  const { bob, pid } = await team();
  const notes = `/api/properties/${pid}/shifts/notes`;
  await bob('POST', notes, { day: '2026-10-12', type: 'morning', text: 'Stays' });
  await bob('POST', notes, { day: '2026-10-12', type: 'evening', text: 'Goes' });
  await bob('PUT', `/api/properties/${pid}/settings`, { shiftTypes: [{ key: 'morning', name: 'Morning', start: '07:00', end: '15:00' }] });
  assert.deepEqual((await bob('GET', week(pid))).data.notes.map(n => n.text), ['Stays']);
});

test('shift notes: another property can neither see nor touch them', async () => {
  const { bob, eva, pid, evaPid } = await team();
  const add = await bob('POST', `/api/properties/${pid}/shifts/notes`, { day: '2026-10-12', type: 'morning', text: 'Costello only' });

  // Through Bob's property: not a member (the property doesn't even show).
  const denied = r => assert.ok([403, 404].includes(r.status), String(r.status));
  denied(await eva('GET', week(pid)));
  denied(await eva('POST', `/api/properties/${pid}/shifts/notes`, { day: '2026-10-12', type: 'morning', text: 'Hi' }));
  denied(await eva('PUT', `/api/properties/${pid}/shifts/notes/${add.data.id}`, { text: 'Hacked' }));
  denied(await eva('DELETE', `/api/properties/${pid}/shifts/notes/${add.data.id}`));
  // Through her own property, with Bob's note id: not found there.
  assert.equal((await eva('PUT', `/api/properties/${evaPid}/shifts/notes/${add.data.id}`, { text: 'Hacked' })).status, 404);
  assert.equal((await eva('PUT', `/api/properties/${evaPid}/shifts/notes/${add.data.id}`, { day: '2026-10-12', type: 'evening' })).status, 404);
  await eva('DELETE', `/api/properties/${evaPid}/shifts/notes/${add.data.id}`);
  assert.equal((await eva('GET', week(evaPid))).data.notes.length, 0);
  assert.deepEqual((await bob('GET', week(pid))).data.notes.map(n => n.text), ['Costello only']);
});

test('kinds of shift keep the order they are saved in (Settings → Shifts, dragged)', async () => {
  const { bob, pid } = await team();
  const s = await bob('PUT', `/api/properties/${pid}/settings`, { shiftTypes: [
    { key: 'evening', name: 'Evening', start: '15:00', end: '23:00' },
    { name: 'Night', start: '23:00', end: '07:00' },
    { key: 'morning', name: 'Morning', start: '07:00', end: '15:00' },
  ] });
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.shiftTypes.map(t => t.name), ['Evening', 'Night', 'Morning']);
  assert.deepEqual((await bob('GET', week(pid))).data.types.map(t => t.name), ['Evening', 'Night', 'Morning']);
});

test('shift days are real calendar days, not far in the future; notes have a ceiling', async () => {
  const { bob, pid, gaiaId } = await team();
  const notes = `/api/properties/${pid}/shifts/notes`;
  for (const day of ['2026-02-31', '2026-13-01', '9999-01-01', '1999-12-31']) {
    assert.equal((await bob('POST', notes, { day, type: 'morning', text: 'Hi' })).status, 400, day);
    assert.equal((await bob('POST', `/api/properties/${pid}/shifts`, { day, type: 'morning', userId: gaiaId })).status, 400, day);
  }
  assert.equal((await bob('POST', notes, { day: '2026-02-28', type: 'morning', text: 'Hi' })).status, 201);
  await env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4999)
    INSERT INTO shift_notes (id, property_id, day, type_key, text, created_by, created_at, updated_at)
    SELECT 'x' || i, ?, '2026-03-01', 'morning', 'x', NULL, 0, 0 FROM n`).bind(pid).run();
  const full = await bob('POST', notes, { day: '2026-03-02', type: 'morning', text: 'One more' });
  assert.equal(full.status, 409);
});

test('a week copied over the next one (own hours kept, what was there replaced) or cleared; only by who plans', async () => {
  const { bob, gaia, eva, pid, gaiaId } = await team();
  const shifts = `/api/properties/${pid}/shifts`;
  const bobId = (await bob('GET', week(pid))).data.me;
  const a = (await bob('POST', shifts, { day: '2026-10-12', type: 'morning', userId: gaiaId })).data;
  await bob('PUT', `${shifts}/${a.id}`, { start: '08:00', end: '14:00' });
  await bob('POST', shifts, { day: '2026-10-18', type: 'evening', userId: bobId });
  await bob('POST', shifts, { day: '2026-10-14', type: 'evening', userId: gaiaId });
  await bob('POST', shifts, { day: '2026-10-21', type: 'evening', userId: gaiaId });
  await bob('POST', shifts, { day: '2026-10-23', type: 'morning', userId: bobId }); // next week's own: replaced
  await bob('POST', `${shifts}/notes`, { day: '2026-10-23', type: 'morning', text: 'Delivery' }); // notes stay
  await bob('POST', `${shifts}/notes`, { day: '2026-10-13', type: 'morning', text: 'Inventory' });

  assert.equal((await gaia('POST', `${shifts}/week`, { from: '2026-10-12', action: 'copy' })).status, 403);
  assert.equal((await eva('POST', `${shifts}/week`, { from: '2026-10-12', action: 'clear' })).status, 404);
  assert.equal((await bob('POST', `${shifts}/week`, { from: 'monday', action: 'copy' })).status, 400);
  assert.equal((await bob('POST', `${shifts}/week`, { from: '2026-10-12', action: 'what' })).status, 400);

  const copy = await bob('POST', `${shifts}/week`, { from: '2026-10-12', action: 'copy' });
  assert.equal(copy.data.copied, 3);
  const next = (await bob('GET', `/api/properties/${pid}/shifts?from=2026-10-19&days=7`)).data;
  const seen = next.shifts.map(s => `${s.day} ${s.type} ${s.userId === gaiaId ? 'gaia' : 'bob'} ${s.start || ''}`).sort();
  assert.deepEqual(seen, ['2026-10-19 morning gaia 08:00', '2026-10-21 evening gaia ', '2026-10-25 evening bob ']);
  assert.deepEqual(next.notes.map(n => n.text), ['Delivery']); // notes stay on their day

  await bob('POST', `${shifts}/week`, { from: '2026-10-12', action: 'clear' });
  const before = (await bob('GET', week(pid))).data;
  assert.deepEqual([before.shifts.length, before.notes.length], [0, 0]);
  assert.equal((await bob('GET', `/api/properties/${pid}/shifts?from=2026-10-19&days=7`)).data.shifts.length, 3);
});
