// HostelFlow — Calendar (HostelOne beta): reservations from the channels'
// iCal links and typed in by hand, on a two-week timeline.
// Plain scripts loaded in order by index.html; they share globals.

const CAL_DAYS = 7; // a week, as in Costello's calendar
const SOURCE_NAMES = { booking: 'Booking.com', airbnb: 'Airbnb', hostelworld: 'Hostelworld', expedia: 'Expedia', other: 'Other', manual: 'Direct' };
let calStart = null;      // first day shown (YYYY-MM-DD)
let calData = null;       // { reservations, rooms, calendars? }
let resPopId = null;

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDay(d); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const todayIso = () => isoDay(new Date());
// Volunteers read the calendar; owner and staff change it.
const canEditReservations = () => can('calendar');
const calDayLabel = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, opts);

async function loadCalendar() {
  if (!state.property) return;
  if (!calStart) calStart = addDays(todayIso(), -1);
  const base = `/api/properties/${state.property.id}`;
  try {
    const [reservations, house] = await Promise.all([
      api('GET', `${base}/reservations?from=${calStart}&to=${addDays(calStart, CAL_DAYS)}`),
      api('GET', `${base}/housekeeping`).catch(() => ({ rooms: [], frames: [] })),
    ]);
    calData = { reservations, rooms: house.rooms, frames: house.frames };
  } catch (err) {
    if (err.status === 401) return show('view-login');
    if (err.status === 402) return renderUpsell();
    return toast(err.message);
  }
  for (const id of ['cal-tools', 'cal-sync', 'cal-add']) $(id).hidden = false;
  renderCalendar();
}

// Without HostelOne: what the calendar would do, and where to get it.
function renderUpsell() {
  for (const id of ['cal-tools', 'cal-sync', 'cal-add']) $(id).hidden = true;
  $('cal-today').replaceChildren();
  const box = $('cal-grid');
  box.replaceChildren();
  const card = document.createElement('div');
  card.className = 'upsell';
  card.append(text('b', 'The calendar is part of HostelOne'),
    text('p', 'All reservations on one screen. Booking.com and Airbnb calendars update every hour. Arrivals and departures show on the Dashboard.', 'muted'));
  if (state.property.role === 'owner') {
    const go = text('button', 'See the plans', 'small primary-lite');
    go.type = 'button';
    go.onclick = () => openSection('sec-billing');
    card.append(go);
  } else card.append(text('p', 'Ask the owner to switch to HostelOne.', 'muted'));
  box.append(card);
}

function resLabel(r) {
  if (r.kind === 'block') return t('Closed');
  if (r.guest) return `${flagOf(r.nationality)} ${r.guest}`.trim();
  return r.guest || (r.code ? `${SOURCE_NAMES[r.source] || r.source} · ${r.code}` : t('{source} booking', { source: SOURCE_NAMES[r.source] || r.source }));
}

function renderCalendar() {
  const today = todayIso();
  const end = addDays(calStart, CAL_DAYS);
  $('cal-range').textContent = `${calDayLabel(calStart, { day: 'numeric', month: 'long' })} – ${calDayLabel(addDays(end, -1), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const bookings = calData.reservations.filter(r => r.kind === 'booking');
  const count = pred => bookings.filter(pred).length;
  $('cal-today').replaceChildren(
    ...[
      [t('Arriving today'), count(r => r.arrival === today), 'arr'],
      [t('Leaving today'), count(r => r.departure === today), 'dep'],
      [t('Staying tonight'), count(r => r.arrival <= today && r.departure > today), 'in'],
    ].map(([label, n, cls]) => {
      const b = document.createElement('div');
      b.className = `cal-stat ${cls}`;
      b.append(text('b', String(n)), text('span', label));
      return b;
    }),
  );

  const box = $('cal-grid');
  box.replaceChildren();
  box.style.setProperty('--days', CAL_DAYS);
  const dayOf = i => addDays(calStart, i);

  // Day header: weekday and a big date, today in the accent colour.
  const head = document.createElement('div');
  head.className = 'cal-row cal-head';
  head.append(text('div', '', 'cal-side'));
  for (let i = 0; i < CAL_DAYS; i++) {
    const d = dayOf(i);
    const c = document.createElement('div');
    c.className = 'cal-day' + (d === today ? ' today' : '') + ([0, 6].includes(new Date(`${d}T12:00:00`).getDay()) ? ' we' : '');
    c.append(text('small', calDayLabel(d, { weekday: 'short' })), text('b', String(new Date(`${d}T12:00:00`).getDate())));
    head.append(c);
  }
  box.append(head);

  if (!calData.rooms.length && !calData.reservations.length) {
    box.append(text('p', state.property.role === 'owner'
      ? 'Add your rooms and beds in Settings → Property, and connect your Booking.com / Airbnb calendars in Settings → Channel calendars.'
      : 'No reservations this week.', 'muted cal-empty'));
    return;
  }

  // Each room shows its beds as rows (as in Costello); its reservations are
  // put into the first bed that is free for their dates.
  const bedLabels = new Map();
  for (const f of calData.frames || []) {
    const room = roomOf(f, calData.rooms);
    if (!room) continue;
    if (!bedLabels.has(room.id)) bedLabels.set(room.id, []);
    bedLabels.get(room.id).push(...f.beds.map(b => b.label));
  }
  const sortLabels = l => l.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const lanesFor = (list, n) => {
    const lanes = Array.from({ length: Math.max(1, n) }, () => []);
    for (const r of [...list].sort((x, y) => x.arrival.localeCompare(y.arrival))) {
      let lane = lanes.find(l => !l.length || l[l.length - 1].departure <= r.arrival);
      if (!lane) { lane = []; lanes.push(lane); }
      lane.push(r);
    }
    return lanes;
  };
  const groups = calData.rooms.map(room => ({ room, list: calData.reservations.filter(r => r.roomId === room.id), labels: sortLabels(bedLabels.get(room.id) || []) }));
  const loose = calData.reservations.filter(r => !r.roomId || !calData.rooms.some(x => x.id === r.roomId));
  if (loose.length) groups.push({ room: null, list: loose, labels: [] });

  for (const g of groups) {
    const rh = document.createElement('div');
    rh.className = 'cal-room';
    rh.append(text('span', g.room ? g.room.name : t('Not assigned')));
    const nightNow = g.list.filter(r => r.kind === 'booking' && r.arrival <= today && r.departure > today).length;
    if (g.labels.length) rh.append(text('small', `${nightNow}/${g.labels.length}`));
    box.append(rh);
    const lanes = lanesFor(g.list, g.labels.length);
    lanes.forEach((lane, i) => {
      const row = document.createElement('div');
      row.className = 'cal-row' + (i === lanes.length - 1 ? ' last' : '');
      row.append(text('div', g.labels[i] ? t('Bed {n}', { n: g.labels[i] }) : g.room ? '+' : '', 'cal-side'));
      const track = document.createElement('div');
      track.className = 'cal-track';
      for (let d = 0; d < CAL_DAYS; d++) {
        // Empty days get a "+" to add a reservation from that day (as in Costello).
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cal-cell' + (dayOf(d) === today ? ' today' : '');
        cell.setAttribute('aria-label', t('Add a reservation from {day}', { day: calDayLabel(dayOf(d), { day: 'numeric', month: 'short' }) }));
        cell.append(text('i', '+'));
        if (canEditReservations()) cell.onclick = () => openResModal(null, { arrival: dayOf(d), roomId: g.room ? g.room.id : null });
        else cell.disabled = true;
        track.append(cell);
      }
      for (const r of lane) {
        const from = Math.max(0, daysBetween(calStart, r.arrival));
        const to = Math.min(CAL_DAYS, daysBetween(calStart, r.departure));
        if (to <= 0 || from >= CAL_DAYS) continue;
        const cutL = daysBetween(calStart, r.arrival) < 0;
        const cutR = daysBetween(calStart, r.departure) > CAL_DAYS;
        const bar = document.createElement('button');
        bar.type = 'button';
        bar.className = `cal-bar src-${r.source} k-${r.kind}` + (resPopId === r.id ? ' open' : '') + (cutL ? ' cut-l' : '') + (cutR ? ' cut-r' : '');
        // Half a day in and out: guests arrive in the afternoon and leave in the morning.
        bar.style.left = `calc(${from} * 100% / var(--days) + ${cutL ? '2px' : '50% / var(--days)'})`;
        bar.style.right = `calc(${CAL_DAYS - to} * 100% / var(--days) - ${cutR ? '-2px' : '50% / var(--days)'})`;
        bar.dataset.res = r.id;
        const st = RES_STATUS[(r.status || [])[0]];
        if (st) { bar.style.background = st[1]; bar.style.color = st[2]; bar.classList.add('has-status'); }
        bar.append(text('span', resLabel(r)));
        if (r.guests > 1) bar.append(text('small', `×${r.guests}`));
        if (r.arrivalTime && r.arrival >= calStart) bar.append(text('small', r.arrivalTime));
        bar.onclick = e => { e.stopPropagation(); resPopId === r.id ? closeResPop() : openResPop(r.id); };
        track.append(bar);
      }
      row.append(track);
      box.append(row);
    });
  }
  if (resPopId) openResPop(resPopId);
}

function closeResPop() {
  resPopId = null;
  $('res-pop').hidden = true;
  document.querySelectorAll('.cal-bar.open').forEach(b => b.classList.remove('open'));
}

function openResPop(id) {
  const r = calData && calData.reservations.find(x => x.id === id);
  const bar = document.querySelector(`.cal-bar[data-res="${CSS.escape(id)}"]`);
  if (!r || !bar) return closeResPop();
  resPopId = id;
  document.querySelectorAll('.cal-bar.open').forEach(b => b.classList.remove('open'));
  bar.classList.add('open');
  const pop = $('res-pop');
  pop.replaceChildren();
  const head = document.createElement('div');
  head.className = 'bp-head';
  const title = document.createElement('div');
  title.append(text('b', resLabel(r)), text('span', SOURCE_NAMES[r.source] || r.source, `src-chip src-${r.source}`));
  const close = text('button', '×', 'bp-x');
  close.type = 'button';
  close.onclick = closeResPop;
  head.append(title, close);
  pop.append(head);
  const nights = daysBetween(r.arrival, r.departure);
  const lines = [
    `${calDayLabel(r.arrival, { weekday: 'short', day: 'numeric', month: 'short' })} → ${calDayLabel(r.departure, { weekday: 'short', day: 'numeric', month: 'short' })}`,
    t(nights === 1 ? '1 night' : '{n} nights', { n: nights }) + (r.guests ? ` · ${t(r.guests === 1 ? '1 guest' : '{n} guests', { n: r.guests })}` : ''),
  ];
  const room = (calData.rooms.find(x => x.id === r.roomId) || {}).name;
  if (room) lines.push(room);
  if (r.arrivalTime) lines.push(`${t('Arrival time')}: ${r.arrivalTime}`);
  if (r.nationality) lines.push(`${flagOf(r.nationality)} ${r.nationality}`);
  if (r.code) lines.push(`${t('Code')}: ${r.code}`);
  if (r.note) lines.push(r.note);
  if ((r.status || []).length) {
    const chips = document.createElement('div');
    chips.className = 'rp-status';
    for (const k of r.status) {
      const st = RES_STATUS[k];
      if (!st) continue;
      const c = text('span', t(st[0]));
      c.style.background = st[1];
      c.style.color = st[2];
      chips.append(c);
    }
    pop.append(chips);
  }
  for (const l of lines) pop.append(text('div', l, 'rp-line'));
  if (r.kind === 'block') {
    pop.append(text('p', 'Dates closed on the channel.', 'muted rp-note'));
  } else if (canEditReservations()) {
    if (!r.editable) pop.append(text('p', 'Dates come from the channel calendar. You can add the name, status and notes here.', 'muted rp-note'));
    const acts = document.createElement('div');
    acts.className = 'bp-acts';
    const edit = text('button', 'Edit', 'small primary-lite');
    edit.type = 'button';
    edit.onclick = () => { closeResPop(); openResModal(r); };
    acts.append(edit);
    pop.append(acts);
  }
  pop.hidden = false;
  const b = bar.getBoundingClientRect();
  const w = Math.min(300, innerWidth - 24);
  pop.style.width = `${w}px`;
  const left = Math.max(12, Math.min(innerWidth - w - 12, b.left + Math.min(b.width, 120) / 2 - w / 2));
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${b.bottom + scrollY + 10}px`;
  pop.style.setProperty('--arrow', `${b.left + Math.min(b.width, 120) / 2 - left}px`);
}
document.addEventListener('click', e => { if (resPopId && !e.target.closest('#res-pop, .cal-bar')) closeResPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && resPopId) closeResPop(); });

$('cal-prev').onclick = () => { calStart = addDays(calStart, -7); closeResPop(); loadCalendar(); };
$('cal-next').onclick = () => { calStart = addDays(calStart, 7); closeResPop(); loadCalendar(); };
$('cal-now').onclick = () => { calStart = addDays(todayIso(), -1); closeResPop(); loadCalendar(); };
$('cal-sync').onclick = async () => {
  const btn = $('cal-sync');
  btn.disabled = true;
  try {
    const r = await api('POST', `/api/properties/${state.property.id}/calendars/sync`, {});
    const bad = r.filter(x => !x.ok);
    toast(!r.length ? t('No channel calendars connected yet.') : bad.length ? t('Some calendars could not be read: {e}', { e: bad[0].error }) : t('Calendars updated.'));
  } catch (err) { toast(err.message); }
  btn.disabled = false;
  loadCalendar();
};
$('cal-add').onclick = () => openResModal(null);

// ----- Add / edit a reservation (laid out like Costello's) -----

// Costello's statuses and colours; a bar takes the colour of its first one.
const RES_STATUS = {
  ok: ['All good', '#8fd6a3', '#0d5c2e'],
  checkin: ['Check-in / not paid', '#f0d800', '#5c4b00'],
  unpaid: ['Not paid', '#e63c3c', '#fff'],
  change: ['Room change', '#22c9d6', '#053b32'],
  'paid-noci': ['Check-in / paid', '#3a6fd4', '#fff'],
  cancel: ['Cancellation', '#d0cfc9', '#4a4944'],
  'lower-bed': ['Lower bed', '#9333ea', '#fff'],
  laundry: ['Laundry', '#fb923c', '#4a2c00'],
};
const RES_NATS = [['GB', '🇬🇧', 'UK'], ['US', '🇺🇸', 'USA'], ['AU', '🇦🇺', 'AUS'], ['DE', '🇩🇪', 'GER'], ['FR', '🇫🇷', 'FRA'], ['ES', '🇪🇸', 'ESP'],
  ['IT', '🇮🇹', 'ITA'], ['NL', '🇳🇱', 'NL'], ['BR', '🇧🇷', 'BRA'], ['CA', '🇨🇦', 'CAN'], ['PL', '🇵🇱', 'POL'], ['CZ', '🇨🇿', 'CZE']];
const flagOf = code => {
  if (!code) return '';
  const known = RES_NATS.find(n => n[0] === code);
  if (known) return known[1];
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) : '';
};

let resEditing = null;
let resStatus = [];
let resTime = { hour: null, ampm: null, other: false, text: '' };
let resNat = '';

function timeFromValue(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!v) return { hour: null, ampm: null, other: false, text: '' };
  if (!m || m[2] !== '00') return { hour: null, ampm: null, other: true, text: v };
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'pm' : 'am';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return { hour: h, ampm, other: false, text: '' };
}
function timeValue() {
  if (resTime.other) return resTime.text.trim();
  if (!resTime.hour || !resTime.ampm) return '';
  let h = resTime.hour;
  if (resTime.ampm === 'pm' && h !== 12) h += 12;
  if (resTime.ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:00`;
}

function chip(label, on, onclick, cls = 'pick') {
  const c = text('button', label, `${cls}${on ? ' on' : ''}`);
  c.type = 'button';
  c.onclick = onclick;
  return c;
}

function renderResPickers() {
  // Status: up to two.
  $('rs-status').replaceChildren(...Object.entries(RES_STATUS).map(([k, [label, bg, ink]]) => {
    const c = chip(t(label), resStatus.includes(k), () => {
      resStatus = resStatus.includes(k) ? resStatus.filter(x => x !== k) : [...resStatus, k].slice(-2);
      renderResPickers();
    }, 'status-chip');
    c.style.background = bg;
    c.style.color = ink;
    return c;
  }));
  // Arrival time: AM/PM, then the hour.
  const tbox = $('rs-time');
  tbox.replaceChildren();
  const ap = document.createElement('div');
  ap.className = 'pick-row two';
  ap.append(chip('AM', resTime.ampm === 'am', () => { resTime = { ...resTime, ampm: resTime.ampm === 'am' ? null : 'am', other: false }; renderResPickers(); }),
    chip('PM', resTime.ampm === 'pm', () => { resTime = { ...resTime, ampm: resTime.ampm === 'pm' ? null : 'pm', other: false }; renderResPickers(); }));
  const hours = document.createElement('div');
  hours.className = 'pick-row two';
  for (const h of [1, 7, 2, 8, 3, 9, 4, 10, 5, 11, 6, 12]) {
    hours.append(chip(`${h}:00`, resTime.hour === h, () => { resTime = { ...resTime, hour: resTime.hour === h ? null : h, other: false }; renderResPickers(); }));
  }
  const other = document.createElement('div');
  other.className = 'pick-row two';
  const inp = document.createElement('input');
  inp.className = 'pick-input';
  inp.placeholder = t('e.g. 15:30');
  inp.value = resTime.text;
  inp.hidden = !resTime.other;
  inp.oninput = () => { resTime.text = inp.value; };
  other.append(chip(t('Other'), resTime.other, () => { resTime = { hour: null, ampm: null, other: !resTime.other, text: resTime.text }; renderResPickers(); if (resTime.other) $('rs-time').querySelector('input').focus(); }), inp);
  tbox.append(ap, hours, other);
  // Nationality: the usual ones, or type it.
  const nbox = $('rs-nat');
  nbox.replaceChildren(...RES_NATS.map(([code, flag, label]) => chip(`${flag} ${label}`, resNat === code, () => { resNat = resNat === code ? '' : code; renderResPickers(); })));
  const isOther = resNat && !RES_NATS.some(n => n[0] === resNat);
  const row = document.createElement('div');
  row.className = 'pick-row other';
  const ninp = document.createElement('input');
  ninp.className = 'pick-input';
  ninp.placeholder = t('e.g. NZ, KR');
  ninp.value = isOther ? resNat : '';
  ninp.oninput = () => { resNat = ninp.value.trim().toUpperCase(); };
  row.append(chip(t('+ Other'), isOther, () => { ninp.focus(); }), ninp);
  nbox.append(row);
}

function openResModal(r, defaults = {}) {
  resEditing = r;
  $('rs-title').textContent = t(r ? 'Edit reservation' : 'New reservation');
  $('rs-guest').value = r ? r.guest || '' : '';
  $('rs-arrival').value = r ? r.arrival : defaults.arrival || todayIso();
  $('rs-departure').value = r ? r.departure : addDays(defaults.arrival || todayIso(), 1);
  const channel = !!(r && !r.editable);
  $('rs-arrival').disabled = channel;
  $('rs-departure').disabled = channel;
  $('rs-channel').hidden = !channel;
  $('rs-guests').value = r && r.guests ? r.guests : '1';
  $('rs-note').value = r ? r.note || '' : '';
  const rooms = (calData && calData.rooms) || [];
  $('rs-room').replaceChildren(new Option('—', ''), ...rooms.map(x => new Option(x.name, x.id)));
  $('rs-room').value = r && r.roomId ? r.roomId : defaults.roomId || '';
  resStatus = r ? [...(r.status || [])] : [];
  resTime = timeFromValue(r && r.arrivalTime);
  resNat = r && r.nationality ? r.nationality : '';
  renderResPickers();
  $('rs-delete').hidden = !(r && r.editable);
  $('rs-err').textContent = '';
  $('res-modal').hidden = false;
  $('rs-guest').focus();
}
function closeResModal() { $('res-modal').hidden = true; }
$('rs-close').onclick = closeResModal;
$('rs-cancel').onclick = closeResModal;
$('rs-delete').onclick = async () => {
  if (!resEditing || !confirm(t('Delete this reservation?'))) return;
  try { await api('DELETE', `/api/properties/${state.property.id}/reservations/${resEditing.id}`); } catch (err) { return toast(err.message); }
  closeResModal();
  loadCalendar();
};
$('res-modal').addEventListener('click', e => { if (e.target === $('res-modal')) closeResModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('res-modal').hidden) closeResModal(); });
bindForm('form-res', 'rs-err', async () => {
  const body = {
    guest: $('rs-guest').value, arrival: $('rs-arrival').value, departure: $('rs-departure').value,
    guests: $('rs-guests').value, roomId: $('rs-room').value || null, note: $('rs-note').value,
    status: resStatus, arrivalTime: timeValue(), nationality: resNat,
  };
  const base = `/api/properties/${state.property.id}/reservations`;
  await api(resEditing ? 'PUT' : 'POST', resEditing ? `${base}/${resEditing.id}` : base, body);
  closeResModal();
  if (!$('tab-calendar').hidden) loadCalendar(); else toast(t('Reservation saved.'));
});

// ----- Settings → Channel calendars (owner) -----

async function loadChannelCalendars() {
  const pid = state.ownerPropertyId;
  let cals;
  try { cals = await api('GET', `/api/properties/${pid}/calendars`); } catch (err) {
    if (err.status !== 402) throw err;
    $('ch-list').replaceChildren(text('p', 'Channel calendars are part of HostelOne — see Settings → Subscription.', 'muted'));
    $('form-channel').hidden = true;
    return;
  }
  $('form-channel').hidden = false;
  const [hkData] = await Promise.all([
    api('GET', `/api/properties/${pid}/housekeeping`).catch(() => ({ rooms: [] })),
  ]);
  const box = $('ch-list');
  box.replaceChildren();
  if (!cals.length) box.append(text('p', 'No calendars connected yet.', 'muted'));
  for (const c of cals) {
    const row = document.createElement('div');
    row.className = 'row';
    const info = document.createElement('div');
    info.className = 'grow';
    const top = document.createElement('div');
    top.append(text('span', SOURCE_NAMES[c.source] || c.source, `src-chip src-${c.source}`), ' ', text('b', c.name));
    info.append(top);
    const room = (hkData.rooms.find(x => x.id === c.roomId) || {}).name;
    info.append(text('div', [room, c.lastError ? `⚠️ ${c.lastError}` : c.lastSync ? t('updated {when}', { when: new Date(c.lastSync).toLocaleString() }) : ''].filter(Boolean).join(' · '), 'muted'));
    const del = text('button', 'Remove', 'small danger');
    del.type = 'button';
    del.onclick = async () => {
      if (!confirm(t('Disconnect this calendar? Its reservations disappear from HostelFlow (not from the channel).'))) return;
      try { await api('DELETE', `/api/properties/${pid}/calendars/${c.id}`); } catch (err) { return toast(err.message); }
      loadChannelCalendars();
    };
    row.append(info, del);
    box.append(row);
  }
  $('ch-room').replaceChildren(new Option(t('Whole property / not sure'), ''), ...hkData.rooms.map(x => new Option(x.name, x.id)));
}
bindForm('form-channel', 'ch-err', async () => {
  const r = await api('POST', `/api/properties/${state.ownerPropertyId}/calendars`, {
    name: $('ch-name').value, url: $('ch-url').value, roomId: $('ch-room').value || null,
  });
  $('ch-name').value = '';
  $('ch-url').value = '';
  await loadChannelCalendars();
  $('ch-err').className = r.sync && r.sync.ok ? 'ok' : 'err';
  $('ch-err').textContent = r.sync && r.sync.ok
    ? t('Connected. Found {n} reservations and closed dates.', { n: r.sync.count })
    : t('Saved, but couldn\'t read it yet: {e}', { e: r.sync ? r.sync.error : '' });
});
