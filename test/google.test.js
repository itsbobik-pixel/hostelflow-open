import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

let env;
let realFetch;
let claims; // what the fake Google says about the person
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh' };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('code'), 'the-code');
    assert.ok(form.get('code_verifier'));
    const part = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    return Response.json({ id_token: `${part({ alg: 'RS256' })}.${part(claims)}.sig` });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

// Keeps every cookie like a browser (paths ignored: all requests are under /api).
function client() {
  const jar = new Map();
  return async function call(method, path, body) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(';')[0].split('=');
      if (v) jar.set(k, v); else jar.delete(k);
    }
    const type = res.headers.get('Content-Type') || '';
    return { status: res.status, location: res.headers.get('Location'), data: type.includes('json') ? await res.json() : null };
  };
}

// Out to Google and back with the code; returns where the app is sent.
async function roundTrip(call, { state } = {}) {
  const out = await call('GET', '/api/auth/google/start');
  assert.equal(out.status, 302);
  const to = new URL(out.location);
  assert.equal(to.origin, 'https://accounts.google.com');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://hf.example/api/auth/google/callback');
  claims = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: Date.now() / 1000 + 600, nonce: to.searchParams.get('nonce'), ...claims };
  const back = await call('GET', `/api/auth/google/callback?code=the-code&state=${state || to.searchParams.get('state')}`);
  assert.equal(back.status, 302);
  return back.location;
}

const person = () => ({ email: 'Ana@Example.com', email_verified: true, name: 'Ana Rossi' });

test('Google sign-in is off without the client settings', async () => {
  delete env.GOOGLE_CLIENT_SECRET;
  const call = client();
  assert.deepEqual((await call('GET', '/api/auth/google')).data, { on: false, newcomer: null });
  assert.equal((await call('GET', '/api/auth/google/start')).status, 404);
});

test('someone new: Google, then the property name, then signed in without a password', async () => {
  const call = client();
  assert.equal((await call('GET', '/api/auth/google')).data.on, true);
  claims = person();
  assert.equal(await roundTrip(call), '/app#google-signup');
  assert.deepEqual((await call('GET', '/api/auth/google')).data.newcomer, { name: 'Ana Rossi', email: 'ana@example.com' });

  assert.equal((await call('POST', '/api/auth/google/finish', { name: 'Ana', propertyName: 'Casa Ana' })).status, 400); // terms
  const r = await call('POST', '/api/auth/google/finish', { name: 'Ana', propertyName: 'Casa Ana', acceptTerms: true });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'ana@example.com');
  assert.equal(r.data.user.hasPassword, false);
  assert.deepEqual(r.data.properties.map(p => [p.name, p.role]), [['Casa Ana', 'owner']]);
  // Used up: a second finish is refused.
  assert.equal((await call('POST', '/api/auth/google/finish', { name: 'Ana', propertyName: 'Again', acceptTerms: true })).status, 400);

  // A first password needs no current one.
  assert.equal((await call('POST', '/api/auth/password', { newPassword: 'a new password' })).status, 200);
  assert.equal((await call('GET', '/api/me')).data.user.hasPassword, true);
});

test('an existing account: Google signs it in', async () => {
  const call = client();
  await call('POST', '/api/auth/register', { name: 'Ana', email: 'ana@example.com', password: 'correct horse', propertyName: 'Casa Ana', acceptTerms: true });
  await call('POST', '/api/auth/logout', {});
  assert.equal((await call('GET', '/api/me')).status, 401);
  claims = person();
  assert.equal(await roundTrip(call), '/app');
  const me = await call('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'ana@example.com');
  assert.equal(me.data.user.hasPassword, true);
});

test('an unconfirmed account: Google confirms it and drops the password someone may have set', async () => {
  const call = client();
  await env.DB.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'ana@example.com', 'X', 'pbkdf2-sha256$1$AA==$AA==', 1)").run();
  claims = person();
  assert.equal(await roundTrip(call), '/app');
  const row = await env.DB.prepare("SELECT password_hash, email_confirmed_at FROM users WHERE id = 'u1'").first();
  assert.equal(row.password_hash, null);
  assert.ok(row.email_confirmed_at);
});

test('a wrong state, a wrong audience or an unverified e-mail sign nobody in', async () => {
  claims = person();
  assert.equal(await roundTrip(client(), { state: 'forged' }), '/app#google-error=expired');
  claims = { ...person(), aud: 'someone-else' };
  assert.equal(await roundTrip(client()), '/app#google-error=google');
  claims = { ...person(), email_verified: false };
  assert.equal(await roundTrip(client()), '/app#google-error=unverified');
  claims = person();
  const call = client();
  await call('GET', '/api/auth/google/start');
  assert.equal((await call('GET', '/api/auth/google/callback?error=access_denied')).location, '/app#google-error=cancelled');
  assert.equal((await call('GET', '/api/me')).status, 401);
});
