import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { dailyPoliceCheck, nextStatus, loginBroken, REMIND_MS } from '../src/policecheck.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const OK = '<GenerateTokenResponse><GenerateTokenResult><expires>x</expires><token>TOK</token></GenerateTokenResult><result><esito>true</esito></result></GenerateTokenResponse>';
const REFUSED = '<GenerateTokenResponse><GenerateTokenResult/><result><esito>false</esito><ErroreCod>3</ErroreCod><ErroreDes>Utente o password errati</ErroreDes></result></GenerateTokenResponse>';

let env, realFetch, mails, portal;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY };
  mails = [];
  portal = 'ok';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('resend.com')) { mails.push(JSON.parse(init.body)); return new Response('{"id":"m"}'); }
    if (portal === 'down') return new Response('<faultstring>busy</faultstring>', { status: 503 });
    return new Response(portal === 'ok' ? OK : REFUSED);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await worker.fetch(new Request('https://hostelflow.it' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('the login verdict: refused is kept (and when it was told), the portal being down changes nothing', () => {
  const refused = nextStatus(null, { ok: false, login: true, message: 'x' }, 1000);
  assert.equal(loginBroken(refused), true);
  assert.equal(nextStatus(refused, { ok: false, login: false }, 2000), refused, 'portal down: same verdict');
  const told = { ...refused, notifiedAt: 1500 };
  assert.equal(nextStatus(told, { ok: false, login: true }, 3000).notifiedAt, 1500);
  assert.equal(loginBroken(nextStatus(told, { ok: true }, 4000)), false);
});

test('every morning: a refused Alloggiati login warns the owner once (again after 3 days) and the app until fixed', async () => {
  const bob = client();
  const pid = (await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  await bob('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'u', password: 'p', wskey: 'k' } });
  env.RESEND_API_KEY = 're_test'; // from now on mail goes out (the sign-up above was confirmed without it)

  // Not at 7:00 in Italy: nothing happens.
  portal = 'refused';
  await dailyPoliceCheck(env, Date.UTC(2026, 9, 15, 10, 0));
  assert.equal((await bob('GET', '/api/me')).data.properties[0].loginBroken, false);

  const morning = Date.UTC(2026, 9, 15, 5, 0); // 7:00 in Rome (summer time)
  await dailyPoliceCheck(env, morning);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['bob@example.com']);
  assert.match(mails[0].subject, /Alloggiati Web/);
  assert.equal((await bob('GET', '/api/me')).data.properties[0].loginBroken, true);
  const board = (await bob('GET', `/api/properties/${pid}/board`)).data;
  assert.equal(board.attention[0].type, 'login');

  // Next morning still broken: no second e-mail yet; after 3 days a reminder.
  await dailyPoliceCheck(env, morning + 86400000);
  assert.equal(mails.length, 1);
  await dailyPoliceCheck(env, morning + REMIND_MS);
  assert.equal(mails.length, 2);

  // The portal is down one morning: no alarm, the verdict stays as it was.
  portal = 'down';
  await dailyPoliceCheck(env, morning + REMIND_MS + 86400000);
  assert.equal(mails.length, 2);

  // Fixed: the check passes and the warning goes.
  portal = 'ok';
  await dailyPoliceCheck(env, morning + 5 * 86400000);
  assert.equal((await bob('GET', '/api/me')).data.properties[0].loginBroken, false);
});

test('a portal that is down never raises the login warning', async () => {
  const bob = client();
  const pid = (await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  await bob('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'u', password: 'p', wskey: 'k' } });
  env.RESEND_API_KEY = 're_test';
  portal = 'down';
  await dailyPoliceCheck(env, 0, { force: true });
  assert.equal(mails.length, 0);
  assert.equal((await bob('GET', '/api/me')).data.properties[0].loginBroken, false);
});

test('every morning: the second structure has its own login, checked and warned about on its own', async () => {
  const bob = client();
  const pid = (await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  await bob('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'MAIN', password: 'p', wskey: 'k' } });
  const annex = (await bob('PUT', `/api/properties/${pid}/settings`, { addStructure: { name: 'Annex' } })).data.added;
  await bob('PUT', `/api/properties/${pid}/settings`, { structure: annex, registration: 'it-alloggiati', credentials: { user: 'ANNEX', password: 'p', wskey: 'k' } });
  env.RESEND_API_KEY = 're_test';
  // Only the annex account is refused.
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('resend.com')) { mails.push(JSON.parse(init.body)); return new Response('{"id":"m"}'); }
    return new Response(init.body.includes('<Utente>ANNEX</Utente>') ? REFUSED : OK);
  };
  await dailyPoliceCheck(env, Date.UTC(2026, 9, 15, 5, 0));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /Costello \(Annex\)/);
  assert.equal((await bob('GET', '/api/me')).data.properties[0].loginBroken, true);
  const s = (await bob('GET', `/api/properties/${pid}/settings`)).data;
  assert.equal(s.status.ok, true);
  assert.equal(s.structures[0].status.ok, false);
});
