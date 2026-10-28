import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { pruneDemos, DEMO_HOURS } from '../src/demo.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const PHOTO = 'data:image/jpeg;base64,' + btoa('fake jpeg bytes');

let env, realFetch, outside, ocrCalls;
beforeEach(() => {
  ocrCalls = 0;
  outside = [];
  env = {
    DB: createD1(),
    ASSETS: { fetch: async () => new Response('app') },
    CREDENTIALS_KEY: KEY,
    ANTHROPIC_API_KEY: 'x',
    readDocument: async () => { ocrCalls++; throw new Error('the demo must not scan'); },
  };
  // Nothing in a demo may reach the outside world.
  realFetch = globalThis.fetch;
  globalThis.fetch = async url => { outside.push(String(url)); throw new Error('no network in a demo'); };
});
afterEach(() => { globalThis.fetch = realFetch; });

function client(ip = '1.2.3.4') {
  let cookie = '';
  return async function call(method, path, body) {
    const headers = { 'CF-Connecting-IP': ip };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

async function startDemo(call) {
  const r = await call('POST', '/api/demo', {});
  assert.equal(r.status, 201);
  const p = r.data.properties[0];
  assert.equal(p.demo, true);
  assert.equal(p.role, 'owner');
  return p.id;
}

test('the demo is a made-up hostel of its own, with something in every tab', async () => {
  const call = client();
  const id = await startDemo(call);
  const base = `/api/properties/${id}`;
  const board = (await call('GET', `${base}/board`)).data;
  assert.ok(board.notes.length >= 5);
  const hk = (await call('GET', `${base}/housekeeping`));
  assert.equal(hk.status, 200);
  assert.ok((await call('GET', `${base}/guests`)).data.length === 3);
  assert.equal((await call('GET', `${base}/shifts`)).status, 200);
  assert.ok((await call('GET', `${base}/staff`)).data.length >= 5);
  // Each visitor their own: a second demo sees nothing of the first.
  const other = client('5.6.7.8');
  const id2 = await startDemo(other);
  assert.notEqual(id, id2);
  assert.equal((await other('GET', `${base}/board`)).status, 404);
  assert.deepEqual(outside, []);
});

test('a scan fills in a made-up guest without Claude; Send only checks them here', async () => {
  const call = client();
  const id = await startDemo(call);
  const base = `/api/properties/${id}/guests`;
  const g = (await call('POST', base, { image: PHOTO })).data;
  assert.equal(ocrCalls, 0);
  assert.ok(g.fields.surname && g.fields.docNumber);
  assert.deepEqual(g.problems, []);
  const drafts = (await call('GET', base)).data;
  const sent = await call('POST', `${base}/send`, { mode: 'send', ids: drafts.map(d => d.id) });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.ok, true);
  assert.equal((await call('GET', base)).data.length, 0);
  assert.deepEqual(outside, []);
  // No scan was counted (the admin centre's costs).
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_monthly').first()).n, 0);
});

test('what would reach the outside world is refused in a demo', async () => {
  const call = client();
  const id = await startDemo(call);
  const base = `/api/properties/${id}`;
  for (const [method, path, body] of [
    ['PUT', `${base}/settings`, { credentials: { user: 'a', password: 'b', wskey: 'c' } }],
    ['POST', `${base}/registration/check`, {}],
    ['POST', `${base}/billing/checkout`, {}],
    ['POST', `${base}/invites`, { email: 'x@example.com' }],
    ['POST', `${base}/staff`, { email: 'x@example.com' }],
    ['POST', `${base}/calendars`, { url: 'https://example.com/a.ics' }],
    ['POST', `${base}/vault/files`, {}],
    ['POST', '/api/assistant', { message: 'hi' }],
    ['POST', '/api/support', { message: 'hi' }],
    ['POST', '/api/properties', { name: 'Mine' }],
  ]) {
    const r = await call(method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.data.code, 'demo');
  }
  // The rest works as in a real hostel.
  assert.equal((await call('PUT', `${base}/settings`, { name: 'My demo' })).status, 200);
  assert.equal((await call('POST', `${base}/notes`, { text: 'hello' })).status, 201);
  assert.deepEqual(outside, []);
});

test('demos go after a day, with their people; real accounts stay', async () => {
  const call = client();
  const id = await startDemo(call);
  const real = client('9.9.9.9');
  assert.equal((await real('POST', '/api/auth/register', {
    name: 'Ann', email: 'ann@example.com', password: 'longpassword1', propertyName: 'Real', acceptTerms: true,
  })).status, 201);
  const users = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
  const before = await users();
  assert.equal(await pruneDemos(env.DB, Date.now()), 0);
  assert.equal(await pruneDemos(env.DB, Date.now() + DEMO_HOURS * 3600000 + 1), 1);
  assert.equal(await env.DB.prepare('SELECT 1 FROM properties WHERE id = ?').bind(id).first(), null);
  assert.equal(await users(), 1);
  assert.ok(before > 1);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await real('GET', '/api/me')).status, 200);
});

test('one visitor can start only a few demos at a time', async () => {
  const call = client();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/demo', {})).status, 201);
  assert.equal((await call('POST', '/api/demo', {})).status, 429);
  assert.equal((await client('2.2.2.2')('POST', '/api/demo', {})).status, 201);
});

test('on the demo\'s device the name tags lead back to the owner, who has no password', async () => {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { 'CF-Connecting-IP': '3.3.3.3', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const me = (await call('POST', '/api/demo', {})).data;
  const people = (await call('GET', '/api/device')).data.properties[0].people;
  const owner = people.find(p => p.owner);
  const giulia = people.find(p => !p.owner);
  assert.equal(owner.password, false);
  assert.equal((await call('POST', '/api/device/signin', { id: giulia.id })).status, 200);
  assert.equal((await call('GET', '/api/me')).data.user.id, giulia.id);
  const back = await call('POST', '/api/device/signin', { id: owner.id });
  assert.equal(back.status, 200);
  assert.equal(back.data.user.id, me.user.id);
});

test('in a demo anyone on the team can step into anyone, the owner too', async () => {
  const call = client('4.4.4.4');
  const id = await startDemo(call);
  const base = `/api/properties/${id}/profiles`;
  const team = (await call('GET', base)).data;
  const giulia = team[0];
  assert.equal((await call('POST', `${base}/${giulia.id}/switch`, {})).status, 200);
  const back = (await call('GET', base)).data;
  const owner = back.find(p => p.name === 'Alex');
  assert.ok(owner, 'the owner is on the list');
  assert.equal((await call('POST', `${base}/${owner.id}/switch`, {})).status, 200);
  assert.equal((await call('GET', '/api/me')).data.user.name, 'Alex');
});

test('a recurring task\'s last-done day can be set by hand', async () => {
  const call = client('6.6.6.6');
  const id = await startDemo(call);
  const base = `/api/properties/${id}/housekeeping`;
  const task = (await call('GET', base)).data.tasks[0];
  const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const r = await call('POST', `${base}/tasks/${task.id}/done`, { day });
  assert.equal(r.status, 200);
  assert.equal(new Date(r.data.tasks.find(t => t.id === task.id).doneAt).toISOString().slice(0, 10), day);
  assert.equal((await call('POST', `${base}/tasks/${task.id}/done`, { day: '2999-01-01' })).status, 400);
});

test('the admin centre counts demos started, tried and gone on to an account — each once', async () => {
  const call = client('7.7.7.7');
  const id = await startDemo(call);
  await startDemo(client('8.8.8.8'));
  const base = `/api/properties/${id}/guests`;
  await call('POST', base, { image: PHOTO });
  await call('POST', base, { image: PHOTO });
  const drafts = (await call('GET', base)).data;
  await call('POST', `${base}/send`, { mode: 'send', ids: drafts.map(d => d.id) });
  assert.equal((await call('POST', '/api/demo/signup', {})).status, 200);
  await call('POST', '/api/demo/signup', {});
  const row = await env.DB.prepare('SELECT SUM(started) AS s, SUM(tried) AS t, SUM(signups) AS u FROM demo_daily').first();
  assert.deepEqual({ ...row }, { s: 2, t: 1, u: 1 });
});
