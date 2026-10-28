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

const tokenOf = link => link.match(/#invite=([\w-]+)/)[1];
// An e-mailed invite's link is only in the e-mail (that proves the address).
const linkOf = inv => inv.data.link || mails.filter(m => /#invite=/.test(m.text)).pop().text.match(/https?:\S+#invite=[\w-]+/)[0];


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

test('invite: e-mail and role, the person finishes the account themselves', async () => {
  const bob = client();
  const reg = await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true });
  const pid = reg.data.properties[0].id;

  assert.equal((await bob('POST', `/api/properties/${pid}/invites`, { email: 'gaia@example.com', role: 'boss' })).status, 400);
  const inv = await bob('POST', `/api/properties/${pid}/invites`, { email: 'gaia@example.com' });
  assert.equal(inv.status, 201);
  assert.equal(inv.data.emailed, true);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['gaia@example.com']);
  assert.equal(inv.data.link, null, 'only the inbox gets the link');
  assert.match(mails[0].text, /#invite=/);
  const list = (await bob('GET', `/api/properties/${pid}/invites`)).data;
  assert.deepEqual(list.map(i => [i.email, i.role]), [['gaia@example.com', 'member']]);

  const gaia = client();
  const token = tokenOf(linkOf(inv));
  const shown = await gaia('POST', '/api/invites/show', { token });
  assert.deepEqual(shown.data, { property: 'Costello', email: 'gaia@example.com', role: 'member', hasAccount: false });
  assert.equal((await gaia('POST', '/api/invites/accept', { token, name: 'Gaia', password: 'short' })).status, 400);
  assert.equal((await gaia('POST', '/api/invites/accept', { token, name: 'Gaia', password: 'gaia password' })).status, 200);
  const me = (await gaia('GET', '/api/me')).data;
  assert.equal(me.user.name, 'Gaia');
  assert.deepEqual(me.properties.map(p => [p.name, p.role]), [['Costello', 'member']]);

  // Used up; and she's on the team now, so no second invite.
  assert.equal((await client()('POST', '/api/invites/accept', { token, name: 'X', password: 'xxxxxxxxx' })).status, 400);
  assert.equal((await bob('POST', `/api/properties/${pid}/invites`, { email: 'GAIA@example.com' })).status, 409);
  assert.deepEqual((await bob('GET', `/api/properties/${pid}/invites`)).data, []);
  // Staff cannot invite.
  assert.equal((await gaia('POST', `/api/properties/${pid}/invites`, { email: 'x@example.com' })).status, 403);
});

test('invite to someone who already has an account: their own password, nothing else changes', async () => {
  const bob = client();
  const pid = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const eve = client();
  await signUp(eve, { name: 'Eve', email: 'eve@example.com', password: 'eve password', propertyName: 'Other', acceptTerms: true });
  const inv = await bob('POST', `/api/properties/${pid}/invites`, { email: 'eve@example.com', role: 'owner' });
  const token = tokenOf(linkOf(inv));
  assert.equal((await client()('POST', '/api/invites/show', { token })).data.hasAccount, true);
  assert.equal((await client()('POST', '/api/invites/accept', { token, password: 'wrong password' })).status, 401);
  const c = client();
  assert.equal((await c('POST', '/api/invites/accept', { token, name: 'Mallory', password: 'eve password' })).status, 200);
  const me = (await c('GET', '/api/me')).data;
  assert.equal(me.user.name, 'Eve');
  assert.deepEqual(me.properties.map(p => [p.name, p.role]).sort(), [['Costello', 'owner'], ['Other', 'owner']]);
});

test('invite without e-mail set up: the owner still gets the link', async () => {
  delete env.RESEND_API_KEY;
  const bob = client();
  const pid = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const inv = await bob('POST', `/api/properties/${pid}/invites`, { email: 'gaia@example.com' });
  assert.equal(inv.data.emailed, false);
  assert.match(inv.data.link, /^https:\/\/hostelflow\.it\/#invite=/);
  assert.equal(mails.length, 0);
});

test('someone invited: dashboard and housekeeping yes, check-in and guest data no', async () => {
  const bob = client();
  const pid = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const inv = await bob('POST', `/api/properties/${pid}/invites`, { email: 'vol@example.com' });
  assert.equal(inv.status, 201);
  const vol = client();
  assert.equal((await vol('POST', '/api/invites/accept', { token: tokenOf(linkOf(inv)), name: 'Vale', password: 'vale password' })).status, 200);
  assert.deepEqual((await vol('GET', '/api/me')).data.properties.map(p => p.role), ['member']);

  const board = await vol('GET', `/api/properties/${pid}/board`);
  assert.equal(board.status, 200);
  assert.ok(!board.data.attention.some(a => ['setup', 'late', 'waiting'].includes(a.type)), 'no police registration items');
  assert.equal((await vol('POST', `/api/properties/${pid}/notes`, { text: 'Towels are in' })).status, 201);
  assert.equal((await vol('GET', `/api/properties/${pid}/housekeeping`)).status, 200);
  assert.equal((await vol('GET', `/api/properties/${pid}/reservations?from=2026-10-01&to=2026-10-08`)).status, 200);

  assert.equal((await vol('GET', `/api/properties/${pid}/guests`)).status, 403);
  assert.equal((await vol('GET', `/api/properties/${pid}/istat/report?from=2026-10-01&to=2026-10-02`)).status, 403);
  assert.equal((await vol('POST', `/api/properties/${pid}/reservations`, { guest: 'X', arrival: '2026-10-03', departure: '2026-10-04' })).status, 403);
  assert.deepEqual((await vol('GET', `/api/properties/${pid}/settings`)).data.credentials, {}, 'the police login: only whether it works');

  // The owner can remove them.
  const team = (await bob('GET', `/api/properties/${pid}/staff`)).data;
  const v = team.find(m => m.role === 'member');
  assert.equal((await bob('DELETE', `/api/properties/${pid}/staff/${v.id}`)).status, 200);
});

test('own colour and name (user menu); support messages are e-mailed with a reply-to', async () => {
  env.SUPPORT_EMAIL = 'help@example.com';
  const bob = client();
  const me = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data;
  assert.equal(me.user.color, null);
  assert.equal(me.supportEnabled, true);
  assert.equal((await bob('PUT', '/api/me', { color: '#123456' })).status, 400);
  assert.equal((await bob('PUT', '/api/me', { color: '#3a6fd4', name: 'Bob B.' })).data.user.color, '#3a6fd4');
  const pid = me.properties[0].id;
  await bob('POST', `/api/properties/${pid}/notes`, { text: 'Hi' });
  const note = (await bob('GET', `/api/properties/${pid}/board`)).data.notes[0];
  assert.deepEqual([note.author, note.authorColor], ['Bob B.', '#3a6fd4']);

  assert.equal((await bob('POST', '/api/support', { message: ' ' })).status, 400);
  assert.equal((await bob('POST', '/api/support', { message: 'The scanner is slow', propertyId: pid })).status, 200);
  const mail = mails.pop();
  assert.deepEqual(mail.to, ['help@example.com']);
  assert.equal(mail.reply_to, 'bob@example.com');
  assert.match(mail.subject, /Costello/);
  assert.match(mail.text, /The scanner is slow/);
  assert.equal((await client()('POST', '/api/support', { message: 'x' })).status, 401);
  delete env.SUPPORT_EMAIL;
  assert.equal((await bob('POST', '/api/support', { message: 'x' })).status, 503);
});

test('open invites (QR code) are gone: an invite always needs an e-mail', async () => {
  const bob = client();
  const pid = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  assert.equal((await bob('POST', `/api/properties/${pid}/invites`, { open: true, role: 'volunteer' })).status, 400);
  // One left over from before is withdrawn: it can't be used and isn't listed.
  const token = 'old-open-link-token';
  const { sha256Hex } = await import('../src/auth.js');
  await env.DB.prepare("INSERT INTO invites (id, token_hash, property_id, email, role, invited_by, expires_at, created_at) VALUES ('i1', ?, ?, '', 'staff', NULL, ?, ?)")
    .bind(await sha256Hex(token), pid, Date.now() + 1e9, Date.now()).run();
  assert.equal((await client()('POST', '/api/invites/accept', { token, email: 'eve@example.com', name: 'Eve', password: 'eve password' })).status, 400);
  assert.deepEqual((await bob('GET', `/api/properties/${pid}/invites`)).data, []);
});

test('another property of one\'s own: owned, its own trial, opened from the list', async () => {
  const bob = client();
  const first = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0];
  assert.equal((await bob('POST', '/api/properties', { name: '' })).status, 400);
  const r = await bob('POST', '/api/properties', { name: 'Apartment Via Roma' });
  assert.equal(r.status, 201);
  assert.ok(r.data.id && r.data.id !== first.id);
  const me = (await bob('GET', '/api/me')).data;
  assert.deepEqual(me.properties.map(p => [p.name, p.role]).sort(), [['Apartment Via Roma', 'owner'], ['Costello', 'owner']]);
  // Its own team: nobody else from Costello is in it.
  const staff = await bob('GET', `/api/properties/${r.data.id}/staff`);
  assert.deepEqual(staff.data.map(s => s.email), ['bob@example.com']);
  assert.equal((await client()('POST', '/api/properties', { name: 'Nope' })).status, 401);
});

test('a voucher typed at sign-up counts only once the e-mail is confirmed', async () => {
  const a = client();
  const r = await a('POST', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'a password', propertyName: 'A', acceptTerms: true, voucher: 'laspezia2026' });
  assert.equal(r.data.confirm, true);
  const uses = () => env.DB.prepare("SELECT uses FROM vouchers WHERE code = 'LASPEZIA2026'").first('uses');
  assert.equal(await uses(), 0, 'a made-up address uses nothing up');
  const mail = mails.filter(m => /#confirm=/.test(m.text)).pop();
  await a('POST', '/api/auth/confirm', { token: mail.text.match(/#confirm=([\w-]+)/)[1], email: 'a@example.com', password: 'a password' });
  assert.equal(await uses(), 1);
  const p = await env.DB.prepare('SELECT trial_ends_at, pending_voucher FROM properties').first();
  assert.equal(p.pending_voucher, null);
  assert.ok(p.trial_ends_at > Date.now() + 30 * 86400000);
});

test('an e-mail invite whose link the inviter saw (mail failed) proves nothing; staff passwords are never replaced', async () => {
  const bob = client();
  const pid = (await signUp(bob, { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  // Mail fails for the invite: Bob sees the link — accepting it must not confirm the address.
  const working = globalThis.fetch;
  globalThis.fetch = async () => new Response('down', { status: 500 });
  const inv = await bob('POST', `/api/properties/${pid}/invites`, { email: 'zoe@example.com' });
  globalThis.fetch = working;
  assert.equal(inv.data.emailed, false);
  const mallory = client();
  const r = await mallory('POST', '/api/invites/accept', { token: tokenOf(inv.data.link), name: 'Zoe?', password: 'mallory chose' });
  assert.equal(r.data.confirm, true);
  assert.equal((await mallory('GET', '/api/me')).status, 401);
  // Adding an existing account as staff never changes its password.
  const eve = client();
  const evePid = (await signUp(eve, { name: 'Eve', email: 'eve@example.com', password: 'eve password', propertyName: 'Eve', acceptTerms: true })).data.properties[0].id;
  await eve('POST', `/api/properties/${evePid}/staff`, { name: 'Bob', email: 'bob@example.com', password: 'eve sets it' });
  assert.equal((await client()('POST', '/api/auth/login', { email: 'bob@example.com', password: 'bob password' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'bob@example.com', password: 'eve sets it' })).status, 401);
});
