import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

let env, realFetch, mails;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, RESEND_API_KEY: 're_test', MAIL_FROM: 'HostelFlow <noreply@hostelflow.it>' };
  mails = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    mails.push({ url: String(url), auth: init.headers.Authorization, ...JSON.parse(init.body) });
    return new Response('{"id":"m1"}', { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await worker.fetch(new Request('https://hostelflow.it' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const tokenFrom = mail => mail.text.match(/#reset=([\w-]+)/)[1];


// Sign up as a real person does: register, open the confirmation e-mail, signed in.
async function signUp(c, body) {
  const r = await c('POST', '/api/auth/register', body);
  if (r.data.confirm) {
    const mail = mails.filter(m => /#confirm=/.test(m.text)).pop();
    await c('POST', '/api/auth/confirm', { token: mail.text.match(/#confirm=([\w-]+)/)[1], email: body.email, password: body.password });
    mails.length = 0;
  }
  return c('GET', '/api/me');
}

test('forgot password e-mails a one-time link that sets a new password', async () => {
  const bob = client();
  await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'old password', propertyName: 'Costello', acceptTerms: true });

  const r = await client()('POST', '/api/auth/forgot', { email: 'BOB@example.com' });
  assert.equal(r.status, 200);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(mails[0].to, ['bob@example.com']);
  assert.match(mails[0].text, /https:\/\/hostelflow\.it\/#reset=/);
  const token = tokenFrom(mails[0]);
  const stored = await env.DB.prepare('SELECT token_hash FROM password_resets').first();
  assert.notEqual(stored.token_hash, token, 'only the hash is stored');

  const anon = client();
  const done = await anon('POST', '/api/auth/reset', { token, password: 'new password' });
  assert.equal(done.status, 200);
  assert.equal((await anon('GET', '/api/me')).status, 200, 'signed in right away');
  assert.equal((await bob('GET', '/api/me')).status, 401, 'old sessions are signed out');
  assert.equal((await client()('POST', '/api/auth/login', { email: 'bob@example.com', password: 'new password' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: 'another one' })).status, 400, 'link works once');
});

test('unknown addresses get the same answer and no e-mail', async () => {
  const r = await client()('POST', '/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  assert.equal(mails.length, 0);
});

test('expired links fail; at most 3 e-mails an hour', async () => {
  await signUp(client(), { name: 'Bob', email: 'bob@example.com', password: 'old password', propertyName: 'C', acceptTerms: true });
  const call = client();
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/forgot', { email: 'bob@example.com' });
  assert.equal(mails.length, 3);
  await env.DB.prepare('UPDATE password_resets SET expires_at = ?').bind(Date.now() - 1).run();
  assert.equal((await call('POST', '/api/auth/reset', { token: tokenFrom(mails[0]), password: 'new password' })).status, 400);
  assert.equal((await call('POST', '/api/auth/reset', { token: 'nonsense', password: 'new password' })).status, 400);
});

test('without a mail provider the feature says so', async () => {
  delete env.RESEND_API_KEY;
  const r = await client()('POST', '/api/auth/forgot', { email: 'bob@example.com' });
  assert.equal(r.status, 503);
});

test('a new account confirms its e-mail before signing in; the link signs in', async () => {
  const bob = client();
  const r = await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data, { confirm: true, email: 'bob@example.com' });
  assert.equal((await bob('GET', '/api/me')).status, 401); // not signed in yet
  assert.equal(mails.length, 1);
  assert.match(mails[0].text, /https:\/\/hostelflow\.it\/#confirm=/);

  // Signing in waits for the confirmation; a new link can be asked for (same answer for unknown addresses).
  const login = await client()('POST', '/api/auth/login', { email: 'bob@example.com', password: 'bob password' });
  assert.equal(login.status, 403);
  assert.equal(login.data.code, 'unconfirmed');
  assert.equal((await client()('POST', '/api/auth/confirm/resend', { email: 'bob@example.com' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/confirm/resend', { email: 'nobody@example.com' })).status, 200);
  assert.equal(mails.length, 2);

  const c = client();
  assert.equal((await c('POST', '/api/auth/confirm', { token: 'nonsense' })).status, 400);
  const token = mails[1].text.match(/#confirm=([\w-]+)/)[1];
  assert.equal((await c('POST', '/api/auth/confirm', { token })).status, 401, 'the password is needed too');
  assert.equal((await c('POST', '/api/auth/confirm', { token, email: 'bob@example.com', password: 'wrong one!' })).status, 401);
  assert.equal((await c('POST', '/api/auth/confirm', { token, email: 'bob@example.com', password: 'bob password' })).status, 200);
  assert.equal((await c('GET', '/api/me')).data.user.email, 'bob@example.com');
  // Links die once used (the older one too); signing in works now.
  assert.equal((await client()('POST', '/api/auth/confirm', { token: mails[0].text.match(/#confirm=([\w-]+)/)[1] })).status, 400);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'bob@example.com', password: 'bob password' })).status, 200);
});
