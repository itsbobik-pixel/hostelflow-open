import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { verifyStripeSignature, TRIAL_DAYS, EARLY_ACCESS_ENDS, trialEnd, priceForGuests, reportUsage } from '../src/billing.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));
const WHSEC = 'whsec_test';
let env, realFetch, stripeCalls;

beforeEach(() => {
  env = {
    DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY,
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_GUESTS: 'price_guests', STRIPE_PRICE_TEAM: 'price_team', STRIPE_METER_EVENT: 'hf_guests',
  };
  stripeCalls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    stripeCalls.push({ path, body: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null, auth: init.headers.Authorization, version: init.headers['Stripe-Version'] });
    const out = path === 'customers' ? { id: 'cus_1' }
      : path === 'checkout/sessions' ? { url: 'https://checkout.stripe.test/s1' }
      : path === 'billing_portal/sessions' ? { url: 'https://billing.stripe.test/p1' } : {};
    return new Response(JSON.stringify(out), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hostelflow.it' + path, {
      method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

async function owner() {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  return { call, pid: r.data.properties[0].id };
}

async function signedEvent(event, secret = WHSEC, t = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return { body, header: `t=${t},v1=${sig}` };
}

test('a new property starts with a 14-day free trial', async () => {
  const { call, pid } = await owner();
  const b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.enabled, true);
  assert.equal(b.status, 'trial');
  assert.equal(b.canSend, true);
  // Free until the launch during early access, TRIAL_DAYS after it.
  const expected = Math.max(Date.now() + TRIAL_DAYS * 86400000, EARLY_ACCESS_ENDS);
  assert.ok(Math.abs(b.trialEndsAt - expected) < 60000);
  assert.equal(trialEnd(EARLY_ACCESS_ENDS - 20 * 86400000), EARLY_ACCESS_ENDS); // signed up before the launch: free until it
  assert.equal(trialEnd(Date.UTC(2027, 5, 1)), Date.UTC(2027, 5, 1) + TRIAL_DAYS * 86400000);
});

test('checkout creates the Stripe customer once and returns the payment page', async () => {
  const { call, pid } = await owner();
  const r = await call('POST', `/api/properties/${pid}/billing/checkout`, {});
  assert.equal(r.data.url, 'https://checkout.stripe.test/s1');
  const cust = stripeCalls[0];
  const session = stripeCalls.find(c => c.path === 'checkout/sessions');
  assert.equal(cust.path, 'customers');
  assert.equal(cust.auth, 'Bearer sk_test_x');
  assert.equal(cust.body['metadata[property_id]'], pid);
  assert.equal(session.body.mode, 'subscription');
  assert.equal(session.body['line_items[0][price]'], 'price_guests');
  assert.equal(session.body['line_items[0][quantity]'], undefined); // metered: Stripe counts
  assert.equal(session.body['line_items[1][price]'], undefined); // Check-in: no Team fee
  assert.equal(session.body.client_reference_id, pid);
  assert.equal(session.body.success_url, 'https://hostelflow.it/?billing=success');

  await call('POST', `/api/properties/${pid}/billing/checkout`, {});
  assert.equal(stripeCalls.filter(c => c.path === 'customers').length, 1);
  assert.equal((await call('POST', `/api/properties/${pid}/billing/portal`, {})).data.url, 'https://billing.stripe.test/p1');
});

test('Managed Payments: switched on, Stripe sells as the merchant of record — no VAT number or customer update of our own', async () => {
  const { call, pid } = await owner();
  await call('POST', `/api/properties/${pid}/billing/checkout`, {});
  let session = stripeCalls.find(c => c.path === 'checkout/sessions');
  assert.equal(session.body['tax_id_collection[enabled]'], 'true');
  assert.equal(session.body['managed_payments[enabled]'], undefined);
  assert.equal(session.version, undefined);

  env.STRIPE_MANAGED_PAYMENTS = '1';
  stripeCalls = [];
  await call('POST', `/api/properties/${pid}/billing/checkout`, {});
  session = stripeCalls.find(c => c.path === 'checkout/sessions');
  assert.equal(session.body['managed_payments[enabled]'], 'true');
  assert.equal(session.body['tax_id_collection[enabled]'], undefined);
  assert.equal(session.body['customer_update[name]'], undefined);
  assert.equal(session.body['line_items[0][price]'], 'price_guests');
  assert.equal(session.version, '2026-04-22.dahlia');
});

test('webhooks update the status; bad signatures are refused', async () => {
  const { call, pid } = await owner();
  const post = async (event, secret) => {
    const { body, header } = await signedEvent(event, secret);
    return call('POST', '/api/stripe/webhook', body, { 'Stripe-Signature': header, 'Content-Type': 'application/json' });
  };
  assert.equal((await post({ type: 'customer.subscription.updated', data: { object: {} } }, 'whsec_wrong')).status, 400);

  await post({ type: 'checkout.session.completed', data: { object: { client_reference_id: pid, customer: 'cus_9', subscription: 'sub_9' } } });
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  await post({ type: 'customer.subscription.created', data: { object: {
    id: 'sub_9', customer: 'cus_9', status: 'active', metadata: { property_id: pid }, items: { data: [{ current_period_end: end }] },
  } } });
  let b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.status, 'active');
  assert.equal(b.currentPeriodEnd, end * 1000);

  await post({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'canceled', metadata: {} } } });
  b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.status, 'canceled');
  // Cancelled while its free days still ran: those stay; after them, sending stops.
  assert.equal(b.canSend, true);
  await env.DB.prepare('UPDATE properties SET trial_ends_at = ?').bind(Date.now() - 1000).run();
  assert.equal((await call('GET', `/api/properties/${pid}/billing`)).data.canSend, false);
});

test('after the trial, scanning still works but sending needs a subscription', async () => {
  const { call, pid } = await owner();
  await call('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'u', password: 'p', wskey: 'k' } });
  const g = (await call('POST', `/api/properties/${pid}/guests`, { fields: { surname: 'X' } })).data;
  await env.DB.prepare('UPDATE properties SET trial_ends_at = ?').bind(Date.now() - 1000).run();
  const r = await call('POST', `/api/properties/${pid}/guests/send`, { ids: [g.id], mode: 'test' });
  assert.equal(r.status, 402);
  assert.match(r.data.error, /subscribe/);

  // The pilot property: free for good.
  await env.DB.prepare("UPDATE properties SET billing_status = 'comp'").run();
  assert.notEqual((await call('POST', `/api/properties/${pid}/guests/send`, { ids: [g.id], mode: 'test' })).status, 402);

  // Without Stripe configured nothing is ever blocked.
  await env.DB.prepare("UPDATE properties SET billing_status = 'canceled'").run();
  delete env.STRIPE_SECRET_KEY;
  assert.notEqual((await call('POST', `/api/properties/${pid}/guests/send`, { ids: [g.id], mode: 'test' })).status, 402);
  assert.equal((await call('GET', `/api/properties/${pid}/billing`)).data.enabled, false);
});

test('only the owner sees billing', async () => {
  const { call, pid } = await owner();
  await call('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'staffpass1' });
  const staff = client();
  await staff('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'staffpass1' });
  assert.equal((await staff('GET', `/api/properties/${pid}/billing`)).status, 403);
  assert.equal((await staff('POST', `/api/properties/${pid}/billing/checkout`, {})).status, 403);
});

test('signature check rejects old timestamps and tampered bodies', async () => {
  const { body, header } = await signedEvent({ a: 1 }, WHSEC, Math.floor(Date.now() / 1000) - 600);
  assert.equal(await verifyStripeSignature(WHSEC, header, body), false);
  const fresh = await signedEvent({ a: 1 });
  assert.equal(await verifyStripeSignature(WHSEC, fresh.header, fresh.body), true);
  assert.equal(await verifyStripeSignature(WHSEC, fresh.header, fresh.body + ' '), false);
});

test('plans: HostelOne price, checkout per plan, who gets the calendar', async () => {
  env.STRIPE_PRICE_ID_ONE = 'price_one';
  const { call, pid } = await owner();
  const b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.deepEqual(b.plans.map(p => [p.id, p.available]), [['checkin', true], ['flow', true], ['one', true]]);
  assert.equal(b.plans.find(p => p.id === 'flow').team, 10);
  assert.equal(b.plans.find(p => p.id === 'one').price, 59);
  assert.equal(b.hostelOne, true); // the trial has everything

  await call('POST', `/api/properties/${pid}/billing/checkout`, { plan: 'one' });
  assert.equal(stripeCalls.find(c => c.path === 'checkout/sessions').body['line_items[0][price]'], 'price_one');
  assert.equal((await call('POST', `/api/properties/${pid}/billing/checkout`, { plan: 'gold' })).status, 400);

  // Trial over, HostelFlow only: no calendar.
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', plan = 'flow'").run();
  const r = await call('GET', `/api/properties/${pid}/reservations`);
  assert.equal(r.status, 402);
  assert.match(r.data.error, /HostelOne/);
  // HostelOne: calendar.
  await env.DB.prepare("UPDATE properties SET plan = 'one'").run();
  assert.equal((await call('GET', `/api/properties/${pid}/reservations`)).status, 200);
  // Free (pilot) properties have everything.
  await env.DB.prepare("UPDATE properties SET billing_status = 'comp', plan = 'flow'").run();
  assert.equal((await call('GET', `/api/properties/${pid}/reservations`)).status, 200);
});

test('HostelOne without its Stripe price cannot be bought yet', async () => {
  const { call, pid } = await owner();
  const b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.plans.find(p => p.id === 'one').available, false);
  const r = await call('POST', `/api/properties/${pid}/billing/checkout`, { plan: 'one' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not available yet/);
});

test('the webhook stores the plan from the subscription price; switching plans', async () => {
  env.STRIPE_PRICE_ID_ONE = 'price_one';
  const { call, pid } = await owner();
  const sub = { id: 'sub_9', customer: 'cus_1', status: 'active', metadata: { property_id: pid }, items: { data: [{ id: 'si_1', price: { id: 'price_one' }, current_period_end: 2000000000 }] } };
  const ev = await signedEvent({ type: 'customer.subscription.updated', data: { object: sub } });
  const w = await call('POST', '/api/stripe/webhook', ev.body, { 'Content-Type': 'application/json', 'Stripe-Signature': ev.header });
  assert.equal(w.status, 200);
  let row = await env.DB.prepare('SELECT plan, billing_status, stripe_subscription_id FROM properties').first();
  assert.deepEqual(row, { plan: 'one', billing_status: 'active', stripe_subscription_id: 'sub_9' });

  // Switch back to HostelFlow: the subscription item gets the other price.
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    stripeCalls.push({ path, method: init.method, body: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null });
    return new Response(JSON.stringify(path === 'subscriptions/sub_9' && init.method === 'GET' ? { items: { data: [{ id: 'si_1', price: { id: 'price_one' } }] } } : {}), { status: 200 });
  };
  const ch = await call('POST', `/api/properties/${pid}/billing/plan`, { plan: 'flow' });
  assert.equal(ch.status, 200);
  assert.equal(ch.data.plan, 'flow');
  // HostelOne's item goes, the guests and Team items come.
  const upd = stripeCalls.find(c => c.path === 'subscriptions/sub_9' && c.method === 'POST');
  assert.equal(upd.body['items[0][id]'], 'si_1');
  assert.equal(upd.body['items[0][deleted]'], 'true');
  assert.equal(upd.body['items[1][price]'], 'price_guests');
  assert.equal(upd.body['items[2][price]'], 'price_team');
  assert.equal(upd.body['items[2][quantity]'], '1');
  row = await env.DB.prepare('SELECT plan FROM properties').first();
  assert.equal(row.plan, 'flow');

  // Flow → Check-in: only the Team item goes; the guests keep counting.
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    stripeCalls.push({ path, method: init.method, body: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null });
    return new Response(JSON.stringify(path === 'subscriptions/sub_9' && init.method === 'GET'
      ? { items: { data: [{ id: 'si_g', price: { id: 'price_guests' } }, { id: 'si_t', price: { id: 'price_team' } }] } } : {}), { status: 200 });
  };
  stripeCalls.length = 0;
  await call('POST', `/api/properties/${pid}/billing/plan`, { plan: 'checkin' });
  const down = stripeCalls.find(c => c.path === 'subscriptions/sub_9' && c.method === 'POST').body;
  assert.equal(down['items[0][id]'], 'si_t');
  assert.equal(down['items[0][deleted]'], 'true');
  assert.equal(down['items[1][id]'], undefined);
  // The webhook then knows the plan from the prices.
  const ev2 = await signedEvent({ type: 'customer.subscription.updated', data: { object: { ...sub, items: { data: [{ id: 'si_g', price: { id: 'price_guests' } }, { id: 'si_t', price: { id: 'price_team' } }] } } } });
  await call('POST', '/api/stripe/webhook', ev2.body, { 'Content-Type': 'application/json', 'Stripe-Signature': ev2.header });
  assert.equal((await env.DB.prepare('SELECT plan FROM properties').first()).plan, 'flow');
});

// A Stripe stand-in that also answers GET subscriptions/… with one item.
function stripeWithItem() {
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    stripeCalls.push({ path, method: init.method, body: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null });
    const out = path === 'customers' ? { id: 'cus_1' }
      : path === 'checkout/sessions' ? { url: 'https://checkout.stripe.test/s1' }
      : init.method === 'GET' && path.startsWith('subscriptions/') ? { items: { data: [{ id: 'si_1' }] } } : {};
    return new Response(JSON.stringify(out), { status: 200 });
  };
}
async function sentGuests(pid, n, at) {
  for (let i = 0; i < n; i++) {
    await env.DB.prepare("INSERT INTO guests (id, property_id, status, fields, sent_at, created_at, updated_at) VALUES (?, ?, 'sent', '{}', ?, ?, ?)")
      .bind(crypto.randomUUID(), pid, at, at, at).run();
  }
}

test('the price by guests: 0–1 free, then 9 / 19 / 29 / 39 €, then 4 cents a guest', () => {
  assert.deepEqual([0, 1, 2, 200, 201, 400, 401, 800, 1000, 1001, 1500].map(priceForGuests),
    [0, 0, 900, 900, 1900, 1900, 2900, 2900, 3900, 3904, 5900]);
});

test('Settings shows this month\'s guests and what they cost, with the other properties it pays for', async () => {
  const { call, pid } = await owner();
  const other = (await call('POST', '/api/properties', { name: 'Via Roma' })).data.id;
  await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [other] });
  const now = Date.now();
  await sentGuests(pid, 150, now - 1000);
  await sentGuests(other, 100, now - 1000);
  await sentGuests(pid, 30, Date.UTC(2020, 0, 1)); // long ago: another month
  const b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.deepEqual(b.month, { guests: 250, price: 19 });
  assert.deepEqual(b.tiers.map(t => [t.upTo, t.price]), [[200, 9], [400, 19], [800, 29], [1000, 39]]);
  assert.equal(b.perGuestAbove, 0.04);
});

test('every hour the guests sent go to Stripe\'s meter: once each, only once paid, with the properties it pays for', async () => {
  const meter = [];
  let fail = false;
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    if (path === 'billing/meter_events') {
      if (fail) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
      meter.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    }
    return new Response('{}', { status: 200 });
  };
  const { call, pid } = await owner();
  const other = (await call('POST', '/api/properties', { name: 'Via Roma' })).data.id;
  await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [other] });
  const paidFrom = Date.now() - 86400000;
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', plan = 'checkin', stripe_customer_id = 'cus_m', paid_from = ? WHERE id = ?").bind(paidFrom, pid).run();
  await sentGuests(pid, 3, paidFrom - 1000); // still in the free days: free
  await sentGuests(pid, 5, paidFrom + 1000);
  await sentGuests(other, 2, paidFrom + 2000);

  // Stripe down: nothing is lost, the next hour sends them.
  fail = true;
  await reportUsage(env);
  assert.equal(meter.length, 0);
  fail = false;
  await reportUsage(env);
  assert.equal(meter.length, 1);
  assert.equal(meter[0].event_name, 'hf_guests');
  assert.equal(meter[0]['payload[stripe_customer_id]'], 'cus_m');
  assert.equal(meter[0]['payload[value]'], '7');
  assert.ok(meter[0].identifier.startsWith(pid));
  // Nothing new: nothing sent. A new guest: just that one.
  await reportUsage(env);
  assert.equal(meter.length, 1);
  await sentGuests(other, 1, Date.now() - 10);
  await reportUsage(env);
  assert.equal(meter.at(-1)['payload[value]'], '1');
  // In Stripe's trial (before the first payment): never.
  await env.DB.prepare("UPDATE properties SET billing_status = 'trialing' WHERE id = ?").bind(pid).run();
  await sentGuests(pid, 4, Date.now() - 10);
  await reportUsage(env);
  assert.equal(meter.length, 2);
});

test('the webhook keeps when the paid part starts: after the free days', async () => {
  const { call, pid } = await owner();
  const trialEnd = Math.floor(Date.UTC(2026, 11, 31, 22, 59, 59) / 1000);
  const ev = await signedEvent({ type: 'customer.subscription.created', data: { object: {
    id: 'sub_t', customer: 'cus_t', status: 'trialing', trial_end: trialEnd, start_date: trialEnd - 86400, metadata: { property_id: pid },
    items: { data: [{ id: 'si_g', price: { id: 'price_guests' }, current_period_end: trialEnd }] },
  } } });
  await call('POST', '/api/stripe/webhook', ev.body, { 'Content-Type': 'application/json', 'Stripe-Signature': ev.header });
  const row = await env.DB.prepare('SELECT paid_from, plan FROM properties WHERE id = ?').bind(pid).first();
  assert.deepEqual({ ...row }, { paid_from: trialEnd * 1000, plan: 'checkin' });
});

test('several properties: one subscription by guests pays for the owner\'s others; not someone else\'s', async () => {
  stripeWithItem();
  const { call, pid } = await owner();
  const others = [];
  for (const name of ['Via Roma', 'Via Milano']) others.push((await call('POST', '/api/properties', { name })).data.id);
  const b = (await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: others })).data;
  assert.deepEqual(b.apartments.ids.sort(), [...others].sort());
  await call('POST', `/api/properties/${pid}/billing/checkout`, { plan: 'flow' });
  const s = stripeCalls.find(c => c.path === 'checkout/sessions').body;
  assert.equal(s['line_items[0][price]'], 'price_guests');
  assert.equal(s['line_items[1][price]'], 'price_team'); // the Team fee once, not per property

  // The parent pays: another property can send while the parent's subscription runs.
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', plan = 'flow', stripe_subscription_id = 'sub_a' WHERE id = ?").bind(pid).run();
  await env.DB.prepare('UPDATE properties SET trial_ends_at = ? WHERE id = ?').bind(Date.now() - 1000, others[0]).run();
  const child = (await call('GET', `/api/properties/${others[0]}/billing`)).data;
  assert.equal(child.paidBy.id, pid);
  assert.equal(child.canSend, true);
  // …and gets the Team part of the parent's plan.
  assert.equal((await call('GET', `/api/properties/${others[0]}/board`)).status, 200);
  // A covered property cannot be bought on its own.
  assert.equal((await call('POST', `/api/properties/${others[0]}/billing/checkout`, { plan: 'checkin' })).status, 409);
  // Adding more tells Stripe nothing: the guests are counted.
  const more = (await call('POST', '/api/properties', { name: 'A' })).data.id;
  stripeCalls.length = 0;
  assert.equal((await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [...others, more] })).status, 200);
  assert.equal(stripeCalls.length, 0);
  // Someone else's property cannot be added.
  const eve = client();
  const evePid = (await eve('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'eve password', propertyName: 'Eve', acceptTerms: true })).data.properties[0].id;
  assert.equal((await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [evePid] })).status, 403);
});

test('pausing is switched off; one paused before still waits for sending and can resume', async () => {
  stripeWithItem();
  const { call, pid } = await owner();
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', stripe_subscription_id = 'sub_p'").run();
  assert.equal((await call('POST', `/api/properties/${pid}/billing/pause`, { pause: true })).status, 400);
  await env.DB.prepare('UPDATE properties SET paused_at = ?').bind(Date.now()).run();
  let b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.paused, true);
  assert.equal(b.canSend, false);
  await call('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati', credentials: { user: 'u', password: 'p', wskey: 'k' } });
  const g = (await call('POST', `/api/properties/${pid}/guests`, { fields: { surname: 'X' } })).data;
  const r = await call('POST', `/api/properties/${pid}/guests/send`, { ids: [g.id], mode: 'test' });
  assert.equal(r.status, 402);
  assert.match(r.data.error, /paused/);
  b = (await call('POST', `/api/properties/${pid}/billing/pause`, { pause: false })).data;
  assert.equal(b.paused, false);
  assert.equal(b.canSend, true);
  assert.equal(stripeCalls.at(-1).body.pause_collection, '');
});

test('Check-in plan: check-in and statistics, no Dashboard, Housekeeping or Shifts (the trial has all)', async () => {
  const { call, pid } = await owner();
  assert.equal((await call('GET', `/api/properties/${pid}/board`)).status, 200);
  assert.equal((await call('GET', '/api/me')).data.properties[0].full, true);
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', plan = 'checkin'").run();
  for (const path of ['board', 'housekeeping', 'shifts', 'vault']) {
    const r = await call('GET', `/api/properties/${pid}/${path}`);
    assert.equal(r.status, 402, path);
    assert.match(r.data.error, /Flow/);
  }
  assert.equal((await call('POST', `/api/properties/${pid}/notes`, { text: 'hi' })).status, 402);
  assert.equal((await call('GET', `/api/properties/${pid}/guests`)).status, 200);
  assert.equal((await call('GET', '/api/me')).data.properties[0].full, false);
  // Flow has everything again.
  await env.DB.prepare("UPDATE properties SET plan = 'flow'").run();
  assert.equal((await call('GET', `/api/properties/${pid}/board`)).status, 200);
});

test('voucher at sign-up: free until its date; once per property, limited uses, expired codes refused', async () => {
  const until = Date.UTC(2026, 11, 31, 23, 59, 59);
  const call = client();
  const bad = await call('POST', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'a password', propertyName: 'A', acceptTerms: true, voucher: 'NOPE' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /voucher/);
  const r = await call('POST', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'a password', propertyName: 'A', acceptTerms: true, voucher: 'laspezia2026' });
  assert.equal(r.status, 201);
  const pid = r.data.properties[0].id;
  const b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.trialEndsAt, Math.max(until, EARLY_ACCESS_ENDS));
  assert.equal((await env.DB.prepare("SELECT uses FROM vouchers WHERE code = 'LASPEZIA2026'").first()).uses, 1);
  // Again on the same property: no.
  assert.equal((await call('POST', `/api/properties/${pid}/billing/voucher`, { code: 'LASPEZIA2026' })).status, 409);

  // Used up / expired codes are refused; a paying property can't use one.
  await env.DB.prepare("INSERT INTO vouchers (code, free_until, redeem_by, max_uses, uses, created_at) VALUES ('FULL', ?, ?, 1, 1, 0), ('OLD', ?, ?, 9, 0, 0)")
    .bind(until, until, until, Date.now() - 1000).run();
  const { call: bob, pid: bobPid } = await owner();
  assert.equal((await bob('POST', `/api/properties/${bobPid}/billing/voucher`, { code: 'FULL' })).status, 400);
  assert.equal((await bob('POST', `/api/properties/${bobPid}/billing/voucher`, { code: 'OLD' })).status, 400);
  const ok = await bob('POST', `/api/properties/${bobPid}/billing/voucher`, { code: ' LASPEZIA2026 ' });
  assert.equal(ok.status, 200);
  await env.DB.prepare("UPDATE properties SET billing_status = 'active' WHERE id = ?").bind(bobPid).run();
  await env.DB.prepare("INSERT INTO vouchers (code, free_until, redeem_by, max_uses, created_at) VALUES ('MORE', ?, ?, 9, 0)").bind(until, until).run();
  assert.equal((await bob('POST', `/api/properties/${bobPid}/billing/voucher`, { code: 'MORE' })).status, 409);
});

test('cancelled for the end of the period: still running, with the date it ends; renewing clears it', async () => {
  const { call, pid } = await owner();
  const post = async object => {
    const { body, header } = await signedEvent({ type: 'customer.subscription.updated', data: { object } });
    return call('POST', '/api/stripe/webhook', body, { 'Stripe-Signature': header, 'Content-Type': 'application/json' });
  };
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  const sub = { id: 'sub_c', customer: 'cus_c', status: 'active', metadata: { property_id: pid }, items: { data: [{ current_period_end: end }] } };
  await post({ ...sub, cancel_at: end, cancel_at_period_end: false });
  let b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.status, 'active');
  assert.equal(b.cancelAt, end * 1000);
  await post({ ...sub, cancel_at: null, cancel_at_period_end: false });
  b = (await call('GET', `/api/properties/${pid}/billing`)).data;
  assert.equal(b.cancelAt, null);
});

test('other properties ride along only on a plan by guests: not on HostelOne', async () => {
  env.STRIPE_PRICE_ID_ONE = 'price_one';
  stripeWithItem();
  const { call, pid } = await owner();
  const other = (await call('POST', '/api/properties', { name: 'Via Roma' })).data.id;
  // Linked in the trial, then checkout on HostelOne: refused.
  assert.equal((await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [other] })).status, 200);
  assert.equal((await call('POST', `/api/properties/${pid}/billing/checkout`, { plan: 'one' })).status, 409);
  assert.equal((await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: 'nope' })).status, 400);
  // Already on HostelOne (e.g. linked before this check): the property doesn't ride along…
  await env.DB.prepare("UPDATE properties SET billing_status = 'active', plan = 'one', stripe_subscription_id = 'sub_c' WHERE id = ?").bind(pid).run();
  await env.DB.prepare('UPDATE properties SET trial_ends_at = ? WHERE id = ?').bind(Date.now() - 1000, other).run();
  const child = (await call('GET', `/api/properties/${other}/billing`)).data;
  assert.equal(child.canSend, false);
  // …and no more can be added.
  const third = (await call('POST', '/api/properties', { name: 'Via Po' })).data.id;
  assert.equal((await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [other, third] })).status, 409);
  // Taking them off is always allowed.
  assert.equal((await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [] })).status, 200);
});

test('an apartment keeps its own trial while the parent is only trying', async () => {
  const { call, pid } = await owner();
  const other = (await call('POST', '/api/properties', { name: 'Via Roma' })).data.id;
  await call('PUT', `/api/properties/${pid}/billing/apartments`, { ids: [other] });
  await env.DB.prepare('UPDATE properties SET trial_ends_at = ? WHERE id = ?').bind(Date.now() - 1000, pid).run();
  assert.equal((await call('GET', `/api/properties/${other}/billing`)).data.canSend, true);
});

test('one free trial per owner: another own property shares what is left; a voucher once per owner', async () => {
  const { call, pid } = await owner();
  const first = await env.DB.prepare('SELECT trial_ends_at FROM properties WHERE id = ?').bind(pid).first('trial_ends_at');
  const second = (await call('POST', '/api/properties', { name: 'Via Roma' })).data.id;
  assert.equal(await env.DB.prepare('SELECT trial_ends_at FROM properties WHERE id = ?').bind(second).first('trial_ends_at'), first);
  // The trial is over: a new property starts without one (before 2027, when
  // nobody pays yet, it is free until then like everyone).
  await env.DB.prepare('UPDATE properties SET trial_ends_at = ?').bind(Date.now() - 1000).run();
  const third = (await call('POST', '/api/properties', { name: 'Via Po' })).data.id;
  assert.equal((await call('GET', `/api/properties/${third}/billing`)).data.canSend, Date.now() < EARLY_ACCESS_ENDS);
  // A voucher counts once per owner, not once per property.
  assert.equal((await call('POST', `/api/properties/${pid}/billing/voucher`, { code: 'LASPEZIA2026' })).status, 200);
  assert.equal((await call('POST', `/api/properties/${third}/billing/voucher`, { code: 'LASPEZIA2026' })).status, 409);
});

test('before billing starts (1. 1. 2027) nothing is charged: trials run to the end of 2026, checkout waits', async () => {
  assert.equal(new Date(EARLY_ACCESS_ENDS).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }), '31/12/2026');
  assert.equal(new Date(EARLY_ACCESS_ENDS + 1000).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }), '01/01/2027');
  const { call, pid } = await owner();
  if (Date.now() >= EARLY_ACCESS_ENDS - 3 * 86400000) return; // only meaningful before then
  assert.equal((await call('GET', `/api/properties/${pid}/billing`)).data.trialEndsAt, EARLY_ACCESS_ENDS);
  await call('POST', `/api/properties/${pid}/billing/checkout`, { plan: 'flow' });
  const s = stripeCalls.find(c => c.path === 'checkout/sessions').body;
  assert.equal(s['subscription_data[trial_end]'], String(Math.floor(EARLY_ACCESS_ENDS / 1000)));
});

test('a second subscription is cancelled; late events about an old one change nothing; state comes fresh from Stripe', async () => {
  const subs = { sub_a: { id: 'sub_a', status: 'active', customer: 'cus_1' }, sub_b: { id: 'sub_b', status: 'trialing', customer: 'cus_1' } };
  const deleted = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '');
    const m = path.match(/^subscriptions\/(sub_\w+)$/);
    if (m && init.method === 'DELETE') { deleted.push(m[1]); subs[m[1]].status = 'canceled'; return new Response(JSON.stringify(subs[m[1]])); }
    if (m) return new Response(JSON.stringify(subs[m[1]] || {}));
    return new Response('{}');
  };
  const { call, pid } = await owner();
  const post = async event => { const { body, header } = await signedEvent(event); return call('POST', '/api/stripe/webhook', body, { 'Stripe-Signature': header, 'Content-Type': 'application/json' }); };
  await post({ type: 'checkout.session.completed', data: { object: { client_reference_id: pid, customer: 'cus_1', subscription: 'sub_a' } } });
  await post({ type: 'customer.subscription.created', data: { object: { id: 'sub_a', customer: 'cus_1', status: 'active', metadata: { property_id: pid } } } });
  // A second checkout from another tab: its subscription is cancelled, sub_a stays.
  await post({ type: 'checkout.session.completed', data: { object: { client_reference_id: pid, customer: 'cus_1', subscription: 'sub_b' } } });
  assert.deepEqual(deleted, ['sub_b']);
  let row = await env.DB.prepare('SELECT stripe_subscription_id, billing_status FROM properties WHERE id = ?').bind(pid).first();
  assert.deepEqual([row.stripe_subscription_id, row.billing_status], ['sub_a', 'active']);
  // A late "deleted" about sub_b changes nothing.
  await post({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_b', customer: 'cus_1', status: 'canceled', metadata: { property_id: pid } } } });
  row = await env.DB.prepare('SELECT stripe_subscription_id, billing_status FROM properties WHERE id = ?').bind(pid).first();
  assert.deepEqual([row.stripe_subscription_id, row.billing_status], ['sub_a', 'active']);
  // A late "incomplete" event about sub_a: Stripe says it's active, so it stays active.
  await post({ type: 'customer.subscription.updated', data: { object: { id: 'sub_a', customer: 'cus_1', status: 'incomplete', metadata: { property_id: pid } } } });
  assert.equal((await env.DB.prepare('SELECT billing_status FROM properties WHERE id = ?').bind(pid).first()).billing_status, 'active');
});
