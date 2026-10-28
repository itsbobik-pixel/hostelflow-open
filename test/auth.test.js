import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { hashPassword, verifyPassword, needsRehash } from '../src/auth.js';
import { TERMS_VERSION, LEGAL_LIVE } from '../src/api.js';
import { createD1 } from './helpers/d1.js';

let env;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') } };
});

// Tiny client that keeps the session cookie like a browser would.
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
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, data: await res.json(), setCookie: set };
  };
}

const owner = { name: 'Bob', email: 'Bob@Example.com', password: 'correct horse', propertyName: 'Hostel Costello', acceptTerms: true };

test('password hashing: random salt, verify, iteration count stored', async () => {
  const a = await hashPassword('secret123', 1000);
  const b = await hashPassword('secret123', 1000);
  assert.notEqual(a, b);
  assert.match(a, /^pbkdf2-sha256\$1000\$/);
  assert.equal(await verifyPassword('secret123', a), true);
  assert.equal(await verifyPassword('secret124', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.equal(needsRehash(a), true);
});

test('register creates user + property + owner role and signs in', async () => {
  const call = client();
  const r = await call('POST', '/api/auth/register', owner);
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /^hf_session=[\w-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  assert.equal(r.data.user.email, 'bob@example.com');
  assert.deepEqual(r.data.properties.map(p => [p.name, p.role]), [['Hostel Costello', 'owner']]);

  const me = await call('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, 'Bob');

  const stored = await env.DB.prepare('SELECT password_hash, terms_accepted_at, terms_version FROM users').first();
  // Acceptance is recorded only once the terms are online.
  assert.equal(stored.terms_version, LEGAL_LIVE ? TERMS_VERSION : null);
  assert.equal(stored.terms_accepted_at > 0, LEGAL_LIVE);
  assert.ok(!stored.password_hash.includes('correct horse'));
  const session = await env.DB.prepare('SELECT id_hash FROM sessions').first();
  assert.ok(!r.setCookie.includes(session.id_hash), 'only the hash of the token is stored');
});

test('register validation and duplicate e-mail', async () => {
  const call = client();
  assert.equal((await call('POST', '/api/auth/register', { ...owner, password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { ...owner, email: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { ...owner, propertyName: ' ', acceptTerms: true })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', owner)).status, 201);
  const dup = await client()('POST', '/api/auth/register', { ...owner, email: 'BOB@example.com' });
  assert.equal(dup.status, 409);
});

test('the Terms of Service box must be ticked once the legal pages are live', async () => {
  for (const acceptTerms of [undefined, false, 'yes']) {
    const r = await client()('POST', '/api/auth/register', { ...owner, email: `t${acceptTerms}@example.com`, acceptTerms });
    if (LEGAL_LIVE) {
      assert.equal(r.status, 400);
      assert.match(r.data.error, /Terms of Service/);
    } else {
      assert.equal(r.status, 201, 'not asked while the pages are hidden');
    }
  }
});

test('login, logout, wrong password', async () => {
  await client()('POST', '/api/auth/register', owner);
  const call = client();
  assert.equal((await call('POST', '/api/auth/login', { email: 'bob@example.com', password: 'wrong pass' })).status, 401);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'BOB@example.com', password: 'correct horse' })).status, 200);
  assert.equal((await call('GET', '/api/me')).status, 200);
  assert.equal((await call('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/me')).status, 401);
});

test('login is blocked after 10 failures', async () => {
  await client()('POST', '/api/auth/register', owner);
  const call = client();
  for (let i = 0; i < 10; i++) await call('POST', '/api/auth/login', { email: 'bob@example.com', password: 'nope nope' });
  const r = await call('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  assert.equal(r.status, 429);
});

test('POST without JSON content type is rejected (CSRF guard)', async () => {
  const res = await worker.fetch(new Request('https://hf.example/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b',
  }), env);
  assert.equal(res.status, 415);
});

test('change own password signs out other sessions', async () => {
  const a = client();
  await a('POST', '/api/auth/register', owner);
  const b = client();
  await b('POST', '/api/auth/login', { email: owner.email, password: owner.password });
  assert.equal((await a('POST', '/api/auth/password', { currentPassword: 'bad', newPassword: 'new password 1' })).status, 401);
  assert.equal((await a('POST', '/api/auth/password', { currentPassword: owner.password, newPassword: 'new password 1' })).status, 200);
  assert.equal((await a('GET', '/api/me')).status, 200, 'current device stays signed in');
  assert.equal((await b('GET', '/api/me')).status, 401, 'other device signed out');
  assert.equal((await client()('POST', '/api/auth/login', { email: owner.email, password: 'new password 1' })).status, 200);
});

test('owner manages staff; staff and strangers cannot', async () => {
  const boss = client();
  const pid = (await boss('POST', '/api/auth/register', owner)).data.properties[0].id;

  const added = await boss('POST', `/api/properties/${pid}/staff`, { name: 'Andrea', email: 'andrea@example.com', password: 'reception1' });
  assert.equal(added.status, 201);
  const staffId = added.data.id;
  assert.equal((await boss('POST', `/api/properties/${pid}/staff`, { name: 'Andrea', email: 'andrea@example.com', password: 'reception1' })).status, 409);

  const andrea = client();
  const login = await andrea('POST', '/api/auth/login', { email: 'andrea@example.com', password: 'reception1' });
  assert.deepEqual(login.data.properties.map(p => p.role), ['member']);
  assert.equal((await andrea('GET', `/api/properties/${pid}/staff`)).status, 200, 'the team to look at, by default');
  assert.equal((await andrea('POST', `/api/properties/${pid}/staff`, { name: 'X', email: 'x@example.com', password: 'xxxxxxxx' })).status, 403);

  const stranger = client();
  await stranger('POST', '/api/auth/register', { ...owner, email: 'other@example.com', propertyName: 'Other B&B', acceptTerms: true });
  assert.equal((await stranger('GET', `/api/properties/${pid}/staff`)).status, 404, 'other properties are invisible');

  const list = await boss('GET', `/api/properties/${pid}/staff`);
  assert.deepEqual(list.data.map(u => u.role), ['owner', 'member']);

  // reset: new password works, old sessions are gone
  assert.equal((await boss('POST', `/api/properties/${pid}/staff/${staffId}/password`, { password: 'new reception' })).status, 200);
  assert.equal((await andrea('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'andrea@example.com', password: 'new reception' })).status, 200);

  // owner can't be reset/removed through the staff routes
  const bossId = (await boss('GET', '/api/me')).data.user.id;
  assert.equal((await boss('DELETE', `/api/properties/${pid}/staff/${bossId}`)).status, 403);

  assert.equal((await boss('DELETE', `/api/properties/${pid}/staff/${staffId}`)).status, 200);
  const after = await client()('POST', '/api/auth/login', { email: 'andrea@example.com', password: 'new reception' });
  assert.deepEqual(after.data.properties, [], 'removed from the property, account still exists');
});

test("an owner can't reset the password of someone who also works elsewhere", async () => {
  const a = client();
  const pidA = (await a('POST', '/api/auth/register', owner)).data.properties[0].id;
  const b = client();
  const pidB = (await b('POST', '/api/auth/register', { ...owner, email: 'b@example.com', propertyName: 'B', acceptTerms: true })).data.properties[0].id;
  const id = (await a('POST', `/api/properties/${pidA}/staff`, { name: 'Mia', email: 'mia@example.com', password: 'mia password' })).data.id;
  const again = await b('POST', `/api/properties/${pidB}/staff`, { email: 'mia@example.com' });
  assert.equal(again.data.existingAccount, true);
  assert.equal((await b('POST', `/api/properties/${pidB}/staff/${id}/password`, { password: 'taken over!' })).status, 403);
});

test('www redirects to the bare domain, keeping path and query', async () => {
  const res = await worker.fetch(new Request('https://www.hostelflow.it/api/me?x=1'), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://hostelflow.it/api/me?x=1');
  const plain = await worker.fetch(new Request('http://hostelflow.it/'), env);
  assert.equal(plain.status, 301);
  assert.equal(plain.headers.get('Location'), 'https://hostelflow.it/');
  const dev = await worker.fetch(new Request('http://localhost:8787/'), env);
  assert.equal(dev.status, 200, 'local dev server stays on http');
});

test('non-API paths are served from static assets', async () => {
  const res = await worker.fetch(new Request('https://hf.example/'), env);
  assert.equal(await res.text(), 'app');
});

test('the welcome tour: not seen by a new account until it says so, once', async () => {
  const call = client();
  await call('POST', '/api/auth/register', owner);
  assert.equal((await call('GET', '/api/me')).data.user.tourDone, false);
  const r = await call('PUT', '/api/me', { tourDone: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.tourDone, true);
  const first = await env.DB.prepare('SELECT tour_done_at FROM users').first('tour_done_at');
  await call('PUT', '/api/me', { tourDone: true });
  assert.equal(await env.DB.prepare('SELECT tour_done_at FROM users').first('tour_done_at'), first, 'the first time is kept');
});

test('tabs I use: chosen per phone and computer, at least one each, null shows them all again', async () => {
  const call = client();
  await call('POST', '/api/auth/register', owner);
  assert.equal((await call('GET', '/api/me')).data.user.tabs, null);
  assert.equal((await call('PUT', '/api/me', { tabs: { phone: [], computer: ['board'] } })).status, 400);
  assert.equal((await call('PUT', '/api/me', { tabs: { phone: ['nonsense'], computer: ['board'] } })).status, 400);
  const r = await call('PUT', '/api/me', { tabs: { phone: ['shifts', 'checkin', 'nonsense'], computer: ['board', 'checkin', 'shifts'] } });
  assert.deepEqual(r.data.user.tabs, { phone: ['checkin', 'shifts'], computer: ['board', 'checkin', 'shifts'] });
  assert.equal((await call('PUT', '/api/me', { tabs: null })).data.user.tabs, null);
});

test('the header picture is kept with the account: the photo, which part shows, town again', async () => {
  const call = client();
  await call('POST', '/api/auth/register', owner);
  assert.equal((await call('GET', '/api/me')).data.user.header, null);
  assert.equal((await call('PUT', '/api/me/header', { art: 'photo' })).data.user.header.art, 'town', 'no photo yet');
  // Our photos to choose from; anything else is refused.
  assert.equal((await call('PUT', '/api/me/header', { art: 'lights' })).data.user.header.art, 'lights');
  assert.equal((await call('PUT', '/api/me/header', { art: 'nope' })).status, 400);
  await call('PUT', '/api/me/header', { art: 'town' });
  assert.equal((await call('PUT', '/api/me/header', { image: 'javascript:alert(1)' })).status, 400);
  const img = 'data:image/jpeg;base64,' + btoa('pretend jpeg');
  let h = (await call('PUT', '/api/me/header', { image: img, art: 'photo' })).data.user.header;
  assert.deepEqual([h.art, h.image, h.pos], ['photo', true, null]);
  assert.equal((await call('PUT', '/api/me/header', { pos: '120% 10%' })).status, 400);
  h = (await call('PUT', '/api/me/header', { pos: '30.5% 70%' })).data.user.header;
  assert.equal(h.pos, '30.5% 70%');
  const row = await env.DB.prepare('SELECT image FROM user_headers').first();
  assert.equal(row.image, img);
  h = (await call('PUT', '/api/me/header', { art: 'town' })).data.user.header;
  assert.deepEqual([h.art, h.image], ['town', true], 'the photo stays for later');
});
