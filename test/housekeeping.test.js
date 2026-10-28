import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
let env;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY };
});

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
  await owner('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'staffpass1' });
  const staff = client();
  await staff('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'staffpass1' });
  return { owner, staff, pid };
}

const LINEN = [
  { key: 'pillow', label: 'Pillow protector', days: 30 },
  { key: 'mattress', label: 'Mattress protector', days: 30 },
  { key: 'blanket', label: 'Blanket cover', days: 30 },
];

const MAP = {
  rooms: [{ name: 'Dorm A', kind: 'room', x: 0, y: 0, w: 12, h: 10 }, { name: 'Bagno', kind: 'other', x: 12, y: 0, w: 5, h: 5 }],
  frames: [
    { kind: 'bunk', x: 1, y: 1, w: 4, h: 2, beds: [{ label: '1' }, { label: '2' }] },
    { kind: 'single', x: 1, y: 5, w: 4, h: 2, beds: [{ label: '3' }] },
  ],
};

test('empty property: no linen items until the owner adds them, empty map', async () => {
  const { staff, pid } = await team();
  const r = await staff('GET', `/api/properties/${pid}/housekeeping`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.linen, []);
  assert.deepEqual(r.data.rooms, []);
  assert.deepEqual(r.data.frames, []);
});

test('owner saves the map; ids and linen history survive a re-save', async () => {
  const { owner, staff, pid } = await team();
  await owner('PUT', `/api/properties/${pid}/settings`, { linen: LINEN });
  assert.equal((await staff('PUT', `/api/properties/${pid}/housekeeping/map`, MAP)).status, 403);
  const saved = await owner('PUT', `/api/properties/${pid}/housekeeping/map`, MAP);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.rooms.map(r => [r.name, r.kind]), [['Dorm A', 'room'], ['Bagno', 'other']]);
  const bunk = saved.data.frames.find(f => f.kind === 'bunk');
  assert.deepEqual(bunk.beds.map(b => [b.level, b.label]), [[0, '1'], [1, '2']]);

  const bed1 = bunk.beds[0].id;
  await staff('POST', `/api/properties/${pid}/beds/${bed1}`, { changed: ['pillow', 'mattress'] });

  // Move the bunk, renumber the upper bed, drop the single bed.
  const again = await owner('PUT', `/api/properties/${pid}/housekeeping/map`, {
    rooms: saved.data.rooms,
    frames: [{ ...bunk, x: 6, beds: [bunk.beds[0], { ...bunk.beds[1], label: '2B' }] }],
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.frames.length, 1);
  const f = again.data.frames[0];
  assert.equal(f.id, bunk.id);
  assert.equal(f.x, 6);
  assert.equal(f.beds[0].id, bed1);
  assert.equal(f.beds[1].label, '2B');
  assert.deepEqual(Object.keys(f.beds[0].linen).sort(), ['mattress', 'pillow']);
  assert.equal(f.beds[0].linen.pillow.by, 'Gaia');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM beds').first()).n, 2);
});

test('map validation', async () => {
  const { owner, pid } = await team();
  const put = body => owner('PUT', `/api/properties/${pid}/housekeeping/map`, body);
  assert.equal((await put({ rooms: [{ name: '', x: 0, y: 0, w: 2, h: 2 }] })).status, 400);
  assert.equal((await put({ rooms: [{ name: 'A', x: -1, y: 0, w: 2, h: 2 }] })).status, 400);
  assert.equal((await put({ frames: [{ kind: 'sofa', x: 0, y: 0, w: 2, h: 4, beds: [{ label: '1' }] }] })).status, 400);
  assert.equal((await put({ frames: [{ kind: 'bunk', x: 0, y: 0, w: 2, h: 4, beds: [{ label: '1' }] }] })).status, 400);
  const dup = await put({ frames: [{ kind: 'bunk', x: 0, y: 0, w: 2, h: 4, beds: [{ label: '1' }, { label: '1' }] }] });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /used twice/);
});

test('bed actions and what the dashboard shows', async () => {
  const { owner, staff, pid } = await team();
  await owner('PUT', `/api/properties/${pid}/settings`, { linen: LINEN });
  const map = (await owner('PUT', `/api/properties/${pid}/housekeeping/map`, MAP)).data;
  const [b1, b2] = map.frames[0].beds;
  // Housekeeping on the Dashboard is still in preview.
  await env.DB.prepare('UPDATE properties SET preview = 1 WHERE id = ?').bind(pid).run();

  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, {})).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { changed: ['towel'] })).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/nope`, { made: true })).status, 404);

  // Sheets only where the owner tracks them.
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'dirty' })).status, 400);
  await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3 } });
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'wet' })).status, 400);
  const out = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'dirty' });
  assert.equal(out.data.frames[0].beds[0].sheets.state, 'dirty');
  // Linen changed 40 days ago is past the 30-day limit.
  await env.DB.prepare("INSERT INTO bed_linen (bed_id, item, changed_at) VALUES (?, 'blanket', ?)")
    .bind(b2.id, Date.now() - 40 * 24 * 3600 * 1000).run();
  let board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(board.attention.filter(a => a.type === 'beds' || a.type === 'linen'),
    [{ type: 'beds', count: 1 }, { type: 'linen', count: 1 }]);

  const clean = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'clean' });
  const cb = clean.data.frames[0].beds[0];
  assert.equal(cb.sheets.state, 'clean');
  assert.ok(cb.sheets.at);
  assert.equal(cb.sheets.by, 'Gaia');
  // The day corrected by hand: put on two days ago (not in the future, not nonsense).
  const day = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const fixed = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheetsDay: day });
  assert.equal(fixed.data.frames[0].beds[0].sheets.state, 'clean');
  assert.equal(new Date(fixed.data.frames[0].beds[0].sheets.at).toISOString().slice(0, 10), day);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheetsDay: '2999-01-01' })).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheetsDay: 'yesterday' })).status, 400);
  const used = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'in_use', sheetsDay: day });
  assert.equal(used.data.frames[0].beds[0].sheets.state, 'in_use');
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'clean' });
  await staff('POST', `/api/properties/${pid}/beds/${b2.id}`, { changed: ['blanket'] });
  board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(board.attention.filter(a => a.type === 'beds' || a.type === 'linen'), []);

  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('POST', `/api/properties/${pid}/beds/${b1.id}`, { made: true })).status, 404);
});

test('owner sets the linen items in Settings', async () => {
  const { owner, pid } = await team();
  const r = await owner('PUT', `/api/properties/${pid}/settings`, {
    linen: [{ key: 'pillow', label: 'Pillow protector', days: 14 }, { label: 'Curtain', days: 90 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.linen[0].days, 14);
  assert.equal(r.data.linen[1].label, 'Curtain');
  assert.match(r.data.linen[1].key, /^[\w-]+$/);
  assert.deepEqual((await owner('PUT', `/api/properties/${pid}/settings`, { linen: [] })).data.linen, []);
  assert.equal((await owner('PUT', `/api/properties/${pid}/settings`, { linen: Array(9).fill({ label: 'x', days: 1 }) })).status, 400);
  assert.equal((await owner('PUT', `/api/properties/${pid}/settings`, { linen: [{ label: 'x', days: 0 }] })).status, 400);
});

test('beds belong to a room directly; new rooms can get beds in the same save', async () => {
  const { owner, pid } = await team();
  const put = body => owner('PUT', `/api/properties/${pid}/housekeeping/map`, body);
  const r = await put({
    rooms: [{ id: 'new-a', name: 'Dorm A', kind: 'room', x: 0, y: 0, w: 8, h: 6 }],
    frames: [
      { kind: 'bunk', roomId: 'new-a', beds: [{ label: '1' }, { label: '2' }] },
      { kind: 'single', roomId: null, beds: [{ label: '9' }] },
    ],
  });
  assert.equal(r.status, 200);
  const room = r.data.rooms[0];
  assert.notEqual(room.id, 'new-a');
  assert.deepEqual(r.data.frames.map(f => [f.kind, f.roomId]), [['bunk', room.id], ['single', null]]);

  // Re-saving with the stored ids keeps the room link.
  const again = await put({ rooms: r.data.rooms, frames: r.data.frames });
  assert.equal(again.data.frames.find(f => f.kind === 'bunk').roomId, room.id);
  assert.equal(again.data.frames.find(f => f.kind === 'bunk').id, r.data.frames.find(f => f.kind === 'bunk').id);

  const bad = await put({ rooms: [], frames: [{ kind: 'single', roomId: 'nope', beds: [{ label: '1' }] }] });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /not on the map/);
});

test('rooms keep the order they were saved in (Settings → Property, drag and drop), not the map position', async () => {
  const { owner, pid } = await team();
  const room = (id, name, x) => ({ id, name, kind: 'room', x, y: 0, w: 2, h: 2 });
  await owner('PUT', `/api/properties/${pid}/housekeeping/map`, { rooms: [room('a', 'Dorm A', 0), room('b', 'Dorm B', 2), room('c', 'Double 1', 4)], frames: [] });
  let hk = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data;
  assert.deepEqual(hk.rooms.map(r => r.name), ['Dorm A', 'Dorm B', 'Double 1']);
  // Double 1 dragged to the top; the map stays as it was.
  const [a, b, c] = hk.rooms;
  await owner('PUT', `/api/properties/${pid}/housekeeping/map`, { rooms: [c, a, b], frames: [] });
  hk = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data;
  assert.deepEqual(hk.rooms.map(r => r.name), ['Double 1', 'Dorm A', 'Dorm B']);
  assert.deepEqual(hk.rooms.map(r => r.x), [4, 0, 2]);
});

test('bed numbers start from 1 in every room — and the migration renumbers the old ones room by room', async () => {
  const { owner, pid } = await team();
  const room = (id, name, x) => ({ id, name, kind: 'room', x, y: 0, w: 4, h: 4 });
  const bed = (roomId, label) => ({ kind: 'single', roomId, x: 0, y: 0, w: 1, h: 2, beds: [{ label }] });
  // Old style: counted across the property (1–2 in A, 3–4 in B).
  let r = await owner('PUT', `/api/properties/${pid}/housekeeping/map`, {
    rooms: [room('a', 'Dorm A', 0), room('b', 'Dorm B', 4)],
    frames: [bed('a', '1'), bed('a', '2'), bed('b', '3'), bed('b', '4')],
  });
  assert.equal(r.status, 200);
  const { readFileSync } = await import('node:fs');
  await env.DB.prepare(readFileSync(new URL('../migrations/0027_beds_per_room.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '')).run();
  const hk = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data;
  const labelsIn = name => hk.frames.filter(f => f.roomId === hk.rooms.find(x => x.name === name).id).flatMap(f => f.beds.map(b => b.label)).sort();
  assert.deepEqual(labelsIn('Dorm A'), ['1', '2']);
  assert.deepEqual(labelsIn('Dorm B'), ['1', '2']);
  // The same number in two rooms is fine; twice in one room is not.
  const [a, b] = hk.rooms;
  r = await owner('PUT', `/api/properties/${pid}/housekeeping/map`, { rooms: [a, b], frames: [bed(a.id, '1'), bed(b.id, '1')] });
  assert.equal(r.status, 200);
  r = await owner('PUT', `/api/properties/${pid}/housekeeping/map`, { rooms: [a, b], frames: [bed(a.id, '1'), bed(a.id, '1')] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /used twice in one room/);
});

test('recurring tasks: the owner sets them up, anyone ticks them off, the dashboard counts what is due', async () => {
  const { owner, staff, pid } = await team();
  await env.DB.prepare('UPDATE properties SET preview = 1').run(); // housekeeping is in preview
  await owner('PUT', `/api/properties/${pid}/housekeeping/map`, { rooms: [{ id: 'k', name: 'Kitchen', kind: 'room', x: 0, y: 0, w: 2, h: 2 }], frames: [] });
  const kitchen = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data.rooms[0].id;
  const tasks = [{ name: 'Clean the fridge', everyDays: 7, roomId: kitchen }, { name: 'Wash the curtains', everyDays: 90 }];
  assert.equal((await staff('PUT', `/api/properties/${pid}/housekeeping/tasks`, { tasks })).status, 403);
  assert.equal((await owner('PUT', `/api/properties/${pid}/housekeeping/tasks`, { tasks: [{ name: '', everyDays: 7 }] })).status, 400);
  assert.equal((await owner('PUT', `/api/properties/${pid}/housekeeping/tasks`, { tasks: [{ name: 'x', everyDays: 0 }] })).status, 400);
  assert.equal((await owner('PUT', `/api/properties/${pid}/housekeeping/tasks`, { tasks: [{ name: 'x', everyDays: 7, roomId: 'nope' }] })).status, 400);
  let r = await owner('PUT', `/api/properties/${pid}/housekeeping/tasks`, { tasks });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.tasks.map(t => [t.name, t.everyDays, t.roomId, t.doneAt]), [['Clean the fridge', 7, kitchen, null], ['Wash the curtains', 90, null, null]]);
  const [fridge, curtains] = r.data.tasks;

  // Never done: both due.
  let attention = (await staff('GET', `/api/properties/${pid}/board`)).data.attention;
  assert.deepEqual(attention.find(a => a.type === 'hktasks'), { type: 'hktasks', count: 2 });

  r = await staff('POST', `/api/properties/${pid}/housekeeping/tasks/${fridge.id}/done`, {});
  assert.equal(r.status, 200);
  const done = r.data.tasks.find(t => t.id === fridge.id);
  assert.ok(done.doneAt > 0);
  assert.equal(done.doneBy, 'Gaia');
  attention = (await owner('GET', `/api/properties/${pid}/board`)).data.attention;
  assert.equal(attention.find(a => a.type === 'hktasks').count, 1);

  // Renaming keeps when it was done; a task taken out is gone.
  r = await owner('PUT', `/api/properties/${pid}/housekeeping/tasks`, { tasks: [{ id: fridge.id, name: 'Clean the fridge well', everyDays: 7, roomId: kitchen }] });
  assert.deepEqual(r.data.tasks.map(t => [t.name, t.doneAt]), [['Clean the fridge well', done.doneAt]]);
  assert.equal((await staff('POST', `/api/properties/${pid}/housekeeping/tasks/${curtains.id}/done`, {})).status, 404);

  // A tap by mistake: undo puts back the time before.
  r = await staff('POST', `/api/properties/${pid}/housekeeping/tasks/${fridge.id}/done`, { undo: true, previous: null });
  assert.equal(r.data.tasks[0].doneAt, null);
  // Due again once its days are up.
  await env.DB.prepare('UPDATE hk_tasks SET done_at = ?').bind(Date.now() - 7 * 86400000).run();
  attention = (await owner('GET', `/api/properties/${pid}/board`)).data.attention;
  assert.equal(attention.find(a => a.type === 'hktasks').count, 1);
});

test('a bed: correct by hand when linen was changed last (Edit)', async () => {
  const { owner, staff, pid } = await team();
  await owner('PUT', `/api/properties/${pid}/settings`, { linen: LINEN });
  await owner('PUT', `/api/properties/${pid}/housekeeping/map`, {
    rooms: [{ id: 'a', name: 'Dorm A', kind: 'room', x: 0, y: 0, w: 4, h: 4 }],
    frames: [{ kind: 'single', roomId: 'a', x: 0, y: 0, w: 1, h: 2, beds: [{ label: '1' }] }],
  });
  const bedId = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data.frames[0].beds[0].id;
  const day = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  let r = await staff('POST', `/api/properties/${pid}/beds/${bedId}`, { set: { pillow: day, mattress: day } });
  assert.equal(r.status, 200);
  let linen = r.data.frames[0].beds[0].linen;
  assert.equal(new Date(linen.pillow.at).toISOString().slice(0, 10), day);
  assert.equal(linen.pillow.by, 'Gaia');
  r = await staff('POST', `/api/properties/${pid}/beds/${bedId}`, { set: { mattress: null } });
  linen = r.data.frames[0].beds[0].linen;
  assert.equal(linen.mattress, undefined, 'cleared: never changed');
  assert.ok(linen.pillow);
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${bedId}`, { set: { pillow: tomorrow } })).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${bedId}`, { set: { pillow: '5.10.2026' } })).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${bedId}`, { set: { towels: day } })).status, 400);
});

test('daily sheets: off by default, owner turns them on, reminder after the days in use', async () => {
  const { owner, staff, pid } = await team();
  const map = (await owner('PUT', `/api/properties/${pid}/housekeeping/map`, MAP)).data;
  const [b1, b2] = map.frames[0].beds;
  let hk = (await staff('GET', `/api/properties/${pid}/housekeeping`)).data;
  assert.deepEqual(hk.sheets, { track: false, days: null, linenInUse: false });
  assert.equal(hk.frames[0].beds[0].sheets, null);

  // Only the owner sets it, and the days are checked.
  assert.equal((await staff('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3 } })).status, 403);
  assert.equal((await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 0 } })).status, 400);
  assert.equal((await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 61 } })).status, 400);
  const set = await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3 } });
  assert.deepEqual(set.data.sheets, { track: true, days: 3, linenInUse: false });
  // Saving other settings leaves it alone.
  await owner('PUT', `/api/properties/${pid}/settings`, { linen: LINEN });
  hk = (await staff('GET', `/api/properties/${pid}/housekeeping`)).data;
  assert.deepEqual(hk.sheets, { track: true, days: 3, linenInUse: false });

  // In use: tapping In use again keeps the date, so the days keep counting.
  const r = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'in_use' });
  const at = r.data.frames[0].beds[0].sheets.at - 4 * 24 * 3600 * 1000;
  await env.DB.prepare('UPDATE beds SET sheets_at = ? WHERE id = ?').bind(at, b1.id).run();
  const again = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'in_use' });
  assert.equal(again.data.frames[0].beds[0].sheets.at, at);
  await staff('POST', `/api/properties/${pid}/beds/${b2.id}`, { sheets: 'in_use' }); // just put on: not due
  const hkOf = board => board.attention.filter(a => ['beds', 'sheets'].includes(a.type));
  let board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(hkOf(board), [{ type: 'sheets', count: 1 }]);

  // Changed: dirty counts as to make up, and the reminder goes.
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'dirty' });
  board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(hkOf(board), [{ type: 'beds', count: 1 }]);
  // "Everything changed" from a phone still on the old version (made + changed) sets them clean.
  const all = await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { made: true, changed: ['pillow'] });
  assert.equal(all.data.frames[0].beds[0].sheets.state, 'clean');

  // No reminder without days; nothing on the Dashboard once tracking is off.
  await env.DB.prepare('UPDATE beds SET sheets = ?, sheets_at = ? WHERE id = ?').bind('in_use', Date.now() - 10 * 24 * 3600 * 1000, b1.id).run();
  await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: null } });
  board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(hkOf(board), []);
  await env.DB.prepare("UPDATE beds SET sheets = 'dirty' WHERE id = ?").bind(b2.id).run();
  await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: false, days: 3 } });
  board = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(hkOf(board), []);
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'clean' })).status, 400);
  // The old "Everything changed" without tracking: only the linen.
  assert.equal((await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { made: true, changed: ['pillow'] })).status, 200);

  // Another property's bed can't be touched.
  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'clean' })).status, 404);
});

test('migration 0060: beds marked with the old Clean / Dirty switch keep it as daily sheets', async () => {
  const { owner, pid } = await team();
  const map = (await owner('PUT', `/api/properties/${pid}/housekeeping/map`, MAP)).data;
  const [b1, b2] = map.frames[0].beds;
  // Rows as the switch (0058) left them; then 0060's data part runs again.
  await env.DB.prepare("UPDATE beds SET dirty_since = 1000, state_by = (SELECT id FROM users WHERE email = 'bob@example.com') WHERE id = ?").bind(b1.id).run();
  await env.DB.prepare('UPDATE beds SET clean_since = 2000 WHERE id = ?').bind(b2.id).run();
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../migrations/0060_daily_sheets.sql', import.meta.url), 'utf8')
    .replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(s => s.startsWith('UPDATE'));
  for (const s of sql) await env.DB.prepare(s).run();
  const hk = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data;
  assert.deepEqual(hk.sheets, { track: true, days: 3, linenInUse: false });
  const beds = hk.frames[0].beds;
  assert.deepEqual([beds[0].sheets.state, beds[0].sheets.at, beds[0].sheets.by], ['dirty', 1000, 'Bob']);
  assert.deepEqual([beds[1].sheets.state, beds[1].sheets.at], ['clean', 2000]);
  const old = await env.DB.prepare('SELECT COUNT(*) AS n FROM beds WHERE dirty_since IS NOT NULL OR clean_since IS NOT NULL OR state_by IS NOT NULL').first();
  assert.equal(old.n, 0);
  // A property that never used the switch stays off.
  const other = client();
  const r = await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.deepEqual((await other('GET', `/api/properties/${r.data.properties[0].id}/housekeeping`)).data.sheets, { track: false, days: null, linenInUse: false });
});

test('linen counts only the days a bed is In use, when the owner says so', async () => {
  const { owner, staff, pid } = await team();
  const DAY = 24 * 3600 * 1000;
  const map = (await owner('PUT', `/api/properties/${pid}/housekeeping/map`, MAP)).data;
  const [b1] = map.frames[0].beds;
  await owner('PUT', `/api/properties/${pid}/settings`, { linen: [{ key: 'blanket', label: 'Blanket cover', days: 14 }] });

  // Needs the daily sheets: without them it stays off.
  let set = await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: false, days: null, linenInUse: true } });
  assert.equal(set.data.sheets.linenInUse, false);
  set = await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3, linenInUse: true } });
  assert.deepEqual(set.data.sheets, { track: true, days: 3, linenInUse: true });
  // The rest of the settings leave it alone.
  await owner('PUT', `/api/properties/${pid}/settings`, { linen: [{ key: 'blanket', label: 'Blanket cover', days: 14 }] });
  assert.equal((await staff('GET', `/api/properties/${pid}/housekeeping`)).data.sheets.linenInUse, true);

  // Blanket changed 20 days ago; since then the bed was In use 5 days, then 6 empty, then In use again for 4.
  const t0 = Date.now() - 20 * DAY;
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { changed: ['blanket'] });
  await env.DB.prepare('UPDATE bed_linen SET changed_at = ? WHERE bed_id = ?').bind(t0, b1.id).run();
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'in_use' });
  await env.DB.prepare('UPDATE beds SET sheets_at = ? WHERE id = ?').bind(t0, b1.id).run();
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'dirty' });
  // That stretch was 20 days long (it ended now): make it the 5 days of the story.
  await env.DB.prepare('UPDATE beds SET in_use_ms = ?, sheets = ?, sheets_at = ? WHERE id = ?').bind(5 * DAY, 'in_use', Date.now() - 4 * DAY, b1.id).run();
  const blanket = async () => (await staff('GET', `/api/properties/${pid}/housekeeping`)).data.frames[0].beds[0].linen.blanket;
  const days = l => Math.round(l.age / DAY);
  assert.equal(days(await blanket()), 9);
  const hkOf = board => board.attention.filter(a => a.type === 'linen');
  assert.deepEqual(hkOf((await staff('GET', `/api/properties/${pid}/board`)).data), []);

  // Off: the calendar days again — 20 days, past the 14.
  await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3, linenInUse: false } });
  assert.equal(days(await blanket()), 20);
  assert.deepEqual(hkOf((await staff('GET', `/api/properties/${pid}/board`)).data), [{ type: 'linen', count: 1 }]);
  await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3, linenInUse: true } });

  // Changed now: counting starts again from the bed's In use total.
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { changed: ['blanket'] });
  assert.equal(days(await blanket()), 0);
  // Two more In use days, then the sheets come off: those two stay counted.
  await env.DB.prepare('UPDATE beds SET sheets_at = sheets_at - ? WHERE id = ?').bind(2 * DAY, b1.id).run();
  assert.equal(days(await blanket()), 2);
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { sheets: 'clean' });
  assert.equal(days(await blanket()), 2);

  // A day typed by hand counts whole: 40 days back is 40 days old, past the 14.
  const ago = new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10);
  await staff('POST', `/api/properties/${pid}/beds/${b1.id}`, { set: { blanket: ago } });
  assert.ok(Math.abs((await blanket()).age - 40 * DAY) <= DAY);
  assert.deepEqual(hkOf((await staff('GET', `/api/properties/${pid}/board`)).data), [{ type: 'linen', count: 1 }]);
  // From then on only the In use days are added (the bed is empty now: no more).
  await env.DB.prepare('UPDATE bed_linen SET changed_at = changed_at - ? WHERE bed_id = ?').bind(10 * DAY, b1.id).run();
  assert.ok(Math.abs((await blanket()).age - 40 * DAY) <= DAY);
});
