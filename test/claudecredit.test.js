import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { hashPassword } from '../src/auth.js';
import { creditEstimate, romeDay } from '../src/claudecredit.js';
import { CLAUDE_PRICES, tokenCostMicro } from '../src/claude-prices.js';
import { costMicro } from '../src/ocr.js';

test('Claude prices: tokens to millionths of a dollar, cache tokens included', () => {
  // Haiku 5.5: $0.10 in, $0.50 out per million → 1000 in + 200 out = 100 + 100 micro.
  assert.equal(tokenCostMicro(CLAUDE_PRICES['claude-haiku-5-5'], { input_tokens: 1000, output_tokens: 200 }), 200);
  // Sonnet 5: $2 in; a cache write is 1.25×, a cache read 0.1×.
  assert.equal(tokenCostMicro(CLAUDE_PRICES['claude-sonnet-5'], { cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 }), 2700);
  assert.equal(costMicro('claude-sonnet-5', { input_tokens: 1500, output_tokens: 300 }), 6000);
  assert.equal(costMicro('claude-unknown', {}), 0);
});

test('Claude credit estimate: spent since each top-up, recent spend, how long it lasts', () => {
  const days = [
    { day: '2026-10-01', costMicro: 1e6, scans: 10 },
    { day: '2026-10-15', costMicro: 2e6, scans: 20 },
    { day: '2026-10-20', costMicro: 1e6, scans: 10 },
    { day: '2026-10-20', costMicro: 0.5e6, scans: 0 }, // Flowy, same day
  ];
  const c = creditEstimate({
    topups: [{ id: 'a', day: '2026-10-01', amountCents: 2000 }, { id: 'b', day: '2026-10-15', amountCents: 500 }],
    days, today: '2026-10-20',
  });
  assert.equal(c.toppedUpMicro, 25e6);
  assert.equal(c.spentMicro, 4.5e6);
  assert.equal(c.remainingMicro, 20.5e6);
  assert.deepEqual(c.topups.map(t => t.spentSinceMicro), [4.5e6, 3.5e6]);
  assert.equal(c.last7Micro, 3.5e6);
  assert.equal(c.last30Micro, 4.5e6);
  // Numbers since 1 Oct: 20 days, 40 scans, $4.50.
  assert.equal(c.scansPerDay, 2);
  assert.equal(c.perDayMicro, 225000);
  assert.equal(c.daysLeft, 91);
  assert.equal(c.low, false);
  assert.equal(c.coveredFrom, '2026-10-01');

  // Under $10 left: low.
  assert.equal(creditEstimate({ topups: [{ id: 'a', day: '2026-10-01', amountCents: 1000 }], days, today: '2026-10-20' }).low, true);
  // No top-up yet: nothing to estimate, not "low".
  const none = creditEstimate({ topups: [], days, today: '2026-10-20' });
  assert.equal(none.daysLeft, null);
  assert.equal(none.low, false);
});

test('Claude credit estimate: before the per-day numbers, the month total spread over its days', () => {
  const c = creditEstimate({
    topups: [{ id: 'a', day: '2026-09-16', amountCents: 5000 }],
    days: [{ day: '2026-10-01', costMicro: 1e6, scans: 1 }],
    months: [{ month: '2026-09', costMicro: 30e6 }, { month: '2026-10', costMicro: 1e6 }],
    today: '2026-10-01',
  });
  // 16–30 Sep = 15 of 30 days → $15, plus $1 on 1 Oct (October's total is in the per-day numbers).
  assert.equal(c.spentMicro, 16e6);
});

function setup() {
  const env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, ADMIN_HOST: 'admin.hf.example' };
  const admin = async (email, role = 'admin') => {
    await env.DB.prepare('INSERT INTO admin_users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), email, email.split('@')[0], await hashPassword('long admin password', 1000), role, Date.now()).run();
    let cookie = '';
    const c = async (method, body) => {
      const headers = cookie ? { Cookie: cookie } : {};
      if (body) headers['Content-Type'] = 'application/json';
      const path = body && body.email ? '/api/admin/login' : '/api/admin';
      const res = await worker.fetch(new Request(`https://admin.hf.example${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
      const set = res.headers.get('Set-Cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
    assert.equal((await c('POST', { email, password: 'long admin password' })).status, 200);
    return c;
  };
  return { env, admin };
}

test('admin centre: Claude top-ups — admins note and remove them, support only reads; the card estimates from our costs', async () => {
  const { env, admin } = setup();
  const bob = await admin('bob@example.com');
  const sue = await admin('sue@example.com', 'support');
  const today = romeDay(Date.now());
  // Some AI use today: scans of a property, and Flowy.
  await env.DB.prepare("INSERT INTO properties (id, name, created_at) VALUES ('p1', 'Test', 0)").run();
  await env.DB.prepare('INSERT INTO usage_daily (property_id, day, scans, cost_micro) VALUES (?, ?, ?, ?)').bind('p1', today, 4, 2e6).run();
  await env.DB.prepare('INSERT INTO assistant_usage (property_id, day, messages, input_tokens, output_tokens) VALUES (?, ?, 1, ?, ?)').bind('p1', today, 1e6, 1e6).run();

  const empty = (await bob('GET')).data.credit;
  assert.deepEqual(empty.topups, []);
  assert.equal(empty.daysLeft, null);

  assert.equal((await sue('POST', { action: 'addTopup', amount: 20, day: today })).status, 403);
  assert.equal((await bob('POST', { action: 'addTopup', amount: 0, day: today })).status, 400);
  assert.equal((await bob('POST', { action: 'addTopup', amount: 20, day: '2999-01-01' })).status, 400);
  assert.equal((await bob('POST', { action: 'addTopup', amount: 20, day: '2026-02-30' })).status, 400);
  const added = await bob('POST', { action: 'addTopup', amount: 20.5, day: today, note: 'balance from Console' });
  assert.equal(added.status, 201);

  const credit = (await sue('GET')).data.credit;
  assert.equal(credit.topups.length, 1);
  assert.equal(credit.topups[0].amountCents, 2050);
  // $2 of scans + Flowy 1M in × $0.10 + 1M out × $0.50 = $2.60.
  assert.equal(credit.spentMicro, 2.6e6);
  assert.equal(credit.remainingMicro, 17.9e6);
  assert.equal(credit.last7Micro, 2.6e6);
  assert.equal(credit.scansPerDay, 4);
  assert.equal(credit.daysLeft, 6);
  assert.equal(credit.low, false);

  assert.equal((await sue('POST', { action: 'deleteTopup', id: added.data.id })).status, 403);
  assert.equal((await bob('POST', { action: 'deleteTopup', id: added.data.id })).status, 200);
  assert.equal((await bob('POST', { action: 'deleteTopup', id: added.data.id })).status, 404);
  assert.deepEqual((await bob('GET')).data.credit.topups, []);
  const { results } = await env.DB.prepare("SELECT action FROM admin_audit WHERE action LIKE '%Topup' ORDER BY at").all();
  assert.deepEqual(results.map(r => r.action), ['addTopup', 'deleteTopup']);
});

test('admin centre: with the Admin API key, exact spend from Anthropic\'s Cost Report — paged, asked at most hourly, key never shown', async () => {
  const { env, admin } = setup();
  const bob = await admin('bob@example.com');
  const DAYMS = 86400000;
  const utc = t => new Date(t).toISOString().slice(0, 10);
  const today = utc(Date.now()), yesterday = utc(Date.now() - DAYMS);
  env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin01-secret';
  const calls = [];
  // Anthropic: one bucket per day; $1.50 yesterday (two lines), $0.50 today; two pages.
  env.anthropicFetch = async (url, init) => {
    calls.push({ url: new URL(url), key: init.headers['x-api-key'] });
    const u = new URL(url);
    const from = u.searchParams.get('starting_at').slice(0, 10);
    assert.equal(u.searchParams.get('bucket_width'), '1d');
    const bucket = day => ({ starting_at: `${day}T00:00:00Z`, ending_at: 'x', results: day === yesterday ? [{ amount: '100.0', currency: 'USD' }, { amount: '50', currency: 'USD' }] : day === today ? [{ amount: '50', currency: 'USD' }] : [] });
    const all = []; for (let d = from; d <= today; d = utc(Date.parse(`${d}T00:00:00Z`) + DAYMS)) all.push(d);
    const page = Number(u.searchParams.get('page') || 0);
    const chunk = all.slice(page * 31, page * 31 + 31);
    const more = (page + 1) * 31 < all.length;
    return new Response(JSON.stringify({ data: chunk.map(bucket), has_more: more, next_page: more ? String(page + 1) : null }));
  };
  // A top-up 40 days ago: the report is read back to it, over two pages.
  const old = utc(Date.now() - 40 * DAYMS);
  assert.equal((await bob('POST', { action: 'addTopup', amount: 12, day: old })).status, 201);
  const first = await bob('GET');
  const credit = first.data.credit;
  assert.equal(credit.source, 'exact');
  assert.equal(credit.spentMicro, 2e6);
  assert.equal(credit.remainingMicro, 10e6);
  assert.equal(credit.last7Micro, 2e6);
  assert.equal(credit.low, false);
  assert.ok(credit.asOf > 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('starting_at'), `${old}T00:00:00Z`);
  assert.ok(calls.every(c => c.key === 'sk-ant-admin01-secret'));
  assert.ok(!JSON.stringify(first.data).includes('sk-ant-admin'));

  // Within the hour: from the database, Anthropic is not asked again.
  await bob('GET');
  assert.equal(calls.length, 2);
  // An hour later (the cron, say): only the last two days again.
  await env.DB.prepare('UPDATE claude_cost_daily SET fetched_at = fetched_at - 3700000').run();
  await bob('GET');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url.searchParams.get('starting_at'), `${yesterday}T00:00:00Z`);

  // Anthropic fails: the stored numbers stay, with the error (status only).
  env.anthropicFetch = async () => new Response('{"error":{"message":"bad key sk-ant-admin01-secret"}}', { status: 401 });
  await env.DB.prepare('UPDATE claude_cost_daily SET fetched_at = fetched_at - 3700000').run();
  const failed = (await bob('GET')).data.credit;
  assert.equal(failed.source, 'exact');
  assert.equal(failed.spentMicro, 2e6);
  assert.match(failed.error, /HTTP 401/);
  assert.ok(!JSON.stringify(failed).includes('sk-ant-admin'));
});

test('admin centre: without the Admin API key, the estimate says so; with a key but no answer yet, the estimate and the error', async () => {
  const { env, admin } = setup();
  const bob = await admin('bob@example.com');
  const plain = (await bob('GET')).data.credit;
  assert.equal(plain.source, 'estimate');
  assert.equal(plain.keyMissing, true);
  env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin01-secret';
  env.anthropicFetch = async () => { throw new Error('network down'); };
  const down = (await bob('GET')).data.credit;
  assert.equal(down.source, 'estimate');
  assert.equal(down.keyMissing, false);
  assert.match(down.error, /network down/);
});

test('hourly job: a Cost Report key Anthropic refuses sends no e-mail (the card shows it); other failures do', async () => {
  const run = async fetchStub => {
    const env = { DB: createD1(), ANTHROPIC_ADMIN_KEY: 'sk-ant-admin01-secret', anthropicFetch: fetchStub };
    const waits = [];
    await worker.scheduled({}, env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    return env.DB.prepare("SELECT kind FROM alerts WHERE kind = 'hourly-claudeCosts'").first();
  };
  assert.equal(await run(async () => new Response('{}', { status: 403 })), null);
  assert.ok(await run(async () => new Response('{}', { status: 500 })));
});
