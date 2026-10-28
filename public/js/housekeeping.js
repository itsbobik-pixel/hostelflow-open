// HostelFlow — Housekeeping: beds, linen, (parked) map editor, linen settings.
// Plain scripts loaded in order by index.html; they share globals.

// ===== Housekeeping =====
//
// The map is drawn on a grid of square cells; everything snaps to it, so a
// map put together on a phone still looks tidy. A bunk bed is one piece of
// furniture split into its levels (▼ bottom, ● middle, ▲ top).

const HK_SIZES = {
  room: [8, 6], other: [4, 4], single: [2, 4], bunk: [2, 4], triple: [2, 4], double: [3, 4],
};
const HK_LEVELS = { single: 1, double: 1, bunk: 2, triple: 3 };
const DAY_MS = 86400000;
let hk = null;          // from the server
let hkEdit = null;      // working copy while the owner edits the map
let hkSel = null;       // view: bed id; edit: { type: 'room' | 'frame', id }
const hkBase = () => `/api/properties/${state.property.id}`;

async function loadHousekeeping() {
  if (!state.property || !fullApp()) return; // not in check-in-only plans
  try {
    hk = await api('GET', `${hkBase()}/housekeeping`);
  } catch (err) {
    if (err.status === 401) return show('view-login');
    return toast(err.message);
  }
  renderHousekeeping();
  renderHkTasks();
}

function hkBeds(data = hk) {
  return data.frames.flatMap(f => f.beds.map(b => ({ ...b, frame: f })));
}

// Daily sheets (only when the property tracks them, Settings → Housekeeping).
const sheetsOn = () => !!(hk.sheets && hk.sheets.track);
const sheetsDirty = b => sheetsOn() && !!b.sheets && b.sheets.state === 'dirty';
// In use, unchanged, for the property's number of days (as src/housekeeping.js sheetsDue).
const sheetsDueNow = b => sheetsOn() && !!hk.sheets.days && !!b.sheets && b.sheets.state === 'in_use'
  && hk.now - b.sheets.at >= hk.sheets.days * DAY_MS - DAY_MS / 2;
const SHEETS_LABEL = { clean: 'Clean', dirty: 'Dirty', in_use: 'In use' };

// ok | due (within 3 days of the limit) | dirty (sheets to change, or linen past its date)
// | use (sheets in use) | none (no record yet). Clean sheets make a bed 'ok'.
function bedState(b) {
  if (sheetsDirty(b) || sheetsDueNow(b)) return 'dirty';
  const sheets = sheetsOn() && b.sheets ? b.sheets.state : '';
  let any = false;
  for (const item of hk.linen) {
    const l = b.linen[item.key];
    if (!l) continue;
    any = true;
    const age = linenAgeMs(l);
    if (age >= item.days * DAY_MS) return 'dirty';
  }
  // No amber "Linen soon" for the whole bed (Bob, 22. 10.): it stays as it is
  // until a change is really due; the bed's card says "next change in N days".
  if (sheets === 'in_use') return 'use';
  return any || sheets === 'clean' ? 'ok' : 'none';
}

function levelName(kind, level) {
  if (HK_LEVELS[kind] < 2) return '';
  if (level === 0) return t('bottom');
  return kind === 'triple' && level === 1 ? t('middle') : t('top');
}

function roomOf(frame, rooms) {
  if (frame.roomId) return rooms.find(r => r.id === frame.roomId) || null;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return rooms.find(r => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) || null;
}

// Linen already changed today: ticking it again changes nothing, so the tick is done.
const changedToday = l => !!l && new Date(l.at).toDateString() === new Date(hk.now).toDateString();
// Calendar days, not 24-hour stretches: yesterday evening is "1 day ago".
const daysSince = ms => {
  const day = x => { const d = new Date(x); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return Math.max(0, Math.round((day(hk.now) - day(ms)) / DAY_MS));
};
// How old a piece of linen counts as (the server's age: only the In use time
// when Settings says so), and in days for "change in N days".
const linenAgeMs = l => (l.age !== undefined ? l.age : hk.now - l.at);
const inUseCount = () => sheetsOn() && !!hk.sheets.linenInUse;
const linenDays = l => (inUseCount() ? Math.floor(linenAgeMs(l) / DAY_MS) : daysSince(l.at));
function daysAgo(ms) {
  const d = daysSince(ms);
  return d === 0 ? t('today') : t(d === 1 ? '1 day ago' : '{n} days ago', { n: d });
}

const SHOW_MAP = false; // the map is parked for now; beds are set up in Settings → Property

function renderHousekeeping() {
  if (!SHOW_MAP) hkEdit = null;
  const editing = !!hkEdit;
  const data = hkEdit || hk;
  $('hk-undo').disabled = !hkUndo.length;
  const owner = hk.role === 'owner';
  $('hk-edit').hidden = editing || !owner;
  $('hk-layout').classList.toggle('editing', editing);
  $('hk-pconly').hidden = editing || !owner;
  $('hk-tools').hidden = !editing;
  $('hk-legend').hidden = true;

  const beds = hkBeds(hk);
  const dirty = beds.filter(sheetsDirty).length;
  const sheetsDue = beds.filter(sheetsDueNow).length;
  const overdue = beds.filter(b => !sheetsDirty(b) && !sheetsDueNow(b) && bedState(b) === 'dirty').length;
  $('hk-hint').textContent = editing
    ? t('Drag the rooms into place, tap one to rename, copy or remove it. Add the beds of each room in the list below.') : '';
  $('hk-summary').textContent = !hk.frames.length ? '' : [
      t(beds.length === 1 ? '1 bed' : '{n} beds', { n: beds.length }),
      dirty ? t('{n} to make up', { n: dirty }) : '',
      sheetsDue ? t('{n} with sheets to change', { n: sheetsDue }) : '',
      overdue ? t('{n} with linen to change', { n: overdue }) : '',
    ].filter(Boolean).join(' · ');

  const empty = !data.rooms.length;
  $('hk-empty').hidden = !empty || editing;
  $('hk-empty').textContent = t(owner
    ? 'Draw your property from above — rooms, bathrooms, kitchen — then list the beds of each room below. Tap "Edit map" to start.'
    : 'The map is not drawn yet — ask the owner to draw it.');
  $('hk-map-card').hidden = !SHOW_MAP;
  $('hk-panel').hidden = !SHOW_MAP;
  $('hk-layout').classList.toggle('solo', !SHOW_MAP);
  if (SHOW_MAP) { renderMap(data, editing); renderHkPanel(); }
  renderBedList(editing);
}

// ----- List of beds -----

let hkFilter = null; // chosen on first render

// While the map is edited, the list says where beds are added now.
function renderBedEditor() {
  $('hk-list-card').hidden = false;
  $('hk-filter').replaceChildren();
  const box = $('hk-list');
  box.replaceChildren();
  const go = text('button', 'Open Settings → Property', 'link');
  go.type = 'button';
  go.onclick = () => { hkEdit = null; openSection('sec-property'); };
  box.append(text('p', 'Rooms and their beds are added in Settings → Property. Here you only place the rooms on the map.', 'muted'), go);
}

// Beds as coloured tiles, room by room. Tapping one opens a small pop-up with
// its linen (the items the property chose in Settings), when each was last
// changed, and the buttons.
const BED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M3 15h18M3 18v2M21 18v2"/><rect x="5.5" y="10.5" width="5" height="3" rx="1"/></svg>';
let bedPopId = null;
let bedEditing = false; // the bed's window shows dates to correct (Edit)
let sheetsDateEdit = null; // the bed whose sheets' day is being corrected (Edit next to Sheets)

// ok | due | over | none, for one linen item of one bed.
function linenState(b, item) {
  const l = b.linen[item.key];
  if (!l) return 'none';
  const age = linenAgeMs(l);
  if (age >= item.days * DAY_MS) return 'over';
  if (age >= (item.days - 3) * DAY_MS) return 'due';
  return 'ok';
}

function renderBedList(editing) {
  if (editing) return renderBedEditor();
  const card = $('hk-list-card');
  card.hidden = false;
  const beds = hkBeds(hk);
  const box = $('hk-list');
  box.replaceChildren();
  if (!beds.length) {
    $('hk-filter').replaceChildren();
    box.append(text('p', hk.role === 'owner' ? 'No beds yet. Add your rooms and their beds in Settings → Property.' : 'No beds yet — the owner adds them in Settings.', 'muted'));
    if (hk.role === 'owner') {
      const go = text('button', 'Open Settings → Property', 'link');
      go.type = 'button';
      go.onclick = () => openSection('sec-property');
      box.append(go);
    }
    return;
  }
  const todo = b => sheetsDirty(b) || sheetsDueNow(b);
  const linenDue = b => !todo(b) && bedState(b) === 'dirty';
  const work = b => todo(b) || linenDue(b);
  if (hkFilter === null) hkFilter = innerWidth < 700 && beds.some(work) ? 'work' : 'all';
  if (!['work', 'all'].includes(hkFilter)) hkFilter = 'all';
  // One switch: everything, or only the beds that need something.
  const only = document.createElement('label');
  only.className = 'hk-only';
  const box2 = document.createElement('input');
  box2.type = 'checkbox';
  box2.checked = hkFilter === 'work';
  box2.onchange = () => { hkFilter = box2.checked ? 'work' : 'all'; closeBedPop(); renderBedList(false); };
  only.append(box2, text('span', 'Show only beds that need something'));
  $('hk-filter').replaceChildren(only);
  const shown = beds.filter(b => hkFilter === 'all' || work(b));
  if (!shown.length) {
    const done = text('div', '', 'all-done');
    done.append(text('span', '✨', 'big'), t('All beds are fine.'));
    box.append(done);
    return;
  }

  // Grouped by room, in the order the rooms were set up.
  const groups = new Map();
  for (const b of shown) {
    const room = roomOf(b.frame, hk.rooms);
    const key = room ? room.id : '';
    if (!groups.has(key)) groups.set(key, { room, beds: [] });
    groups.get(key).beds.push(b);
  }
  const order = [...groups.values()].sort((a, b) => (a.room ? hk.rooms.indexOf(a.room) : 1e9) - (b.room ? hk.rooms.indexOf(b.room) : 1e9));
  for (const g of order) {
    const sec = document.createElement('section');
    sec.className = 'bed-room';
    const head = document.createElement('div');
    head.className = 'bed-room-h';
    head.append(text('span', g.room ? g.room.name : t('Other')));
    sec.append(head);
    const grid = document.createElement('div');
    grid.className = 'bed-grid';
    g.beds.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    for (const b of g.beds) {
      const st = bedState(b);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `bed-tile st-${st}` + (bedPopId === b.id ? ' open' : '') + (flashBed === b.id ? ' flash' : '');
      tile.dataset.bed = b.id;
      tile.innerHTML = BED_ICON;
      tile.append(text('b', b.label));
      const level = levelName(b.frame.kind, b.level);
      if (level) tile.append(text('small', level));
      // One dot per linen item: green fine, amber soon, red change it, grey no record.
      if (hk.linen.length) {
        const dots = document.createElement('span');
        dots.className = 'dots';
        for (const item of hk.linen) {
          const d = document.createElement('i');
          d.className = `ln-${linenState(b, item)}`;
          dots.append(d);
        }
        tile.append(dots);
      }
      // A reminder on the bed itself when its sheets have been in use too long
      // (dirty sheets need no words: the red tile says it, see the legend).
      const flag = sheetsDueNow(b) ? 'Change sheets' : '';
      if (flag) tile.append(text('small', flag, 'sh-flag'));
      const said = flag || (sheetsDirty(b) ? 'Dirty sheets' : { dirty: 'Change linen', ok: 'Clean', use: 'In use', none: 'No record yet' }[st]);
      tile.setAttribute('aria-label', `${t('Bed {n}', { n: b.label })}: ${t(said)}`);
      tile.onclick = e => { e.stopPropagation(); bedPopId === b.id ? closeBedPop() : openBedPop(b.id); };
      grid.append(tile);
    }
    sec.append(grid);
    box.append(sec);
  }
  box.append(bedLegend());
  if (bedPopId) openBedPop(bedPopId); // keep it open (and up to date) after a change
}

// A small key under the beds: what each colour means (only the ones in use here).
function bedLegend() {
  const keys = [['ok', 'Clean']];
  if (sheetsOn()) keys.push(['use', 'In use'], ['dirty', 'Dirty']);
  if (!sheetsOn() && hk.linen.length) keys.push(['dirty', 'Change linen']);
  keys.push(['none', 'No record yet']);
  const leg = document.createElement('div');
  leg.className = 'bed-legend';
  for (const [st, label] of keys) {
    const k = text('span', label);
    const sw = document.createElement('i');
    sw.className = `st-${st}`;
    k.prepend(sw);
    leg.append(k);
  }
  return leg;
}

function closeBedPop() {
  bedPopId = null;
  sheetsDateEdit = null;
  bedEditing = false;
  $('bed-pop').hidden = true;
  document.querySelectorAll('.bed-tile.open').forEach(t => t.classList.remove('open'));
}

function openBedPop(bedId) {
  const bed = hkBeds().find(b => b.id === bedId);
  const tile = document.querySelector(`.bed-tile[data-bed="${CSS.escape(bedId)}"]`);
  if (!bed || !tile) return closeBedPop();
  bedPopId = bedId;
  document.querySelectorAll('.bed-tile.open').forEach(t => t.classList.remove('open'));
  tile.classList.add('open');
  const pop = $('bed-pop');
  pop.replaceChildren();

  const head = document.createElement('div');
  head.className = 'bp-head';
  const title = document.createElement('div');
  title.append(text('b', t('Bed {n}', { n: bed.label })));
  const room = roomOf(bed.frame, hk.rooms);
  title.append(text('span', [room && room.name, levelName(bed.frame.kind, bed.level)].filter(Boolean).join(' · '), 'muted'));
  const close = text('button', '×', 'bp-x');
  close.type = 'button';
  close.setAttribute('aria-label', t('Close'));
  close.onclick = closeBedPop;
  head.append(title, close);
  pop.append(head);

  if (sheetsOn() && !bedEditing) {
    if (sheetsDueNow(bed)) pop.append(text('div', t('The same sheets have been in use for {n} days — time to change them.', { n: Math.floor((hk.now - bed.sheets.at) / DAY_MS) }), 'bp-note'));
    pop.append(sheetsRow(bed));
  }

  if (!hk.linen.length) {
    // The owner sets it up; the others are only told it isn't set.
    pop.append(text('p', hk.role === 'owner' ? 'Which linen do you track (pillow protector, mattress protector…) and how often?' : 'The owner hasn\'t chosen which linen to track yet (pillow protector, mattress protector…).', 'muted bp-hint'));
    if (hk.role === 'owner') {
      const go = text('button', 'Add it in Settings', 'link');
      go.type = 'button';
      go.onclick = () => { closeBedPop(); openSection('sec-linen'); };
      pop.append(go);
    }
  }
  const isoDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  if (bedEditing && hk.linen.length) {
    // Edit: the day each item was really changed last, to correct by hand.
    pop.append(text('p', 'When was each item last changed? Fix the dates and save. Leave it empty if it was never changed.', 'muted bp-edit-help'));
    const form = document.createElement('div');
    form.className = 'bp-edit';
    for (const item of hk.linen) {
      const l = bed.linen[item.key];
      const lab = document.createElement('div');
      lab.className = 'bp-edit-row';
      const input = document.createElement('input');
      input.max = isoDay(Date.now());
      input.value = l ? isoDay(l.at) : '';
      input.dataset.key = item.key;
      input.dataset.was = input.value;
      lab.append(text('span', t(item.label)), dateField(input, { clearable: true }));
      form.append(lab);
    }
    pop.append(form);
    const acts = document.createElement('div');
    acts.className = 'bp-acts';
    const cancel = text('button', 'Cancel', 'small');
    cancel.type = 'button';
    cancel.onclick = () => { bedEditing = false; openBedPop(bed.id); };
    const save = text('button', 'Save', 'small primary');
    save.type = 'button';
    save.onclick = async () => {
      const set = {};
      for (const i of form.querySelectorAll('input')) if (i.value !== i.dataset.was) set[i.dataset.key] = i.value || null;
      bedEditing = false;
      if (Object.keys(set).length) await bedDo(bed.id, { set });
      else openBedPop(bed.id);
    };
    acts.append(cancel, save);
    pop.append(acts);
    placeBedPop(pop, tile);
    return;
  }
  for (const item of hk.linen) {
    const l = bed.linen[item.key];
    const row = document.createElement('div');
    row.className = `bp-item ln-${linenState(bed, item)}`;
    const info = document.createElement('span');
    info.className = 'grow';
    // The name, and under it only when it is next due (or how late).
    const name = text('b', t(item.label));
    const when = text('span', l ? '' : t('not recorded yet'), 'when');
    if (l) {
      const left = item.days - linenDays(l);
      const next = left > 1 ? t('next change in {n} days', { n: left }) : left === 1 ? t('next change tomorrow')
        : left === 0 ? t('due today') : t(left === -1 ? '1 day late' : '{n} days late', { n: -left });
      when.append(text('span', next, left <= 0 ? 'ln-late' : ''));
    }
    info.append(name, when);
    const done = changedToday(l);
    const btn = text('button', '✓', 'bp-tick' + (done ? ' done' : ''));
    btn.type = 'button';
    btn.disabled = done;
    btn.title = t(done ? 'Changed today' : 'Changed');
    btn.setAttribute('aria-label', `${t(item.label)}: ${btn.title}`);
    btn.onclick = () => bedDo(bed.id, { changed: [item.key] });
    row.append(text('i', '', 'dot'), info, btn);
    pop.append(row);
  }

  const acts = document.createElement('div');
  acts.className = 'bp-acts';
  if (hk.linen.length) {
    const editBtn = text('button', 'Edit', 'small');
    editBtn.type = 'button';
    editBtn.title = t('Fix last-changed dates');
    editBtn.onclick = () => { bedEditing = true; openBedPop(bed.id); };
    const all = text('button', 'Everything changed', 'small primary');
    all.type = 'button';
    all.disabled = hk.linen.every(i => changedToday(bed.linen[i.key])) && (!sheetsOn() || (!!bed.sheets && bed.sheets.state === 'clean'));
    // Everything includes the sheets: they're clean now.
    all.onclick = () => bedDo(bed.id, { ...(sheetsOn() ? { sheets: 'clean' } : {}), changed: hk.linen.map(i => i.key) });
    acts.append(editBtn, all);
  }
  if (acts.childElementCount) pop.append(acts);
  // Housekeeping only to look at (Settings → Team): the bed shows, nothing changes.
  if (!can('housekeeping')) pop.querySelectorAll('button:not(.close), input').forEach(el => { if (!el.closest('.bp-head')) el.disabled = true; });
  placeBedPop(pop, tile);
}

// "Sheets": three coloured cards — Clean, In use, Dirty — the one now is filled
// in; a tap sets another. Above them: since when, and Edit to correct
// the day by hand (e.g. the sheets went on yesterday and nobody tapped).
const hkDayIso = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function sheetsRow(bed) {
  const s = bed.sheets;
  const wrap = document.createElement('div');
  wrap.className = 'bp-sheets';
  const head = document.createElement('div');
  head.className = 'bp-sheets-h';
  head.append(text('b', 'Sheets'));
  head.append(text('span', s
    ? `${t(SHEETS_LABEL[s.state])} · ${new Date(s.at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })} · ${daysAgo(s.at)}`
    : t('not recorded yet'), 'muted'));
  if (s && sheetsDateEdit !== bed.id) {
    const edit = text('button', 'Edit', 'link bp-edit-link');
    edit.type = 'button';
    edit.onclick = () => { sheetsDateEdit = bed.id; openBedPop(bed.id); };
    head.append(edit);
  }
  wrap.append(head);
  if (s && sheetsDateEdit === bed.id) {
    const row = document.createElement('div');
    row.className = 'bp-edit-row bp-sheets-date';
    const input = document.createElement('input');
    input.max = hkDayIso(Date.now());
    input.value = hkDayIso(s.at);
    row.append(text('span', t('{state} since', { state: t(SHEETS_LABEL[s.state]) })), dateField(input));
    const acts = document.createElement('div');
    acts.className = 'bp-acts';
    const cancel = text('button', 'Cancel', 'small');
    cancel.type = 'button';
    cancel.onclick = () => { sheetsDateEdit = null; openBedPop(bed.id); };
    const save = text('button', 'Save', 'small primary');
    save.type = 'button';
    save.onclick = () => {
      sheetsDateEdit = null;
      if (input.value && input.value !== hkDayIso(s.at)) bedDo(bed.id, { sheetsDay: input.value });
      else openBedPop(bed.id);
    };
    acts.append(cancel, save);
    wrap.append(row, acts);
    return wrap;
  }
  const cards = document.createElement('div');
  cards.className = 'sh-cards';
  cards.setAttribute('role', 'group');
  cards.setAttribute('aria-label', t('Sheets'));
  for (const [state, st] of [['clean', 'ok'], ['in_use', 'use'], ['dirty', 'dirty']]) {
    const on = !!s && s.state === state;
    const b = text('button', SHEETS_LABEL[state], `sh-card st-${st}${on ? ' on' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => { if (!on) bedDo(bed.id, { sheets: state }); };
    cards.append(b);
  }
  wrap.append(cards);
  return wrap;
}

// Under the tile, kept inside the screen; the little arrow points at the tile.
function placeBedPop(pop, tile) {
  pop.hidden = false;
  const r = tile.getBoundingClientRect();
  const w = Math.min(320, innerWidth - 24);
  pop.style.width = `${w}px`;
  const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${r.bottom + scrollY + 10}px`;
  pop.style.setProperty('--arrow', `${r.left + r.width / 2 - left}px`);
  // A bed low on the page: scroll so the whole window (and its buttons) is on screen.
  const over = pop.getBoundingClientRect().bottom - innerHeight + 12;
  if (over > 0) scrollBy({ top: Math.min(over, Math.max(0, r.top - 12)), behavior: 'smooth' });
}
document.addEventListener('click', e => {
  // A button the window just redrew is no longer on the page: not a click outside.
  if (bedPopId && e.target.isConnected && !e.target.closest('#bed-pop, .bed-tile')) closeBedPop();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && bedPopId) closeBedPop(); });
window.addEventListener('resize', () => { if (bedPopId) openBedPop(bedPopId); });

// ----- The map -----

// Phones get 20 columns across; a computer screen gets ~28 px cells, so more room to draw.
function mapGeometry(data, editing) {
  const items = data.rooms;
  const width = ($('hk-map-wrap').clientWidth || 340) - 28;
  const cols = Math.min(60, Math.max(width >= 600 ? Math.floor(width / 28) : 20, ...items.map(i => i.x + i.w)));
  const u = Math.max(10, Math.min(32, Math.floor(width / cols)));
  const rows = Math.max(editing ? Math.ceil(420 / u) : 1, ...items.map(i => i.y + i.h + (editing ? 4 : 0)));
  return { cols, rows, u };
}

function place(el, o, u) {
  el.style.left = `${o.x * u}px`;
  el.style.top = `${o.y * u}px`;
  el.style.width = `${o.w * u}px`;
  el.style.height = `${o.h * u}px`;
}

function renderMap(data, editing) {
  const map = $('hk-map');
  map.replaceChildren();
  const { cols, rows, u } = mapGeometry(data, editing);
  map.classList.toggle('editing', editing);
  map.style.width = `${cols * u}px`;
  map.style.height = `${rows * u}px`;
  map.style.setProperty('--u', `${u}px`);
  map.hidden = !data.rooms.length && !editing;

  for (const r of data.rooms) {
    const el = document.createElement('div');
    el.className = `hk-room ${r.kind}` + (editing && hkSel && hkSel.id === r.id ? ' sel' : '');
    el.dataset.id = r.id;
    place(el, r, u);
    el.append(text('span', r.name, 'hk-rname'));
    if (!editing && r.kind === 'room') {
      const beds = hkBeds(data).filter(b => roomOf(b.frame, data.rooms) === r);
      if (beds.length) {
        const sum = document.createElement('span');
        sum.className = 'hk-rsum';
        for (const b of beds) {
          const dot = document.createElement('i');
          dot.className = `hk-bed st-${bedState(b)}`;
          sum.append(dot);
        }
        sum.append(text('span', t(beds.length === 1 ? '1 bed' : '{n} beds', { n: beds.length })));
        el.append(sum);
      }
      el.onclick = () => {
        const g = $(`hk-g-${r.id}`);
        if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }
    if (editing) {
      el.onpointerdown = e => startDrag(e, 'room', r, u);
      if (hkSel && hkSel.id === r.id) {
        const grip = document.createElement('span');
        grip.className = 'hk-grip';
        grip.onpointerdown = e => { e.stopPropagation(); startDrag(e, 'resize', r, u); };
        el.append(grip);
      }
    }
    map.append(el);
  }

}

// Drag to move (a room takes the beds inside it along), or resize a room by its corner.
function startDrag(e, kind, obj, u) {
  if (e.button > 0) return;
  e.preventDefault();
  const map = $('hk-map');
  const start = { x: e.clientX, y: e.clientY, ox: obj.x, oy: obj.y, ow: obj.w, oh: obj.h };
  const carried = kind === 'room'
    ? hkEdit.frames.filter(f => roomOf(f, [obj]) === obj).map(f => ({ f, ox: f.x, oy: f.y }))
    : [];
  let moved = false;
  const el = id => map.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const onMove = ev => {
    const dx = Math.round((ev.clientX - start.x) / u);
    const dy = Math.round((ev.clientY - start.y) / u);
    if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 4) return;
    if (!moved) snapshot();
    moved = true;
    if (kind === 'resize') {
      obj.w = Math.max(2, Math.min(60, start.ow + dx));
      obj.h = Math.max(2, start.oh + dy);
    } else {
      const mx = Math.max(-start.ox, Math.min(60 - start.ox - obj.w, dx));
      const my = Math.max(-start.oy, dy);
      obj.x = start.ox + mx;
      obj.y = start.oy + my;
      for (const c of carried) {
        c.f.x = Math.max(0, c.ox + mx);
        c.f.y = Math.max(0, c.oy + my);
        place(el(c.f.id), c.f, u);
      }
    }
    place(el(obj.id), obj, u);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!moved && kind !== 'resize') hkSel = { type: kind, id: obj.id };
    renderHousekeeping();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// ----- Editing -----

let hkUndo = [];
function snapshot() {
  hkUndo.push(JSON.stringify(hkEdit));
  if (hkUndo.length > 100) hkUndo.shift();
  $('hk-undo').disabled = false;
}
function undo() {
  if (!hkUndo.length) return;
  hkEdit = JSON.parse(hkUndo.pop());
  if (hkSel && !findSel()) hkSel = null;
  renderHousekeeping();
}
function findSel() {
  if (!hkSel || !hkEdit) return null;
  return hkSel.type === 'room' ? hkEdit.rooms.find(r => r.id === hkSel.id) : hkEdit.frames.find(f => f.id === hkSel.id);
}
const newId = () => `new-${Math.random().toString(36).slice(2)}`;

// Beds standing inside a room move (and get copied) with it.
function bedsIn(room) {
  return hkEdit.frames.filter(f => roomOf(f, [room]) === room);
}

function nudge(dx, dy) {
  const sel = findSel();
  if (!sel) return;
  const mx = Math.max(-sel.x, Math.min(60 - sel.x - sel.w, dx));
  const my = Math.max(-sel.y, dy);
  if (!mx && !my) return;
  snapshot();
  const carried = hkSel.type === 'room' ? bedsIn(sel) : [];
  sel.x += mx;
  sel.y += my;
  for (const f of carried) { f.x = Math.max(0, f.x + mx); f.y = Math.max(0, f.y + my); }
  renderHousekeeping();
}

function rotateSel() {
  const sel = findSel();
  if (!sel) return;
  snapshot();
  [sel.w, sel.h] = [sel.h, sel.w];
  renderHousekeeping();
}

function removeSel() {
  const sel = findSel();
  if (!sel) return;
  if (hkSel.type === 'room' && bedsIn(sel).length && !confirm(t('Remove this room and its {n} beds?', { n: hkBeds({ frames: bedsIn(sel) }).length }))) return;
  snapshot();
  if (hkSel.type === 'room') {
    const gone = new Set(bedsIn(sel));
    hkEdit.frames = hkEdit.frames.filter(f => !gone.has(f));
    hkEdit.rooms = hkEdit.rooms.filter(r => r !== sel);
  }
  else hkEdit.frames = hkEdit.frames.filter(f => f !== sel);
  hkSel = null;
  renderHousekeeping();
}

const nextName = name => (/\d+$/.test(name) ? name.replace(/\d+$/, n => String(Number(n) + 1)) : `${name} 2`);

function copyFrame(f, x, y, roomId = f.roomId) {
  const first = Number(nextBedLabel(roomId ? hkEdit.rooms.find(r => r.id === roomId) : roomOf({ x, y, w: f.w, h: f.h }, hkEdit.rooms)));
  const copy = { id: newId(), kind: f.kind, roomId, x, y, w: f.w, h: f.h, beds: f.beds.map((b, level) => ({ id: newId(), level, label: String(first + level) })) };
  hkEdit.frames.push(copy);
  return copy;
}

// A copy right next to the original (a whole dorm with its bunks, or one bunk), renumbered.
function duplicateSel() {
  const sel = findSel();
  if (!sel) return;
  snapshot();
  if (hkSel.type === 'room') {
    const right = { x: sel.x + sel.w, y: sel.y, w: sel.w, h: sel.h };
    const spot = right.x + right.w <= 60 && !overlaps(right, hkEdit.rooms.filter(r => r !== sel)) ? right : { ...belowAll(), w: sel.w, h: sel.h };
    const room = { id: newId(), name: nextName(sel.name), kind: sel.kind, ...spot };
    const beds = bedsIn(sel);
    hkEdit.rooms.push(room);
    for (const f of beds) copyFrame(f, f.x - sel.x + room.x, f.y - sel.y + room.y, room.id);
    hkSel = { type: 'room', id: room.id };
  } else {
    const room = roomOf(sel, hkEdit.rooms);
    const beside = { x: sel.x + sel.w + 1, y: sel.y, w: sel.w, h: sel.h };
    const fits = !overlaps(beside, hkEdit.frames) && (!room || beside.x + beside.w <= room.x + room.w);
    const spot = fits ? beside : (room && freeSpot(sel.w, sel.h, hkEdit.frames, room, true)) || belowAll();
    hkSel = { type: 'frame', id: copyFrame(sel, spot.x, spot.y).id };
  }
  renderHousekeeping();
}

document.addEventListener('keydown', e => {
  if (!hkEdit || $('tab-housekeeping').hidden || $('view-app').hidden) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (mod && key === 'z') { e.preventDefault(); undo(); }
  else if (mod && key === 'd') { e.preventDefault(); duplicateSel(); }
  else if (arrows[key] && hkSel) { e.preventDefault(); nudge(...arrows[key]); }
  else if (key === 'r' && !mod && hkSel) rotateSel();
  else if ((key === 'delete' || key === 'backspace') && hkSel) { e.preventDefault(); removeSel(); }
  else if (key === 'escape' && hkSel) { hkSel = null; renderHousekeeping(); }
});

// Every room counts its beds from 1; beds outside any room count together.
function nextBedLabel(room) {
  const nums = hkEdit.frames.filter(f => roomOf(f, hkEdit.rooms) === (room || null)).flatMap(f => f.beds)
    .map(b => parseInt(b.label, 10)).filter(n => !Number.isNaN(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

// Before saving: a bed moved into another room may share a number there —
// it gets the next free one of that room.
function fixBedNumbers(draft) {
  const used = new Map(); // room id -> numbers taken
  for (const f of draft.frames) {
    const roomId = f.roomId || '';
    if (!used.has(roomId)) used.set(roomId, new Set());
    const taken = used.get(roomId);
    for (const b of f.beds) {
      const key = b.label.trim().toLowerCase();
      if (key && !taken.has(key)) { taken.add(key); continue; }
      let n = 1;
      while (taken.has(String(n))) n++;
      b.label = String(n);
      taken.add(b.label);
    }
  }
}

function overlaps(a, list) {
  return list.some(b => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
}

// First free spot inside `area`, left to right, top to bottom (null if full).
// Inside a room, beds keep one free cell from the walls and from each other.
function freeSpot(w, h, list, area, inRoom) {
  const pad = inRoom ? 1 : 0;
  for (let y = area.y + pad; y + h <= area.y + area.h - pad; y++) {
    for (let x = area.x + pad; x + w <= area.x + area.w - pad; x++) {
      const probe = inRoom ? { x: x - 1, y: y - 1, w: w + 2, h: h + 2 } : { x, y, w, h };
      if (!overlaps(probe, list)) return { x, y };
    }
  }
  return null;
}

// Below everything else on the map.
function belowAll() {
  return { x: 0, y: Math.max(0, ...[...hkEdit.rooms, ...hkEdit.frames].map(o => o.y + o.h + 1)) };
}

function addToMap(kind) {
  snapshot();
  const [w, h] = HK_SIZES[kind];
  const id = newId();
  if (kind === 'room' || kind === 'other') {
    const name = kind === 'room'
      ? t('Room {n}', { n: hkEdit.rooms.filter(r => r.kind === 'room').length + 1 })
      : t('Bathroom');
    hkEdit.rooms.push({ id, name, kind, w, h, ...(freeSpot(w, h, hkEdit.rooms, { x: 0, y: 0, w: 20, h: 400 }) || belowAll()) });
  } else {
    const selRoom = hkSel && hkSel.type === 'room' ? hkEdit.rooms.find(r => r.id === hkSel.id)
      : hkSel && hkSel.type === 'frame' ? roomOf(hkEdit.frames.find(f => f.id === hkSel.id), hkEdit.rooms) : null;
    // The selected room first, then the other rooms, else below the map.
    const rooms = [selRoom, ...hkEdit.rooms.filter(r => r.kind === 'room' && r !== selRoom)].filter(Boolean);
    let spot = null;
    let into = null;
    for (const r of rooms) if (!spot) { spot = freeSpot(w, h, hkEdit.frames, r, true); if (spot) into = r; }
    const first = Number(nextBedLabel(into));
    const beds = Array.from({ length: HK_LEVELS[kind] }, (_, level) => ({
      id: newId(), level, label: String(first + level),
    }));
    hkEdit.frames.push({ id, kind, w, h, beds, ...(spot || belowAll()) });
  }
  hkSel = { type: kind === 'room' || kind === 'other' ? 'room' : 'frame', id };
  renderHousekeeping();
}

function renderHkPanel() {
  const box = $('hk-panel');
  box.replaceChildren();
  box.classList.add('empty');
  const close = text('button', '×', 'hk-close');
  close.type = 'button';
  close.setAttribute('aria-label', t('Close'));
  close.onclick = () => { hkSel = null; renderHousekeeping(); };
  box.append(close);
  if (hkEdit) return renderEditPanel(box);
  const bed = hkSel && hkBeds().find(b => b.id === hkSel);
  if (!bed) {
    if (hk.frames.length) box.append(text('p', 'Click a bed to see its linen and mark it.', 'muted'));
    return;
  }
  box.classList.remove('empty');

  const head = document.createElement('div');
  head.className = 'top';
  const title = document.createElement('div');
  const room = roomOf(bed.frame, hk.rooms);
  const level = levelName(bed.frame.kind, bed.level);
  title.append(text('h2', t('Bed {n}', { n: bed.label })));
  title.lastChild.style.margin = '0';
  title.append(text('div', [room && room.name, level].filter(Boolean).join(' · '), 'muted'));
  const st = bedState(bed);
  const pillText = sheetsDueNow(bed) ? 'Change sheets' : sheetsDirty(bed) ? 'Dirty sheets' : { dirty: 'Change linen', ok: 'Clean', none: 'No record yet' }[st];
  head.append(title, text('span', pillText, `pill hk-pill st-${st}`));
  box.append(head);
  if (sheetsOn()) box.append(sheetsRow(bed));

  if (!hk.linen.length && !sheetsOn()) {
    const p = text('p', hk.role === 'owner' ? 'Which linen do you track (pillow protector, mattress protector…) and how often?' : 'The owner hasn\'t chosen which linen to track yet (pillow protector, mattress protector…).', 'muted');
    box.append(p);
    if (hk.role === 'owner') {
      const go = text('button', 'Add it in Settings', 'link');
      go.type = 'button';
      go.onclick = () => openSection('sec-linen');
      box.append(go);
    }
  }
  for (const item of hk.linen) {
    const l = bed.linen[item.key];
    const row = document.createElement('div');
    row.className = 'row';
    const info = document.createElement('div');
    info.className = 'grow';
    info.append(text('div', t(item.label)));
    const age = l ? linenAgeMs(l) : null;
    const over = l && age >= item.days * DAY_MS;
    const sub = text('div', l
      ? `${t('changed {when}', { when: daysAgo(l.at) })} · ${t('at most every {n} days', { n: item.days })}`
      : t('no record yet · at most every {n} days', { n: item.days }), 'muted');
    if (over) sub.style.color = 'var(--danger)';
    info.append(sub);
    const b = text('button', changedToday(l) ? 'Changed today' : 'Changed', 'small');
    b.type = 'button';
    b.disabled = changedToday(l);
    b.onclick = () => bedDo(bed.id, { changed: [item.key] });
    row.append(info, b);
    box.append(row);
  }

  const acts = document.createElement('div');
  acts.className = 'hk-acts';
  const all = text('button', 'Everything changed', 'primary');
  all.type = 'button';
  all.onclick = () => bedDo(bed.id, { ...(sheetsOn() ? { sheets: 'clean' } : {}), changed: hk.linen.map(i => i.key) });
  if (hk.linen.length) acts.append(all);
  box.append(acts);
}

let flashBed = null;
async function bedDo(bedId, body) {
  try {
    hk = await api('POST', `${hkBase()}/beds/${bedId}`, body);
    if (body.sheets === 'clean' || body.changed) flashBed = bedId;
    renderHousekeeping();
    flashBed = null;
  } catch (err) { toast(err.message); }
}

function renderEditPanel(box) {
  const sel = hkSel && (hkSel.type === 'room'
    ? hkEdit.rooms.find(r => r.id === hkSel.id)
    : hkEdit.frames.find(f => f.id === hkSel.id));
  if (!sel) {
    box.append(text('p', 'Add rooms with the buttons and drag them into place; click one to rename, copy or remove it. Beds go in the list under the map.', 'muted'));
    return;
  }
  box.classList.remove('empty');
  const remove = text('button', 'Remove', 'small danger');
  remove.type = 'button';
  remove.onclick = removeSel;
  const copy = text('button', 'Copy', 'small');
  copy.type = 'button';
  copy.title = 'Ctrl+D';
  copy.onclick = duplicateSel;

  if (hkSel.type === 'room') {
    box.append(text('label', 'Name'));
    const name = document.createElement('input');
    name.value = sel.name;
    name.maxLength = 40;
    name.onfocus = snapshot;
    name.oninput = () => { sel.name = name.value; const el = $('hk-map').querySelector(`[data-id="${CSS.escape(sel.id)}"] .hk-rname`); if (el) el.textContent = name.value; };
    box.append(name);

    const foot = document.createElement('div');
    foot.className = 'hk-acts';
    foot.append(text('span', 'Drag the corner to resize.', 'muted'), copy, remove);
    box.append(foot);
    return;
  }

  const names = { single: 'Single bed', bunk: 'Bunk bed', triple: 'Triple bunk', double: 'Double bed' };
  box.append(text('h2', names[sel.kind]));
  box.lastChild.style.margin = '0 0 4px';
  const grid = document.createElement('div');
  grid.className = 'grid';
  sel.beds.forEach((b, i) => {
    const wrap = document.createElement('div');
    const lab = text('label', HK_LEVELS[sel.kind] > 1
      ? t('Bed number — {level}', { level: levelName(sel.kind, i) })
      : t('Bed number'));
    const inp = document.createElement('input');
    inp.value = b.label;
    inp.maxLength = 10;
    inp.onfocus = snapshot;
    inp.oninput = () => { b.label = inp.value; };
    inp.onchange = () => renderHousekeeping();
    wrap.append(lab, inp);
    grid.append(wrap);
  });
  box.append(grid);
  const acts = document.createElement('div');
  acts.className = 'hk-acts';
  const turn = text('button', '⟳ Turn', 'small');
  turn.type = 'button';
  turn.title = 'R';
  turn.onclick = rotateSel;
  acts.append(turn, copy, remove);
  box.append(acts);
}

$('hk-edit').onclick = () => {
  hkEdit = JSON.parse(JSON.stringify({ rooms: hk.rooms, frames: hk.frames }));
  for (const f of hkEdit.frames) if (!f.roomId) f.roomId = (roomOf(f, hkEdit.rooms) || {}).id || null;
  hkSel = null;
  hkUndo = [];
  $('hk-undo').disabled = true;
  renderHousekeeping();
};
$('hk-undo').onclick = undo;
// Keyboard shortcuts, shown on computers only (CSS).
for (const [i, [keys, what]] of [['←↑→↓', 'move'], ['R', 'turn'], ['Del', 'remove'], ['Ctrl+D', 'copy'], ['Ctrl+Z', 'undo'], ['Esc', 'deselect']].entries()) {
  if (i) $('hk-keys').append(' · ');
  $('hk-keys').append(text('kbd', keys), ` ${t(what)}`);
}
$('hk-cancel').onclick = () => { hkEdit = null; hkSel = null; renderHousekeeping(); };
$('hk-save').onclick = async () => {
  const btn = $('hk-save');
  btn.disabled = true;
  fixBedNumbers(hkEdit);
  try {
    hk = await api('PUT', `${hkBase()}/housekeeping/map`, {
      rooms: hkEdit.rooms.map(({ id, name, kind, x, y, w, h }) => ({ id, name, kind, x, y, w, h })),
      frames: hkEdit.frames.map(({ id, kind, roomId, x, y, w, h, beds }) => ({ id, kind, roomId, x, y, w, h, beds: beds.map(({ id, label }) => ({ id, label })) })),
    });
    hkEdit = null;
    hkSel = null;
    renderHousekeeping();
    toast(t('Map saved.'));
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
};
document.querySelectorAll('#hk-tools [data-add]').forEach(b => { b.onclick = () => addToMap(b.dataset.add); });
window.addEventListener('resize', () => { if (hk && !$('tab-housekeeping').hidden) renderMap(hkEdit || hk, !!hkEdit); });

// ----- Daily sheets (Settings, owner) -----

function renderSheetsSettings(sheets) {
  const sh = sheets || { track: false, days: null, linenInUse: false };
  $('sh-track').checked = sh.track;
  $('sh-days').value = sh.days || '';
  $('sh-days-row').hidden = !sh.track;
  $('ln-inuse').checked = !!sh.linenInUse;
  inUseSwitchState();
}
// Counting only In use days needs the daily sheets (that's where a bed is In use).
function inUseSwitchState() {
  const on = $('sh-track').checked;
  $('ln-inuse').disabled = !on;
  if (!on) $('ln-inuse').checked = false;
  $('ln-inuse-row').classList.toggle('off', !on);
  $('ln-inuse-note').hidden = on;
}
$('sh-track').onchange = () => {
  $('sh-days-row').hidden = !$('sh-track').checked;
  if ($('sh-track').checked && !$('sh-days').value) $('sh-days').value = 3;
  inUseSwitchState();
};
function readSheetsSettings() {
  const days = $('sh-days').value.trim();
  return { track: $('sh-track').checked, days: days ? Number(days) : null, linenInUse: $('sh-track').checked && $('ln-inuse').checked };
}

// ----- Linen items (Settings, owner) -----

function renderLinenSettings(items) {
  const box = $('ln-items');
  box.replaceChildren();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'ln-row';
    const name = document.createElement('input');
    name.value = t(item.label);
    name.maxLength = 40;
    name.dataset.key = item.key || '';
    name.dataset.orig = item.label;
    name.setAttribute('aria-label', t('Name'));
    const days = document.createElement('input');
    days.type = 'number';
    days.min = 1;
    days.max = 365;
    days.value = item.days;
    days.setAttribute('aria-label', t('Days'));
    const del = text('button', '×', 'small');
    del.type = 'button';
    del.setAttribute('aria-label', t('Remove'));
    del.onclick = () => { row.remove(); renderLinenSuggestions(readLinenSettings()); };
    row.append(name, days, text('span', 'days', 'muted'), del);
    box.append(row);
  }
  renderLinenSuggestions(items);
}

// One-tap ideas; nothing is added until the owner picks it.
const LINEN_IDEAS = ['Pillow protector', 'Mattress protector', 'Blanket cover', 'Duvet cover', 'Sheets', 'Pillowcase', 'Towels'];
function renderLinenSuggestions(items) {
  const box = $('ln-ideas');
  box.replaceChildren();
  const have = new Set(items.map(i => i.label));
  for (const idea of LINEN_IDEAS.filter(i => !have.has(i))) {
    const c = text('button', `+ ${t(idea)}`, 'chip');
    c.type = 'button';
    c.onclick = () => renderLinenSettings([...readLinenSettings(), { label: idea, days: 30 }]);
    box.append(c);
  }
}
$('ln-add').onclick = () => {
  renderLinenSettings([...readLinenSettings(), { label: '', days: 30 }]);
  $('ln-items').lastChild.querySelector('input').focus();
};
function readLinenSettings() {
  return [...$('ln-items').querySelectorAll('.ln-row')].map(r => {
    const [name, days] = r.querySelectorAll('input');
    // An untouched default keeps its English name, so it stays translated.
    const label = name.dataset.orig && t(name.dataset.orig) === name.value ? name.dataset.orig : name.value;
    return { key: name.dataset.key || undefined, label, days: Number(days.value) };
  });
}
bindForm('form-linen', 'ln-err', async () => {
  renderSettings(await api('PUT', `/api/properties/${state.ownerPropertyId}/settings`, { sheets: readSheetsSettings(), linen: readLinenSettings() }));
  if (hk) loadHousekeeping(); // the beds show (or hide) their sheets right away
  const r = await api('PUT', `/api/properties/${state.ownerPropertyId}/housekeeping/tasks`, { tasks: readTaskSettings() });
  renderTaskSettings(r.tasks, tkRooms);
  if (hk) { hk.tasks = r.tasks; renderHkTasks(); }
  $('ln-err').className = 'ok';
  $('ln-err').textContent = t('Saved.');
});

// ===== Recurring tasks =====

// Due on the day its days are up (as src/housekeeping.js taskDue).
const taskIsDue = (task, now = Date.now()) => !task.doneAt || now - task.doneAt >= task.everyDays * DAY_MS - DAY_MS / 2;
const taskNext = task => (task.doneAt || 0) + task.everyDays * DAY_MS;
const tkUndo = new Map(); // task id -> when it was done before a tap here (for Undo)
let tkEdit = null;        // the task whose last-done day is being set by hand

function renderHkTasks() {
  const tasks = (hk && hk.tasks) || [];
  const owner = hk && hk.role === 'owner';
  $('hk-tasks-card').hidden = !tasks.length && !owner;
  const box = $('hk-tasks');
  box.replaceChildren();
  if (!tasks.length) {
    $('hk-tasks-sum').textContent = '';
    box.append(text('p', 'Things to do every few days — clean the fridge, wash the curtains… Add them in Settings → Housekeeping.', 'muted'));
    const go = text('button', 'Add recurring tasks', 'link');
    go.type = 'button';
    go.onclick = () => openSection('sec-linen');
    box.append(go);
    return;
  }
  const now = Date.now();
  const due = tasks.filter(x => taskIsDue(x, now));
  $('hk-tasks-sum').textContent = due.length ? t(due.length === 1 ? '1 due' : '{n} due', { n: due.length }) : t('All done for now');
  const order = [...due, ...tasks.filter(x => !taskIsDue(x, now)).sort((a, b) => taskNext(a) - taskNext(b))];
  for (const task of order) {
    const isDue = taskIsDue(task, now);
    const row = document.createElement('div');
    row.className = `hk-task${isDue ? ' due' : ''}`;
    const check = text('button', isDue ? '' : '✓', 'hk-check');
    check.type = 'button';
    check.setAttribute('aria-label', t(isDue ? 'Mark "{name}" as done' : '"{name}" is done', { name: task.name }));
    check.disabled = !isDue;
    check.onclick = async () => {
      check.disabled = true;
      try {
        const before = task.doneAt;
        hk.tasks = (await api('POST', `${hkBase()}/housekeeping/tasks/${task.id}/done`, {})).tasks;
        tkUndo.set(task.id, before);
        renderHkTasks();
        loadBoardIfShown();
      } catch (err) { toast(tx(err.message)); check.disabled = false; }
    };
    const words = document.createElement('div');
    words.className = 'grow';
    const room = task.roomId && hk.rooms.find(r => r.id === task.roomId);
    words.append(text('div', task.name, 'hk-task-name'));
    const every = t(task.everyDays === 1 ? 'Every day' : 'Every {n} days', { n: task.everyDays });
    words.append(text('small', [room && room.name, every].filter(Boolean).join(' · '), 'muted'));
    const when = document.createElement('div');
    when.className = 'hk-task-when';
    // Only when it is next due, as with the linen (Bob, 27. 10.): not who, not when it was done.
    if (isDue) {
      const late = task.doneAt ? Math.floor((now - taskNext(task)) / DAY_MS) : 0;
      when.append(text('b', late >= 1 ? t(late === 1 ? '1 day late' : '{n} days late', { n: late }) : t('Due today')));
    } else {
      const inDays = Math.max(1, Math.ceil((taskNext(task) - now - DAY_MS / 2) / DAY_MS));
      when.append(text('span', inDays === 1 ? t('Next: tomorrow') : t('Next in {n} days', { n: inDays })));
      if (tkUndo.has(task.id)) {
        const undo = text('button', 'Undo', 'link');
        undo.type = 'button';
        undo.onclick = async () => {
          const prev = tkUndo.get(task.id);
          tkUndo.delete(task.id);
          try {
            hk.tasks = (await api('POST', `${hkBase()}/housekeeping/tasks/${task.id}/done`, { undo: true, previous: prev ? { at: prev } : null })).tasks;
            renderHkTasks();
            loadBoardIfShown();
          } catch (err) { toast(tx(err.message)); }
        };
        when.append(undo);
      }
    }
    // Edit: the day it was last done, by hand (done but nobody ticked it).
    if (tkEdit !== task.id) {
      const edit = text('button', 'Edit', 'link');
      edit.type = 'button';
      edit.onclick = () => { tkEdit = task.id; renderHkTasks(); };
      when.append(edit);
    }
    row.append(words, when, check);
    box.append(row);
    if (tkEdit === task.id) box.append(taskDayEditor(task));
  }
  if (!can('housekeeping')) box.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
}
function taskDayEditor(task) {
  const wrap = document.createElement('div');
  wrap.className = 'hk-task-edit';
  const input = document.createElement('input');
  input.max = hkDayIso(Date.now());
  input.value = hkDayIso(task.doneAt || Date.now());
  const row = document.createElement('div');
  row.className = 'bp-edit-row';
  row.append(text('span', t('Last done')), dateField(input));
  const acts = document.createElement('div');
  acts.className = 'bp-acts';
  const cancel = text('button', 'Cancel', 'small');
  cancel.type = 'button';
  cancel.onclick = () => { tkEdit = null; renderHkTasks(); };
  const save = text('button', 'Save', 'small primary');
  save.type = 'button';
  save.onclick = async () => {
    save.disabled = true;
    try {
      hk.tasks = (await api('POST', `${hkBase()}/housekeeping/tasks/${task.id}/done`, { day: input.value })).tasks;
      tkEdit = null;
      tkUndo.delete(task.id);
      renderHkTasks();
      loadBoardIfShown();
    } catch (err) { toast(tx(err.message)); save.disabled = false; }
  };
  acts.append(cancel, save);
  wrap.append(row, acts);
  return wrap;
}
function daysAgoFrom(ms, now) {
  const d = Math.floor((now - ms) / DAY_MS);
  return d <= 0 ? t('today') : t(d === 1 ? '1 day ago' : '{n} days ago', { n: d });
}
// The Dashboard's "Needs attention" counts due tasks: refresh it if it's open.
function loadBoardIfShown() { if (currentTab === 'board') loadBoard(); }

// Settings → Housekeeping: the list of recurring tasks (saved with the form).
let tkRooms = [];
const TASK_IDEAS = [['Clean the fridge', 7], ['Deep clean the bathrooms', 7], ['Clean the windows', 30], ['Defrost the freezer', 30], ['Wash the curtains', 90], ['Wash the pillows', 90]];
function renderTaskSettings(tasks, rooms) {
  tkRooms = rooms || tkRooms;
  const box = $('tk-items');
  box.replaceChildren();
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'ln-row tk-row';
    row.dataset.id = task.id || '';
    const name = document.createElement('input');
    name.value = task.orig ? t(task.name) : task.name;
    name.dataset.orig = task.orig ? task.name : '';
    name.maxLength = 60;
    name.placeholder = t('e.g. Clean the fridge');
    name.setAttribute('aria-label', t('Task'));
    const days = document.createElement('input');
    days.type = 'number';
    days.min = 1;
    days.max = 365;
    days.value = task.everyDays;
    days.setAttribute('aria-label', t('Every how many days'));
    const room = document.createElement('select');
    room.setAttribute('aria-label', t('Where'));
    room.append(new Option(t('Whole property'), ''), ...tkRooms.filter(r => r.kind === 'room').map(r => new Option(r.name, r.id)));
    room.value = task.roomId || '';
    const del = text('button', '×', 'small');
    del.type = 'button';
    del.setAttribute('aria-label', t('Remove'));
    del.onclick = () => { row.remove(); renderTaskIdeas(); };
    row.append(name, text('span', 'every', 'muted'), days, text('span', 'days', 'muted'), room, del);
    box.append(row);
  }
  renderTaskIdeas();
}
function readTaskSettings() {
  return [...$('tk-items').querySelectorAll('.tk-row')].map(r => {
    const [name, days] = r.querySelectorAll('input');
    // An untouched idea keeps its English name, so it stays translated.
    const label = name.dataset.orig && t(name.dataset.orig) === name.value ? name.dataset.orig : name.value;
    return { id: r.dataset.id || undefined, name: label, everyDays: Number(days.value), roomId: r.querySelector('select').value || null };
  });
}
function renderTaskIdeas() {
  const have = new Set(readTaskSettings().map(x => x.name));
  $('tk-ideas').replaceChildren(...TASK_IDEAS.filter(([name]) => !have.has(name)).map(([name, everyDays]) => {
    const c = text('button', `+ ${t(name)}`, 'chip');
    c.type = 'button';
    c.onclick = () => renderTaskSettings([...readTaskSettings(), { name, everyDays, orig: true }]);
    return c;
  }));
}
$('tk-add').onclick = () => {
  renderTaskSettings([...readTaskSettings(), { name: '', everyDays: 7 }]);
  $('tk-items').lastChild.querySelector('input').focus();
};
