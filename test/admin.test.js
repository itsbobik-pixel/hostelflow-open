import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { hashPassword } from '../src/auth.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 5)));

function setup() {
  const env = {
    DB: createD1(), // Like Cloudflare's assets: a .html path answers with a redirect to the clean one.
    ASSETS: { fetch: async r => new URL(r.url).pathname.endsWith('.html') ? new Response(null, { status: 307, headers: { Location: '/admin' } }) : new Response('app') }, CREDENTIALS_KEY: KEY,
    ADMIN_HOST: 'admin.hf.example',
  };
  const client = (host = 'hf.example') => {
    let cookie = '';
    return async (method, path, body) => {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await worker.fetch(new Request(`https://${host}` + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      const set = res.headers.get('Set-Cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
  };
  const join = async (name, email, propertyName) => {
    const c = client();
    await c('POST', '/api/auth/register', { name, email, password: 'correct horse', propertyName, acceptTerms: true });
    return c;
  };
  // Admin-centre accounts are separate from the app's (scripts/admin-user.mjs).
  const admin = async (email, password, role = 'admin') => {
    await env.DB.prepare('INSERT INTO admin_users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), email, email.split('@')[0], await hashPassword(password, 1000), role, Date.now()).run();
    const c = client('admin.hf.example');
    const r = await c('POST', '/api/admin/login', { email, password });
    assert.equal(r.status, 200);
    return c;
  };
  return { env, join, client, admin };
}

test('admin centre: only listed accounts; support reads and extends trials, the rest is for admins; all logged', async () => {
  const { env, join, client, admin } = setup();
  await join('Bob', 'bob@example.com', 'Bob hostel');
  const eve = await join('Eve', 'eve@example.com', 'Eve hostel');
  const bob = await admin('bob@example.com', 'bob admin password');
  const sue = await admin('sue@example.com', 'sue support password', 'support');
  // App accounts and app cookies mean nothing here; the app address has no admin centre.
  assert.equal((await eve('GET', '/api/admin')).status, 404);
  assert.equal((await client('admin.hf.example')('GET', '/api/admin')).status, 401);
  assert.equal((await client('admin.hf.example')('POST', '/api/admin/login', { email: 'eve@example.com', password: 'correct horse' })).status, 401);
  assert.equal((await client('admin.hf.example')('POST', '/api/admin/login', { email: 'bob@example.com', password: 'correct horse' })).status, 401);
  assert.equal((await bob('GET', '/api/admin/me')).data.role, 'admin');

  const all = await bob('GET', '/api/admin');
  assert.equal(all.status, 200);
  assert.equal(all.data.role, 'admin');
  assert.equal(all.data.daily.series.length, 7);
  assert.ok(all.data.daily.today.signups >= 2);
  assert.ok(Array.isArray(all.data.daily.attention));
  assert.equal(typeof all.data.daily.activity, 'object');
  assert.ok(all.data.daily.monthFrom > all.data.daily.prevMonthFrom && all.data.daily.monthFrom >= all.data.daily.yearFrom);
  assert.equal(all.data.earnings, null); // no Stripe in tests
  // Scans and their cost, per Italian day: today's count in all three periods, older not in 7 days.
  const rome = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(t);
  const evePid = all.data.properties.find(p => p.name === 'Eve hostel').id;
  await env.DB.prepare('INSERT INTO usage_daily (property_id, day, scans, cost_micro) VALUES (?, ?, 3, 9000), (?, ?, 2, 4000)')
    .bind(evePid, rome(Date.now()), evePid, rome(Date.now() - 20 * 86400000)).run();
  // The month comes from the monthly totals (they also hold scans from before the daily counting).
  await env.DB.prepare('INSERT INTO usage_monthly (property_id, month, scans, cost_micro) VALUES (?, ?, 7, 21000)').bind(evePid, new Date().toISOString().slice(0, 7)).run();
  const act = (await bob('GET', '/api/admin')).data.daily.activity[evePid];
  assert.deepEqual([act.day.scans, act.week.scans, act.month.scans, act.month.costMicro], [3, 3, 7, 21000]);
  const evep = all.data.properties.find(p => p.name === 'Eve hostel');
  assert.equal(evep.ownerEmail, 'eve@example.com');
  assert.equal(evep.status, 'trial');
  assert.equal(evep.scanCap, 20); // a new trial's scans (src/guests.js scanLimit)
  // No guest data in the overview, ever: only counts.
  assert.ok(!JSON.stringify(all.data).includes('fields'));

  // Support: may extend a trial, nothing else; sees no alert details.
  const sr = await sue('GET', '/api/admin');
  assert.equal(sr.data.role, 'support');
  const before = evep.trialEndsAt;
  const ext = await sue('POST', '/api/admin', { action: 'extendTrial', propertyId: evep.id, days: 7 });
  assert.equal(ext.status, 200);
  assert.ok(ext.data.trialEndsAt >= before + 7 * 86400000);
  assert.equal((await sue('POST', '/api/admin', { action: 'setComp', propertyId: evep.id, on: true })).status, 403);
  assert.equal((await sue('POST', '/api/admin', { action: 'extendTrial', propertyId: evep.id, days: 365 })).status, 400);

  // Admin: comp on and off, scan limit, vouchers.
  assert.equal((await bob('POST', '/api/admin', { action: 'setComp', propertyId: evep.id, on: true })).status, 200);
  let row = await env.DB.prepare('SELECT billing_status, trial_ends_at FROM properties WHERE id = ?').bind(evep.id).first();
  assert.equal(row.billing_status, 'comp');
  assert.equal((await bob('POST', '/api/admin', { action: 'extendTrial', propertyId: evep.id, days: 7 })).status, 409);
  assert.equal((await bob('POST', '/api/admin', { action: 'setComp', propertyId: evep.id, on: false })).status, 200);
  row = await env.DB.prepare('SELECT billing_status, trial_ends_at FROM properties WHERE id = ?').bind(evep.id).first();
  assert.equal(row.billing_status, 'trial');
  assert.ok(row.trial_ends_at > Date.now() + 13 * 86400000);
  assert.equal((await bob('POST', '/api/admin', { action: 'setScanLimit', propertyId: evep.id, limit: 500 })).status, 200);
  assert.equal((await bob('POST', '/api/admin', { action: 'setScanLimit', propertyId: evep.id, limit: -1 })).status, 400);

  const soon = Date.now() + 30 * 86400000;
  assert.equal((await bob('POST', '/api/admin', { action: 'createVoucher', code: 'genova-27', freeUntil: soon, redeemBy: soon, maxUses: 5 })).status, 201);
  assert.equal((await bob('POST', '/api/admin', { action: 'createVoucher', code: 'GENOVA-27', freeUntil: soon, redeemBy: soon, maxUses: 5 })).status, 409);
  assert.equal((await bob('POST', '/api/admin', { action: 'createVoucher', code: 'x', freeUntil: soon, redeemBy: soon, maxUses: 5 })).status, 400);
  assert.equal((await bob('POST', '/api/admin', { action: 'nope' })).status, 400);

  const after = await bob('GET', '/api/admin');
  assert.ok(after.data.vouchers.some(v => v.code === 'GENOVA-27' && v.maxUses === 5));
  const actions = after.data.audit.map(a => `${a.actor}:${a.action}`);
  assert.ok(actions.includes('sue@example.com:extendTrial'));
  assert.ok(actions.includes('bob@example.com:setComp'));
  assert.ok(actions.includes('bob@example.com:createVoucher'));
  assert.equal(after.data.properties.find(p => p.id === evep.id).scanLimit, 500);
});

test('admin centre: sign out ends the session; the admin address serves only the admin page', async () => {
  const { env, admin } = setup();
  const bob = await admin('bob@example.com', 'bob admin password');
  assert.equal((await bob('GET', '/api/admin')).status, 200);
  assert.equal((await bob('POST', '/api/admin/logout')).status, 200);
  assert.equal((await bob('GET', '/api/admin')).status, 401);
  const r = await worker.fetch(new Request('https://admin.hf.example/api/me'), env);
  assert.equal(r.status, 302);
  const page = await worker.fetch(new Request('https://admin.hf.example/'), env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  const off = await worker.fetch(new Request('https://hf.example/admin'), env);
  assert.equal(off.headers.get('Location'), 'https://admin.hf.example/');
});

test('admin centre: removing a property needs its exact name and no running subscription; the owner stays', async () => {
  const { env, join, admin } = setup();
  const eve = await join('Eve', 'eve@example.com', 'Eve hostel');
  const bob = await admin('bob@example.com', 'bob admin password');
  const sue = await admin('sue@example.com', 'sue support password', 'support');
  const pid = (await bob('GET', '/api/admin')).data.properties.find(p => p.name === 'Eve hostel').id;
  assert.equal((await sue('POST', '/api/admin', { action: 'deleteProperty', propertyId: pid, confirmName: 'Eve hostel' })).status, 403);
  assert.equal((await bob('POST', '/api/admin', { action: 'deleteProperty', propertyId: pid, confirmName: 'eve hostel' })).status, 400);
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', stripe_subscription_id = 'sub_1' WHERE id = ?").bind(pid).run();
  assert.equal((await bob('POST', '/api/admin', { action: 'deleteProperty', propertyId: pid, confirmName: 'Eve hostel' })).status, 409);
  await env.DB.prepare("UPDATE properties SET billing_status = 'canceled' WHERE id = ?").bind(pid).run();
  // A file in the Vault: its R2 object goes with the property.
  const r2 = new Set([`${pid}/f1`, 'other/f2']);
  env.VAULT = { delete: async keys => { for (const k of [].concat(keys)) r2.delete(k); } };
  await env.DB.prepare("INSERT INTO vault_items (id, property_id, kind, title, file_key, file_type, file_size, created_at, updated_at) VALUES ('f1', ?, 'file', 'a.pdf', ?, 'application/pdf', 1, 0, 0)")
    .bind(pid, `${pid}/f1`).run();
  assert.equal((await bob('POST', '/api/admin', { action: 'deleteProperty', propertyId: pid, confirmName: 'Eve hostel' })).status, 200);
  assert.deepEqual([...r2], ['other/f2']);
  assert.equal(await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(pid).first(), null);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE property_id = ?').bind(pid).first()).n, 0);
  // Eve's account is still there and she can sign in.
  const me = await eve('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.properties.length, 0);
  const audit = (await bob('GET', '/api/admin')).data.audit.find(a => a.action === 'deleteProperty');
  assert.ok(audit && audit.detail.includes('Eve hostel'));
});

test('admin centre: own to-dos (support too) and automatic items ticked off for a while', async () => {
  const { env, join, admin } = setup();
  await join('Eve', 'eve@example.com', 'Eve hostel');
  const bob = await admin('bob@example.com', 'bob admin password');
  const sue = await admin('sue@example.com', 'sue support password', 'support');
  const pid = (await bob('GET', '/api/admin')).data.properties.find(p => p.name === 'Eve hostel').id;
  assert.equal((await sue('POST', '/api/admin', { action: 'addTodo', text: 'Call Eve about the key', level: 'warn', propertyId: pid })).status, 201);
  assert.equal((await bob('POST', '/api/admin', { action: 'addTodo', text: '' })).status, 400);
  let d = (await bob('GET', '/api/admin')).data.daily;
  const todo = d.todos.find(x => x.text === 'Call Eve about the key');
  assert.equal(todo.name, 'Eve hostel');
  assert.equal(todo.level, 'warn');
  assert.equal((await bob('POST', '/api/admin', { action: 'editTodo', id: todo.id, text: 'Call Eve', level: 'danger' })).status, 200);
  assert.equal((await bob('POST', '/api/admin', { action: 'doneTodo', id: todo.id })).status, 200);
  d = (await bob('GET', '/api/admin')).data.daily;
  assert.equal(d.todos.length, 0);
  // In the archive, with who and when; back onto the list, done again, then gone for good.
  const arch = d.archive.todos.find(x => x.id === todo.id);
  assert.ok(arch.doneAt && arch.doneBy === 'bob@example.com');
  assert.equal((await sue('POST', '/api/admin', { action: 'undoTodo', id: todo.id })).status, 200);
  assert.equal((await bob('GET', '/api/admin')).data.daily.todos.length, 1);
  await bob('POST', '/api/admin', { action: 'doneTodo', id: todo.id });
  assert.equal((await bob('POST', '/api/admin', { action: 'deleteTodo', id: todo.id })).status, 200);
  assert.equal((await bob('GET', '/api/admin')).data.daily.archive.todos.length, 0);

  // A property past its setup window shows up; ticked off it hides until then.
  await env.DB.prepare('UPDATE properties SET created_at = ? WHERE id = ?').bind(Date.now() - 5 * 86400000, pid).run();
  d = (await bob('GET', '/api/admin')).data.daily;
  const item = d.attention.find(a => a.propertyId === pid && a.kind === 'setup');
  assert.ok(item);
  assert.equal((await sue('POST', '/api/admin', { action: 'dismissAttention', key: item.key, days: 7, name: item.name, text: item.text, level: item.level })).status, 200);
  d = (await bob('GET', '/api/admin')).data.daily;
  assert.ok(!d.attention.some(a => a.key === item.key));
  assert.ok(d.dismissed.some(a => a.key === item.key));
  const ticked = d.archive.dismissed.find(a => a.key === item.key);
  assert.equal(ticked.name, 'Eve hostel');
  assert.equal(ticked.by, 'sue@example.com');
  assert.ok(ticked.dismissedAt > 0);
  assert.equal((await bob('POST', '/api/admin', { action: 'dismissAttention', key: 'nope; DROP', days: 7 })).status, 400);
  assert.equal((await bob('POST', '/api/admin', { action: 'restoreAttention', key: item.key })).status, 200);
  assert.ok((await bob('GET', '/api/admin')).data.daily.attention.some(a => a.key === item.key));
});
