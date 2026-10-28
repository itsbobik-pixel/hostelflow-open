import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
let env, realFetch;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY };
  realFetch = globalThis.fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  const call = async function (method, path, body) {
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
  return call;
}

async function owner(email = 'bob@example.com', propertyName = 'Costello') {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email, password: 'correct horse', propertyName, acceptTerms: true });
  return { call, pid: r.data.properties[0].id };
}

test('a profile has no e-mail and, until it sets one, no password; the owner switches to it from the user menu', async () => {
  const { call, pid } = await owner();
  assert.equal((await call('POST', `/api/properties/${pid}/profiles`, { name: '' })).status, 400);
  assert.equal((await call('POST', `/api/properties/${pid}/profiles`, { name: 'Anna', role: 'owner' })).status, 400);
  const made = await call('POST', `/api/properties/${pid}/profiles`, { name: 'Anna', role: 'staff' });
  assert.equal(made.status, 201);

  const staff = (await call('GET', `/api/properties/${pid}/staff`)).data;
  const anna = staff.find(s => s.name === 'Anna');
  assert.equal(anna.profile, true);
  assert.equal(anna.email, null, 'the placeholder address is never shown');
  assert.equal(anna.password, false, 'no password until someone sets one');
  assert.equal((await call('POST', `/api/properties/${pid}/staff/${anna.id}/password`, { password: 'short' })).status, 400);
  assert.equal((await call('PUT', `/api/properties/${pid}/staff/${anna.id}/access`, { role: 'owner' })).status, 400);

  // Nobody can sign in as her with an e-mail and password.
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(anna.id).first();
  assert.equal((await client()('POST', '/api/auth/login', { email: row.email, password: 'anything at all' })).status, 401);

  const list = (await call('GET', `/api/properties/${pid}/profiles`)).data;
  assert.deepEqual(list.map(p => p.name), ['Anna']);
  assert.equal((await call('POST', `/api/properties/${pid}/profiles/${anna.id}/switch`)).status, 200);
  const me = (await call('GET', '/api/me')).data;
  assert.equal(me.user.name, 'Anna');
  assert.equal(me.user.profile, true);
  assert.equal(me.user.email, null);
  assert.equal(me.properties[0].role, 'member');

  // As a profile: she sees other profiles, never the owner's, and can't manage the team.
  assert.deepEqual((await call('GET', `/api/properties/${pid}/profiles`)).data, []);
  assert.equal((await call('POST', `/api/properties/${pid}/profiles`, { name: 'Eve' })).status, 403);
});

test('only owners, team managers and profiles may step into a profile; and only of their own property', async () => {
  const { call: bob, pid } = await owner();
  const anna = (await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Anna' })).data.id;
  // An ordinary staff member with a password of their own.
  await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' });
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  assert.deepEqual((await gaia('GET', `/api/properties/${pid}/profiles`)).data, []);
  assert.equal((await gaia('POST', `/api/properties/${pid}/profiles/${anna}/switch`)).status, 403);

  // Another property's owner can't use it either.
  const other = await owner('eve@example.com', 'Elsewhere');
  assert.equal((await other.call('POST', `/api/properties/${pid}/profiles/${anna}/switch`)).status, 404);
  assert.equal((await other.call('POST', `/api/properties/${other.pid}/profiles/${anna}/switch`)).status, 404);
});

test('removing a profile deletes it, and its sessions', async () => {
  const { call, pid } = await owner();
  const anna = (await call('POST', `/api/properties/${pid}/profiles`, { name: 'Anna' })).data.id;
  const tablet = client();
  await tablet('POST', '/api/auth/login', { email: 'bob@example.com', password: 'correct horse' });
  await tablet('POST', `/api/properties/${pid}/profiles/${anna}/switch`);
  assert.equal((await call('DELETE', `/api/properties/${pid}/staff/${anna}`)).status, 200);
  assert.equal(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(anna).first(), null);
  assert.equal((await tablet('GET', '/api/me')).status, 401);
});

test('the activity log: owners see who did what, without guest data; others do not', async () => {
  const { call, pid } = await owner();
  await call('POST', `/api/properties/${pid}/profiles`, { name: 'Anna' });
  await call('POST', `/api/auth/login`, { email: 'bob@example.com', password: 'correct horse' });
  const log = (await call('GET', `/api/properties/${pid}/activity`)).data;
  assert.deepEqual(log.items.map(i => i.action), ['signed_in', 'profile_added']);
  assert.equal(log.items[1].detail, 'Anna');
  assert.equal(log.items[1].who, 'Bob');
  assert.equal(log.more, false);

  await call('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' });
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  assert.equal((await gaia('GET', `/api/properties/${pid}/activity`)).status, 403);
  assert.equal((await client()('GET', `/api/properties/${pid}/activity`)).status, 401);
});

test('the same police login cannot be saved at two properties', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  const a = await owner('a@example.com', 'A');
  const b = await owner('b@example.com', 'B');
  const save = (who, user) => who.call('PUT', `/api/properties/${who.pid}/settings`, { registration: 'it-alloggiati', credentials: { user, password: 'x', wskey: 'y' } });
  assert.equal((await save(a, 'COSTELLO')).status, 200);
  const dup = await save(b, ' costello ');
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /already used by another property/);
  assert.equal((await save(b, 'OTHER')).status, 200);
  // Changing something else about A is not blocked by itself.
  assert.equal((await save(a, 'COSTELLO')).status, 200);
});

test('a login saved before fingerprints existed is still found', async () => {
  const a = await owner('a@example.com', 'A');
  const b = await owner('b@example.com', 'B');
  await a.call('PUT', `/api/properties/${a.pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'OLD', password: 'x', wskey: 'y' } });
  await env.DB.prepare('UPDATE properties SET police_login_fp = NULL').run();
  const r = await b.call('PUT', `/api/properties/${b.pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'old', password: 'x', wskey: 'y' } });
  assert.equal(r.status, 409);
});

test('disconnect forgets the police login, frees it for another property, and is logged', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  const a = await owner('a@example.com', 'A');
  const b = await owner('b@example.com', 'B');
  const put = (who, body) => who.call('PUT', `/api/properties/${who.pid}/settings`, body);
  await put(a, { registration: 'it-alloggiati', credentials: { user: 'COSTELLO', password: 'x', wskey: 'y' } });
  const r = await put(a, { clearCredentials: true });
  assert.equal(r.status, 200);
  const row = await env.DB.prepare('SELECT registration, registration_credentials, police_login_fp FROM properties WHERE id = ?').bind(a.pid).first();
  assert.equal(row.registration, 'it-alloggiati');
  assert.equal(row.registration_credentials, null);
  assert.equal(row.police_login_fp, null);
  assert.equal((await put(b, { registration: 'it-alloggiati', credentials: { user: 'COSTELLO', password: 'x', wskey: 'y' } })).status, 200);
  const log = (await a.call('GET', `/api/properties/${a.pid}/activity`)).data.items.map(i => i.action);
  assert.ok(log.includes('police_login_removed'));
});

test('a profile can be added with its own colour and access; only owners give access of their own', async () => {
  const { call: bob, pid } = await owner();
  assert.equal((await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Anna', color: '#123456' })).status, 400);
  assert.equal((await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Anna', levels: ['billing'] })).status, 400);
  assert.equal((await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Anna', role: 'owner' })).status, 400);
  const made = await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Anna', color: '#3a6fd4', levels: { shifts: 'edit', vault: 'edit', notes: 'read' } });
  assert.equal(made.status, 201);
  const anna = (await bob('GET', `/api/properties/${pid}/staff`)).data.find(s => s.name === 'Anna');
  assert.equal(anna.role, 'member');
  assert.deepEqual(anna.can, ['shifts', 'vault']);
  assert.deepEqual(anna.levels, { notes: 'read', shifts: 'edit', vault: 'edit' });
  assert.equal((await env.DB.prepare('SELECT color FROM users WHERE id = ?').bind(anna.id).first()).color, '#3a6fd4');

  // Someone who may manage the team but isn't an owner: profiles with the defaults only.
  await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' });
  const gaiaId = (await bob('GET', `/api/properties/${pid}/staff`)).data.find(s => s.name === 'Gaia').id;
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'edit', team: 'edit' } });
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  assert.equal((await gaia('POST', `/api/properties/${pid}/profiles`, { name: 'Eve', levels: { team: 'edit', police: 'edit' } })).status, 403);
  assert.equal((await gaia('POST', `/api/properties/${pid}/profiles`, { name: 'Eve', color: '#17c4aa' })).status, 201);
  const eve = (await bob('GET', `/api/properties/${pid}/staff`)).data.find(s => s.name === 'Eve');
  assert.deepEqual(eve.can, ['notes', 'housekeeping']);
});

test('stepping into a profile never gives more than one has; owners may enter any', async () => {
  const { call: bob, pid } = await owner();
  const prof = `/api/properties/${pid}/profiles`;
  const desk = { checkin: 'edit', notes: 'edit', housekeeping: 'edit' };
  const front = (await bob('POST', prof, { name: 'Front desk', levels: desk })).data.id;
  const desk2 = (await bob('POST', prof, { name: 'Desk two', levels: desk })).data.id;
  const police = (await bob('POST', prof, { name: 'Night manager', levels: { ...desk, police: 'edit', vault: 'edit' } })).data.id;

  // Gaia manages the team and checks guests in, but may not touch the police login.
  await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' });
  const gaiaId = (await bob('GET', `/api/properties/${pid}/staff`)).data.find(s => s.name === 'Gaia').id;
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { ...desk, team: 'edit' } });
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  assert.deepEqual((await gaia('GET', prof)).data.map(p => p.name), ['Desk two', 'Front desk'], 'only profiles within her own access are offered');
  assert.equal((await gaia('POST', `${prof}/${police}/switch`)).status, 403);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati' })).status, 403);

  // The reception computer: from one default profile to another works, upwards does not.
  assert.equal((await gaia('POST', `${prof}/${front}/switch`)).status, 200);
  assert.deepEqual((await gaia('GET', prof)).data.map(p => p.name), ['Desk two']);
  assert.equal((await gaia('POST', `${prof}/${police}/switch`)).status, 403);
  assert.equal((await gaia('POST', `${prof}/${desk2}/switch`)).status, 200);

  // The owner enters any profile.
  assert.equal((await bob('POST', `${prof}/${police}/switch`)).status, 200);
  assert.equal((await bob('GET', '/api/me')).data.user.name, 'Night manager');
});

test('the Ross1000 login and codes are hidden from members without the police permission', async () => {
  const { call: bob, pid } = await owner();
  await bob('PUT', `/api/properties/${pid}/settings`, { ross: { region: 'liguria', codice: '0110', user: 'rossuser', password: 'secret', rooms: 2, beds: 8 } });
  await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' });
  const gaiaId = (await bob('GET', `/api/properties/${pid}/staff`)).data.find(s => s.name === 'Gaia').id;
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { shifts: 'edit' } });
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  const s = await gaia('GET', `/api/properties/${pid}/settings`);
  assert.equal(s.status, 200);
  assert.equal(s.data.ross, null);
  assert.ok(!JSON.stringify(s.data).includes('rossuser'));
  assert.equal((await bob('GET', `/api/properties/${pid}/settings`)).data.ross.user, 'rossuser');
});

test('Team: the colour of someone added without e-mail is set there; people with an e-mail choose their own', async () => {
  const { call: bob, pid } = await owner();
  await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Anna' });
  await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' });
  const staff = (await bob('GET', `/api/properties/${pid}/staff`)).data;
  const anna = staff.find(s => s.name === 'Anna');
  const gaia = staff.find(s => s.name === 'Gaia');
  assert.equal(anna.color, null);
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${anna.id}/color`, { color: '#123456' })).status, 400);
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${anna.id}/color`, { color: '#9a5ad4' })).status, 200);
  assert.equal((await bob('GET', `/api/properties/${pid}/staff`)).data.find(s => s.name === 'Anna').color, '#9a5ad4');
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${gaia.id}/color`, { color: '#9a5ad4' })).status, 403);
  // Not on the team: no.
  const { call: eve } = await owner('eve@example.com', 'Other');
  assert.notEqual((await eve('PUT', `/api/properties/${pid}/staff/${anna.id}/color`, { color: '#3a6fd4' })).status, 200);
});

test('Settings → Team: a name, a nickname shown on the name tag, and an e-mail that makes a profile an account', async () => {
  const { call, pid } = await owner();
  const anna = (await call('POST', `/api/properties/${pid}/profiles`, { name: 'Anna Rossi' })).data;
  assert.equal((await call('PUT', `/api/properties/${pid}/staff/${anna.id}`, { name: 'Anna Bianchi', nickname: 'Annie', showNickname: true })).status, 200);
  const row = (await call('GET', `/api/properties/${pid}/staff`)).data.find(s => s.id === anna.id);
  assert.equal(row.name, 'Anna Bianchi');
  assert.equal(row.nickname, 'Annie');
  assert.equal(row.showNickname, true);
  assert.equal((await call('GET', `/api/properties/${pid}/profiles`)).data[0].shown, 'Annie');
  // Back to the full name on the tag.
  await call('PUT', `/api/properties/${pid}/staff/${anna.id}`, { showNickname: false });
  assert.equal((await call('GET', `/api/properties/${pid}/profiles`)).data[0].shown, 'Anna Bianchi');

  // Your own nickname, from the same window (yourself → /api/me).
  const me = (await call('PUT', '/api/me', { nickname: 'Bobby', showNickname: true })).data;
  assert.equal(me.user.shown, 'Bobby');

  // An e-mail taken by someone else is refused; a free one makes her an account.
  assert.equal((await call('PUT', `/api/properties/${pid}/staff/${anna.id}`, { email: 'bob@example.com' })).status, 409);
  assert.equal((await call('PUT', `/api/properties/${pid}/staff/${anna.id}`, { email: 'anna@example.com' })).status, 200);
  const after = (await call('GET', `/api/properties/${pid}/staff`)).data.find(s => s.id === anna.id);
  assert.equal(after.profile, false);
  assert.equal(after.email, 'anna@example.com');
  assert.equal((await call('PUT', `/api/properties/${pid}/staff/${anna.id}`, { email: 'other@example.com' })).status, 400);

  // Owners aren't changed from here; and only whoever manages the team may.
  const bob = (await call('GET', '/api/me')).data.user;
  assert.equal((await call('PUT', `/api/properties/${pid}/staff/${bob.id}`, { name: 'X' })).status, 403);
  assert.equal((await client()('PUT', `/api/properties/${pid}/staff/${anna.id}`, { name: 'X' })).status, 401);
});
