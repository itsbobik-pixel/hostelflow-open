// The admin centre's "Claude credit" card. We buy API credit in advance and
// Anthropic shows the balance only in Claude Console → Billing, not through
// its API — so the admins note each top-up here and the card takes off what
// Anthropic billed since: exactly, from its Cost Report (Admin API, secret
// ANTHROPIC_ADMIN_KEY, kept per day in claude_cost_daily and asked at most
// once an hour). Without that key, an estimate from our own per-day AI costs:
// document scans (usage_daily, priced per scan as it happens) and Flowy
// (assistant_usage tokens) — missing failed readings, the scan bench and
// staging. Numbers only, no guest data; the key is never logged or returned.
import { HttpError, json } from './http.js';
import { CLAUDE_PRICES, tokenCostMicro } from './claude-prices.js';
import { ASSISTANT_MODEL } from './assistant.js';

const DAY = 86400000;
const LOW_MICRO = 10e6; // under $10 left: the card turns red
export const romeDay = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(t);
const dayNum = d => Date.parse(`${d}T00:00:00Z`) / DAY;
const addDays = (d, n) => new Date((dayNum(d) + n) * DAY).toISOString().slice(0, 10);
const daysInMonth = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();

// days: [{ day, costMicro, scans }] (any order, may repeat a day);
// months: [{ month: 'YYYY-MM', costMicro }] — the scans' monthly totals, used
// only before the first day in `days` (older scans, each month spread evenly).
// topups: [{ id, day, amountCents, … }]; today: 'YYYY-MM-DD' in Italy.
export function creditEstimate({ topups, days, months = [], today }) {
  const covered = days.reduce((m, d) => (!m || d.day < m ? d.day : m), null) || today;
  const spentSince = since => {
    let micro = 0;
    for (const d of days) if (d.day >= since && d.day <= today) micro += d.costMicro || 0;
    // Before the per-day numbers start: that share of each month's total.
    if (since < covered) {
      for (const m of months) {
        const first = `${m.month}-01`, last = addDays(first, daysInMonth(m.month) - 1);
        const from = since > first ? since : first, to = addDays(covered, -1) < last ? addDays(covered, -1) : last;
        if (to >= from) micro += (m.costMicro || 0) * (dayNum(to) - dayNum(from) + 1) / daysInMonth(m.month);
      }
    }
    return Math.round(micro);
  };
  const span = n => {
    const from = addDays(today, -(n - 1));
    let micro = 0, scans = 0;
    for (const d of days) if (d.day >= from && d.day <= today) { micro += d.costMicro || 0; scans += d.scans || 0; }
    return { micro, scans };
  };
  const last7 = span(7), last30 = span(30);
  // Averages over the last 30 days, or fewer when our numbers start later.
  const n = Math.max(1, Math.min(30, dayNum(today) - dayNum(covered) + 1));
  const perDayMicro = last30.micro / n;

  const list = topups.map(t => ({ ...t, spentSinceMicro: spentSince(t.day) }));
  const toppedUpMicro = topups.reduce((s, t) => s + t.amountCents * 1e4, 0);
  const first = topups.reduce((m, t) => (!m || t.day < m ? t.day : m), null);
  const spentMicro = first ? spentSince(first) : 0;
  const remainingMicro = toppedUpMicro - spentMicro;
  return {
    topups: list,
    toppedUpMicro, spentMicro, remainingMicro,
    last7Micro: last7.micro, last30Micro: last30.micro,
    scansPerDay: Math.round((last30.scans / n) * 10) / 10,
    perDayMicro: Math.round(perDayMicro),
    daysLeft: first && perDayMicro > 0 ? Math.max(0, Math.floor(remainingMicro / perDayMicro)) : null,
    low: !!first && remainingMicro < LOW_MICRO,
    coveredFrom: covered,
  };
}

// ---- Exact: Anthropic's Cost Report ----
const COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const FRESH_MS = 3600000; // ask Anthropic at most once an hour
const utcDay = t => new Date(t).toISOString().slice(0, 10);

// All daily buckets from `from` (YYYY-MM-DD, UTC) up to and including today
// (still running, so it can grow). Amounts come as decimal strings in cents.
async function fetchCostDays(env, from, now) {
  const get = env.anthropicFetch || fetch; // env.anthropicFetch: test stand-in
  const days = [];
  let page = null;
  for (let i = 0; i < 50; i++) { // 31 days a page: years of history, then stop
    const q = new URLSearchParams({ starting_at: `${from}T00:00:00Z`, ending_at: `${addDays(utcDay(now), 1)}T00:00:00Z`, bucket_width: '1d', limit: '31' });
    if (page) q.set('page', page);
    const res = await get(`${COST_URL}?${q}`, {
      headers: { 'x-api-key': env.ANTHROPIC_ADMIN_KEY, 'anthropic-version': '2023-06-01', 'User-Agent': 'HostelFlow/1.0 (https://hostelflow.it)' },
    });
    // Only the status: an error body is not ours to pass on.
    if (!res.ok) throw Object.assign(new Error(`Anthropic Cost Report answered HTTP ${res.status}`), { status: res.status });
    const out = await res.json();
    for (const b of out.data || []) {
      days.push({ day: String(b.starting_at).slice(0, 10), cents: (b.results || []).reduce((n, r) => n + (Number(r.amount) || 0), 0) });
    }
    if (!out.has_more || !out.next_page) return days;
    page = out.next_page;
  }
  return days;
}

// Brings claude_cost_daily up to date when it is older than an hour: the days
// not stored yet (back to the first top-up, at least 30 days), and the last
// two again (today still runs; yesterday may be finished late). Also hourly from the cron.
export async function refreshClaudeCosts(env, now, force = false) {
  if (!env.ANTHROPIC_ADMIN_KEY) return false;
  const db = env.DB;
  const have = await db.prepare('SELECT MIN(day) AS first, MAX(day) AS last, MAX(fetched_at) AS at FROM claude_cost_daily').first();
  const topup = await db.prepare('SELECT MIN(day) AS first FROM claude_topups').first();
  const today = utcDay(now);
  const need = [addDays(today, -29), topup && topup.first].filter(Boolean).sort()[0];
  const backfill = !have.first || need < have.first;
  if (!force && !backfill && have.at > now - FRESH_MS) return false;
  const from = backfill ? need : addDays(have.last, -1);
  const days = await fetchCostDays(env, from, now);
  if (days.length) {
    await db.batch(days.map(d => db.prepare(
      'INSERT INTO claude_cost_daily (day, amount_cents, fetched_at) VALUES (?, ?, ?) ON CONFLICT (day) DO UPDATE SET amount_cents = excluded.amount_cents, fetched_at = excluded.fetched_at',
    ).bind(d.day, d.cents, now)));
  } else {
    await db.prepare('UPDATE claude_cost_daily SET fetched_at = ? WHERE day = ?').bind(now, have.last || '').run();
  }
  return true;
}

// The card's numbers: exact with the Admin API key, else the estimate.
export async function creditOverview(env, now) {
  const db = env.DB;
  let error = null;
  if (env.ANTHROPIC_ADMIN_KEY) {
    try { await refreshClaudeCosts(env, now); } catch (err) {
      console.error('claude cost report', err.message);
      error = String(err.message || err).slice(0, 200);
    }
  }
  const { results: topups } = await db.prepare(
    'SELECT id, day, amount_cents AS amountCents, note, created_by AS createdBy, created_at AS createdAt FROM claude_topups ORDER BY day DESC, created_at DESC',
  ).all();
  const { results: scans } = await db.prepare('SELECT day, SUM(scans) AS scans, SUM(cost_micro) AS costMicro FROM usage_daily GROUP BY day').all();
  const { results: billed } = env.ANTHROPIC_ADMIN_KEY
    ? await db.prepare('SELECT day, amount_cents AS cents, fetched_at AS at FROM claude_cost_daily').all() : { results: [] };
  if (billed.length) {
    // Exact spend per day from Anthropic; the scans only for the scans-per-day average.
    const days = [...billed.map(b => ({ day: b.day, costMicro: Math.round(b.cents * 1e4), scans: 0 })), ...scans.map(s => ({ day: s.day, scans: s.scans, costMicro: 0 }))];
    const out = creditEstimate({ topups, days, today: utcDay(now) });
    return { ...out, source: 'exact', asOf: Math.max(...billed.map(b => b.at)), error };
  }
  return { ...(await estimateFromOurCosts(env, topups, scans, now)), source: 'estimate', keyMissing: !env.ANTHROPIC_ADMIN_KEY, error };
}

// The estimate, from our own numbers.
async function estimateFromOurCosts(env, topups, scans, now) {
  const db = env.DB;
  const { results: flowy } = await db.prepare('SELECT day, SUM(input_tokens) AS input, SUM(output_tokens) AS output FROM assistant_usage GROUP BY day').all();
  const { results: months } = await db.prepare('SELECT month, SUM(cost_micro) AS costMicro FROM usage_monthly GROUP BY month').all();
  const price = CLAUDE_PRICES[ASSISTANT_MODEL];
  const days = [
    ...scans,
    ...flowy.map(f => ({ day: f.day, scans: 0, costMicro: tokenCostMicro(price, { input_tokens: f.input, output_tokens: f.output }) })),
  ];
  return creditEstimate({ topups, days, months, today: romeDay(now) });
}

// Admin actions: { action: 'addTopup', amount (USD), day, note? } and { action: 'deleteTopup', id }.
export async function topupAction(env, user, action, body, now) {
  const db = env.DB;
  if (action === 'addTopup') {
    const amount = Number(body.amount);
    if (!(amount > 0) || amount > 100000) throw new HttpError(400, 'the amount must be more than $0 and at most $100,000');
    const day = String(body.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(dayNum(day)) || addDays(day, 0) !== day) throw new HttpError(400, 'pick the day of the top-up');
    if (day > romeDay(now)) throw new HttpError(400, 'the day cannot be in the future');
    if (day < '2024-01-01') throw new HttpError(400, 'that day is too long ago');
    const note = String(body.note || '').trim().slice(0, 200) || null;
    const id = crypto.randomUUID();
    const cents = Math.round(amount * 100);
    await db.prepare('INSERT INTO claude_topups (id, day, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, day, cents, note, user.email, now).run();
    return { response: json({ ok: true, id }, 201), detail: { day, cents } };
  }
  const row = await db.prepare('SELECT id, day, amount_cents FROM claude_topups WHERE id = ?').bind(String(body.id || '')).first();
  if (!row) throw new HttpError(404, 'no such top-up');
  await db.prepare('DELETE FROM claude_topups WHERE id = ?').bind(row.id).run();
  return { response: json({ ok: true }), detail: { day: row.day, cents: row.amount_cents } };
}
