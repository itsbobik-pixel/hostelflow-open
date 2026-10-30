// HostelFlow — Helpers, API calls, tabs, Settings sections, appearance.
// Plain scripts loaded in order by index.html; they share globals.

const $ = id => document.getElementById(id);
let state = { me: null, property: null, ownerPropertyId: null, adminPropertyId: null, settings: null, guests: [], selected: new Set(), seen: new Set(), open: null, busy: [] };

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status, data });
  return data;
}

function show(id) {
  for (const v of ['view-login', 'view-register', 'view-google', 'view-forgot', 'view-reset', 'view-invite', 'view-confirm', 'view-app']) $(v).hidden = v !== id;
  document.querySelector('.wrap').classList.toggle('app', id === 'view-app');
  if (id !== 'view-app') $('ci-sendbar').hidden = true;
  if (id === 'view-login') renderLoginTeam();
}

// Runs a form submit with a disabled button and an error line.
function bindForm(formId, errId, handler) {
  $(formId).addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $(formId).querySelector('button[type=submit]');
    $(errId).textContent = '';
    $(errId).className = 'err';
    btn.disabled = true;
    try { await handler(); }
    catch (err) { $(errId).textContent = tx(err.message); }
    finally { btn.disabled = false; }
  });
}

function text(tag, value, cls) {
  const el = document.createElement(tag);
  el.textContent = tx(value);
  if (cls) el.className = cls;
  return el;
}

let toastTimer;
function toast(msg) {
  $('toast').textContent = tx(msg);
  $('toast').hidden = true;
  void $('toast').offsetWidth; // replay the slide-in
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

// A dialog closes on a tap on its dark backdrop — but not when the press began
// inside it (selecting a name with the mouse and letting go outside is a
// "click" on the backdrop too). Every .modal-back, before its own listener.
let pressedOn = null;
document.addEventListener('pointerdown', e => { pressedOn = e.target; }, true);
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-back') && pressedOn !== e.target) e.stopPropagation();
}, true);

// ===== Tabs =====

// Each tab has its own address (hostelflow.it/#calendar), so a refresh stays
// on it, the browser's back button goes to the previous tab and a link can
// open a tab directly.
const TAB_ROUTES = { dashboard: 'board', calendar: 'calendar', checkin: 'checkin', shifts: 'shifts', housekeeping: 'housekeeping', settings: 'settings', vault: 'vault', activity: 'activity', structures: 'settings' }; // the structures page opens from Settings → Reports (its data is there)
const routeOf = name => (name === 'board' ? 'dashboard' : name);
const tabFromHash = () => TAB_ROUTES[location.hash.slice(1)] || null;

let currentTab = null;
// Tabs still being built: only for properties in preview.
const PREVIEW_TABS = ['calendar'];
const inPreview = () => !!(state.property && state.property.preview);

// Tabs someone chose to hide (Settings → Your account), on this kind of device.
const PHONE = matchMedia('(max-width: 640px)');
const TAB_ORDER = ['calendar', 'board', 'checkin', 'housekeeping', 'shifts'];
function hiddenTabs() {
  const prefs = state.me && state.me.user.tabs;
  const keep = prefs && prefs[PHONE.matches ? 'phone' : 'computer'];
  return keep ? TAB_ORDER.filter(t => !keep.includes(t)) : [];
}
function applyTabPrefs() {
  const hidden = hiddenTabs();
  document.querySelectorAll('header.bar nav.tabs button[data-tab]').forEach(b => b.classList.toggle('tab-off', hidden.includes(b.dataset.tab)));
  if (currentTab && hidden.includes(currentTab)) showTab(currentTab);
}
PHONE.addEventListener('change', applyTabPrefs);

// Check-in-only plans (src/billing.js): no Dashboard, Housekeeping or Shifts.
const FULL_TABS = ['board', 'housekeeping', 'shifts'];
const fullApp = () => !state.property || state.property.full !== false;
const homeTab = () => (fullApp() && tabSeen('board') ? 'board' : TAB_ORDER.find(t => tabSeen(t) && !(FULL_TABS.includes(t) && !fullApp()) && !(PREVIEW_TABS.includes(t) && !inPreview())) || 'settings');

function showTab(name, { push = true } = {}) {
  if (PREVIEW_TABS.includes(name) && !inPreview()) name = homeTab();
  if ((FULL_TABS.includes(name) || name === 'vault') && !fullApp()) name = homeTab(); // the Vault is Flow's too
  const hidden = name === 'settings' ? [] : hiddenTabs();
  if (hidden.includes(name)) {
    name = TAB_ORDER.find(t => !hidden.includes(t) && !(PREVIEW_TABS.includes(t) && !inPreview()) && !(FULL_TABS.includes(t) && !fullApp()) && tabSeen(t)) || homeTab();
  }
  if (name !== 'settings' && name !== 'vault' && name !== 'activity' && !tabSeen(name)) name = homeTab();
  currentTab = name;
  const route = `#${routeOf(name)}`;
  if (location.hash !== route) {
    if (push && tabFromHash()) history.pushState(null, '', route);
    else history.replaceState(null, '', route);
  }
  document.querySelectorAll('header.bar button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('tab-plus').classList.toggle('on', name === 'checkin');
  $('tab-board').hidden = name !== 'board';
  $('hello').hidden = name !== 'board';
  if (typeof renderFavs === 'function') renderFavs(name);
  // Fade the new tab in (as in Costello). The first time on a tab (for this
  // property) it waits for its data, so it doesn't show an empty or old page
  // that then jumps around — at most a second, then it shows anyway.
  const shown = $(`tab-${name}`);
  const fadeIn = () => { if (!shown) return; shown.classList.remove('tab-wait', 'tab-enter'); void shown.offsetWidth; shown.classList.add('tab-enter'); };
  const pid = state.property && state.property.id;
  const loader = TAB_LOADERS[name];
  const firstVisit = loader && tabLoadedFor[name] !== pid;
  if (firstVisit && shown) shown.classList.add('tab-wait');
  else fadeIn();
  $('tab-checkin').hidden = name !== 'checkin';
  $('tab-housekeeping').hidden = name !== 'housekeeping';
  $('tab-shifts').hidden = name !== 'shifts';
  $('tab-calendar').hidden = name !== 'calendar';
  if (name !== 'housekeeping') hkSel = null;
  $('tab-settings').hidden = name !== 'settings';
  $('tab-vault').hidden = name !== 'vault';
  $('tab-activity').hidden = name !== 'activity';
  $('tab-structures').hidden = name !== 'structures';
  renderSendbar();
  if (!loader) return;
  const loading = Promise.resolve(loader()).catch(() => {});
  if (!firstVisit || !shown) return;
  const timer = setTimeout(fadeIn, 1000);
  loading.then(() => { clearTimeout(timer); tabLoadedFor[name] = pid; if (shown.classList.contains('tab-wait')) fadeIn(); });
}
// Each tab's data, and for which property it was last loaded.
const TAB_LOADERS = { checkin: () => loadGuests(), board: () => loadBoard(), housekeeping: () => loadHousekeeping(), shifts: () => loadShifts(), calendar: () => loadCalendar(), vault: () => loadVault(), activity: () => loadActivity(false) };
const tabLoadedFor = {};
// The gear opens Settings; pressed again, it goes back where you were.
let beforeSettings = 'board';
document.querySelectorAll('header.bar button[data-tab]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.tab === 'settings' && currentTab === 'settings') return showTab(beforeSettings);
  if (b.dataset.tab === 'settings' && currentTab) beforeSettings = currentTab;
  showTab(b.dataset.tab);
}));
// Back / forward, or an address typed in by hand.
// Back fires both popstate and hashchange: the tab is only drawn once.
const followHash = () => { const tab = tabFromHash(); if (tab && tab !== currentTab && state.me && !$('view-app').hidden) showTab(tab, { push: false }); };
window.addEventListener('popstate', followHash);
window.addEventListener('hashchange', followHash);

// On a computer Check-in has no tab: it opens from the "+" (with, later, new reservations).
function closePlus() { $('plus-menu').hidden = true; $('tab-plus').setAttribute('aria-expanded', 'false'); }
$('tab-plus').onclick = e => {
  e.stopPropagation();
  const open = $('plus-menu').hidden;
  $('plus-menu').hidden = !open;
  $('tab-plus').setAttribute('aria-expanded', String(open));
  // Drop down from the "+" itself.
  const bar = $('tab-plus').closest('header').getBoundingClientRect();
  $('plus-menu').style.left = `${$('tab-plus').getBoundingClientRect().left - bar.left}px`;
};
// Straight to choosing photos; the Check-in screen opens once some are picked.
$('pm-checkin').onclick = () => { closePlus(); $('ci-files').click(); };
$('pm-res').onclick = () => { closePlus(); openResModal(null); };
document.addEventListener('click', e => { if (!e.target.closest('#plus-menu, #tab-plus')) closePlus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlus(); });

// The logo is "home": back to the dashboard, at the top.
const homeLogo = document.querySelector('#view-app h1.logo');
homeLogo.style.cursor = 'pointer';
homeLogo.setAttribute('role', 'link');
homeLogo.tabIndex = 0;
const goHome = () => { state.open = null; showTab(homeTab()); window.scrollTo({ top: 0, behavior: 'smooth' }); };
homeLogo.addEventListener('click', goHome);
homeLogo.addEventListener('keydown', e => { if (e.key === 'Enter') goHome(); });

// Someone in several properties works in one at a time; which one is
// remembered on this device (else their own, else the first). Switching
// reloads the app for that property.
const PROPERTY_KEY = 'hf_property';
function workingProperty(properties) {
  let id = null;
  try { id = localStorage.getItem(PROPERTY_KEY); } catch { /* the first one */ }
  return properties.find(p => p.id === id) || properties.find(p => p.role === 'owner') || properties[0] || null;
}
// A soft fade to the other property: the veil comes up, the page reloads under
// it and it lifts once the app is drawn again (theme.js keeps it up meanwhile).
function switchProperty(id) {
  try { localStorage.setItem(PROPERTY_KEY, id); } catch { /* can't be remembered */ }
  const p = state.me.properties.find(x => x.id === id);
  const name = p ? p.name : '';
  try { sessionStorage.setItem('hf_switching', name || '1'); } catch { /* just no veil after the reload */ }
  closePropMenu();
  $('veil-name').textContent = name;
  document.documentElement.dataset.switching = '1';
  setTimeout(() => location.reload(), 220);
}
function liftVeil() {
  if (!document.documentElement.dataset.switching) return;
  try { sessionStorage.removeItem('hf_switching'); } catch { /* fine */ }
  setTimeout(() => { delete document.documentElement.dataset.switching; }, 60);
}
try { const n = sessionStorage.getItem('hf_switching'); if (n && n !== '1') $('veil-name').textContent = n; } catch { /* fine */ }
// Never stuck: signed out or an error still lifts it.
setTimeout(liftVeil, 6000);
// Owners, and everyone else on the team (no more Staff and Volunteer, 23. 10.).
const roleLabel = role => t(role === 'owner' ? 'Owner' : 'Team');

function renderPropertyList() {
  const { properties } = state.me;
  const list = $('properties');
  list.replaceChildren();
  if (!properties.length) list.append(text('p', 'You are not part of any property yet.', 'muted'));
  for (const p of properties) {
    const row = document.createElement('div');
    row.className = 'row';
    row.append(text('div', p.name, 'grow'), text('span', roleLabel(p.role), 'pill'));
    if (properties.length > 1) {
      if (state.property && p.id === state.property.id) row.append(text('span', 'Open now', 'muted prop-now'));
      else {
        const go = text('button', 'Switch', 'small');
        go.type = 'button';
        go.onclick = () => switchProperty(p.id);
        row.append(go);
      }
    }
    list.append(row);
  }
}

// The property's name under the logo: with more than one, it opens the switcher.
// With more than one property: the name under the logo opens the switcher.
function renderPropertySwitch() {
  const many = state.me.properties.length > 1;
  // One property: just its name. More: a pill with a chevron that opens the switcher.
  $('prop-btn').classList.toggle('many', many);
  $('prop-btn').disabled = !many;
  $('prop-menu').replaceChildren(...state.me.properties.map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    const words = document.createElement('span');
    words.append(text('b', p.name), text('small', roleLabel(p.role)));
    b.append(words);
    if (state.property && p.id === state.property.id) { b.disabled = true; b.classList.add('on'); }
    else b.onclick = () => switchProperty(p.id);
    return b;
  }), ...(ownsAProperty() ? [addPropertyItem()] : []));
  $('prop-add-open').hidden = !ownsAProperty() || !$('form-prop-add').hidden;
}
const ownsAProperty = () => state.me.properties.some(p => p.role === 'owner');
// The switcher ends with "Add a property" (Settings → Your account).
function addPropertyItem() {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.className = 'prop-add';
  b.append(text('b', '+ Add a property'));
  b.onclick = () => { closePropMenu(); openSection('sec-account'); $('prop-add-open').click(); };
  return b;
}
function closePropMenu() { $('prop-menu').hidden = true; $('prop-btn').setAttribute('aria-expanded', 'false'); }

// Another property of one's own: created, then opened.
$('prop-add-open').onclick = () => { $('form-prop-add').hidden = false; $('prop-add-open').hidden = true; $('prop-add-name').focus(); };
$('prop-add-cancel').onclick = () => { $('form-prop-add').hidden = true; $('prop-add-open').hidden = false; $('form-prop-add').reset(); };
bindForm('form-prop-add', 'prop-add-err', async () => {
  const r = await api('POST', '/api/properties', { name: $('prop-add-name').value });
  try { localStorage.setItem(PROPERTY_KEY, r.id); } catch { /* the owned one opens anyway */ }
  location.hash = '#settings';
  location.reload();
});
function togglePropMenu(e) {
  e.stopPropagation();
  const menu = $('prop-menu');
  menu.hidden = !menu.hidden;
  $('prop-btn').setAttribute('aria-expanded', String(!menu.hidden));
  // Drops down from the name, left edges lined up.
  const bar = $('prop-btn').closest('header').getBoundingClientRect();
  const r = $('prop-btn').getBoundingClientRect();
  menu.style.left = `${Math.max(8, r.left - bar.left)}px`;
  menu.style.top = `${r.bottom - bar.top + 6}px`;
}
$('prop-btn').addEventListener('click', togglePropMenu);
document.addEventListener('click', e => { if (!e.target.closest('#prop-menu, #prop-btn')) closePropMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePropMenu(); });

// May this person do that at the working property? (src/auth.js PERMISSIONS)
// Settings → Team: what someone may change (can) and at least look at (sees).
function can(permission) {
  return !!(state.property && (state.property.can || []).includes(permission));
}
function sees(area) {
  return !!(state.property && (state.property.sees || state.property.can || []).includes(area));
}
// The tabs someone sees: each area's own, the Dashboard with any of its parts.
const TAB_AREAS = { board: ['notes', 'attention', 'guidelines'], checkin: ['checkin'], housekeeping: ['housekeeping'], shifts: ['shifts'], calendar: ['calendar'] };
const tabSeen = tab => !state.property || !TAB_AREAS[tab] || TAB_AREAS[tab].some(sees);
const SHOWN_AREAS = ['checkin', 'notes', 'attention', 'guidelines', 'housekeeping', 'shifts', 'calendar', 'vault'];

function renderApp() {
  const { properties } = state.me;
  // One property at a time: the one chosen on this device, or the first.
  state.property = workingProperty(properties);
  renderPropertyList();
  $('hd-property').textContent = state.property ? state.property.name : '';
  $('demo-bar').hidden = !(state.property && state.property.demo);
  renderPasswordForm();
  renderPropertySwitch();
  document.documentElement.dataset.role = state.property ? state.property.role : '';
  // What this person sees and changes (Settings → Team), for app.css:
  // data-see-x="0" hides an area, data-edit-x="0" leaves it to look at.
  document.documentElement.dataset.checkin = sees('checkin') ? '1' : '0';
  for (const area of SHOWN_AREAS) {
    document.documentElement.dataset[`see${area[0].toUpperCase()}${area.slice(1)}`] = sees(area) ? '1' : '0';
    document.documentElement.dataset[`edit${area[0].toUpperCase()}${area.slice(1)}`] = can(area) ? '1' : '0';
  }
  // The plan: the whole app, or check-in only (no Dashboard, Housekeeping, Shifts).
  document.documentElement.dataset.full = fullApp() ? '1' : '0';
  // Parts still being built show only for properties in preview (see app.css).
  document.documentElement.dataset.preview = state.property && state.property.preview ? '1' : '';
  renderUserButton();
  emailSignIn = false; // signed out later: the names again
  loadDevice().then(renderWhoChips);
  liftVeil();
  // The header picture is the person's (and a device's old one moves up once).
  applyHeaderArt();
  renderHeaderPicker();
  moveLocalHeader();
  applyTabPrefs();
  renderTabPrefs();
  $('sp-open').hidden = !state.me.supportEnabled;
  $('um-vault').hidden = !state.property || !sees('vault') || !fullApp(); // the Vault is a property's, and Flow's
  $('um-bench').hidden = !state.me.bench; // the scan bench (for now, only the listed accounts)
  // Owner things (settings, billing) are those of the property open now.
  const owned = state.property && state.property.role === 'owner' ? state.property : null;
  state.ownerPropertyId = owned ? owned.id : null;
  // Where the shared settings (police login, guidelines, team) are edited:
  // the owned property, or this one if the owner gave the permission.
  const admin = ['guidelines', 'shifts'].some(can) || ['police', 'team'].some(sees);
  state.adminPropertyId = owned ? owned.id : admin ? state.property.id : null;
  document.querySelectorAll('#tab-settings [data-owner]').forEach(d => { d.hidden = !owned; });
  $('um-activity').hidden = !owned; // the Activity Log is the owner's
  // Reports and Team are shown to whoever may look at them; Guidelines and Shifts only to who changes them.
  document.querySelectorAll('#tab-settings [data-perm]').forEach(d => { d.hidden = !(['police', 'team'].includes(d.dataset.perm) ? sees : can)(d.dataset.perm); });
  const place = owned || (admin && state.property);
  if (place) $('staff-property').textContent = place.name;
  if (sees('team')) loadStaff();
  if (owned || sees('police') || can('guidelines') || can('shifts')) loadSettings();
  if (owned) loadBilling();
  show('view-app');
  showTab(tabFromHash() || homeTab(), { push: false });
  maybeStartTour(); // the first sign-in: the welcome tour (tour.js)
}

// ===== Settings sections =====

// Which sections are open is remembered on this device.
function savedSections() {
  try { return JSON.parse(localStorage.getItem('hf_sections') || '[]'); } catch { return []; }
}
for (const d of document.querySelectorAll('details.sect')) {
  d.open = savedSections().includes(d.id);
  d.addEventListener('toggle', () => {
    const open = new Set(savedSections());
    if (d.open) open.add(d.id); else open.delete(d.id);
    try { localStorage.setItem('hf_sections', JSON.stringify([...open])); } catch { /* not remembered */ }
  });
}
function openSection(id) {
  showTab('settings');
  $(id).open = true;
  $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== Appearance (per device) =====

// The moon / sun in the header's corner: flips light and dark on this device.
const isDark = () => document.documentElement.dataset.mode === 'dark'
  || (document.documentElement.dataset.mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
// Light ↔ dark: a short cross-fade (View Transitions where the browser has
// them, CSS transitions elsewhere); the icon turns.
$('mode-toggle').onclick = () => {
  const next = isDark() ? 'light' : 'dark';
  const btn = $('mode-toggle');
  btn.classList.remove('turn');
  void btn.offsetWidth;
  btn.classList.add('turn');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setAppearance('mode', next);
  if (document.startViewTransition) {
    const vt = document.startViewTransition(() => setAppearance('mode', next));
    // A hidden tab can't animate: the colours still change, just without the fade.
    vt.ready.catch(() => {});
    vt.finished.catch(() => {});
    return;
  }
  document.documentElement.classList.add('mode-fade');
  setAppearance('mode', next);
  setTimeout(() => document.documentElement.classList.remove('mode-fade'), 400);
};

const MODES = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];
function setAppearance(key, value) {
  document.documentElement.dataset[key] = value;
  try { localStorage.setItem(`hf_${key}`, value); } catch { /* not remembered */ }
  renderAppearance();
}
// Settings → Your account → Tabs I use: a chip per tab, on a phone and on a computer.
const TAB_NAMES = { board: 'Dashboard', checkin: 'Check-in', housekeeping: 'Housekeeping', shifts: 'Shifts', calendar: 'Calendar' };
function renderTabPrefs() {
  if (!state.me) return;
  // Only tabs the plan has (no Dashboard, Housekeeping, Shifts in check-in-only plans).
  const offered = TAB_ORDER.filter(t => !(PREVIEW_TABS.includes(t) && !inPreview()) && !(FULL_TABS.includes(t) && !fullApp()) && tabSeen(t));
  const prefs = state.me.user.tabs || { phone: TAB_ORDER, computer: TAB_ORDER };
  for (const device of ['phone', 'computer']) {
    $(`tb-${device}`).replaceChildren(...offered.map(tab => {
      const on = prefs[device].includes(tab);
      const c = text('button', TAB_NAMES[tab], 'chip' + (on ? ' on' : ''));
      c.type = 'button';
      c.setAttribute('aria-pressed', String(on));
      c.onclick = async () => {
        const next = { phone: [...prefs.phone], computer: [...prefs.computer] };
        next[device] = on ? next[device].filter(t => t !== tab) : [...next[device], tab];
        $('tb-err').textContent = '';
        try {
          const r = await api('PUT', '/api/me', { tabs: next });
          state.me.user.tabs = r.user.tabs;
          applyTabPrefs();
          renderTabPrefs();
        } catch (err) { $('tb-err').textContent = tx(err.message); }
      };
      return c;
    }));
  }
}

function renderAppearance() {
  const root = document.documentElement;
  for (const [box, key, options] of [['ap-mode', 'mode', MODES]]) {
    $(box).replaceChildren(...options.map(([value, label]) => {
      const c = text('button', label, 'chip' + (root.dataset[key] === value ? ' on' : ''));
      c.type = 'button';
      c.onclick = () => setAppearance(key, value);
      return c;
    }));
  }
  // The phone's status bar follows the top bar.
  document.querySelector('meta[name=theme-color]').content = '#1f2433'; // the header photo's sky
}
renderAppearance();

// ----- Header picture (with the account): our town or an own photo, moved into place -----

// Offered in Settings; the other photos stay valid (for whoever picked them) but are hidden for now.
const HEADER_ARTS = [['town', 'Town'], ['mountains', 'Blue mountains'], ['peaks', 'Snowy peaks'], ['photo', 'Upload']];
// Our photos (public/headers/, Unsplash License): who took them, and the part
// each shows on a phone (narrow) and on a computer (a wide strip).
const STOCK_HEADERS = {
  "lights": {
    "by": "Ian Battaglia",
    "url": "https://unsplash.com/photos/lights-above-house-under-blue-sky-at-dawn-LmQpAJmUZ9k",
    "phone": "50% 58%",
    "wide": "50% 56%"
  },
  "clouds": {
    "by": "Nicole Geri",
    "url": "https://unsplash.com/photos/white-and-blue-nimbus-cloud-umjM9-gCI7g",
    "phone": "50% 50%",
    "wide": "50% 50%"
  },
  "sunset": {
    "by": "José Fulgencio Orenes Martínez",
    "url": "https://unsplash.com/photos/calm-sea-and-silhouette-of-mountains-at-dusk-r-NyP6czjiY",
    "phone": "68% 56%",
    "wide": "50% 47%"
  },
  "mountains": {
    "by": "Fabrizio Conti",
    "url": "https://unsplash.com/photos/layered-blue-mountain-silhouettes-c3wsMnxQZDw",
    "phone": "50% 55%",
    "wide": "50% 75%"
  },
  "stars": {
    "by": "Chris Klein",
    "url": "https://unsplash.com/photos/the-night-sky-is-filled-with-stars-and-trees-SfP3THtCgXI",
    "phone": "50% 45%",
    "wide": "50% 40%"
  },
  "peaks": {
    "by": "v2osk",
    "url": "https://unsplash.com/photos/snowy-dolomites-peaks-at-golden-hour-P_hTMaVlkzk",
    "phone": "50% 60%",
    "wide": "50% 58%"
  }
};
// Dark enough for the white logo and menu on top.
const HEADER_COLORS = ['#1f2433', '#2c3e5c', '#3b2d63', '#1f4d3a', '#5b2b2b', '#3a3835', '#181816'];
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };

const headerOf = () => (state.me && state.me.user.header) || null;
const headerImgUrl = h => `/api/me/header/image?v=${h.v}`;
function applyHeaderArt() {
  const bar = document.querySelector('header.bar');
  const h = headerOf();
  const art = h && h.art === 'photo' && h.image ? 'photo' : h && STOCK_HEADERS[h.art] ? h.art : 'town';
  const stock = STOCK_HEADERS[art];
  bar.dataset.art = stock ? 'photo' : art;
  bar.dataset.pick = art;
  bar.style.setProperty('--hdr-color', HEADER_COLORS[0]);
  // Settings → Language and design: credit to whoever took the picture shown.
  const credit = stock || null; // Town is our own drawing
  $('hdr-credit').hidden = !credit;
  if (credit) { $('hdr-credit-by').textContent = credit.by; $('hdr-credit-by').href = credit.url; }
  bar.style.removeProperty('--hdr-pos-wide');
  if (stock) {
    bar.style.setProperty('--hdr-img', `url("/headers/${art}.jpg")`);
    bar.style.setProperty('--hdr-pos', stock.phone);
    bar.style.setProperty('--hdr-pos-wide', stock.wide);
  } else if (art === 'photo') {
    bar.style.setProperty('--hdr-img', `url("${headerImgUrl(h)}")`);
    bar.style.setProperty('--hdr-pos', h.pos || '50% 50%');
  } else {
    bar.style.removeProperty('--hdr-img');
    bar.style.removeProperty('--hdr-pos');
  }
}

async function saveHeader(values) {
  try {
    const r = await api('PUT', '/api/me/header', values);
    state.me.user.header = r.user.header;
  } catch (err) { toast(tx(err.message)); return false; }
  applyHeaderArt();
  renderHeaderPicker();
  return true;
}

// A photo kept on this device before pictures moved to the account goes up once.
async function moveLocalHeader() {
  const img = stored('hf_header_img');
  if (!img || (headerOf() && headerOf().image)) return;
  if (await saveHeader({ image: img, art: stored('hf_header') === 'photo' ? 'photo' : 'town' })) {
    try { localStorage.removeItem('hf_header_img'); localStorage.removeItem('hf_header'); localStorage.removeItem('hf_header_color'); } catch { /* fine */ }
  }
}

function renderHeaderPicker() {
  const art = document.querySelector('header.bar').dataset.pick;
  $('ap-header').replaceChildren(...HEADER_ARTS.map(([value, label]) => {
    const c = text('button', label, 'chip' + (art === value ? ' on' : ''));
    c.type = 'button';
    c.onclick = () => {
      if (value !== 'photo') saveHeader({ art: value });
      else if (headerOf() && headerOf().image) openHeaderModal();
      else $('ap-header-file').click();
    };
    return c;
  }));
}

// The own picture in a pop-up: drag it to choose the part the header shows,
// Save (it becomes the header) or Cancel (back to what was there), or upload another.
let headerPos = [50, 50];
// The whole photo with a frame on it: the part the header shows on this screen.
// Moving the frame moves that part (background-position, like the header's).
function headerWindow() {
  const img = $('hp-img');
  const r = document.querySelector('header.bar').getBoundingClientRect();
  const bar = { width: r.width || innerWidth, height: r.height || 64 };
  if (!img.naturalWidth) return null;
  const scale = Math.max(bar.width / img.naturalWidth, bar.height / img.naturalHeight);
  return [Math.min(1, bar.width / (img.naturalWidth * scale)), Math.min(1, bar.height / (img.naturalHeight * scale))];
}
function showHeaderPos() {
  const p = `${headerPos[0].toFixed(1)}% ${headerPos[1].toFixed(1)}%`;
  const bar = document.querySelector('header.bar');
  bar.dataset.art = 'photo';
  bar.style.setProperty('--hdr-img', `url("${headerImgUrl(headerOf())}")`);
  bar.style.setProperty('--hdr-pos', p);
  const w = headerWindow();
  const win = $('hp-window');
  win.hidden = !w;
  if (!w) return;
  win.style.width = `${w[0] * 100}%`;
  win.style.height = `${w[1] * 100}%`;
  win.style.left = `${headerPos[0] * (1 - w[0])}%`;
  win.style.top = `${headerPos[1] * (1 - w[1])}%`;
}
function openHeaderModal() {
  const h = headerOf();
  headerPos = (h.pos || '50% 50%').split(' ').map(parseFloat);
  $('hp-img').onload = showHeaderPos;
  $('hp-img').src = headerImgUrl(h);
  $('hp-modal').hidden = false;
  showHeaderPos();
}
function closeHeaderModal() {
  $('hp-modal').hidden = true;
  applyHeaderArt();
  renderHeaderPicker();
}
$('hp-frame').onpointerdown = e => {
  const frame = $('hp-frame');
  const w = headerWindow();
  if (!w) return;
  e.preventDefault();
  frame.setPointerCapture(e.pointerId);
  frame.classList.add('moving');
  const start = [e.clientX, e.clientY, ...headerPos];
  const r = frame.getBoundingClientRect();
  // The frame follows the finger.
  const step = (d, size, part) => (part >= 1 ? 0 : (d / (size * (1 - part))) * 100);
  frame.onpointermove = ev => {
    headerPos = [
      Math.min(100, Math.max(0, start[2] + step(ev.clientX - start[0], r.width, w[0]))),
      Math.min(100, Math.max(0, start[3] + step(ev.clientY - start[1], r.height, w[1]))),
    ];
    showHeaderPos();
  };
  frame.onpointerup = frame.onpointercancel = () => { frame.onpointermove = null; frame.classList.remove('moving'); };
};
$('hp-save').onclick = async () => {
  $('hp-save').disabled = true;
  const ok = await saveHeader({ art: 'photo', pos: `${headerPos[0].toFixed(1)}% ${headerPos[1].toFixed(1)}%` });
  $('hp-save').disabled = false;
  if (ok) closeHeaderModal();
};
$('hp-cancel').onclick = closeHeaderModal;
$('hp-close').onclick = closeHeaderModal;
$('hp-upload').onclick = () => $('ap-header-file').click();
$('hp-modal').addEventListener('click', e => { if (e.target === $('hp-modal')) closeHeaderModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('hp-modal').hidden) closeHeaderModal(); });

$('ap-header-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    // Same reader as the check-in photos (iPhone HEIC too), a bit larger.
    const img = await resizePhoto(file, 1800);
    // A new picture: straight into the pop-up to choose its part.
    if (await saveHeader({ image: img, art: 'photo' })) openHeaderModal();
  } catch (err) { toast(tx(err.message)); }
});
applyHeaderArt();

// ===== The user menu (top right, under your name tag): who's signed in, the team, sign out =====

// The same palette as on the server (src/api.js PERSON_COLORS).
const PERSON_COLORS = ['#e07856', '#3a6fd4', '#17c4aa', '#caa53a', '#9a5ad4', '#d4537e', '#4a9d5f', '#5b6475'];
// A person's colour: the one they chose, else one picked from their name.
function colorOf(name, chosen) {
  if (chosen) return chosen;
  return PERSON_COLORS[[...String(name || '?')].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % 6];
}
// Dark text on the light colours (orange, teal, yellow), white on the rest.
function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#1c1c1c' : '#fff';
}
const initialsOf = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function renderUserButton() {
  const u = state.me.user;
  const color = colorOf(u.name || u.email, u.color);
  $('um-account').hidden = !!u.profile;
  $('form-password').hidden = !!u.profile; // a profile's own password: the user menu (um-mypass)
  $('um-mypass').hidden = !u.profile;
  renderWhoChips();
}

function closeUserMenu() {
  $('user-menu').hidden = true;
  $('um-side').hidden = true;
  $('favs').classList.remove('open'); // Quicklinks fold up again
  $('um-quick').setAttribute('aria-expanded', 'false');
  const tag = $('who-chips').querySelector('.who-me');
  if (tag) tag.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => { if (!$('user-menu').hidden && !e.target.closest('#user-menu')) closeUserMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUserMenu(); });
$('um-account').onclick = () => { closeUserMenu(); openSection('sec-account'); };
// The Vault has no tab of its own: it opens from here (js/vault.js).
$('um-vault').onclick = () => { closeUserMenu(); showTab('vault'); };
$('um-activity').onclick = () => { closeUserMenu(); showTab('activity'); };
$('um-bench').onclick = () => { location.href = '/ocr-compare'; };
// Add to home screen (the user menu): the browser's own install where it has one (Chrome,
// Edge), else the guide step by step. Not shown once opened from the home screen.
let installGuide = null;
$('um-install').hidden = HFInstall.standalone;
function closeInstall() { $('ig-modal').hidden = true; }
async function openInstall() {
  closeUserMenu();
  if (HFInstall.canPrompt() && await HFInstall.prompt()) { toast(t('HostelFlow is on your home screen ✓')); return; }
  if (!installGuide) installGuide = HFInstall.mount($('ig-guide'), { lang: LANG, inApp: true, onDone: closeInstall });
  else { installGuide.setLang(LANG); installGuide.reset(); }
  $('ig-modal').hidden = false;
}
$('um-install').onclick = openInstall;
$('ig-close').onclick = closeInstall;
$('faq-install').onclick = openInstall;
$('ig-modal').addEventListener('click', e => { if (e.target === $('ig-modal')) closeInstall(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ig-modal').hidden) closeInstall(); });
// ----- Who is using the app: an account chooser, like Google's -----
// Signed in, the team's profiles are name tags beside the menu
// (renderSideTeam): a tap is enough without a password (the server checks that
// whoever is signed in now may enter it — mayUseProfiles, api.js).
// The sign-in screen used to list who signed in here before; it only confused
// (Bob, 29. 10.), so the old list is cleared from the device.
try { localStorage.removeItem('hf-accounts'); } catch { /* private mode */ }
// A row: the person's colour and initials, the name, a line under it.
// Names are people's own words: set as they are, never translated.
function whoRow(name, sub, color) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'who-row';
  const dot = document.createElement('span');
  dot.className = 'um-avatar';
  dot.textContent = initialsOf(name);
  dot.style.background = colorOf(name, color);
  const words = document.createElement('span');
  words.className = 'grow';
  const n = document.createElement('b');
  n.textContent = name;
  words.append(n);
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    words.append(s);
  }
  b.append(dot, words);
  return b;
}
// Stepping into a profile (someone without e-mail) where they aren't on this device's list.
async function enterProfile(p) {
  const url = `/api/properties/${state.property.id}/profiles/${p.id}/switch`;
  if (p.password) return askPassword(p.name, password => api('POST', url, { password }).then(() => handOver(p.name)));
  try { await api('POST', url); handOver(p.name); }
  catch (err) { toast(tx(err.message)); }
}
$('um-out').onclick = () => { closeUserMenu(); signOut(); };

// ----- The hostel's device: the team by name (src/devices.js) -----
// Once an owner signed in here, the sign-in screen lists the team: a tap on a
// name without a password is enough, the others type just theirs. The same
// people are in the name tags at the top, next to light/dark (like the old
// Costello app): tap your name, pick someone, and they take over.
let deviceTeam = [];
let emailSignIn = false; // "Sign in with e-mail" chosen on the names screen
async function loadDevice() {
  try { deviceTeam = (await api('GET', '/api/device')).properties || []; } catch { deviceTeam = []; }
  return deviceTeam;
}
const deviceTeamHere = () => {
  const place = state.property && deviceTeam.find(p => p.id === state.property.id);
  return place ? place.people : [];
};
// The name on someone's tag: their nickname when they chose it, else the full name.
const shownName = p => p.shown || p.name || p.email || '';
// The reload goes under the veil, with the new person's name on it.
function handOver(name) {
  try { sessionStorage.setItem('hf_switching', name || '1'); } catch { /* no veil */ }
  $('veil-name').textContent = name || '';
  document.documentElement.dataset.switching = '1';
  setTimeout(() => location.reload(), 220);
}

// The password, in a small window (signed in: the team's name tags).
let paSubmit = null;
function askPassword(name, submit) {
  paSubmit = submit;
  $('pa-title').textContent = name;
  $('form-pa').reset();
  $('pa-err').textContent = '';
  $('pa-modal').hidden = false;
  $('pa-pass').focus();
}
function closePassword() { $('pa-modal').hidden = true; paSubmit = null; }
bindForm('form-pa', 'pa-err', async () => {
  try { await paSubmit($('pa-pass').value); }
  catch (err) { $('pa-pass').select(); throw err; }
});
$('pa-close').onclick = closePassword;
$('pa-modal').addEventListener('click', e => { if (e.target === $('pa-modal')) closePassword(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('pa-modal').hidden) closePassword(); });

const deviceSignIn = (p, password) => api('POST', '/api/device/signin', { id: p.id, password });
function takeOver(p) {
  if (p.password) return askPassword(p.name, password => deviceSignIn(p, password).then(() => handOver(p.name)));
  deviceSignIn(p).then(() => handOver(p.name), err => toast(tx(err.message)));
}

// Your name tag next to light/dark (like the old Costello app) opens the user
// menu, and the rest of the team come out beside it (renderSideTeam).
function renderWhoChips() {
  const wrap = $('who-chips');
  const me = state.me && state.me.user;
  wrap.hidden = !me;
  if (!me) return wrap.replaceChildren();
  const name = me.name || me.email;
  const mine = document.createElement('button');
  mine.type = 'button';
  mine.className = 'who-chip who-me';
  const color = colorOf(name, me.color);
  mine.style.setProperty('--who', color);
  mine.style.setProperty('--who-ink', inkOn(color));
  mine.textContent = shownName(me); // a person's own name: never translated
  mine.title = t('Your account');
  mine.setAttribute('aria-haspopup', 'menu');
  mine.setAttribute('aria-expanded', String(!$('user-menu').hidden));
  mine.onclick = e => {
    e.stopPropagation();
    const open = $('user-menu').hidden;
    $('user-menu').hidden = !open;
    mine.setAttribute('aria-expanded', String(open));
    if (open) renderSideTeam(); else $('um-side').hidden = true;
  };
  wrap.replaceChildren(mine);
}

// The rest of the team left of your name tag while the menu is open, as tags like yours: a tap
// and they take over (a password only if they have one). The hostel's device
// lists everyone; elsewhere the profiles whoever is signed in may step into.
async function renderSideTeam() {
  const me = state.me.user;
  const box = $('um-side');
  let people = deviceTeamHere().filter(p => p.id !== me.id);
  const onDevice = people.length > 0;
  if (!onDevice && state.property) {
    try { people = await api('GET', `/api/properties/${state.property.id}/profiles`); } catch { people = []; }
  }
  box.replaceChildren(...people.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-chip';
    const c = colorOf(p.name, p.color);
    b.style.setProperty('--who', c);
    b.style.setProperty('--who-ink', inkOn(c));
    b.style.animationDelay = `${i * 35}ms`;
    b.textContent = shownName(p); // a person's own name: never translated
    b.title = p.name;
    b.setAttribute('role', 'menuitem');
    b.onclick = () => { closeUserMenu(); if (onDevice) takeOver(p); else enterProfile(p); };
    return b;
  }));
  // A phone has no room beside the name tag: there they head the menu instead.
  if (matchMedia('(max-width:640px)').matches) $('user-menu').prepend(box);
  else $('who-chips').after(box);
  box.hidden = !people.length || $('user-menu').hidden; // closed while the list was loading
}

// The sign-in screen of the hostel's device: names instead of the e-mail form.
async function renderLoginTeam() {
  const places = (await loadDevice()).filter(p => p.people.length);
  const names = places.length > 0 && !emailSignIn;
  $('li-team').hidden = !names;
  $('form-login').hidden = names;
  $('li-links').hidden = names;
  $('li-team-err').textContent = '';
  if (!names) return;
  $('li-team-title').textContent = places.length === 1 ? places[0].name : t('Who is signing in?');
  const box = $('li-team-list');
  box.replaceChildren();
  for (const place of places) {
    if (places.length > 1) box.append(Object.assign(document.createElement('h3'), { className: 'li-team-place', textContent: place.name }));
    const list = document.createElement('div');
    list.className = 'who-list';
    for (const p of place.people) {
      const item = document.createElement('div');
      item.className = 'who-team';
      const b = whoRow(shownName(p), p.password ? '' : t('No password needed'), p.color);
      b.onclick = async () => {
        $('li-team-err').textContent = '';
        if (p.password) {
          // The password opens under the name; a second tap closes it.
          const open = item.querySelector('.who-pass');
          box.querySelectorAll('.who-pass').forEach(f => f.remove());
          box.querySelectorAll('.who-row.on').forEach(r => r.classList.remove('on'));
          if (!open) { item.append(teamPassword(p)); b.classList.add('on'); item.querySelector('input').focus(); }
          return;
        }
        b.disabled = true;
        try { state.me = await deviceSignIn(p); renderApp(); }
        catch (err) { $('li-team-err').textContent = tx(err.message); }
        finally { b.disabled = false; }
      };
      item.append(b);
      list.append(item);
    }
    box.append(list);
  }
}
function teamPassword(p) {
  const f = document.createElement('form');
  f.className = 'who-pass';
  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.required = true;
  input.placeholder = t('Password');
  input.setAttribute('aria-label', `${t('Password')}: ${p.name}`);
  const go = text('button', 'Sign in', 'primary');
  go.type = 'submit';
  const err = document.createElement('div');
  err.className = 'err';
  f.append(input, go, err);
  f.onsubmit = async e => {
    e.preventDefault();
    go.disabled = true;
    err.textContent = '';
    try { state.me = await deviceSignIn(p, input.value); renderApp(); }
    catch (ex) {
      err.textContent = tx(ex.message);
      input.select();
    }
    finally { go.disabled = false; }
  };
  return f;
}
function showEmailForm() {
  emailSignIn = true;
  $('li-team').hidden = true;
  $('form-login').hidden = false;
  $('li-links').hidden = false;
}
$('li-use-email').onclick = () => { showEmailForm(); $('li-email').focus(); };
$('li-forget').onclick = async () => {
  if (!confirm(t('Forget this device? It will ask for an e-mail at sign-in again.'))) return;
  await api('POST', '/api/device/forget', {}).catch(() => {});
  renderLoginTeam();
};

// A profile's own password (user menu → "Your password"): set, change or drop it.
function openMyPassword() {
  closeUserMenu();
  const has = state.me.user.hasPassword;
  $('form-mp').reset();
  $('mp-err').textContent = '';
  $('mp-err').className = 'err';
  $('mp-current-wrap').hidden = !has;
  $('mp-current').required = has;
  $('mp-remove-wrap').hidden = !has;
  $('mp-modal').hidden = false;
  (has ? $('mp-current') : $('mp-new')).focus();
}
function closeMyPassword() { $('mp-modal').hidden = true; }
async function saveMyPassword(newPassword) {
  await api('POST', '/api/auth/password', { currentPassword: $('mp-current').value, newPassword });
  state.me.user.hasPassword = !!newPassword;
  closeMyPassword();
  toast(t(newPassword ? 'Password saved.' : 'Password removed. You can sign in by tapping your name.'));
  loadDevice().then(renderWhoChips);
}
bindForm('form-mp', 'mp-err', () => saveMyPassword($('mp-new').value));
$('mp-remove').onclick = async () => {
  $('mp-err').textContent = '';
  if (!$('mp-current').value) { $('mp-current').focus(); return; }
  try { await saveMyPassword(null); } catch (err) { $('mp-err').textContent = tx(err.message); }
};
$('um-mypass').onclick = openMyPassword;
$('mp-close').onclick = closeMyPassword;
$('mp-modal').addEventListener('click', e => { if (e.target === $('mp-modal')) closeMyPassword(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('mp-modal').hidden) closeMyPassword(); });

// ----- An eye in every password field: tap it to see what you typed -----
const PW_EYE_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const PW_EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.7C3.6 8.5 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function addPasswordEyes(root) {
  for (const input of root.querySelectorAll('input[type=password]')) {
    if (input.dataset.eye) continue;
    input.dataset.eye = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    const show = shown => {
      input.type = shown ? 'text' : 'password';
      btn.innerHTML = shown ? PW_EYE_OFF : PW_EYE_ON;
      btn.setAttribute('aria-label', t(shown ? 'Hide password' : 'Show password'));
    };
    btn.onclick = () => show(input.type === 'password');
    show(false);
    input.replaceWith(wrap);
    wrap.append(input, btn);
  }
}
addPasswordEyes(document);
new MutationObserver(list => {
  for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) addPasswordEyes(n);
}).observe(document.body, { childList: true, subtree: true });

// Date fields with our own month grid. The browser's date picker speaks the
// phone's language, not the app's (Bob: an Italian calendar with English set),
// so every <input type="date"> becomes a button + a grid drawn in LOCALE. The
// input itself stays (hidden) with its id, ISO value, min/max and 'change'
// event, so the code around it reads and sets it just like before.
const INPUT_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const INPUT_DISABLED = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'disabled');
const isoOfDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function dateField(input, { clearable = false } = {}) {
  const wrap = document.createElement('span');
  wrap.className = 'date-field';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'date-btn';
  const grid = document.createElement('div');
  grid.className = 'date-cal';
  grid.hidden = true;
  if (input.parentNode) input.replaceWith(wrap);
  input.type = 'hidden';
  wrap.append(input, btn, grid);
  // The label opens the grid now (it pointed at the input, which is hidden).
  const label = input.id && document.querySelector(`label[for="${input.id}"]`);
  if (label) { btn.id = `${input.id}-pick`; label.htmlFor = btn.id; }

  const day = iso => new Date(`${iso}T12:00:00`);
  const show = () => {
    const v = INPUT_VALUE.get.call(input);
    btn.textContent = v ? day(v).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  };
  // Code that sets .value or .disabled updates the button too.
  Object.defineProperty(input, 'value', { get: () => INPUT_VALUE.get.call(input), set: v => { INPUT_VALUE.set.call(input, v); show(); } });
  Object.defineProperty(input, 'disabled', { get: () => INPUT_DISABLED.get.call(input), set: v => { INPUT_DISABLED.set.call(input, v); btn.disabled = !!v; if (v) grid.hidden = true; } });
  btn.disabled = input.disabled;

  const pick = v => {
    input.value = v;
    grid.hidden = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let month;
  const draw = () => {
    const min = input.getAttribute('min') || '';
    const max = input.getAttribute('max') || '';
    grid.replaceChildren();
    const head = document.createElement('div');
    head.className = 'date-cal-h';
    const prev = text('button', '‹', 'small');
    prev.type = 'button';
    prev.setAttribute('aria-label', t('Previous month'));
    prev.disabled = !!min && isoOfDate(month) <= min;
    prev.onclick = () => { month.setMonth(month.getMonth() - 1); draw(); };
    const next = text('button', '›', 'small');
    next.type = 'button';
    next.setAttribute('aria-label', t('Next month'));
    next.disabled = !!max && isoOfDate(new Date(month.getFullYear(), month.getMonth() + 1, 1)) > max;
    next.onclick = () => { month.setMonth(month.getMonth() + 1); draw(); };
    head.append(prev, text('b', month.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })), next);
    const days = document.createElement('div');
    days.className = 'date-cal-d';
    // Weeks start on Monday (all four languages); 1 Jan 2024 was a Monday.
    for (let i = 0; i < 7; i++) days.append(text('small', new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, { weekday: 'narrow' })));
    for (let i = 0; i < (month.getDay() + 6) % 7; i++) days.append(document.createElement('span'));
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const today = isoOfDate(new Date());
    for (let d = 1; d <= last; d++) {
      const iso = isoOfDate(new Date(month.getFullYear(), month.getMonth(), d));
      const b = text('button', String(d), [iso === input.value && 'on', iso === today && 'today'].filter(Boolean).join(' '));
      b.type = 'button';
      b.disabled = (!!min && iso < min) || (!!max && iso > max);
      b.onclick = () => pick(iso);
      days.append(b);
    }
    grid.append(head, days);
    if (clearable && input.value) {
      const clear = text('button', 'Clear', 'link');
      clear.type = 'button';
      clear.onclick = () => pick('');
      grid.append(clear);
    }
  };
  btn.onclick = () => {
    grid.hidden = !grid.hidden;
    if (grid.hidden) return;
    month = day(input.value || input.getAttribute('max') || isoOfDate(new Date()));
    month.setDate(1);
    draw();
    // Keep it on screen: a field at the right edge opens its grid leftwards.
    grid.classList.remove('left');
    if (grid.getBoundingClientRect().right > window.innerWidth - 8) grid.classList.add('left');
    grid.scrollIntoView({ block: 'nearest' }); // inside a scrolling window, show all of it
  };
  // Closes on a tap elsewhere (composedPath: the month arrows redraw the grid).
  document.addEventListener('click', e => { if (!grid.hidden && !e.composedPath().includes(wrap)) grid.hidden = true; });
  show();
  return wrap;
}
for (const i of document.querySelectorAll('input[type=date]')) dateField(i);
