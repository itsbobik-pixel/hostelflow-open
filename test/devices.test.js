import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

let env;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') } };
});

// A browser: keeps every cookie it is given (the session and the device's).
function browser() {
  const jar = new Map();
  return async function (method, path, body) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, v] = kv.split('=');
      if (attrs.some(a => a.trim() === 'Max-Age=0')) jar.delete(k); else jar.set(k, v);
    }
    return { status: res.status, data: await res.json() };
  };
}

async function setUp() {
  const call = browser();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  const pid = r.data.properties[0].id;
  const anna = (await call('POST', `/api/properties/${pid}/profiles`, { name: 'Anna' })).data.id;
  const luca = (await call('POST', `/api/properties/${pid}/profiles`, { name: 'Luca' })).data.id;
  await call('POST', `/api/properties/${pid}/staff/${luca}/password`, { password: 'luca secret' });
  const gaia = (await call('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' })).data.id;
  return { call, pid, anna, luca, gaia };
}

test("a device knows nobody until the owner signs in on it; then the team by name, never e-mails", async () => {
  const { pid } = await setUp();
  const desk = browser();
  assert.deepEqual((await desk('GET', '/api/device')).data, { properties: [] });
  assert.equal((await desk('POST', '/api/device/signin', { id: 'x' })).status, 403);

  // Gaia (staff) signing in doesn't make it the hostel's device.
  await desk('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  assert.deepEqual((await desk('GET', '/api/device')).data, { properties: [] });

  await desk('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  await desk('POST', '/api/auth/logout', {});
  const { properties } = (await desk('GET', '/api/device')).data;
  assert.equal(properties.length, 1);
  assert.equal(properties[0].id, pid);
  assert.equal(properties[0].name, 'Costello');
  assert.deepEqual(properties[0].people.map(p => [p.name, p.password, p.owner]), [['Bob', true, true], ['Anna', false, false], ['Gaia', true, false], ['Luca', true, false]]);
  assert.ok(!JSON.stringify(properties).includes('@'), 'no e-mail addresses');
});

test('a tap on a name without a password signs in; the others type only their password', async () => {
  const { anna, luca, gaia } = await setUp();
  const desk = browser();
  await desk('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  await desk('POST', '/api/auth/logout', {});

  const a = await desk('POST', '/api/device/signin', { id: anna });
  assert.equal(a.status, 200);
  assert.equal(a.data.user.name, 'Anna');
  assert.equal((await desk('GET', '/api/me')).data.user.name, 'Anna');

  // Straight from Anna to Luca: his password, and Anna's session is over.
  assert.equal((await desk('POST', '/api/device/signin', { id: luca })).status, 401);
  assert.equal((await desk('POST', '/api/device/signin', { id: luca, password: 'wrong one!' })).status, 401);
  assert.equal((await desk('POST', '/api/device/signin', { id: luca, password: 'luca secret' })).data.user.name, 'Luca');
  assert.equal((await desk('POST', '/api/device/signin', { id: gaia, password: 'gaia password' })).data.user.name, 'Gaia');
  assert.equal((await desk('GET', '/api/me')).data.user.name, 'Gaia');

  // A profile's password never works with its placeholder address.
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(luca).first();
  assert.equal((await browser()('POST', '/api/auth/login', { email: row.email, password: 'luca secret' })).status, 401);
});

test('a device signs in only its own team, and forgetting it hides the names', async () => {
  const { anna } = await setUp();
  const other = browser();
  await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'eve password', propertyName: 'Elsewhere', acceptTerms: true });
  assert.equal((await other('GET', '/api/device')).data.properties[0].name, 'Elsewhere', 'an owner in the app makes it theirs');
  assert.equal((await other('POST', '/api/device/signin', { id: anna })).status, 404);

  await other('POST', '/api/device/forget', {});
  assert.deepEqual((await other('GET', '/api/device')).data, { properties: [] });
});

test("a profile sets, changes and drops its own password; switching to it asks for it", async () => {
  const { call, pid, anna } = await setUp();
  await call('POST', `/api/properties/${pid}/profiles/${anna}/switch`);
  assert.equal((await call('GET', '/api/me')).data.user.hasPassword, false);
  assert.equal((await call('POST', '/api/auth/password', { newPassword: 'anna secret' })).status, 200);
  assert.equal((await call('GET', '/api/me')).data.user.hasPassword, true);
  assert.equal((await call('POST', '/api/auth/password', { currentPassword: 'nope', newPassword: null })).status, 401);

  const bob = browser();
  await bob('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  assert.equal((await bob('POST', `/api/properties/${pid}/profiles/${anna}/switch`, {})).status, 401);
  assert.equal((await bob('POST', `/api/properties/${pid}/profiles/${anna}/switch`, { password: 'anna secret' })).status, 200);
  assert.equal((await bob('POST', '/api/auth/password', { currentPassword: 'anna secret', newPassword: null })).status, 200);
  assert.equal((await bob('GET', '/api/me')).data.user.hasPassword, false);

  // People with an e-mail can't drop theirs.
  const gaia = browser();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  assert.equal((await gaia('POST', '/api/auth/password', { currentPassword: 'gaia password', newPassword: null })).status, 400);
});

test("the owner's new password makes the other devices ask for the e-mail again", async () => {
  await setUp();
  const desk = browser();
  const phone = browser();
  await desk('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  await phone('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  assert.equal((await desk('GET', '/api/device')).data.properties.length, 1);
  await phone('POST', '/api/auth/password', { currentPassword: 'correct horse', newPassword: 'battery staple' });
  assert.deepEqual((await desk('GET', '/api/device')).data, { properties: [] });
  assert.equal((await phone('GET', '/api/device')).data.properties.length, 1, 'where the new password was typed, it stays');
});
