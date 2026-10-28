import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { parseRoutine, localNow, boardCleanup } from '../src/board.js';

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

test('routine text: blocks, open-ended blocks, bullets, stable ids, errors', () => {
  const { blocks, errors } = parseRoutine(`
8:00-9:00 Opening
- Open terrace
• Coffee

11.00 · Cleaning
Beds
14:00-15:00
Check-outs
`);
  assert.deepEqual(errors, []);
  assert.deepEqual(blocks.map(b => [b.from, b.to, b.label, b.tasks.map(t => t.text)]), [
    [480, 540, 'Opening', ['Open terrace', 'Coffee']],
    [660, 840, 'Cleaning', ['Beds']],
    [840, 900, '', ['Check-outs']],
  ]);
  // Editing another line keeps the ids of the rest.
  const again = parseRoutine('8:00-9:00 Opening\nOpen terrace\nNew task\nCoffee').blocks[0].tasks;
  assert.equal(again[0].id, blocks[0].tasks[0].id);
  assert.equal(again[2].id, blocks[0].tasks[1].id);

  assert.match(parseRoutine('Task without a time').errors[0], /line 1: start with a time/);
  assert.match(parseRoutine('9:00-8:00 Backwards\nx').errors[0], /line 1: the time is not valid/);
  assert.match(parseRoutine('25:00 Late').errors[0], /not valid/);
});

test('local time in the property zone', () => {
  const n = localNow('Europe/Rome', new Date('2026-09-28T22:30:00Z'));
  assert.deepEqual(n, { day: '2026-09-29', date: '29.09.2026', minutes: 30 });
});

test('empty board: only the missing police login needs attention', async () => {
  const { owner, pid } = await team();
  const r = await owner('GET', `/api/properties/${pid}/board`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.attention, [{ type: 'setup' }]);
  assert.deepEqual(r.data.routine, []);
  assert.deepEqual(r.data.notes, []);
});

test('routine: owner saves it, missed tasks need attention until someone ticks them', async () => {
  const { owner, staff, pid } = await team();
  const bad = await owner('PUT', `/api/properties/${pid}/settings`, { routine: 'no time here' });
  assert.equal(bad.status, 400);
  assert.equal((await staff('PUT', `/api/properties/${pid}/settings`, { routine: '0:00 x' })).status, 403);

  // 0:00-0:01 has passed (unless the test runs in that minute); 23:58-23:59 hasn't.
  const saved = await owner('PUT', `/api/properties/${pid}/settings`, { routine: '0:00-0:01 Night\nLock the door\nLights off\n23:58-23:59 Late\nNot yet' });
  assert.equal(saved.status, 200);
  assert.match(saved.data.routine, /Lock the door/);

  let b = (await staff('GET', `/api/properties/${pid}/board`)).data;
  const tasks = b.attention.filter(a => a.type === 'task');
  assert.deepEqual(tasks.map(t => [t.text, t.block]), [['Lock the door', 'Night'], ['Lights off', 'Night']]);

  assert.equal((await staff('POST', `/api/properties/${pid}/board/routine`, { taskIds: ['nope'] })).status, 400);
  const tick = await staff('POST', `/api/properties/${pid}/board/routine`, { taskIds: [tasks[0].id] });
  assert.equal(tick.status, 200);
  b = (await owner('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(b.attention.filter(a => a.type === 'task').map(t => t.text), ['Lights off']);
  assert.equal(b.routine[0].tasks[0].done.by, 'Gaia');

  // Clear all, then untick one.
  await owner('POST', `/api/properties/${pid}/board/routine`, { taskIds: tasks.map(t => t.id) });
  await owner('POST', `/api/properties/${pid}/board/routine`, { taskIds: [tasks[1].id], done: false });
  b = (await owner('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(b.attention.filter(a => a.type === 'task').map(t => t.text), ['Lights off']);
  assert.equal(b.routine[0].tasks[0].done.by, 'Gaia'); // the first tick is kept

  // A week later the ticks are gone. (9 days: cleanup counts days in UTC, the
  // ticks are stamped with the day in Rome — around midnight they differ by one.)
  await boardCleanup(env.DB, Date.now() + 9 * 24 * 3600 * 1000);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM routine_done').first()).n, 0);
});

test('guests waiting and late ones show up', async () => {
  const { owner, pid } = await team();
  const today = localNow('Europe/Rome').date;
  const now = Date.now();
  for (const [id, arrival] of [['g1', '01.01.2020'], ['g2', today], ['g3', '']]) {
    await env.DB.prepare('INSERT INTO guests (id, property_id, status, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, pid, 'pending', JSON.stringify({ arrival }), now, now).run();
  }
  await env.DB.prepare("INSERT INTO guests (id, property_id, status, fields, created_at, updated_at) VALUES ('g4', ?, 'sent', '{}', ?, ?)")
    .bind(pid, now, now).run();
  const b = (await owner('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(b.attention.filter(a => a.type !== 'setup'), [{ type: 'late', count: 1 }, { type: 'waiting', count: 2 }]);
});

test('notes: post, like toggle, delete rights, strangers locked out', async () => {
  const { owner, staff, pid } = await team();
  assert.equal((await staff('POST', `/api/properties/${pid}/notes`, { text: '  ' })).status, 400);
  assert.equal((await staff('POST', `/api/properties/${pid}/notes`, { text: 'x', category: 'weird' })).status, 400);
  const a = await staff('POST', `/api/properties/${pid}/notes`, { text: 'Bed 4 is broken', category: 'broken' });
  assert.equal(a.status, 201);
  const b = await owner('POST', `/api/properties/${pid}/notes`, { text: 'Buy coffee' });

  await owner('POST', `/api/properties/${pid}/notes/${a.data.id}/like`, {});
  let notes = (await staff('GET', `/api/properties/${pid}/board`)).data.notes;
  assert.deepEqual(notes.map(n => [n.text, n.author, n.category, n.likes, n.liked, n.canDelete]), [
    ['Buy coffee', 'Bob', null, [], false, false],
    ['Bed 4 is broken', 'Gaia', 'broken', ['Bob'], false, true],
  ]);
  const unlike = await owner('POST', `/api/properties/${pid}/notes/${a.data.id}/like`, {});
  assert.equal(unlike.data.liked, false);

  assert.equal((await staff('DELETE', `/api/properties/${pid}/notes/${b.data.id}`)).status, 403);
  assert.equal((await owner('DELETE', `/api/properties/${pid}/notes/${a.data.id}`)).status, 200);

  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('GET', `/api/properties/${pid}/board`)).status, 404);
  assert.equal((await stranger('DELETE', `/api/properties/${pid}/notes/${b.data.id}`)).status, 404);
});

test('note replies: anyone on the team replies, author or owner deletes, gone with the note', async () => {
  const { owner, staff, pid } = await team();
  const n = await owner('POST', `/api/properties/${pid}/notes`, { text: 'Who has the key?' });
  const url = `/api/properties/${pid}/notes/${n.data.id}/replies`;
  assert.equal((await staff('POST', url, { text: ' ' })).status, 400);
  const r = await staff('POST', url, { text: 'Me, at the desk' });
  assert.equal(r.status, 201);
  await owner('POST', url, { text: 'Thanks!' });
  let note = (await staff('GET', `/api/properties/${pid}/board`)).data.notes[0];
  assert.deepEqual(note.replies.map(x => [x.author, x.text, x.canDelete]), [['Gaia', 'Me, at the desk', true], ['Bob', 'Thanks!', false]]);
  assert.equal((await staff('DELETE', `${url}/${note.replies[1].id}`)).status, 403);
  assert.equal((await owner('DELETE', `${url}/${note.replies[0].id}`)).status, 200);
  note = (await staff('GET', `/api/properties/${pid}/board`)).data.notes[0];
  assert.deepEqual(note.replies.map(x => x.text), ['Thanks!']);
  assert.equal((await owner('DELETE', `/api/properties/${pid}/notes/${n.data.id}`)).status, 200);
  assert.equal((await staff('POST', url, { text: 'late' })).status, 404);
});

test('owner puts a note into Needs attention for everyone; staff cannot', async () => {
  const { owner, staff, pid } = await team();
  const n = await staff('POST', `/api/properties/${pid}/notes`, { text: 'The boiler makes a noise' });
  const url = `/api/properties/${pid}/notes/${n.data.id}/attention`;
  assert.equal((await staff('POST', url, { on: true })).status, 403);
  assert.equal((await owner('POST', url, { on: true })).status, 200);
  let b = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(b.attention[0], { type: 'note', id: n.data.id, text: 'The boiler makes a noise', author: 'Gaia' });
  assert.equal(b.notes[0].attention, true);
  assert.equal(b.notes[0].canFlag, false);
  assert.equal((await owner('GET', `/api/properties/${pid}/board`)).data.notes[0].canFlag, true);
  await owner('POST', url, { on: false });
  b = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.ok(!b.attention.some(a => a.type === 'note'));
});

test('a new note can go straight into Needs attention — owner only', async () => {
  const { owner, staff, pid } = await team();
  assert.equal((await staff('POST', `/api/properties/${pid}/notes`, { text: 'Urgent', attention: true })).status, 403);
  const n = await owner('POST', `/api/properties/${pid}/notes`, { text: 'Fire drill at 10', category: null, attention: true });
  assert.equal(n.status, 201);
  const b = (await staff('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual(b.attention[0], { type: 'note', id: n.data.id, text: 'Fire drill at 10', author: 'Bob' });
});

test('editing a note: author or owner; attention only by the owner; marked as edited', async () => {
  const { owner, staff, pid } = await team();
  const mine = await staff('POST', `/api/properties/${pid}/notes`, { text: 'Bed 4 squeaks', category: 'broken' });
  const bobs = await owner('POST', `/api/properties/${pid}/notes`, { text: 'Buy coffee' });
  const put = (who, id, body) => who('PUT', `/api/properties/${pid}/notes/${id}`, body);
  assert.equal((await put(staff, bobs.data.id, { text: 'Buy tea' })).status, 403);
  assert.equal((await put(staff, mine.data.id, { text: '  ' })).status, 400);
  assert.equal((await put(staff, mine.data.id, { text: 'Bed 4 squeaks a lot', category: 'broken', attention: true })).status, 200);
  let notes = (await owner('GET', `/api/properties/${pid}/board`)).data.notes;
  let n = notes.find(x => x.id === mine.data.id);
  assert.equal(n.text, 'Bed 4 squeaks a lot');
  assert.equal(n.attention, false); // staff can't put it into Needs attention
  assert.ok(n.editedAt);
  assert.equal((await put(owner, mine.data.id, { text: 'Bed 4: fixed?', category: null, attention: true })).status, 200);
  n = (await owner('GET', `/api/properties/${pid}/board`)).data.notes.find(x => x.id === mine.data.id);
  assert.deepEqual([n.text, n.category, n.attention], ['Bed 4: fixed?', null, true]);
  // The author editing again keeps the owner's flag.
  await put(staff, mine.data.id, { text: 'Bed 4: fixed!' });
  n = (await owner('GET', `/api/properties/${pid}/board`)).data.notes.find(x => x.id === mine.data.id);
  assert.deepEqual([n.text, n.attention], ['Bed 4: fixed!', true]);
});

test('Housekeeping items on the Dashboard for every property, not just those in preview', async () => {
  const { owner, pid } = await team();
  assert.equal((await owner('GET', '/api/me')).data.properties[0].preview, 0);
  await owner('PUT', `/api/properties/${pid}/housekeeping/map`, {
    rooms: [{ id: 'r', name: 'Dorm', kind: 'room', x: 0, y: 0, w: 4, h: 4 }],
    frames: [{ kind: 'single', roomId: 'r', beds: [{ label: '1' }] }],
  });
  const bed = (await owner('GET', `/api/properties/${pid}/housekeeping`)).data.frames[0].beds[0];
  await owner('PUT', `/api/properties/${pid}/settings`, { sheets: { track: true, days: 3 } });
  await owner('POST', `/api/properties/${pid}/beds/${bed.id}`, { sheets: 'dirty' });
  const types = (await owner('GET', `/api/properties/${pid}/board`)).data.attention.map(a => a.type);
  assert.ok(types.includes('beds'));
});

test('end of shift: anyone on the team writes one; it comes back as a handover, and can be taken off by editing', async () => {
  const { staff, owner, pid } = await team();
  const n = await staff('POST', `/api/properties/${pid}/notes`, { text: 'Room 3 key is at the bar', handover: true });
  assert.equal(n.status, 201);
  let note = (await owner('GET', `/api/properties/${pid}/board`)).data.notes.find(x => x.id === n.data.id);
  assert.equal(note.handover, true);
  await staff('PUT', `/api/properties/${pid}/notes/${n.data.id}`, { text: 'Room 3 key is at the bar', handover: false });
  note = (await owner('GET', `/api/properties/${pid}/board`)).data.notes.find(x => x.id === n.data.id);
  assert.equal(note.handover, false);
});

test('end of shift: whoever read it ticks it off the Dashboard for everyone; it stays a note and can come back', async () => {
  const { staff, owner, pid } = await team();
  const n = await owner('POST', `/api/properties/${pid}/notes`, { text: 'Checkout of room 2 at noon', handover: true });
  const find = async () => (await owner('GET', `/api/properties/${pid}/board`)).data.notes.find(x => x.id === n.data.id);
  assert.equal((await find()).handoverDone, false);
  assert.equal((await staff('POST', `/api/properties/${pid}/notes/${n.data.id}/handover-done`, { done: true })).status, 200);
  const note = await find();
  assert.equal(note.handoverDone, true);
  assert.equal(note.handover, true, 'still marked as end of shift in Notes');
  await staff('POST', `/api/properties/${pid}/notes/${n.data.id}/handover-done`, { done: false });
  assert.equal((await find()).handoverDone, false);
});
