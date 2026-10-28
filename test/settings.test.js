import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
let env;
let realFetch;
let portalCalls;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY };
  realFetch = globalThis.fetch;
  portalCalls = [];
  // Fake Alloggiati: accepts password "right", anything else is refused.
  globalThis.fetch = async (url, init) => {
    portalCalls.push(init.body);
    const ok = init.body.includes('<Password>right</Password>');
    const xml = ok
      ? '<GenerateTokenResult><token>T</token></GenerateTokenResult><result><esito>true</esito></result>'
      : '<result><esito>false</esito><ErroreDes>AUTENTICAZIONE FALLITA</ErroreDes></result>';
    return { ok: true, status: 200, text: async () => xml };
  };
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

async function ownerWithProperty() {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  return { call, pid: r.data.properties[0].id };
}

const it = 'it-alloggiati';

test('settings start empty and list the available systems', async () => {
  const { call, pid } = await ownerWithProperty();
  const r = await call('GET', `/api/properties/${pid}/settings`);
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Costello');
  assert.equal(r.data.registration, null);
  assert.deepEqual(r.data.credentials, {});
  const mod = r.data.modules.find(m => m.id === it);
  assert.deepEqual(mod.fields.map(f => [f.key, f.secret]), [['user', false], ['password', true], ['wskey', true]]);
  assert.match(mod.fields.find(f => f.key === 'wskey').help, /Chiave Web Service/);
  assert.equal(mod.portalUrl, 'https://alloggiatiweb.poliziadistato.it');
});

test('credentials are stored encrypted and secrets are never returned', async () => {
  const { call, pid } = await ownerWithProperty();
  const r = await call('PUT', `/api/properties/${pid}/settings`, {
    name: 'Hostel Costello', registration: it,
    credentials: { user: ' SP000123 ', password: 'hunter22secret', wskey: 'AAAAwskeyBBBB' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Hostel Costello');
  assert.equal(r.data.country, 'IT');
  assert.deepEqual(r.data.credentials, {
    user: { set: true, value: 'SP000123' }, password: { set: true }, wskey: { set: true },
  });
  assert.ok(!JSON.stringify(r.data).includes('hunter22secret'));

  const row = await env.DB.prepare('SELECT registration_credentials AS c FROM properties').first();
  assert.match(row.c, /^v1\./);
  for (const s of ['SP000123', 'hunter22secret', 'AAAAwskeyBBBB']) assert.ok(!row.c.includes(s));
});

test('empty secret keeps the stored one; switching system drops credentials', async () => {
  const { call, pid } = await ownerWithProperty();
  await call('PUT', `/api/properties/${pid}/settings`, { registration: it, credentials: { user: 'u', password: 'right', wskey: 'k' } });
  const r = await call('PUT', `/api/properties/${pid}/settings`, { credentials: { user: 'u2', password: '', wskey: '' } });
  assert.deepEqual(r.data.credentials, { user: { set: true, value: 'u2' }, password: { set: true }, wskey: { set: true } });
  const check = await call('POST', `/api/properties/${pid}/registration/check`, {});
  assert.equal(check.data.ok, true);
  assert.ok(portalCalls[0].includes('<Utente>u2</Utente>'));

  const off = await call('PUT', `/api/properties/${pid}/settings`, { registration: null });
  assert.equal(off.data.registration, null);
  assert.equal((await env.DB.prepare('SELECT registration_credentials AS c FROM properties').first()).c, null);
});

test('check connection: ok, wrong password, missing fields, cooldown, status reset on change', async () => {
  const { call, pid } = await ownerWithProperty();
  await call('PUT', `/api/properties/${pid}/settings`, { registration: it, credentials: { user: 'u' } });
  const missing = await call('POST', `/api/properties/${pid}/registration/check`, {});
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /Password/);
  assert.equal(portalCalls.length, 0);

  await call('PUT', `/api/properties/${pid}/settings`, { credentials: { password: 'wrong', wskey: 'k' } });
  const bad = await call('POST', `/api/properties/${pid}/registration/check`, {});
  assert.equal(bad.status, 200);
  assert.equal(bad.data.ok, false);
  assert.match(bad.data.message, /AUTENTICAZIONE FALLITA/);

  const again = await call('POST', `/api/properties/${pid}/registration/check`, {});
  assert.equal(again.status, 429);
  assert.equal(portalCalls.length, 1);

  // New credentials clear the old result (and with it the cooldown).
  const fixed = await call('PUT', `/api/properties/${pid}/settings`, { credentials: { password: 'right' } });
  assert.equal(fixed.data.status, null);
  const good = await call('POST', `/api/properties/${pid}/registration/check`, {});
  assert.equal(good.data.ok, true);
  assert.equal((await call('GET', `/api/properties/${pid}/settings`)).data.status.ok, true);
});

test('validation: unknown system, credentials without system, bad types', async () => {
  const { call, pid } = await ownerWithProperty();
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { registration: 'xx' })).status, 400);
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { credentials: { user: 'u' } })).status, 400);
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { registration: it, credentials: { user: 5 } })).status, 400);
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { name: '' })).status, 400);
});

test('the team and strangers cannot change settings; strangers cannot see them', async () => {
  const { call, pid } = await ownerWithProperty();
  await call('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'staffpass1' });
  const staff = client();
  await staff('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'staffpass1' });
  // By default the police registration is there to look at: whether it works, never the login.
  assert.deepEqual((await staff('GET', `/api/properties/${pid}/settings`)).data.credentials, {});
  assert.equal((await staff('PUT', `/api/properties/${pid}/settings`, { name: 'x' })).status, 403);
  assert.equal((await staff('POST', `/api/properties/${pid}/registration/check`, {})).status, 403);

  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('GET', `/api/properties/${pid}/settings`)).status, 404);
});

test('credentials encrypted for one property do not decrypt on another', async () => {
  const { call, pid } = await ownerWithProperty();
  await call('PUT', `/api/properties/${pid}/settings`, { registration: it, credentials: { user: 'u', password: 'right', wskey: 'k' } });
  const other = client();
  const r = await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  const otherId = r.data.properties[0].id;
  await env.DB.prepare(
    `UPDATE properties SET registration = ?, registration_credentials = (SELECT registration_credentials FROM properties WHERE id = ?) WHERE id = ?`,
  ).bind(it, pid, otherId).run();
  assert.equal((await other('GET', `/api/properties/${otherId}/settings`)).status, 500);
});

test('missing CREDENTIALS_KEY fails closed', async () => {
  const { call, pid } = await ownerWithProperty();
  delete env.CREDENTIALS_KEY;
  const r = await call('PUT', `/api/properties/${pid}/settings`, { registration: it, credentials: { user: 'u' } });
  assert.equal(r.status, 500);
  assert.equal((await env.DB.prepare('SELECT registration_credentials AS c FROM properties').first()).c, null);
});
