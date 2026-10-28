// The admin centre (admin.hostelflow.it): own accounts (scripts/admin-user.mjs),
// reads GET /api/admin, changes through POST /api/admin (src/admin.js).
// Czech, for us — not translated.
const $ = id => document.getElementById(id);

// One set of line icons for the whole page (shapes after Lucide, ISC licence).
const ICONS = {
  today: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  flask: '<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12a2 2 0 0 1-.21-.9V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 11 5 12 8c1-3 2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  key: '<path d="M2.59 17.41A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  hourglass: '<path d="M5 22h14M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  task: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
};
const svg = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
// An icon element; with a label, an icon followed by text.
function ico(name, cls = '') { const s = document.createElement('span'); s.className = `ic-wrap ${cls}`.trim(); s.innerHTML = svg(name); return s; }
function withIcon(node, name, label) { node.replaceChildren(ico(name)); if (label) node.append(label); return node; }
for (const e of document.querySelectorAll('[data-i]')) e.innerHTML = svg(e.dataset.i);
const DAY = 86400000;
let data = null, filter = 'all', me = null, period = 'week', showAllActivity = false, suPeriod = 'week', demoPeriod = 'week', moneyPeriod = 'month', earnPeriod = 'month';
try { moneyPeriod = sessionStorage.getItem('hf-admin-money') === 'year' ? 'year' : 'month'; earnPeriod = sessionStorage.getItem('hf-admin-earn') || 'month'; } catch { /* private window */ }
try { suPeriod = sessionStorage.getItem('hf-admin-su') || 'week'; } catch { /* private window */ }
try { period = sessionStorage.getItem('hf-admin-period') || 'week'; } catch { /* private window */ }

async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `HTTP ${res.status}`), { status: res.status });
  return out;
}
const call = (method, body) => api('/api/admin', method, body);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
const day = t => t ? new Date(t).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—';
const when = t => t ? new Date(t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const usd = micro => `$${((micro || 0) / 1e6).toFixed(micro >= 1e6 ? 2 : 3)}`;
const ago = t => { if (!t) return '—'; const d = Math.floor((Date.now() - t) / DAY); return d <= 0 ? 'dnes' : d === 1 ? 'včera' : `před ${d} dny`; };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200); }

// ---- Sign in / out ----
function showLogin() { $('app').hidden = true; $('login').hidden = false; $('li-email').focus(); }
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('li-err').textContent = '';
  const b = e.submitter || $('login-form').querySelector('button');
  b.disabled = true;
  try {
    me = await api('/api/admin/login', 'POST', { email: $('li-email').value, password: $('li-pass').value });
    $('li-pass').value = '';
    $('login').hidden = true;
    await start();
  } catch (err) {
    $('li-err').textContent = err.status === 429 ? 'Moc pokusů, zkus to za chvíli.' : err.status === 401 ? 'Špatný e-mail nebo heslo.' : `Chyba: ${err.message}`;
  } finally { b.disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', 'POST'); } catch { /* signed out anyway */ }
  me = null; data = null; showLogin();
});

// ---- Views ----
function show(view) {
  for (const b of $('nav').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.view === view);
    if (b.dataset.view === view && $('nav').scrollWidth > $('nav').clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `v-${view}`;
  try { sessionStorage.setItem('hf-admin-view', view); } catch { /* private window */ }
  window.scrollTo(0, 0);
}
$('nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });
$('refresh').addEventListener('click', () => load().then(() => toast('Obnoveno ✓')));

const PLAN = { checkin: 'Check-in', flow: 'Flow', apartments: 'Apartmány', one: 'One', full: 'Hostel', calendar: 'Kalendář' };
// One word for where the property stands with us.
function standing(p) {
  const now = data.now;
  if (p.status === 'comp') return ['comp', 'Zdarma (comp)'];
  if (p.billing_parent || p.billingParent) return ['paying', 'Pod jinou'];
  if (p.status === 'trial') return (p.trialEndsAt || 0) > now ? ['trial', `Trial do ${day(p.trialEndsAt)}`] : ['ended', 'Trial skončil'];
  if (p.pausedAt) return ['paused', 'Pauza'];
  if (p.cancelAt) return ['cancel', `Zrušeno, do ${day(p.cancelAt)}`];
  if (['active', 'trialing'].includes(p.status)) return ['paying', 'Platí'];
  if (['past_due', 'unpaid'].includes(p.status)) return ['problem', 'Neplatí'];
  return ['ended', p.status];
}

// ---- Denní přehled ----
function kpi(color, icon, n, label, cmp) {
  const k = el('div', `kpi k-${color}`);
  const i = el('div', 'ico'); i.innerHTML = svg(icon);
  k.append(i, el('b', '', String(n)), el('div', 'lbl', label));
  if (cmp) k.append(el('div', 'cmp', cmp));
  return k;
}

function renderToday() {
  const d = data.daily;
  const h = new Date().getHours();
  const name = (me && me.name) ? `, ${me.name.split(' ')[0]}` : '';
  $('hello').textContent = `${h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý den' : 'Dobrý večer'}${name}`;
  $('today-date').textContent = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  renderSignups();

  renderMoney();

  // Free trials (nothing is charged there), with the new properties.
  const trials = data.properties.filter(p => standing(p)[0] === 'trial');
  const soon = trials.filter(p => p.trialEndsAt - data.now < 7 * DAY).length;
  const over = data.properties.filter(p => p.status === 'trial' && standing(p)[0] === 'ended').length;
  $('trials').replaceChildren(ico('flask'), el('b', '', String(trials.length)), ` ve zkušební době · ${[soon ? `${soon} končí do 7 dní` : 'žádná nekončí do 7 dní', over ? `${over} skončilo bez předplatného` : ''].filter(Boolean).join(' · ')}`);

  renderAttention();

  const ps = data.properties;
  const by = k => ps.filter(p => standing(p)[0] === k).length;
  const month = data.costs[0] || {};
  $('month').replaceChildren(
    kpi('green', 'card', by('paying'), 'platí'),
    kpi('blue', 'flask', by('trial'), 've zkušební době'),
    kpi('violet', 'gift', by('comp'), 'zdarma (comp)'),
    kpi('teal', 'send', ps.reduce((n, p) => n + (p.sentMonth || 0), 0), 'hostů odesláno tento měsíc'),
    kpi('orange', 'scan', month.scans || 0, `skenů · ${usd((month.scanCostMicro || 0) + (month.flowyCostMicro || 0))} AI`),
  );

  renderDemo();

  const n = d.support + d.alerts;
  $('inbox-count').hidden = !n;
  $('inbox-count').textContent = String(n);
}

// Subscriptions by type, what they bring a month, and what really came in through Stripe.
const MONEY_PERIODS = [['month', 'Měsíc'], ['year', 'Rok']];
const EARN_PERIODS = [['month', 'Měsíc'], ['year', 'Rok'], ['all', 'Celkem']];
const eur = (c, cents = true) => `${(c / 100).toLocaleString('cs-CZ', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })} €`;
function renderMoney() {
  $('money-period').replaceChildren(...MONEY_PERIODS.map(([k, label]) => {
    const b = el('button', 'chip' + (moneyPeriod === k ? ' on' : ''), label);
    b.type = 'button';
    b.onclick = () => { moneyPeriod = k; try { sessionStorage.setItem('hf-admin-money', k); } catch { /* private window */ } renderMoney(); };
    return b;
  }));
  renderEarnings();

  // Running subscriptions (paying, or before their first payment), by type, at last month's guests.
  const subs = data.properties.filter(p => p.subscribed && ['active', 'trialing', 'past_due'].includes(p.status));
  const types = {};
  for (const p of subs) {
    // By last month's guests (the server works out the price).
    const [key, label] = p.plan === 'one' ? ['one', 'HostelOne'] : p.plan === 'flow' ? ['flow', 'Flow'] : ['checkin', 'Check-in'];
    const euros = p.estimate || 0;
    const t = (types[key] ||= { label, n: 0, euros: 0 });
    t.n++; t.euros += euros;
  }
  const mult = moneyPeriod === 'month' ? 1 : 12;
  const per = moneyPeriod === 'month' ? '/měs.' : '/rok';
  const rows = Object.values(types).sort((a, b) => b.euros - a.euros).map(t => {
    const r = el('div', 'plan-row');
    r.append(el('span', '', t.label), el('span', 'n', `${t.n}×`), el('b', '', `${eur(t.euros * mult * 100, false)}${per}`));
    return r;
  });
  if (rows.length) {
    const total = Object.values(types).reduce((n, t) => n + t.euros, 0);
    const r = el('div', 'plan-row total');
    r.append(el('span', '', 'Z předplatných celkem'), el('span', 'n', `${subs.length}×`), el('b', '', `${eur(total * mult * 100, false)}${per}`));
    rows.push(r);
  } else rows.push(el('div', 'plan-row', 'Zatím žádné předplatné'));
  const total = Object.values(types).reduce((n, t) => n + t.euros, 0);
  $('subs-n').textContent = String(subs.length);
  $('subs-total').textContent = `aktivních · odhad ${eur(total * mult * 100, false)}${per}`;
  $('plans').replaceChildren(...rows);
  const paying = subs.filter(p => p.status !== 'trialing').length;
  const ending = subs.filter(p => p.cancelAt).length;
  $('subs-sub').textContent = `${paying} platí · ${subs.length - paying} před 1. platbou${ending ? ` · ${ending} zrušeno ke konci období` : ''} · částky podle hostů minulý měsíc`;
}

// What really came in through Stripe: this month, this year, ever.
function renderEarnings() {
  $('earn-period').replaceChildren(...EARN_PERIODS.map(([k, label]) => {
    const b = el('button', 'chip' + (earnPeriod === k ? ' on' : ''), label);
    b.type = 'button';
    b.onclick = () => { earnPeriod = k; try { sessionStorage.setItem('hf-admin-earn', k); } catch { /* private window */ } renderEarnings(); };
    return b;
  }));
  const e = data.earnings;
  const sum = e && !e.error ? e[earnPeriod] : null;
  $('earn-n').textContent = sum ? eur(sum.gross) : '—';
  $('earn-sub').textContent = !e ? 'Stripe není nastavený' : e.error ? 'Stripe teď neodpovídá'
    : `přišlo ${{ month: 'tento měsíc', year: 'letos', all: 'celkem' }[earnPeriod]} · po poplatcích Stripe ${eur(sum.net)}`;
}

// ---- Vyžaduje pozornost: automatic items + our own to-dos ----
const ICON = { login: 'key', payment: 'card', trial: 'hourglass', setup: 'wrench' };
const LEVEL_ICON = { danger: 'alert', warn: 'warn', info: 'info' };
const ORDER = { danger: 0, warn: 1, info: 2 };
let showDismissed = false;

async function todoCall(body, done) {
  try { await call('POST', body); if (done) toast(done); await load(); }
  catch (err) { toast(`Chyba: ${err.message}`); }
}
// Folds the item away, then does the call (like ticking off in the app).
function foldThen(item, fn) { item.classList.add('fold'); setTimeout(fn, 230); }
function roundBtn(cls, icon, title, onclick) {
  const b = el('button', cls);
  b.innerHTML = svg(icon);
  b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
  b.onclick = e => { e.stopPropagation(); onclick(); };
  return b;
}

function renderAttention() {
  const d = data.daily;
  const items = [
    ...d.attention.map(a => ({ ...a, auto: true })),
    ...d.todos.map(t => ({ ...t, todo: true })),
  ].sort((a, b) => ORDER[a.level] - ORDER[b.level] || (a.todo ? 1 : 0) - (b.todo ? 1 : 0));
  const box = $('attention');
  if (!items.length) { box.replaceChildren(withIcon(el('div', 'allgood'), 'sparkles', 'Všechno v pořádku')); }
  else box.replaceChildren(...items.map(a => (a.todo ? todoItem(a) : autoItem(a))));

  // Ticked off for a while: shown on request, with a way back.
  const dis = $('dismissed');
  dis.replaceChildren();
  if (d.dismissed.length) {
    const t = el('button', 'link dismissed', showDismissed ? 'Skrýt odkliknuté' : `Odkliknuté na čas: ${d.dismissed.length} · zobrazit`);
    t.type = 'button';
    t.onclick = () => { showDismissed = !showDismissed; renderAttention(); };
    dis.append(t);
    if (showDismissed) dis.append(...d.dismissed.map(a => {
      const c = el('div', `att ${a.level}`);
      const bd = el('div', 'bd');
      bd.append(el('div', 't', a.name), el('div', 's', a.text), el('div', 'by', `skryto do ${day(a.until)}`));
      const tools = el('div', 'tools');
      tools.append(roundBtn('', 'undo', 'Vrátit zpátky', () => todoCall({ action: 'restoreAttention', key: a.key })));
      c.append(ico(ICON[a.kind] || 'info', 'ic'), bd, tools);
      return c;
    }));
  }
}

function autoItem(a) {
  const c = el('div', `att ${a.level}`);
  c.title = 'Otevřít v Provozovnách';
  const bd = el('div', 'bd');
  bd.append(el('div', 't', a.name), el('div', 's', a.text + (a.kind === 'trial' && a.at ? ` (${day(a.at)})` : '')));
  const tools = el('div', 'tools');
  tools.append(roundBtn('tick', 'check', 'Vyřízeno — skrýt na 7 dní (když problém trvá, vrátí se)', () =>
    foldThen(c, () => todoCall({ action: 'dismissAttention', key: a.key, days: 7, name: a.name, text: a.text, level: a.level }, 'Odkliknuto — najdeš to v Archivu'))));
  c.append(ico(ICON[a.kind] || 'info', 'ic'), bd, tools);
  c.onclick = () => openProperty(a.propertyId);
  return c;
}

function todoItem(t) {
  const c = el('div', `att ${t.level} todo`);
  const bd = el('div', 'bd');
  bd.append(el('div', 't', t.name || 'Úkol'), el('div', 's', t.text),
    el('div', 'by', `${t.createdBy.split('@')[0]} · ${day(t.createdAt)}`));
  const tools = el('div', 'tools');
  tools.append(
    roundBtn('', 'pencil', 'Upravit', () => editTodo(c, t)),
    roundBtn('tick', 'check', 'Hotovo', () => foldThen(c, () => todoCall({ action: 'doneTodo', id: t.id }, 'Hotovo ✓ — najdeš to v Archivu'))),
  );
  c.append(ico('task', 'ic'), bd, tools);
  if (t.propertyId) { c.title = 'Otevřít v Provozovnách'; c.onclick = () => openProperty(t.propertyId); }
  else c.style.cursor = 'default';
  return c;
}

function levelSelect(value) {
  const s = el('select');
  s.setAttribute('aria-label', 'Důležitost');
  for (const [v, label] of [['danger', 'Důležité'], ['warn', 'Pozor'], ['info', 'Info']]) {
    const o = el('option', '', label); o.value = v; o.selected = v === value; s.append(o);
  }
  return s;
}

// In place: the text and how important, save / delete / cancel.
function editTodo(item, t) {
  item.onclick = null;
  item.style.cursor = 'default';
  const f = el('form');
  const input = el('input'); input.value = t.text; input.maxLength = 300; input.required = true;
  const lvl = levelSelect(t.level);
  const save = el('button', 'primary', 'Uložit'); save.type = 'submit';
  const del = el('button', 'danger', 'Smazat'); del.type = 'button';
  del.onclick = () => { if (confirm('Smazat tenhle úkol?')) todoCall({ action: 'deleteTodo', id: t.id }, 'Smazáno'); };
  const cancel = el('button', 'ghost', 'Zrušit'); cancel.type = 'button'; cancel.onclick = () => renderAttention();
  f.append(input, lvl, save, del, cancel);
  f.onsubmit = e => { e.preventDefault(); todoCall({ action: 'editTodo', id: t.id, text: input.value, level: lvl.value }, 'Uloženo ✓'); };
  item.replaceChildren(ico('pencil', 'ic'), f);
  input.focus();
}

// New to-do.
$('todo-add').onclick = () => {
  const sel = $('todo-prop');
  sel.replaceChildren(sel.options[0]);
  for (const p of [...data.properties].sort((a, b) => a.name.localeCompare(b.name, 'cs'))) {
    const o = el('option', '', p.name); o.value = p.id; sel.append(o);
  }
  $('todo-form').hidden = false;
  $('todo-text').focus();
};
$('todo-cancel').onclick = () => { $('todo-form').hidden = true; };
$('todo-form').addEventListener('submit', async e => {
  e.preventDefault();
  await todoCall({ action: 'addTodo', text: $('todo-text').value, level: $('todo-level').value, propertyId: $('todo-prop').value || null }, 'Úkol přidán ✓');
  $('todo-text').value = ''; $('todo-form').hidden = true;
});

// ---- Archiv: what was ticked off, with dates and a way back ----
const KIND_TEXT = { login: 'Přihlášení do Alloggiati nefunguje (heslo nebo klíč)', payment: 'Neprošla platba', trial: 'Zkušební doba končí do 7 dní', setup: 'Ještě nenastavil Alloggiati (registrace před víc než 2 dny)' };
function renderArchive() {
  const a = data.daily.archive;
  const names = Object.fromEntries(data.properties.map(p => [p.id, p.name]));
  const pill = (txt, on) => el('span', `state${on ? ' on' : ''}`, txt);
  const btn = (label, fn, cls = '', icon = '') => { const b = el('button', cls); withIcon(b, icon, label); if (!icon) b.textContent = label; b.type = 'button'; b.onclick = fn; return b; };

  $('arch-todos').replaceChildren(...(a.todos.length ? a.todos.map(t => {
    const c = el('div', `att ${t.level} todo`);
    const bd = el('div', 'bd');
    bd.append(el('div', 't', t.name || 'Úkol'), el('div', 's', t.text),
      el('div', 'dates', `přidal ${t.createdBy.split('@')[0]} ${when(t.createdAt)} · hotovo ${when(t.doneAt)}${t.doneBy ? ` (${t.doneBy.split('@')[0]})` : ''}`));
    const tools = el('div', 'tools');
    tools.append(
      btn('Obnovit', () => todoCall({ action: 'undoTodo', id: t.id }, 'Obnoveno — je zpátky ve Vyžaduje pozornost'), '', 'undo'),
      btn('Smazat', () => { if (confirm('Smazat tenhle úkol natrvalo?')) todoCall({ action: 'deleteTodo', id: t.id }, 'Smazáno'); }, 'danger', 'trash'),
    );
    c.append(ico('task', 'ic'), bd, tools);
    return c;
  }) : [el('p', 'empty', 'Zatím nic hotového.')]));

  $('arch-dismissed').replaceChildren(...(a.dismissed.length ? a.dismissed.map(d => {
    const [kind, pid] = d.key.split(':');
    const hidden = d.until > data.now;
    const c = el('div', `att ${d.level || 'info'}`);
    const bd = el('div', 'bd');
    bd.append(el('div', 't', d.name || names[pid] || 'Smazaná provozovna'), el('div', 's', d.text || KIND_TEXT[kind] || kind),
      el('div', 'dates', `odkliknuto ${d.dismissedAt ? when(d.dismissedAt) : '—'}${d.by ? ` (${d.by.split('@')[0]})` : ''} · ${hidden ? `skryto do ${day(d.until)}` : `skrytí skončilo ${day(d.until)}`}`));
    const tools = el('div', 'tools');
    tools.append(pill(hidden ? 'skryto' : 'vypršelo', hidden),
      btn(hidden ? 'Obnovit' : 'Odebrat z archivu', () => todoCall({ action: 'restoreAttention', key: d.key }, hidden ? 'Obnoveno — je zpátky ve Vyžaduje pozornost' : 'Odebráno'), '', hidden ? 'undo' : 'trash'));
    c.append(ico(ICON[kind] || 'info', 'ic'), bd, tools);
    if (pid && names[pid]) { c.style.cursor = 'pointer'; c.title = 'Otevřít v Provozovnách'; c.onclick = e => { if (!e.target.closest('button')) openProperty(pid); }; }
    return c;
  }) : [el('p', 'empty', 'Zatím nic odkliknutého.')]));
}

// Top of the page: how many properties joined — today, in 7 / 30 days, or ever.
const SU_PERIODS = [['day', 'Dnes'], ['week', '7 dní'], ['month', 'Měsíc'], ['all', 'Celkem']];
function renderSignups() {
  $('su-period').replaceChildren(...SU_PERIODS.map(([k, label]) => {
    const b = el('button', 'chip' + (suPeriod === k ? ' on' : ''), label);
    b.type = 'button';
    b.onclick = () => { suPeriod = k; try { sessionStorage.setItem('hf-admin-su', k); } catch { /* private window */ } renderSignups(); };
    return b;
  }));
  const ps = data.properties;
  const today = data.daily.series[data.daily.series.length - 1].day; // midnight in Italy
  const span = { day: DAY, week: 7 * DAY }[suPeriod];
  const from = suPeriod === 'day' ? today : suPeriod === 'week' ? today + DAY - span : suPeriod === 'month' ? data.daily.monthFrom : 0;
  const n = ps.filter(p => p.createdAt >= from).length;
  $('su-n').textContent = String(n);
  $('su-label').textContent = { day: 'dnes', week: 'za 7 dní', month: 'tento měsíc', all: 'celkem' }[suPeriod];
  if (suPeriod === 'all') {
    const first = ps.reduce((t, p) => Math.min(t, p.createdAt || Infinity), Infinity);
    $('su-cmp').textContent = first < Infinity ? `od ${day(first)}` : '';
  } else {
    const prevFrom = suPeriod === 'month' ? data.daily.prevMonthFrom : from - span;
    const before = ps.filter(p => p.createdAt >= prevFrom && p.createdAt < from).length;
    $('su-cmp').textContent = `${{ day: 'včera', week: 'předchozích 7 dní', month: 'minulý měsíc' }[suPeriod]} ${before}${n > before ? ' · ▲' : n < before ? ' · ▼' : ''}`;
  }
}

// The demo on the sign-in page: started, tried something, went on to their own account.
function renderDemo() {
  $('demo-period').replaceChildren(...PERIODS.map(([k, label]) => {
    const b = el('button', 'chip' + (demoPeriod === k ? ' on' : ''), label);
    b.type = 'button';
    b.onclick = () => { demoPeriod = k; renderDemo(); };
    return b;
  }));
  const x = (data.daily.demo || {})[demoPeriod] || { started: 0, tried: 0, signups: 0 };
  const share = n => (x.started ? ` (${Math.round(n / x.started * 100)} %)` : '');
  $('demo').replaceChildren(
    kpi('blue', 'flask', x.started, 'spuštěno'),
    kpi('orange', 'scan', x.tried, `něco zkusili${share(x.tried)}`),
    kpi('green', 'building', x.signups, `klikli na vlastní účet${share(x.signups)}`),
  );
}

// This month's scans against the allowance, e.g. 50/200 (the limit resets on the 1st).
// In the free trial: all its scans against the trial's allowance (not per month).
function capPill(p) {
  const used = p.capUsed !== undefined ? p.capUsed : p.scans || 0;
  if (p.scanCap === null || p.scanCap === undefined) { const s = el('span', 'cap', `${used}/∞`); s.title = 'Skeny tento měsíc — bez limitu'; return s; }
  const share = used / Math.max(1, p.scanCap);
  const s = el('span', `cap${share >= 1 ? ' full' : share >= 0.8 ? ' near' : ''}`, `${used}/${p.scanCap}`);
  s.title = `${p.capWhole ? 'Skeny za celou zkušební dobu' : 'Skeny tento měsíc'}: použito ${used} z ${p.scanCap}, zbývá ${Math.max(0, p.scanCap - used)}`;
  return s;
}

// Properties ranked by what they did (guests added + sent) in the chosen period.
const PERIODS = [['day', 'Dnes'], ['week', '7 dní'], ['month', 'Měsíc']];
function renderActivity() {
  $('act-period').replaceChildren(...PERIODS.map(([k, label]) => {
    const b = el('button', 'chip' + (period === k ? ' on' : ''), label);
    b.type = 'button';
    b.onclick = () => { period = k; try { sessionStorage.setItem('hf-admin-period', k); } catch { /* private window */ } renderActivity(); };
    return b;
  }));
  const zero = { added: 0, sent: 0, scans: 0, costMicro: 0 };
  const rows = data.properties.map(p => ({ p, a: (data.daily.activity[p.id] || {})[period] || zero }))
    .map(r => ({ ...r, n: r.a.added + r.a.sent }))
    .sort((x, y) => y.n - x.n || y.a.sent - x.a.sent || (y.p.lastGuestAt || 0) - (x.p.lastGuestAt || 0));
  const max = Math.max(1, ...rows.map(r => r.n));
  const box = $('activity');
  const shown = showAllActivity ? rows : rows.slice(0, 10);
  box.replaceChildren(...shown.map((r, i) => {
    const row = el('div', 'act' + (r.n ? '' : ' idle'));
    const name = el('div', 'nm', r.p.name);
    name.append(el('small', '', `${standing(r.p)[1]} · poslední host ${ago(r.p.lastGuestAt)}`));
    const meter = el('div', 'meter');
    meter.title = `${r.a.sent} odesláno, ${r.a.added} přidáno`;
    const sent = el('i', 'm-sent'); sent.style.width = `${100 * r.a.sent / max}%`;
    const added = el('i', 'm-added'); added.style.width = `${100 * r.a.added / max}%`;
    meter.append(sent, added);
    const ct = el('div', 'ct');
    ct.append(el('b', '', String(r.a.sent)), document.createTextNode(' odesl. · '), el('b', '', String(r.a.added)), document.createTextNode(' přid. · '),
      el('b', '', String(r.a.scans || 0)), document.createTextNode(' skenů'), el('span', 'cost', usd(r.a.costMicro || 0)), capPill(r.p));
    ct.title = 'Odesláno policii · přidáno do aplikace · přečteno dokladů AI (a co to stálo)';
    row.append(el('span', 'rk', String(i + 1)), name, meter, ct);
    row.onclick = () => openProperty(r.p.id);
    return row;
  }));
  if (!rows.length) box.append(el('p', 'empty', 'Zatím žádné provozovny.'));
  const total = rows.reduce((t, r) => ({ scans: t.scans + (r.a.scans || 0), cost: t.cost + (r.a.costMicro || 0) }), { scans: 0, cost: 0 });
  if (rows.length) box.append(el('p', 'act-total', `Celkem ${total.scans} skenů za ${usd(total.cost)}`));
  if (rows.length > 10) {
    const b = el('button', 'ghost more-btn', showAllActivity ? 'Zobrazit jen prvních 10' : `Zobrazit všech ${rows.length}`);
    b.type = 'button';
    b.onclick = () => { showAllActivity = !showAllActivity; renderActivity(); };
    box.append(b);
  }
}

function openProperty(id) {
  const p = data.properties.find(x => x.id === id);
  filter = 'all';
  $('q').value = p ? p.name : '';
  renderFilters(); renderProps();
  show('props');
  const first = $('props').querySelector('details');
  if (first) first.open = true;
}

// ---- Provozovny ----
const FILTERS = [['all', 'Vše'], ['trial', 'Trial'], ['paying', 'Platí'], ['comp', 'Comp'], ['ended', 'Skončil'], ['problem', 'Neplatí']];
function renderFilters() {
  $('status-filter').replaceChildren(...FILTERS.map(([k, label]) => {
    const b = el('button', 'chip' + (filter === k ? ' on' : ''), label);
    b.type = 'button';
    b.onclick = () => { filter = k; renderFilters(); renderProps(); };
    return b;
  }));
}

function act(label, body, opts = {}) {
  const b = el('button', opts.cls || '', label);
  b.type = 'button';
  if (opts.admin) b.dataset.admin = '';
  b.onclick = async () => {
    if (opts.confirm && !confirm(opts.confirm)) return;
    b.disabled = true;
    try { await call('POST', typeof body === 'function' ? body() : body); toast('Hotovo ✓'); await load(); }
    catch (err) { toast(`Chyba: ${err.message}`); b.disabled = false; }
  };
  return b;
}

function renderProps() {
  const q = $('q').value.trim().toLowerCase();
  const list = data.properties.filter(p => (filter === 'all' || standing(p)[0] === filter)
    && (!q || `${p.name} ${p.ownerEmail || ''} ${p.ownerName || ''}`.toLowerCase().includes(q)));
  const box = $('props');
  box.replaceChildren();
  if (!list.length) { box.append(el('p', 'empty', 'Nic tu není.')); return; }
  const names = Object.fromEntries(data.properties.map(p => [p.id, p.name]));
  for (const p of list) {
    const d = el('details', 'prop');
    const s = el('summary');
    const [kind, label] = standing(p);
    const who = el('div', 'grow');
    who.append(el('div', 'name', p.name), el('div', 'sub', `${PLAN[p.plan] || p.plan} · ${p.country} · od ${day(p.createdAt)}`));
    const owner = el('div', 'owner');
    owner.append(el('div', 'sub', p.ownerName || '—'), el('div', 'sub', p.ownerEmail || ''));
    s.append(who, el('span', `badge b-${kind}`, label), owner,
      el('div', 'nums', `${p.sentMonth || 0} hostů · ${p.scans || 0} skenů · ${usd(p.costMicro)}`));
    d.append(s);

    const more = el('div', 'more');
    const facts = el('dl', 'facts');
    const fact = (k, v) => facts.append(el('dt', '', k), el('dd', '', v));
    fact('ID', p.id);
    fact('Tarif', PLAN[p.plan] || p.plan);
    fact('Stav ve Stripe', `${p.status}${p.subscribed ? ' · má předplatné' : ''}`);
    if (p.periodEnd) fact('Další platba', day(p.periodEnd));
    if (p.billingParent) fact('Platí za ni', names[p.billingParent] || p.billingParent);
    fact('Tým', `${p.members} lidí`);
    fact('Policie', p.policeSet ? `nastaveno (${p.registration || '?'})` : 'nenastaveno');
    fact('Odesláno policii', `tento měsíc ${p.sentMonth || 0}, minulý ${p.sentLastMonth || 0}`);
    fact('Poslední host', ago(p.lastGuestAt));
    fact('Skeny tento měsíc', p.scanCap === null ? `${p.scans || 0} (bez limitu)` : `${p.scans || 0} / ${p.scanCap} · zbývá ${Math.max(0, p.scanCap - (p.scans || 0))}${p.scanLimit ? ' (vlastní limit)' : ''}`);

    const acts = el('div', 'acts');
    if (p.status === 'trial') {
      const r = el('div', 'row');
      r.append(el('b', '', 'Prodloužit trial'), ...[7, 14, 30].map(n => act(`+${n} dní`, { action: 'extendTrial', propertyId: p.id, days: n })));
      acts.append(r);
    }
    const comp = el('div', 'row');
    comp.dataset.admin = '';
    comp.append(el('b', '', 'Zdarma (comp)'));
    if (p.status === 'comp') comp.append(act('Zrušit comp → trial', { action: 'setComp', propertyId: p.id, on: false }, { confirm: `${p.name}: zrušit „zdarma“? Dostane trial (14 dní, ale nejméně do 31. 12. 2026).` }));
    else if (p.status === 'trial') comp.append(act('Dát zdarma', { action: 'setComp', propertyId: p.id, on: true }, { confirm: `${p.name}: dát HostelFlow zdarma natrvalo?` }));
    else comp.append(el('span', 'muted small', 'má předplatné — nejdřív zrušit ve Stripe'));
    acts.append(comp);
    const lim = el('div', 'row');
    lim.dataset.admin = '';
    const inp = el('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '100000'; inp.placeholder = 'výchozí'; inp.value = p.scanLimit || '';
    lim.append(el('b', '', 'Limit skenů za měsíc'), inp,
      act('Uložit', () => ({ action: 'setScanLimit', propertyId: p.id, limit: inp.value === '' ? null : Number(inp.value) })));
    acts.append(lim);
    const del = el('div', 'row danger-zone');
    del.dataset.admin = '';
    const delBtn = withIcon(el('button', 'danger'), 'trash', 'Odstranit provozovnu');
    delBtn.type = 'button';
    delBtn.onclick = async () => {
      const typed = prompt(`Odstranit „${p.name}“ natrvalo? Smažou se hosté, tým, pokoje, rezervace i nastavení policie. Účet majitele zůstane.

Pro potvrzení napiš přesný název provozovny:`);
      if (typed === null) return;
      if (typed !== p.name) { toast('Název nesedí, nic se nesmazalo.'); return; }
      delBtn.disabled = true;
      try { await call('POST', { action: 'deleteProperty', propertyId: p.id, confirmName: typed }); toast(`„${p.name}“ odstraněna ✓`); $('q').value = ''; await load(); }
      catch (err) { toast(`Chyba: ${err.message}`); delBtn.disabled = false; }
    };
    del.append(delBtn);
    acts.append(del);
    if (p.ownerEmail) {
      const mail = withIcon(el('a', 'small mail'), 'mail', `Napsat ${p.ownerEmail}`);
      mail.href = `mailto:${p.ownerEmail}`;
      acts.append(mail);
    }
    more.append(facts, acts);
    d.append(more);
    box.append(d);
  }
}

// ---- Tables: vouchers, costs, inbox, audit ----
function table(id, head, rows) {
  const t = $(id);
  const tr = el('tr');
  for (const h of head) tr.append(el('th', h.r ? 'r' : '', h.t || h));
  t.replaceChildren(tr);
  if (!rows.length) { const r = el('tr'); const c = el('td', 'muted', 'Zatím nic.'); c.colSpan = head.length; r.append(c); t.append(r); return; }
  for (const row of rows) {
    const r = el('tr');
    row.forEach((v, i) => r.append(el('td', head[i].r ? 'r' : '', v)));
    t.append(r);
  }
}

// The Claude credit: top-ups noted here minus what Anthropic billed (exact,
// with the Admin API key) — or, without the key, our own estimate.
const usd2 = micro => `${micro < 0 ? '−' : ''}$${(Math.abs(micro || 0) / 1e6).toFixed(2)}`;
function renderCredit() {
  const c = data.credit;
  if (!c) return;
  const has = c.topups.length > 0;
  const exact = c.source === 'exact';
  const est = exact ? '' : ' (odhad)';
  $('credit-src').textContent = exact ? '— přesně' : '— odhad';
  const left = kpi(c.low ? 'pink' : 'green', 'wallet', has ? usd2(c.remainingMicro) : '—', `zbývá${est}`,
    has ? (c.daysLeft === null ? 'zatím žádná útrata' : `vydrží asi ${c.daysLeft} dní`) : 'zapiš první dobití');
  if (c.low) left.classList.add('low');
  $('credit').replaceChildren(
    left,
    kpi('violet', 'coins', has ? usd2(c.toppedUpMicro) : '—', 'dobito celkem'),
    kpi('orange', 'sparkles', has ? usd2(c.spentMicro) : '—', `utraceno od dobití${est}`),
    kpi('blue', 'history', usd2(c.last7Micro), `posledních 7 dní${est}`, `30 dní: ${usd2(c.last30Micro)} · ${usd2(c.perDayMicro)} denně`),
    kpi('teal', 'scan', String(c.scansPerDay).replace('.', ','), 'skenů denně (průměr 30 dní)'),
  );
  const low = c.low ? ' Pod $10 — dobij kredit.' : '';
  const failed = c.error ? ` Poslední načtení z Anthropic selhalo (${c.error}).` : '';
  $('credit-note').textContent = exact
    ? `Přesně podle Anthropic (Cost Report, Admin API), načteno ${when(c.asOf)}; obnovuje se každou hodinu. Dny podle UTC.${failed}${low}`
    : `${c.keyMissing ? 'Pro přesná čísla připoj Admin API klíč: v Cloudflare přidej secret ANTHROPIC_ADMIN_KEY (Claude Console → Settings → Admin keys). ' : ''}`
      + `Zatím odhad z našich čísel: skeny dokladů a Flowy podle tokenů a ceníku (src/claude-prices.js). Nepočítá nepovedené skeny, testovací porovnání skenů ani staging — skutečný zůstatek bývá o něco nižší. Denní čísla máme od ${day(Date.parse(c.coveredFrom))}, dřív jen po měsících.${failed}${low}`;
  const t = $('topups');
  const head = el('tr');
  for (const h of ['Den', 'Částka', 'Utraceno od té doby', 'Poznámka', '']) head.append(el('th', h === 'Částka' || h.startsWith('Utraceno') ? 'r' : '', h));
  t.replaceChildren(head);
  if (!has) { const r = el('tr'); const d = el('td', 'muted', 'Zatím nic.'); d.colSpan = 5; r.append(d); t.append(r); }
  for (const x of c.topups) {
    const r = el('tr');
    const del = el('button', 'ghost small-btn', '');
    del.setAttribute('data-admin', '');
    del.title = 'Smazat dobití';
    withIcon(del, 'trash');
    del.addEventListener('click', async () => {
      if (!confirm(`Smazat dobití ${usd2(x.amountCents * 1e4)} z ${day(Date.parse(x.day))}?`)) return;
      try { await call('POST', { action: 'deleteTopup', id: x.id }); toast('Dobití smazáno'); await load(); } catch (err) { toast(`Chyba: ${err.message}`); }
    });
    const act = el('td', 'r'); act.append(del);
    r.append(el('td', '', day(Date.parse(x.day))), el('td', 'r', usd2(x.amountCents * 1e4)), el('td', 'r', usd2(x.spentSinceMicro)), el('td', '', x.note || ''), act);
    t.append(r);
  }
}

function renderRest() {
  renderCredit();
  table('costs', ['Měsíc', { t: 'Skeny', r: 1 }, { t: 'AI skeny', r: 1 }, { t: 'Na sken', r: 1 }, { t: 'Flowy', r: 1 }],
    data.costs.map(c => [c.month, String(c.scans), usd(c.scanCostMicro), c.scans ? usd(c.scanCostMicro / c.scans) : '—', `${usd(c.flowyCostMicro)} (${c.flowyMessages})`]));
  table('ocr', ['Dvojice', { t: 'Skenů', r: 1 }, { t: 'Rozdíl', r: 1 }, { t: 'Chyby', r: 1 }],
    data.ocr.map(o => [o.pair, String(o.n), o.n ? `${Math.round(100 * o.differs / o.n)} %` : '—', String(o.errors)]));
  table('vouchers', ['Kód', 'Zdarma do', 'Uplatnit do', { t: 'Použito', r: 1 }, 'Poznámka'],
    data.vouchers.map(v => [v.code, day(v.freeUntil), day(v.redeemBy), `${v.uses} / ${v.maxUses}`, v.note || '']));
  const sup = $('support');
  sup.replaceChildren(...(data.support.length ? data.support.map(m => {
    const c = el('div', 'msg');
    c.append(el('div', 'meta', `${when(m.createdAt)} · ${m.email || 'smazaný účet'}${m.property ? ` · ${m.property}` : ''}`), el('p', '', m.message));
    return c;
  }) : [el('p', 'empty', 'Žádné zprávy.')]));
  const al = $('alerts');
  al.replaceChildren(...(data.alerts.length ? data.alerts.map(a => {
    const c = el('div', 'msg');
    c.append(el('div', 'meta', `${a.kind} · naposledy ${when(a.lastSentAt)}${a.missed ? ` · +${a.missed}× potom` : ''}`));
    if (a.detail) c.append(el('pre', '', a.detail));
    return c;
  }) : [el('p', 'empty', 'Žádné chyby.')]));
  const names = Object.fromEntries(data.properties.map(p => [p.id, p.name]));
  table('audit', ['Kdy', 'Kdo', 'Co', 'Provozovna', 'Detail'],
    data.audit.map(a => [when(a.at), a.actor, a.action, a.propertyId ? names[a.propertyId] || a.propertyId : '', a.detail || '']));
}

// ---- Loading ----
async function load() {
  try { data = await call('GET'); }
  catch (err) {
    if (err.status === 401) { showLogin(); return; }
    toast(`Chyba: ${err.message}`);
    return;
  }
  document.documentElement.dataset.role = data.role;
  renderToday(); renderActivity(); renderArchive(); renderFilters(); renderProps(); renderRest();
}

async function start() {
  $('who-name').textContent = me.name || me.email.split('@')[0];
  $('who').textContent = me.role === 'admin' ? 'admin' : 'podpora';
  $('who-av').textContent = (me.name || me.email).trim()[0].toUpperCase();
  $('who-av').title = me.email;
  $('app').hidden = false;
  let view = 'today';
  try { view = sessionStorage.getItem('hf-admin-view') || 'today'; } catch { /* private window */ }
  show($(`v-${view}`) ? view : 'today');
  await load();
}

$('q').addEventListener('input', renderProps);
// Dates: the voucher form starts with sensible defaults.
const iso = t => new Date(t).toISOString().slice(0, 10);
$('v-free').value = iso(Date.now() + 90 * DAY);
$('v-by').value = iso(Date.now() + 60 * DAY);
$('t-day').value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(Date.now());
$('topup-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('t-err').textContent = '';
  try {
    await call('POST', { action: 'addTopup', amount: Number($('t-amount').value), day: $('t-day').value, note: $('t-note').value });
    $('t-amount').value = ''; $('t-note').value = '';
    toast('Dobití uloženo ✓');
    await load();
  } catch (err) { $('t-err').textContent = err.message; }
});
$('voucher-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('v-err').textContent = '';
  // End of the chosen day, UTC.
  const end = v => Date.parse(`${v}T23:59:59Z`);
  try {
    await call('POST', { action: 'createVoucher', code: $('v-code').value, freeUntil: end($('v-free').value), redeemBy: end($('v-by').value), maxUses: Number($('v-max').value), note: $('v-note').value });
    $('v-code').value = ''; $('v-note').value = '';
    toast('Voucher vytvořen ✓');
    await load();
  } catch (err) { $('v-err').textContent = err.message; }
});

// Who's here? Signed in → straight to the day; otherwise the sign-in card.
api('/api/admin/me').then(m => { me = m; return start(); }).catch(err => {
  if (err.status === 401 || err.status === 403) showLogin();
  else { showLogin(); $('li-err').textContent = `Chyba: ${err.message}`; }
});
