// The admin centre (admin.hostelflow.it): the properties at a glance and the
// few things we otherwise did by hand in SQL — extend a trial, make a property
// free (comp), change its scan limit, create vouchers — plus a daily overview,
// costs, alerts and support messages. It has accounts of its own (admin_users,
// migrations/0048), apart from the app's: signing in to the app never opens it,
// and its session cookie lives only on the admin address. Roles: admin
// (everything) and support (reading + extending a trial). Every change is
// written to admin_audit (who, when, what). No guest data: only counts.
import { deleteVaultOf } from './vault.js';
import { HttpError, json, readJson, requireEmail } from './http.js';
import { b64url, sha256Hex, verifyPassword, checkLoginAllowed, recordLoginFailure, clearLoginFailures } from './auth.js';
import { ASSISTANT_PRICE } from './assistant.js';
import { scanLimit, trialWide } from './guests.js';
import { mailEnabled } from './mail.js';
import { EARLY_ACCESS_ENDS, stripeEarnings, priceForGuests, TEAM_PRICE } from './billing.js';
import { creditOverview, topupAction } from './claudecredit.js';

const DAY = 86400000;
export const ADMIN_COOKIE = 'hf_admin';
const ADMIN_SESSION_MS = 12 * 3600000; // a working day, then sign in again

// A listed app address counts only once it is proven (confirmed), and never on
// staging without e-mail, where nothing can be proven (the scan bench).
export async function provenAddress(env, userId) {
  if (env.STAGING === '1' && !mailEnabled(env)) return false;
  const row = await env.DB.prepare('SELECT email_confirmed_at FROM users WHERE id = ?').bind(userId).first();
  return !!(row && row.email_confirmed_at);
}

const adminCookie = (token, maxAge) => `${ADMIN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function adminFromSession(env, request) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    'SELECT a.id, a.email, a.name, a.role FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id WHERE s.id_hash = ? AND s.expires_at > ?',
  ).bind(await sha256Hex(token), Date.now()).first();
}

async function adminUser(env, request, need = 'support') {
  const admin = await adminFromSession(env, request);
  if (!admin) throw new HttpError(401, 'sign in to the admin centre');
  if (need === 'admin' && admin.role !== 'admin') throw new HttpError(403, 'only an admin can do this');
  return { user: admin, role: admin.role };
}

// Login attempts count apart from the app's (same limits, own key).
const loginKey = email => `admin:${email}`;

async function adminLogin(env, request) {
  const db = env.DB;
  const body = await readJson(request);
  const email = requireEmail(body);
  await checkLoginAllowed(db, loginKey(email));
  const admin = await db.prepare('SELECT id, email, name, role, password_hash FROM admin_users WHERE email = ?').bind(email).first();
  if (!admin || !(await verifyPassword(String(body.password || ''), admin.password_hash))) {
    await recordLoginFailure(db, loginKey(email));
    throw new HttpError(401, 'wrong e-mail or password');
  }
  await clearLoginFailures(db, loginKey(email));
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO admin_sessions (id_hash, admin_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), admin.id, now + ADMIN_SESSION_MS),
    db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').bind(now, admin.id),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
  ]);
  await record(env, admin.email, 'login', null, null);
  return json({ email: admin.email, name: admin.name, role: admin.role }, 200, { 'Set-Cookie': adminCookie(token, ADMIN_SESSION_MS / 1000) });
}

async function adminLogout(env, request) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE id_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': adminCookie('', 0) });
}

// /api/admin/* (only on the admin address, or locally — see worker.js).
export async function handleAdmin(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;
  try {
    if (pathname === '/api/admin/login' && method === 'POST') return await adminLogin(env, request);
    if (pathname === '/api/admin/logout' && method === 'POST') return await adminLogout(env, request);
    if (pathname === '/api/admin/me' && method === 'GET') {
      const { user, role } = await adminUser(env, request);
      return json({ email: user.email, name: user.name, role });
    }
    if (pathname === '/api/admin' && method === 'GET') return await adminOverview(env, request);
    if (pathname === '/api/admin' && method === 'POST') return await adminAction(env, request);
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status);
    console.error(err);
    return json({ error: 'server error' }, 500);
  }
}

// Midnight in Italy (where the hostels are), as a timestamp.
function romeMidnight(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'shortOffset' })
    .formatToParts(t).map(p => [p.type, p.value]));
  const off = (parts.timeZoneName.match(/GMT([+-]\d+)/) || [, '+0'])[1];
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00${off.startsWith('-') ? '-' : '+'}${String(Math.abs(+off)).padStart(2, '0')}:00`);
}

// The day at a glance: today vs yesterday, the last 7 days, and what needs a look.
// Demos (src/demo.js) are left out everywhere: made-up guests, nobody's hostel.
async function dailyOverview(env, now) {
  const db = env.DB;
  const today = romeMidnight(now);
  const days = Array.from({ length: 7 }, (_, i) => romeMidnight(today - (6 - i) * DAY + 3 * 3600000)); // 3 h in: DST-safe
  const from = days[0];
  const { results: guests } = await db.prepare('SELECT created_at, sent_at, property_id FROM guests WHERE (created_at >= ? OR sent_at >= ?) AND property_id NOT IN (SELECT id FROM properties WHERE demo_until IS NOT NULL)').bind(from, from).all();
  const { results: props } = await db.prepare('SELECT created_at FROM properties WHERE created_at >= ? AND demo_until IS NULL').bind(from).all();
  const dayOf = t => { for (let i = days.length - 1; i >= 0; i--) if (t >= days[i]) return i; return -1; };
  const series = days.map(d => ({ day: d, added: 0, sent: 0, signups: 0 }));
  for (const g of guests) {
    if (g.created_at >= from) series[dayOf(g.created_at)].added++;
    if (g.sent_at && g.sent_at >= from) series[dayOf(g.sent_at)].sent++;
  }
  for (const p of props) series[dayOf(p.created_at)].signups++;
  // Each property's activity (guests added + sent) today, in 7 days and this month (in Italy).
  const romeDate = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(t);
  const ym = romeDate(now).slice(0, 7);
  const monthFrom = romeMidnight(Date.parse(`${ym}-01T12:00:00Z`));
  const [yr, mo] = ym.split('-').map(Number);
  const prevMonthFrom = romeMidnight(Date.UTC(mo === 1 ? yr - 1 : yr, mo === 1 ? 11 : mo - 2, 1, 12));
  const yearFrom = romeMidnight(Date.UTC(yr, 0, 1, 12));
  const { results: act } = await db.prepare(
    `SELECT property_id AS id,
       SUM(created_at >= ?1) AS ad, SUM(created_at >= ?2) AS aw, SUM(created_at >= ?3) AS am,
       SUM(COALESCE(sent_at, 0) >= ?1) AS sd, SUM(COALESCE(sent_at, 0) >= ?2) AS sw, SUM(COALESCE(sent_at, 0) >= ?3) AS sm
     FROM guests WHERE (created_at >= ?3 OR sent_at >= ?3) AND property_id NOT IN (SELECT id FROM properties WHERE demo_until IS NOT NULL) GROUP BY property_id`,
  ).bind(today, from, monthFrom).all();
  // Scans and their AI cost: today and 7 days per Italian day (usage_daily), the month from usage_monthly.
  const { results: sc } = await db.prepare(
    `SELECT property_id AS id,
       SUM(CASE WHEN day >= ?1 THEN scans ELSE 0 END) AS nd, SUM(scans) AS nw,
       SUM(CASE WHEN day >= ?1 THEN cost_micro ELSE 0 END) AS cd, SUM(cost_micro) AS cw
     FROM usage_daily WHERE day >= ?2 GROUP BY property_id`,
  ).bind(romeDate(today), romeDate(from)).all();
  const { results: sm } = await db.prepare('SELECT property_id AS id, scans, cost_micro FROM usage_monthly WHERE month = ?')
    .bind(new Date(now).toISOString().slice(0, 7)).all();
  const activity = {};
  const zero = () => ({ added: 0, sent: 0, scans: 0, costMicro: 0 });
  const slot = id => (activity[id] ||= { day: zero(), week: zero(), month: zero() });
  for (const a of act) {
    const s = slot(a.id);
    s.day.added = a.ad || 0; s.week.added = a.aw || 0; s.month.added = a.am || 0;
    s.day.sent = a.sd || 0; s.week.sent = a.sw || 0; s.month.sent = a.sm || 0;
  }
  for (const c of sc) {
    const s = slot(c.id);
    s.day.scans = c.nd || 0; s.week.scans = c.nw || 0;
    s.day.costMicro = c.cd || 0; s.week.costMicro = c.cw || 0;
  }
  for (const c of sm) { const s = slot(c.id); s.month.scans = c.scans || 0; s.month.costMicro = c.cost_micro || 0; }
  const activeToday = new Set(guests.filter(g => g.created_at >= today || (g.sent_at || 0) >= today).map(g => g.property_id)).size;
  const support = await db.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE created_at >= ?').bind(today - DAY).first();
  const alerts = await db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE last_sent_at >= ?').bind(now - DAY).first();

  // What needs a look, most urgent first.
  const attention = [];
  const { results: plist } = await db.prepare(
    `SELECT p.id, p.name, p.billing_status AS status, p.trial_ends_at AS trialEndsAt, p.created_at AS createdAt, p.registration, p.registration_status AS rs,
       (SELECT COUNT(*) FROM guests g WHERE g.property_id = p.id AND g.status = 'sent') AS sent
     FROM properties p WHERE p.demo_until IS NULL`,
  ).all();
  for (const p of plist) {
    let rs = null; try { rs = p.rs ? JSON.parse(p.rs) : null; } catch { /* old value */ }
    if (rs && rs.ok === false && rs.login) attention.push({ level: 'danger', kind: 'login', propertyId: p.id, name: p.name, text: 'Přihlášení do Alloggiati nefunguje (heslo nebo klíč)' });
    if (['past_due', 'unpaid'].includes(p.status)) attention.push({ level: 'danger', kind: 'payment', propertyId: p.id, name: p.name, text: 'Neprošla platba' });
    if (p.status === 'trial' && p.trialEndsAt > now && p.trialEndsAt - now < 7 * DAY) attention.push({ level: 'warn', kind: 'trial', propertyId: p.id, name: p.name, text: 'Zkušební doba končí do 7 dní', at: p.trialEndsAt });
    if (!p.registration && now - p.createdAt > 2 * DAY && !p.sent) attention.push({ level: 'info', kind: 'setup', propertyId: p.id, name: p.name, text: 'Ještě nenastavil Alloggiati (registrace před víc než 2 dny)', at: p.createdAt });
  }
  // Ticked off for a while: hidden until then (back if the problem is still there).
  const { results: dis } = await db.prepare('SELECT key, until FROM admin_dismissed WHERE until > ?').bind(now).all();
  const hiddenUntil = Object.fromEntries(dis.map(d => [d.key, d.until]));
  for (const a of attention) a.key = `${a.kind}:${a.propertyId}`;
  const order = { danger: 0, warn: 1, info: 2 };
  attention.sort((a, b) => order[a.level] - order[b.level]);
  const dismissed = attention.filter(a => hiddenUntil[a.key]).map(a => ({ ...a, until: hiddenUntil[a.key] }));
  const shown = attention.filter(a => !hiddenUntil[a.key]);
  // Our own to-dos.
  const { results: todos } = await db.prepare(
    `SELECT t.id, t.text, t.level, t.property_id AS propertyId, p.name, t.created_by AS createdBy, t.created_at AS createdAt
     FROM admin_todos t LEFT JOIN properties p ON p.id = t.property_id WHERE t.done_at IS NULL ORDER BY t.created_at`,
  ).all();
  // The archive: to-dos done, automatic items ticked off (still hidden, or back already).
  const { results: doneTodos } = await db.prepare(
    `SELECT t.id, t.text, t.level, t.property_id AS propertyId, p.name, t.created_by AS createdBy, t.created_at AS createdAt,
       t.done_at AS doneAt, t.done_by AS doneBy
     FROM admin_todos t LEFT JOIN properties p ON p.id = t.property_id WHERE t.done_at IS NOT NULL ORDER BY t.done_at DESC LIMIT 300`,
  ).all();
  const { results: ticked } = await db.prepare(
    'SELECT key, until, by, dismissed_at AS dismissedAt, name, text, level FROM admin_dismissed ORDER BY dismissed_at DESC LIMIT 300',
  ).all();
  // The demo (src/demo.js): started, tried a scan or Send, went on to "Create your own account".
  const demoRow = (await db.prepare(
    `SELECT SUM(CASE WHEN day >= ?1 THEN started ELSE 0 END) AS ds, SUM(CASE WHEN day >= ?1 THEN tried ELSE 0 END) AS dt, SUM(CASE WHEN day >= ?1 THEN signups ELSE 0 END) AS du,
       SUM(CASE WHEN day >= ?2 THEN started ELSE 0 END) AS ws, SUM(CASE WHEN day >= ?2 THEN tried ELSE 0 END) AS wt, SUM(CASE WHEN day >= ?2 THEN signups ELSE 0 END) AS wu,
       SUM(CASE WHEN day >= ?3 THEN started ELSE 0 END) AS ms, SUM(CASE WHEN day >= ?3 THEN tried ELSE 0 END) AS mt, SUM(CASE WHEN day >= ?3 THEN signups ELSE 0 END) AS mu
     FROM demo_daily WHERE day >= ?4`,
  ).bind(romeDate(today), romeDate(from), romeDate(monthFrom), romeDate(Math.min(from, monthFrom))).first()) || {};
  const demo = {
    day: { started: demoRow.ds || 0, tried: demoRow.dt || 0, signups: demoRow.du || 0 },
    week: { started: demoRow.ws || 0, tried: demoRow.wt || 0, signups: demoRow.wu || 0 },
    month: { started: demoRow.ms || 0, tried: demoRow.mt || 0, signups: demoRow.mu || 0 },
  };
  const t = series[6], y = series[5];
  return {
    today: { added: t.added, sent: t.sent, signups: t.signups, active: activeToday },
    yesterday: { added: y.added, sent: y.sent, signups: y.signups },
    series, support: support.n, alerts: alerts.n, attention: shown, dismissed, todos, archive: { todos: doneTodos, dismissed: ticked }, activity, demo, monthFrom, prevMonthFrom, yearFrom,
  };
}

const monthOf = t => new Date(t).toISOString().slice(0, 7);
const monthStart = (t, back = 0) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1); };

export async function adminOverview(env, request) {
  const { role } = await adminUser(env, request);
  const db = env.DB;
  const now = Date.now();
  const thisMonth = monthStart(now), lastMonth = monthStart(now, 1);
  const { results: properties } = await db.prepare(
    `SELECT p.id, p.name, p.country, p.plan, p.billing_status AS status, p.trial_ends_at AS trialEndsAt, p.created_at AS createdAt,
       p.scan_limit AS scanLimit, p.price_tier AS priceTier, p.billing_parent AS billingParent, p.paused_at AS pausedAt,
       p.cancel_at AS cancelAt, p.current_period_end AS periodEnd, p.preview, p.registration,
       p.registration_credentials IS NOT NULL AS policeSet, p.stripe_subscription_id IS NOT NULL AS subscribed,
       (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.property_id = p.id AND m.role = 'owner' LIMIT 1) AS ownerEmail,
       (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.property_id = p.id AND m.role = 'owner' LIMIT 1) AS ownerName,
       (SELECT COUNT(*) FROM memberships m WHERE m.property_id = p.id) AS members,
       (SELECT scans FROM usage_monthly WHERE property_id = p.id AND month = ?) AS scans,
       (SELECT cost_micro FROM usage_monthly WHERE property_id = p.id AND month = ?) AS costMicro,
       (SELECT SUM(scans) FROM usage_monthly WHERE property_id = p.id) AS scansTotal,
       (SELECT COUNT(*) FROM guests g WHERE g.property_id = p.id AND g.sent_at >= ?) AS sentMonth,
       (SELECT COUNT(*) FROM guests g WHERE g.property_id = p.id AND g.sent_at >= ? AND g.sent_at < ?) AS sentLastMonth,
       (SELECT MAX(g.created_at) FROM guests g WHERE g.property_id = p.id) AS lastGuestAt
     FROM properties p WHERE p.demo_until IS NULL ORDER BY p.created_at DESC`,
  ).bind(monthOf(now), monthOf(now), thisMonth, lastMonth, thisMonth).all();
  for (const p of properties) {
    p.policeSet = !!p.policeSet; p.subscribed = !!p.subscribed; p.preview = !!p.preview;
    // This month's scan allowance, as the app counts it (null = no limit).
    p.scanCap = scanLimit(env, { billing_status: p.status, scan_limit: p.scanLimit, created_at: p.createdAt });
    // In the free trial the allowance is for the whole trial (src/guests.js trialWide).
    p.capWhole = trialWide({ billing_status: p.status, scan_limit: p.scanLimit });
    p.capUsed = p.capWhole ? p.scansTotal || 0 : p.scans || 0;
  }
  // What a subscription by guests comes to, in euros, at last month's guests
  // (with the properties it pays for) — the money card's estimate.
  for (const p of properties) {
    const guests = properties.filter(o => o.id === p.id || o.billingParent === p.id).reduce((n, o) => n + o.sentLastMonth, 0);
    p.estimate = p.plan === 'one' ? 59 : priceForGuests(guests) / 100 + (p.plan === 'flow' ? TEAM_PRICE : 0);
  }

  const { results: scanCosts } = await db.prepare(
    'SELECT month, SUM(scans) AS scans, SUM(cost_micro) AS costMicro FROM usage_monthly GROUP BY month ORDER BY month DESC LIMIT 6',
  ).all();
  const { results: flowy } = await db.prepare(
    `SELECT substr(day, 1, 7) AS month, SUM(messages) AS messages, SUM(input_tokens) AS input, SUM(output_tokens) AS output
     FROM assistant_usage GROUP BY month ORDER BY month DESC LIMIT 6`,
  ).all();
  const costs = scanCosts.map(c => {
    const f = flowy.find(x => x.month === c.month);
    return { month: c.month, scans: c.scans, scanCostMicro: c.costMicro,
      flowyMessages: f ? f.messages : 0,
      flowyCostMicro: f ? Math.round(f.input * ASSISTANT_PRICE.input + f.output * ASSISTANT_PRICE.output) : 0 };
  });
  const { results: ocr } = await db.prepare(
    `SELECT COALESCE(pair, model) AS pair, COUNT(*) AS n,
       SUM(CASE WHEN differs IS NOT NULL AND differs NOT IN ('', '[]') THEN 1 ELSE 0 END) AS differs,
       SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors
     FROM ocr_shadow WHERE created_at > ? GROUP BY COALESCE(pair, model)`,
  ).bind(now - 30 * DAY).all();
  const { results: vouchers } = await db.prepare(
    'SELECT code, free_until AS freeUntil, redeem_by AS redeemBy, max_uses AS maxUses, uses, note, created_at AS createdAt FROM vouchers ORDER BY created_at DESC',
  ).all();
  const { results: support } = await db.prepare(
    `SELECT s.id, s.message, s.created_at AS createdAt, u.email, p.name AS property
     FROM support_messages s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN properties p ON p.id = s.property_id
     ORDER BY s.created_at DESC LIMIT 30`,
  ).all();
  // Error details can carry stack traces and addresses: the admins only.
  const { results: alerts } = await db.prepare(
    `SELECT kind, last_sent_at AS lastSentAt, missed${role === 'admin' ? ', last_detail AS detail' : ''} FROM alerts ORDER BY last_sent_at DESC LIMIT 20`,
  ).all();
  const { results: audit } = await db.prepare(
    'SELECT at, actor, action, property_id AS propertyId, detail FROM admin_audit ORDER BY at DESC LIMIT 50',
  ).all();
  const daily = await dailyOverview(env, now);
  // What came in through Stripe (admins only; the page still loads if Stripe doesn't answer).
  let earnings = null;
  if (role === 'admin') { try { earnings = await stripeEarnings(env, daily); } catch (err) { console.error('earnings', err); earnings = { error: true }; } }
  // The Claude credit, estimated (top-ups noted by hand, see claudecredit.js).
  const credit = await creditOverview(env, now);
  return json({ role, now, daily, earnings, properties, costs, credit, ocr, vouchers, support, alerts, audit });
}

// "Vyžaduje pozornost": own to-dos, and ticking automatic items off for a while.
const TODO_ACTIONS = ['addTodo', 'editTodo', 'doneTodo', 'undoTodo', 'deleteTodo', 'dismissAttention', 'restoreAttention'];
const LEVELS = ['danger', 'warn', 'info'];
async function todoAction(env, user, action, body, now) {
  const db = env.DB;
  const text = () => {
    const t = String(body.text || '').trim();
    if (!t || t.length > 300) throw new HttpError(400, 'write the to-do (at most 300 characters)');
    return t;
  };
  const level = () => (LEVELS.includes(body.level) ? body.level : 'info');
  const todo = async () => {
    const t = await db.prepare('SELECT id, property_id FROM admin_todos WHERE id = ? AND done_at IS NULL').bind(String(body.id || '')).first();
    if (!t) throw new HttpError(404, 'no such to-do');
    return t;
  };
  if (action === 'addTodo') {
    const propertyId = body.propertyId ? (await propertyOr404(env, body.propertyId)).id : null;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO admin_todos (id, text, level, property_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, text(), level(), propertyId, user.email, now).run();
    return json({ ok: true, id }, 201);
  }
  if (action === 'editTodo') {
    const t = await todo();
    await db.prepare('UPDATE admin_todos SET text = ?, level = ? WHERE id = ?').bind(text(), level(), t.id).run();
    return json({ ok: true });
  }
  if (action === 'doneTodo') {
    const t = await todo();
    await db.prepare('UPDATE admin_todos SET done_at = ?, done_by = ? WHERE id = ?').bind(now, user.email, t.id).run();
    return json({ ok: true });
  }
  // Back from the archive onto the list.
  if (action === 'undoTodo') {
    const r = await db.prepare('UPDATE admin_todos SET done_at = NULL, done_by = NULL WHERE id = ? AND done_at IS NOT NULL').bind(String(body.id || '')).run();
    if (!r.meta.changes) throw new HttpError(404, 'no such to-do in the archive');
    return json({ ok: true });
  }
  if (action === 'deleteTodo') { // open or archived
    const r = await db.prepare('DELETE FROM admin_todos WHERE id = ?').bind(String(body.id || '')).run();
    if (!r.meta.changes) throw new HttpError(404, 'no such to-do');
    return json({ ok: true });
  }
  const key = String(body.key || '');
  if (!/^(login|payment|trial|setup):[\w-]{1,64}$/.test(key)) throw new HttpError(400, 'unknown item');
  if (action === 'dismissAttention') {
    const days = Number(body.days || 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpError(400, 'days must be 1–90');
    // What it said, for the archive.
    const snap = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    await db.prepare(
      `INSERT INTO admin_dismissed (key, until, by, dismissed_at, name, text, level) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET until = excluded.until, by = excluded.by, dismissed_at = excluded.dismissed_at,
         name = excluded.name, text = excluded.text, level = excluded.level`,
    ).bind(key, now + days * DAY, user.email, now, snap(body.name, 100), snap(body.text, 300), LEVELS.includes(body.level) ? body.level : null).run();
    return json({ ok: true });
  }
  await db.prepare('DELETE FROM admin_dismissed WHERE key = ?').bind(key).run(); // restoreAttention: back on the list, out of the archive
  return json({ ok: true });
}

async function record(env, actor, action, propertyId, detail) {
  await env.DB.prepare('INSERT INTO admin_audit (at, actor, action, property_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), actor, action, propertyId || null, detail ? JSON.stringify(detail) : null).run();
}

async function propertyOr404(env, id) {
  const p = await env.DB.prepare('SELECT id, name, billing_status, trial_ends_at, stripe_subscription_id FROM properties WHERE id = ?').bind(String(id || '')).first();
  if (!p) throw new HttpError(404, 'no such property');
  return p;
}

// Body: { action, propertyId?, ... } — see the cases below.
export async function adminAction(env, request) {
  const body = await readJson(request);
  const action = String(body.action || '');
  // Support may only extend trials; everything else is for the admins.
  // Support may extend trials and work the to-do list; everything else is for the admins.
  const { user } = await adminUser(env, request, ['extendTrial', ...TODO_ACTIONS].includes(action) ? 'support' : 'admin');
  const db = env.DB;
  const now = Date.now();

  if (action === 'extendTrial') {
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpError(400, 'days must be 1–90');
    const max = Math.max(now, EARLY_ACCESS_ENDS) + 180 * DAY; // no endless trials
    const p = await propertyOr404(env, body.propertyId);
    // In its trial, or cancelled (no subscription running): more free days.
    if (!['trial', 'canceled'].includes(p.billing_status)) throw new HttpError(409, 'only a property in its free trial (or with a cancelled subscription) can get more days');
    const until = Math.max(p.trial_ends_at || 0, now) + days * DAY;
    if (until > max) throw new HttpError(400, 'that is too far ahead — make it free (comp) instead');
    await db.prepare('UPDATE properties SET trial_ends_at = ? WHERE id = ?').bind(until, p.id).run();
    await record(env, user.email, action, p.id, { days, until });
    return json({ ok: true, trialEndsAt: until });
  }

  if (action === 'setComp') {
    const p = await propertyOr404(env, body.propertyId);
    if (body.on) {
      if (p.billing_status === 'comp') return json({ ok: true });
      // Not while a Stripe subscription is set up (also one still in its free days).
      if (!['trial', 'canceled'].includes(p.billing_status) || (p.billing_status === 'trial' && p.stripe_subscription_id)) {
        throw new HttpError(409, 'this property has a subscription — cancel it in Stripe first, then make it free');
      }
      await db.prepare("UPDATE properties SET billing_status = 'comp' WHERE id = ?").bind(p.id).run();
    } else {
      if (p.billing_status !== 'comp') throw new HttpError(409, 'this property is not free (comp)');
      // Back to a trial, so they have time to subscribe.
      const until = Math.max(now + 14 * DAY, EARLY_ACCESS_ENDS);
      await db.prepare("UPDATE properties SET billing_status = 'trial', trial_ends_at = ? WHERE id = ?").bind(until, p.id).run();
    }
    await record(env, user.email, action, p.id, { on: !!body.on });
    return json({ ok: true });
  }

  if (action === 'setScanLimit') {
    const limit = body.limit === null || body.limit === '' ? null : Number(body.limit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 100000)) throw new HttpError(400, 'the limit must be 0–100000, or empty for the default');
    const p = await propertyOr404(env, body.propertyId);
    await db.prepare('UPDATE properties SET scan_limit = ? WHERE id = ?').bind(limit, p.id).run();
    await record(env, user.email, action, p.id, { limit });
    return json({ ok: true });
  }

  // Removes a property and everything in it (guests, team, rooms, … — the
  // tables cascade). The owner's account stays. Not while money runs through it.
  if (action === 'deleteProperty') {
    const p = await propertyOr404(env, body.propertyId);
    if (String(body.confirmName || '') !== p.name) throw new HttpError(400, 'type the exact name of the property to confirm');
    const row = await db.prepare(
      'SELECT billing_parent, (SELECT COUNT(*) FROM properties c WHERE c.billing_parent = p.id) AS kids FROM properties p WHERE id = ?',
    ).bind(p.id).first();
    if (p.stripe_subscription_id && !['trial', 'comp', 'canceled'].includes(p.billing_status)) {
      throw new HttpError(409, 'this property has a subscription — cancel it in Stripe first');
    }
    if (row.kids) throw new HttpError(409, 'this property pays for other properties — move them off its subscription first');
    if (row.billing_parent) throw new HttpError(409, 'another property pays for this one — take it off that subscription in the app first');
    const counts = await db.prepare(
      'SELECT (SELECT COUNT(*) FROM guests WHERE property_id = ?1) AS guests, (SELECT COUNT(*) FROM memberships WHERE property_id = ?1) AS members',
    ).bind(p.id).first();
    // The Vault's files are in R2, not in the database: they go first.
    const vaultFiles = await deleteVaultOf(env, p.id);
    await db.prepare('DELETE FROM properties WHERE id = ?').bind(p.id).run();
    await record(env, user.email, action, p.id, { name: p.name, status: p.billing_status, ...counts, vaultFiles });
    return json({ ok: true });
  }

  if (TODO_ACTIONS.includes(action)) return todoAction(env, user, action, body, now);

  if (action === 'addTopup' || action === 'deleteTopup') {
    const { response, detail } = await topupAction(env, user, action, body, now);
    await record(env, user.email, action, null, detail);
    return response;
  }

  if (action === 'createVoucher') {
    const code = String(body.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) throw new HttpError(400, 'the code: 4–32 letters, digits or -');
    const freeUntil = Number(body.freeUntil), redeemBy = Number(body.redeemBy), maxUses = Number(body.maxUses);
    if (!(freeUntil > now) || !(redeemBy > now)) throw new HttpError(400, 'both dates must be in the future');
    if (freeUntil > now + 729 * DAY || redeemBy > now + 729 * DAY) throw new HttpError(400, 'at most two years ahead'); // Stripe: a trial at most 730 days
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) throw new HttpError(400, 'uses must be 1–10000');
    const note = String(body.note || '').slice(0, 200) || null;
    const exists = await db.prepare('SELECT code FROM vouchers WHERE code = ?').bind(code).first();
    if (exists) throw new HttpError(409, 'this code already exists');
    await db.prepare('INSERT INTO vouchers (code, free_until, redeem_by, max_uses, uses, note, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .bind(code, freeUntil, redeemBy, maxUses, note, now).run();
    await record(env, user.email, action, null, { code, freeUntil, redeemBy, maxUses });
    return json({ ok: true, code }, 201);
  }

  throw new HttpError(400, 'unknown action');
}
