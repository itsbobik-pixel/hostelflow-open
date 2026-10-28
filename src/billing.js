// Subscriptions with Stripe. A new property gets a free trial without a
// card (TRIAL_DAYS); after that the owner subscribes through Stripe Checkout, manages
// card/invoices/cancel in the Stripe Customer Portal, and Stripe keeps us
// up to date through webhooks. Everything stays switched off (nobody is
// blocked) until STRIPE_SECRET_KEY and STRIPE_PRICE_GUESTS are configured.
//
// Pricing by guests (Bob, 24. 10.): each month is paid afterwards by the guests
// sent to the police in it — 0–1 guests 0 €, up to 200 9 €, 400 19 €, 800 29 €,
// 1000 39 €, then 4 cents a guest (GUEST_TIERS; the same tiers are the Stripe
// price). A metered Stripe price: reportUsage tells Stripe every hour how many
// guests were sent. Plans: Check-in (guests only) and Flow (+10 € a
// month for the Dashboard, Housekeeping and Shifts), and HostelOne (still in
// preview: + calendar and channels). One subscription can pay for the owner's
// other properties too: their guests add up, the Team fee is paid once.
// The free trial and free ('comp') properties get everything.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (secrets); vars:
// STRIPE_PRICE_GUESTS (metered, tiered), STRIPE_PRICE_TEAM (10 € a month),
// STRIPE_METER_EVENT (the meter's event name), STRIPE_PRICE_ID_ONE.

import { HttpError, json, readJson } from './http.js';
import { requireUser, requireRole } from './auth.js';
import { alert } from './alerts.js';

export const TRIAL_DAYS = 14;
// Early access: everyone who signs up before the launch uses it free until
// then; after it, new sign-ups get TRIAL_DAYS.
// Move it if the launch moves — existing trials keep their own end date.
// 13. 10.: payments are live — new sign-ups get TRIAL_DAYS; the places written to
// get the end of 2026 with the LASPEZIA2026 voucher (and earlier sign-ups keep theirs).
// 14. 10.: Bob's trade licence (živnost) starts on 1. 1. 2027, so until then
// nobody pays: every trial runs to the end of 2026 (31. 12. 23:59 Italian
// time), and a subscription started earlier is charged only from then.
export const EARLY_ACCESS_ENDS = Date.UTC(2026, 11, 31, 22, 59, 59);
const DAY = 86400000;
// Stripe retries failed payments for a while ("past_due"); keep the app
// working meanwhile. It ends as "unpaid" or "canceled".
const PAYING = ['active', 'trialing', 'past_due'];

export const billingEnabled = env => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_GUESTS);

// The month's price by its guests, in euro cents — the same tiers as the
// Stripe price (graduated: each tier's flat fee adds up). The first tier is
// "1 guest, free" because Stripe charges a first tier's flat fee also for 0.
export const GUEST_TIERS = [
  { upTo: 1, flat: 0 }, { upTo: 200, flat: 900 }, { upTo: 400, flat: 1000 },
  { upTo: 800, flat: 1000 }, { upTo: 1000, flat: 1000 }, { upTo: Infinity, perGuest: 4 },
];
export function priceForGuests(n) {
  let cents = 0, below = 0;
  for (const t of GUEST_TIERS) {
    if (n <= below) break;
    cents += (t.flat || 0) + (t.perGuest || 0) * (Math.min(n, t.upTo) - below);
    below = t.upTo;
  }
  return cents;
}
export const TEAM_PRICE = 10;

// items: the Stripe prices of a plan (env names); the guests price is metered.
export const PLANS = {
  checkin: { name: 'Check-in', items: ['STRIPE_PRICE_GUESTS'] },
  flow: { name: 'Flow', items: ['STRIPE_PRICE_GUESTS', 'STRIPE_PRICE_TEAM'] },
  one: { name: 'HostelOne', price: 59, items: ['STRIPE_PRICE_ID_ONE'] },
};
const METERED = ['STRIPE_PRICE_GUESTS'];
const BY_GUESTS = ['checkin', 'flow'];
const available = (env, plan) => PLANS[plan].items.every(k => env[k]);
// The plan a subscription's prices make (the most items that all match).
function planOfPrices(env, priceIds) {
  if (!priceIds.length) return null;
  const ids = new Set(priceIds);
  let best = null;
  for (const [id, p] of Object.entries(PLANS)) {
    if (available(env, id) && p.items.every(k => ids.has(env[k])) && (!best || p.items.length > PLANS[best].items.length)) best = id;
  }
  return best;
}

// Calendar and channel calendars: HostelOne, the trial, free properties.
export function hasHostelOne(env, p, now = Date.now()) {
  if (!billingEnabled(env) || p.billing_status === 'comp') return true;
  if (['trial', 'canceled'].includes(p.billing_status) && (p.trial_ends_at || 0) > now) return true;
  return p.plan === 'one' && PAYING.includes(p.billing_status);
}

export async function requireHostelOne(env, propertyId) {
  const p = await env.DB.prepare('SELECT billing_status, trial_ends_at, plan FROM properties WHERE id = ?').bind(propertyId).first();
  if (!hasHostelOne(env, p)) throw new HttpError(402, 'the calendar is part of HostelOne — the owner can switch in Settings → Subscription');
}

export function canSend(env, p, now = Date.now()) {
  if (!billingEnabled(env) || p.billing_status === 'comp') return true;
  if (PAYING.includes(p.billing_status)) return !p.paused_at;
  // A subscription cancelled while its free days still ran: those days stay.
  return ['trial', 'canceled'].includes(p.billing_status) && (p.trial_ends_at || 0) > now;
}

// A property paid for by another one: that one's subscription counts.
// Only a running subscription by guests (or a free one) pays for other
// properties; otherwise each stands on its own (its own trial too).
async function payer(db, p) {
  if (!p.billing_parent) return p;
  const parent = await db.prepare('SELECT id, name, plan, billing_status, trial_ends_at, paused_at FROM properties WHERE id = ?')
    .bind(p.billing_parent).first();
  const pays = parent && (parent.billing_status === 'comp' || (BY_GUESTS.includes(parent.plan) && PAYING.includes(parent.billing_status)));
  return pays ? parent : p;
}

// The Check-in plan is check-in, police and statistics only: the Dashboard,
// Housekeeping and Shifts are the Team's. The trial, free properties and ones
// without a running subscription keep everything (sending is what stops when
// nothing is paid). 'apartments': the old Multiple apartments plan, check-in only.
const CHECKIN_ONLY = ['checkin', 'apartments'];
export function hasFullApp(env, payerRow) {
  if (!billingEnabled(env) || !payerRow || payerRow.billing_status === 'comp') return true;
  return !(PAYING.includes(payerRow.billing_status) && CHECKIN_ONLY.includes(payerRow.plan));
}
export async function fullAppOf(env, p) {
  return hasFullApp(env, await payer(env.DB, p));
}
export async function requireFullApp(env, propertyId) {
  const p = await env.DB.prepare('SELECT id, plan, billing_status, trial_ends_at, billing_parent, paused_at FROM properties WHERE id = ?').bind(propertyId).first();
  if (p && !(await fullAppOf(env, p))) {
    throw new HttpError(402, 'the Dashboard, Housekeeping, Shifts and the Vault are part of Flow — the owner can switch in Settings → Subscription');
  }
}

export async function requireCanSend(env, p) {
  const b = await payer(env.DB, p);
  if (canSend(env, b)) return;
  if (b.paused_at && PAYING.includes(b.billing_status)) {
    throw new HttpError(402, 'the subscription is paused for the season — the owner can resume it in Settings → Subscription');
  }
  throw new HttpError(402, 'the free trial has ended — the owner can subscribe in Settings to keep registering guests');
}

// Guests sent to the police since `from` by these properties (a subscription
// and the ones it pays for) — what the month costs.
async function guestsSince(db, ids, from) {
  const r = await db.prepare(
    `SELECT COUNT(*) AS n FROM guests WHERE property_id IN (${ids.map(() => '?').join(',')}) AND status = 'sent' AND sent_at >= ?`,
  ).bind(...ids, from).first();
  return r.n;
}

// Where the month being counted began: the subscription's period (a month
// before its end, never before the paid part started), else the calendar month.
function periodStart(p, now = Date.now()) {
  if (p.current_period_end && p.current_period_end > now) {
    const d = new Date(p.current_period_end);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return Math.max(d.getTime(), p.paid_from || 0);
  }
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// Stripe's API takes form-encoded bodies with a[b][0][c]=d style keys.
function form(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params, version) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(version ? { 'Stripe-Version': version } : {}),
    },
    body: params ? form(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('stripe error', res.status, data.error && data.error.message);
    throw new HttpError(502, 'the payment service is not responding correctly — try again later');
  }
  return data;
}

const COLS = 'id, name, plan, billing_status, trial_ends_at, stripe_customer_id, stripe_subscription_id, current_period_end, billing_parent, paused_at, cancel_at, paid_from';
async function ownerContext(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requireRole(env.DB, user.id, propertyId, ['owner']);
  const p = await env.DB.prepare(`SELECT ${COLS} FROM properties WHERE id = ?`).bind(propertyId).first();
  return { user, p };
}

// The other properties this property's subscription pays for (besides itself).
const childrenOf = async (db, id) => (await db.prepare('SELECT id, name FROM properties WHERE billing_parent = ? ORDER BY created_at').bind(id).all()).results;

async function view(env, p) {
  const db = env.DB;
  const parent = p.billing_parent ? await payer(db, p) : null;
  const children = await childrenOf(db, p.id);
  // This month so far, with the properties it pays for.
  const guests = await guestsSince(db, [p.id, ...children.map(c => c.id)], periodStart(p));
  return {
    enabled: billingEnabled(env),
    status: p.billing_status,
    trialEndsAt: p.trial_ends_at,
    currentPeriodEnd: p.current_period_end,
    // Cancelled, still running until this date (then it ends by itself).
    cancelAt: PAYING.includes(p.billing_status) ? p.cancel_at || null : null,
    canSend: canSend(env, parent || p),
    hasCustomer: !!p.stripe_customer_id,
    plan: PLANS[p.plan] ? p.plan : 'checkin',
    paused: !!p.paused_at,
    hostelOne: hasHostelOne(env, p),
    // A property under another property's subscription.
    paidBy: parent && parent.id !== p.id ? { id: parent.id, name: parent.name } : null,
    apartments: { ids: children.map(c => c.id) },
    month: { guests, price: priceForGuests(guests) / 100 },
    tiers: GUEST_TIERS.filter(t => t.flat).map(t => ({ upTo: t.upTo, price: priceForGuests(t.upTo) / 100 })),
    perGuestAbove: GUEST_TIERS.at(-1).perGuest / 100,
    teamPrice: TEAM_PRICE,
    plans: Object.entries(PLANS).map(([id, x]) => ({
      id, name: x.name, available: available(env, id),
      ...(id === 'flow' ? { team: TEAM_PRICE } : {}), ...(x.price ? { price: x.price } : {}),
    })),
  };
}

export async function getBilling(env, request, propertyId) {
  const { p } = await ownerContext(env, request, propertyId);
  return json(await view(env, p));
}

async function chosenPlan(env, request) {
  let plan = 'checkin';
  try { plan = (await request.clone().json()).plan || 'checkin'; } catch { /* no body: Check-in */ }
  if (!PLANS[plan]) throw new HttpError(400, 'unknown plan');
  if (!available(env, plan)) throw new HttpError(400, `${PLANS[plan].name} is not available yet`);
  return plan;
}

// A plan's Stripe line items: a metered price takes no quantity (Stripe
// counts the guests reported to its meter).
const lineItems = (env, plan) => PLANS[plan].items.map(k => (METERED.includes(k) ? { price: env[k] } : { price: env[k], quantity: 1 }));

// The first charge waits for the free days left (own trial or voucher) and
// never comes before billing starts (EARLY_ACCESS_ENDS). Stripe wants a
// trial end at least 48 h ahead: right before either, a little later.
function firstCharge(p, now = Date.now()) {
  // Free days left also after a cancelled subscription (they stayed its).
  const free = Math.max(['trial', 'canceled'].includes(p.billing_status) ? p.trial_ends_at || 0 : 0, EARLY_ACCESS_ENDS);
  if (free <= now) return {};
  return { trial_end: Math.floor(Math.max(free, now + 2 * DAY + 3600000) / 1000) };
}

// Stripe Managed Payments (Stripe the merchant of record: it charges and pays
// the VAT of every country, sends the invoices — "Sold through Link" — and
// handles disputes; +3.5 % per payment). On with STRIPE_MANAGED_PAYMENTS = "1",
// once Stripe has approved it for the account (Dashboard → Settings → Managed
// Payments) and every product has an eligible tax code (SaaS – business use,
// txcd_10103001). Only new subscriptions: running ones stay as they are.
const managedPayments = env => env.STRIPE_MANAGED_PAYMENTS === '1';
const MANAGED_API_VERSION = '2026-04-22.dahlia'; // the first version with managed_payments

// Body: { plan }. Returns { url } of a Stripe Checkout page.
export async function startCheckout(env, request, propertyId) {
  if (!billingEnabled(env)) throw new HttpError(400, 'subscriptions are not available yet');
  const plan = await chosenPlan(env, request);
  const { user, p } = await ownerContext(env, request, propertyId);
  if (p.billing_parent) throw new HttpError(409, 'this property is already paid for by the subscription of another one');
  if (PAYING.includes(p.billing_status) || p.billing_status === 'unpaid') throw new HttpError(409, 'already subscribed — use "Manage subscription"');
  if (p.billing_status === 'comp') throw new HttpError(409, 'this property is free — nothing to pay');
  // Other properties ride along only on a plan by guests.
  if (!BY_GUESTS.includes(plan) && (await childrenOf(env.DB, p.id)).length) {
    throw new HttpError(409, 'other properties are on this subscription — take them off first');
  }
  let customer = p.stripe_customer_id;
  if (!customer) {
    customer = (await stripe(env, 'POST', 'customers', {
      email: user.email, name: p.name, metadata: { property_id: p.id },
    })).id;
    await env.DB.prepare('UPDATE properties SET stripe_customer_id = ? WHERE id = ?').bind(customer, p.id).run();
  }
  // An earlier checkout still open (another tab, back from Stripe): closed, so
  // that two can't both finish into two subscriptions.
  try {
    const open = await stripe(env, 'GET', `checkout/sessions?customer=${encodeURIComponent(customer)}&status=open&limit=10`);
    for (const s of (open && open.data) || []) await stripe(env, 'POST', `checkout/sessions/${s.id}/expire`, {}).catch(() => {});
  } catch { /* the webhook still stops a second subscription */ }
  const origin = new URL(request.url).origin;
  const managed = managedPayments(env);
  const session = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: p.id,
    line_items: lineItems(env, plan),
    // Before billing starts: the card is saved, the first charge waits (Stripe wants 2+ days ahead).
    subscription_data: { metadata: { property_id: p.id, plan }, ...firstCharge(p) },
    billing_address_collection: 'required',
    // Managed Payments: Stripe sells as the merchant of record (VAT, invoices,
    // the customer's name and address are its own); without it, we collect them.
    ...(managed ? { managed_payments: { enabled: true } } : {
      tax_id_collection: { enabled: true }, // hostels are businesses: let them add their VAT number
      customer_update: { name: 'auto', address: 'auto' },
    }),
    allow_promotion_codes: true,
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancel`,
  }, managed ? MANAGED_API_VERSION : undefined);
  return json({ url: session.url });
}

// Whether a subscription still runs, asked from Stripe itself (our copy can be
// behind when webhooks arrive late). Unknown: treated as not running.
async function runningInStripe(env, subId) {
  if (!subId) return false;
  try { return PAYING.includes((await stripe(env, 'GET', `subscriptions/${subId}`)).status); } catch { return false; }
}

// Body: { plan } — moves a running subscription to another plan: the items
// it no longer needs go, the missing ones come (Stripe prorates the Team fee
// on the next invoice); the guests item stays and keeps counting.
export async function changePlan(env, request, propertyId) {
  if (!billingEnabled(env)) throw new HttpError(400, 'subscriptions are not available yet');
  const plan = await chosenPlan(env, request);
  const { p } = await ownerContext(env, request, propertyId);
  if (!p.stripe_subscription_id || !PAYING.includes(p.billing_status)) throw new HttpError(400, 'no running subscription — subscribe first');
  if (!BY_GUESTS.includes(plan) && (await childrenOf(env.DB, p.id)).length) {
    throw new HttpError(409, 'first remove the other properties from this subscription');
  }
  const sub = await stripe(env, 'GET', `subscriptions/${p.stripe_subscription_id}`);
  const have = (sub.items && sub.items.data) || [];
  const want = lineItems(env, plan);
  const items = [
    ...have.filter(i => !want.some(w => w.price === (i.price && i.price.id))).map(i => ({ id: i.id, deleted: true })),
    ...want.filter(w => !have.some(i => (i.price && i.price.id) === w.price)),
  ];
  if (items.length) {
    await stripe(env, 'POST', `subscriptions/${p.stripe_subscription_id}`, {
      items, proration_behavior: 'create_prorations', metadata: { property_id: p.id, plan },
    }, managedPayments(env) ? MANAGED_API_VERSION : undefined);
  }
  await env.DB.prepare('UPDATE properties SET plan = ? WHERE id = ?').bind(plan, p.id).run();
  return json(await view(env, { ...p, plan }));
}

// Body: { ids } — which of the owner's other properties this one's
// subscription pays for (their guests count with its own). Allowed in the
// trial too, so that subscribing covers them all at once.
export async function setApartments(env, request, propertyId) {
  const db = env.DB;
  const { user, p } = await ownerContext(env, request, propertyId);
  const raw = (await readJson(request)).ids;
  if (!Array.isArray(raw)) throw new HttpError(400, 'ids must be a list');
  const ids = [...new Set(raw.map(String))].filter(id => id !== p.id);
  if (ids.length && p.billing_status !== 'trial' && !BY_GUESTS.includes(p.plan)) {
    throw new HttpError(409, 'other properties can be added only to a subscription by guests');
  }
  if (p.billing_parent) throw new HttpError(409, 'this property is already paid for by the subscription of another one');
  for (const id of ids) {
    const o = await db.prepare(
      `SELECT p.billing_status, p.billing_parent, (SELECT COUNT(*) FROM properties c WHERE c.billing_parent = p.id) AS kids
       FROM memberships m JOIN properties p ON p.id = m.property_id WHERE m.user_id = ? AND m.property_id = ? AND m.role = 'owner'`,
    ).bind(user.id, id).first();
    if (!o) throw new HttpError(403, 'only properties you own can be added');
    if (o.billing_parent && o.billing_parent !== p.id) throw new HttpError(409, 'one of them is already paid for by another subscription');
    if (PAYING.includes(o.billing_status) || o.billing_status === 'comp') throw new HttpError(409, 'one of them has its own subscription — cancel it first');
    if (o.kids) throw new HttpError(409, 'one of them already pays for other apartments');
  }
  // Nothing to tell Stripe: their guests are counted with this property's.
  await db.batch([
    db.prepare('UPDATE properties SET billing_parent = NULL WHERE billing_parent = ?').bind(p.id),
    ...ids.map(id => db.prepare('UPDATE properties SET billing_parent = ? WHERE id = ?').bind(p.id, id)),
  ]);
  return json(await view(env, p));
}

// Body: { pause: true | false } — closed for the season: nothing is charged
// while paused (Stripe voids those invoices); sending waits for the resume.
export async function pauseSubscription(env, request, propertyId) {
  if (!billingEnabled(env)) throw new HttpError(400, 'subscriptions are not available yet');
  const { p } = await ownerContext(env, request, propertyId);
  const pause = (await readJson(request)).pause === true;
  // Pausing is switched off for now (14. 10.); one already paused can still resume.
  if (pause) throw new HttpError(400, 'pausing a subscription is not offered at the moment');
  if (!p.stripe_subscription_id || !PAYING.includes(p.billing_status)) throw new HttpError(400, 'no running subscription — subscribe first');
  await stripe(env, 'POST', `subscriptions/${p.stripe_subscription_id}`, {
    pause_collection: pause ? { behavior: 'void' } : '',
  });
  const pausedAt = pause ? (p.paused_at || Date.now()) : null;
  await env.DB.prepare('UPDATE properties SET paused_at = ? WHERE id = ?').bind(pausedAt, p.id).run();
  return json(await view(env, { ...p, paused_at: pausedAt }));
}

// Returns { url } of the Stripe Customer Portal (card, invoices, cancel).
export async function openPortal(env, request, propertyId) {
  if (!billingEnabled(env)) throw new HttpError(400, 'subscriptions are not available yet');
  const { p } = await ownerContext(env, request, propertyId);
  if (!p.stripe_customer_id) throw new HttpError(400, 'no subscription yet');
  const session = await stripe(env, 'POST', 'billing_portal/sessions', {
    customer: p.stripe_customer_id, return_url: new URL(request.url).origin + '/',
  });
  return json({ url: session.url });
}

// Hourly: the guests sent since the last report, per paying subscription
// (with the properties it pays for), go to Stripe's meter — Stripe adds them
// up for the month's invoice. Only once the paid part runs (not in Stripe's
// trial, nor guests from before it). A guest is marked before it is reported,
// so it can never count twice; if Stripe refuses, the marks are taken back
// and the next hour tries again.
export async function reportUsage(env, now = Date.now()) {
  if (!billingEnabled(env) || !env.STRIPE_METER_EVENT) return;
  const db = env.DB;
  const { results } = await db.prepare(
    `SELECT id, stripe_customer_id, paid_from FROM properties
     WHERE plan IN ('checkin', 'flow') AND billing_status IN ('active', 'past_due')
       AND stripe_customer_id IS NOT NULL AND paid_from IS NOT NULL AND paid_from <= ?`,
  ).bind(now).all();
  // One failing (Stripe hiccup) must not stop the others; we hear about it.
  for (const p of results) {
    const ids = [p.id, ...(await childrenOf(db, p.id)).map(c => c.id)];
    const marks = `property_id IN (${ids.map(() => '?').join(',')}) AND status = 'sent'`;
    const r = await db.prepare(`UPDATE guests SET metered_at = ? WHERE ${marks} AND metered_at IS NULL AND sent_at >= ? AND sent_at < ?`)
      .bind(now, ...ids, p.paid_from, now).run();
    const n = r.meta.changes;
    if (!n) continue;
    try {
      await stripe(env, 'POST', 'billing/meter_events', {
        event_name: env.STRIPE_METER_EVENT,
        // The same hour's report again (a retry) is counted once by Stripe.
        identifier: `${p.id}-${now}`,
        payload: { stripe_customer_id: p.stripe_customer_id, value: n },
      });
    } catch (err) {
      await db.prepare(`UPDATE guests SET metered_at = NULL WHERE ${marks} AND metered_at = ?`).bind(...ids, now).run();
      await alert(env, 'usage', `Reporting ${n} guests of property ${p.id} to Stripe failed: ${err.message || err}`);
    }
  }
}

// ===== Webhook =====

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">[,v1=...]
export async function verifyStripeSignature(secret, header, body, now = Date.now()) {
  const parts = String(header || '').split(',').map(s => s.split('='));
  const t = Number((parts.find(([k]) => k === 't') || [])[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!secret || !t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`)));
  return sigs.some(s => s.length === expected.length && [...s].every((c, i) => c === expected[i]));
}

// What came in through Stripe this month, this year and ever, in euro cents:
// gross (payments minus refunds) and net (after Stripe's fees). Null without Stripe.
export async function stripeEarnings(env, { monthFrom = 0, yearFrom = 0 } = {}) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const sum = () => ({ gross: 0, net: 0 });
  const out = { month: sum(), year: sum(), all: sum() };
  let after = null;
  for (let page = 0; page < 30; page++) {
    const list = await stripe(env, 'GET', `balance_transactions?limit=100${after ? `&starting_after=${after}` : ''}`);
    for (const t of list.data) {
      if (t.currency !== 'eur' || !['charge', 'payment', 'refund', 'payment_refund'].includes(t.type)) continue;
      const at = t.created * 1000;
      for (const [k, from] of [['all', 0], ['year', yearFrom], ['month', monthFrom]]) {
        if (at >= from) { out[k].gross += t.amount; out[k].net += t.net; }
      }
    }
    if (!list.has_more || !list.data.length) break;
    after = list.data[list.data.length - 1].id;
  }
  return out;
}

export async function stripeWebhook(env, request) {
  const body = await request.text();
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get('Stripe-Signature'), body))) {
    return json({ error: 'bad signature' }, 400);
  }
  const event = JSON.parse(body);
  const obj = event.data && event.data.object;
  const db = env.DB;

  if (event.type === 'checkout.session.completed' && obj.client_reference_id) {
    const row = await db.prepare('SELECT stripe_subscription_id FROM properties WHERE id = ?').bind(obj.client_reference_id).first();
    if (row && row.stripe_subscription_id && row.stripe_subscription_id !== obj.subscription && await runningInStripe(env, row.stripe_subscription_id)) {
      // Two checkouts finished (two tabs): the second subscription goes before it charges.
      await stripe(env, 'DELETE', `subscriptions/${obj.subscription}`).catch(() => {});
      await alert(env, 'duplicate-subscription', `Property ${obj.client_reference_id}: a second subscription ${obj.subscription} was cancelled (running: ${row.stripe_subscription_id}).`);
      return json({ received: true });
    }
    await db.prepare(
      `UPDATE properties SET stripe_customer_id = COALESCE(stripe_customer_id, ?), stripe_subscription_id = ?
       WHERE id = ?`,
    ).bind(obj.customer, obj.subscription, obj.client_reference_id).run();
  }

  if (event.type.startsWith('customer.subscription.')) {
    // One property: the one the subscription names, else the one with this
    // customer (never every property that shares it).
    const row = await db.prepare('SELECT id, stripe_subscription_id FROM properties WHERE id = ? OR stripe_customer_id = ? ORDER BY id = ? DESC LIMIT 1')
      .bind((obj.metadata && obj.metadata.property_id) || '', obj.customer || '', (obj.metadata && obj.metadata.property_id) || '').first();
    if (!row) return json({ received: true });
    if (row && row.stripe_subscription_id && row.stripe_subscription_id !== obj.id && await runningInStripe(env, row.stripe_subscription_id)) {
      // About another subscription than the running one: an old one (late
      // event) is ignored; a new second one is cancelled before it charges.
      if (event.type !== 'customer.subscription.deleted' && PAYING.includes(obj.status)) {
        await stripe(env, 'DELETE', `subscriptions/${obj.id}`).catch(() => {});
        await alert(env, 'duplicate-subscription', `Property ${row.id}: a second subscription ${obj.id} was cancelled (running: ${row.stripe_subscription_id}).`);
      }
      return json({ received: true });
    }
    // Events can come late or out of order: the subscription's state now, from Stripe.
    if (event.type !== 'customer.subscription.deleted') {
      try {
        const fresh = await stripe(env, 'GET', `subscriptions/${obj.id}`);
        if (fresh && fresh.id === obj.id) Object.assign(obj, fresh);
      } catch { /* the event's own copy, then */ }
    }
    const status = event.type === 'customer.subscription.deleted' || obj.status === 'canceled' ? 'canceled' : obj.status;
    // Newer API versions keep the period on the subscription items.
    const periodEnd = obj.current_period_end
      || (obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].current_period_end);
    const prices = ((obj.items && obj.items.data) || []).map(i => i.price && i.price.id).filter(Boolean);
    const known = planOfPrices(env, prices);
    // Paused for the season (or resumed) — also when done in Stripe's own portal.
    const paused = !!obj.pause_collection && status !== 'canceled';
    // Cancelled for the end of the period: when it stops (null once renewed).
    const cancelAt = status === 'canceled' ? null : obj.cancel_at || (obj.cancel_at_period_end ? periodEnd : null);
    // Guests count from when the subscription is paid: after its free days.
    const paidFrom = obj.trial_end || obj.start_date;
    await db.prepare(
      `UPDATE properties SET billing_status = ?, stripe_subscription_id = ?, current_period_end = ?, plan = COALESCE(?, plan),
         paused_at = CASE WHEN ? = 1 THEN COALESCE(paused_at, ?) ELSE NULL END, cancel_at = ?,
         paid_from = COALESCE(?, paid_from)
       WHERE billing_status != 'comp' AND id = ?`,
    ).bind(status, obj.id, periodEnd ? periodEnd * 1000 : null, known,
      paused ? 1 : 0, Date.now(), cancelAt ? cancelAt * 1000 : null, paidFrom ? paidFrom * 1000 : null, row.id).run();
  }
  return json({ received: true });
}

export const trialEnd = (now = Date.now()) => Math.max(now + TRIAL_DAYS * DAY, EARLY_ACCESS_ENDS);

// ===== Voucher codes (migrations/0043) =====

const BAD_VOUCHER = 'this voucher code is not valid or has expired';
const cleanCode = code => String(code || '').trim().toUpperCase();

// A code that can still be used: its row, or a 400.
export async function checkVoucher(db, code, now = Date.now()) {
  const v = await db.prepare('SELECT code, free_until, redeem_by, max_uses, uses FROM vouchers WHERE code = ?').bind(cleanCode(code)).first();
  if (!v || v.redeem_by < now || v.uses >= v.max_uses) throw new HttpError(400, BAD_VOUCHER);
  return v;
}

// Uses the code for a property: its free trial lasts until the voucher's date.
// Counted once per property; the count can't pass max_uses even when two
// people redeem at the same moment.
export async function redeemVoucher(db, code, propertyId, now = Date.now()) {
  const v = await checkVoucher(db, code, now);
  if (await db.prepare('SELECT 1 FROM voucher_uses WHERE code = ? AND property_id = ?').bind(v.code, propertyId).first()) {
    throw new HttpError(409, 'this voucher has already been used here');
  }
  // Once per owner, not once per each of their properties.
  if (await db.prepare(
    `SELECT 1 FROM voucher_uses u JOIN memberships m ON m.property_id = u.property_id AND m.role = 'owner'
     WHERE u.code = ? AND m.user_id IN (SELECT user_id FROM memberships WHERE property_id = ? AND role = 'owner')`,
  ).bind(v.code, propertyId).first()) {
    throw new HttpError(409, 'this voucher has already been used on your account');
  }
  const r = await db.prepare('UPDATE vouchers SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND redeem_by >= ?').bind(v.code, now).run();
  if (!r.meta.changes) throw new HttpError(400, BAD_VOUCHER);
  await db.batch([
    db.prepare('INSERT INTO voucher_uses (code, property_id, used_at) VALUES (?, ?, ?)').bind(v.code, propertyId, now),
    db.prepare("UPDATE properties SET trial_ends_at = MAX(COALESCE(trial_ends_at, 0), ?) WHERE id = ? AND billing_status = 'trial'").bind(v.free_until, propertyId),
  ]);
  return v;
}

// Settings → Subscription: a code for a property that is in its trial.
export async function applyVoucher(env, request, propertyId) {
  const { p } = await ownerContext(env, request, propertyId);
  if (p.billing_status !== 'trial') throw new HttpError(409, 'vouchers are for the free trial — this property already has a subscription');
  await redeemVoucher(env.DB, (await readJson(request)).code, p.id);
  const fresh = await env.DB.prepare(`SELECT ${COLS} FROM properties WHERE id = ?`).bind(p.id).first();
  return json(await view(env, fresh));
}
