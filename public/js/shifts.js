// HostelFlow — Shifts: who works when, a week at a time. Everyone sees the
// rota (their own shifts stand out); whoever may edit it (the 'shifts'
// permission) drags people onto shifts, moves them between shifts and drags
// them off — or, on a phone, taps a person and then the shifts. A tap on a
// shift writes a note on it; notes are chips like the names, dragged the same way.
// Shift types and their hours: Settings → Shifts.

let sh = null;
let shPick = null;         // the person picked for tap-to-assign
let shDragged = false;     // a drag just ended: not a tap
const shIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shDate = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const shAddDays = (day, n) => { const d = shDate(day); d.setDate(d.getDate() + n); return shIso(d); };
const shMonday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return shIso(x); };
let shFrom = shMonday(new Date());

// Hours of a kind of shift; an end before the start runs overnight.
function shiftHours(type) {
  const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let d = mins(type.end) - mins(type.start);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}
const fmtHours = h => (Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`);

async function loadShifts() {
  if (!state.property || !fullApp()) return; // not in check-in-only plans
  try {
    sh = await api('GET', `/api/properties/${state.property.id}/shifts?from=${shFrom}&days=7`);
  } catch (err) {
    if (err.status === 401) return show('view-login');
    return toast(tx(err.message));
  }
  renderShifts();
}

function renderShifts() {
  if (!sh) return;
  const locale = LOCALE;
  const last = shDate(shAddDays(sh.from, 6));
  $('sh-range').textContent = `${shDate(sh.from).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('sh-today').disabled = sh.from === shMonday(new Date());
  $('sh-tools').hidden = !sh.canEdit;
  $('sh-clear').disabled = !sh.shifts.length && !sh.notes.length;
  const typeOf = key => sh.types.find(t => t.key === key);
  const memberOf = id => sh.members.find(m => m.id === id);
  // Just the first name on the rota — with the surname's initial when two
  // people share it ("Marco R.", "Marco B."). The full name shows on hover.
  const first = n => String(n || '').trim().split(/\s+/)[0] || n;
  const short = m => {
    const f = first(m.name);
    if (sh.members.filter(o => first(o.name) === f).length < 2) return f;
    const rest = String(m.name).trim().split(/\s+/).slice(1).join(' ');
    return rest ? `${f} ${rest[0]}.` : f;
  };

  // The team with their hours this week — for everyone to see; whoever plans
  // the rota also drags them from here.
  const people = $('sh-people');
  people.hidden = false;
  people.replaceChildren();
  if (shPick && !memberOf(shPick)) shPick = null;
  {
    for (const m of sh.members) {
      const hours = sh.shifts.filter(s => s.userId === m.id).reduce((sum, s) => sum + hoursOfShift(s, typeOf), 0);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `sh-person${shPick === m.id ? ' on' : ''}`;
      chip.style.setProperty('--c', colorOf(m.name, m.color));
      chip.append(text('span', short(m)), text('small', fmtHours(hours)));
      chip.title = m.name;
      chip.setAttribute('aria-pressed', shPick === m.id ? 'true' : 'false');
      // Your own name has a ring, but only for those who can't plan: whoever
      // plans taps names to pick them, and the same ring read as "picked"
      // (Bob, 22. 10.: his own name looked selected all the time).
      if (m.id === sh.me && !sh.canEdit) chip.classList.add('me');
      if (sh.canEdit) {
        chip.onpointerdown = e => shStartDrag(e, { userId: m.id });
        chip.onclick = () => { if (shDragged) return; shPick = shPick === m.id ? null : m.id; renderShifts(); };
      } else chip.disabled = true;
      people.append(chip);
    }
  }
  $('sh-help').textContent = t(!sh.canEdit ? 'Your shifts are highlighted. Tap a note to read it.'
    : shPick ? 'Now tap the shifts for {name} — tap the name again when you are done.'
    : 'Drag a person onto a shift, or tap a person and then the shifts. Drag a name off to take it away. Tap a shift to write a note on it.',{ name: shPick && memberOf(shPick) ? short(memberOf(shPick)) : '' });

  // The week as a table: a row per day (each day its own colour), a column
  // per kind of shift; people are coloured badges, dragged into the cells.
  const week = $('sh-week');
  week.replaceChildren();
  week.classList.toggle('picking', !!shPick);
  const table = document.createElement('table');
  table.className = 'sh-table';
  const head = document.createElement('tr');
  head.append(document.createElement('th'));
  // The kinds of shift in the order set in Settings → Shifts.
  const types = sh.types;
  const cols = types;
  const colorFor = type => SH_TYPE_COLORS[types.indexOf(type) % SH_TYPE_COLORS.length];
  const hoursText = type => `${type.start}–${type.end}`;
  for (const type of cols) {
    const th = document.createElement('th');
    th.append(text('b', type.name), text('small', hoursText(type)));
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  const today = shIso(new Date());
  for (let i = 0; i < 7; i++) {
    const day = shAddDays(sh.from, i);
    const d = shDate(day);
    const tr = document.createElement('tr');
    tr.className = `sh-row${day === today ? ' today' : ''}`;
    tr.style.setProperty('--day', SH_DAY_COLORS[(d.getDay() + 6) % 7]);
    const th = document.createElement('th');
    th.scope = 'row';
    th.append(text('b', d.toLocaleDateString(locale, { weekday: 'short' })), text('small', d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })));
    tr.append(th);
    for (const type of cols) {
      const cell = document.createElement('td');
      cell.className = 'sh-cell';
      cell.dataset.day = day;
      cell.dataset.type = type.key;
      // On phones each day is a card and every shift a line: its name and hours lead the line.
      const label = document.createElement('span');
      label.className = 'sh-label';
      label.style.setProperty('--c', colorFor(type));
      label.append(text('b', type.name), text('small', hoursText(type)));
      cell.append(label);
      for (const s of sh.shifts.filter(x => x.day === day && x.type === type.key)) {
        const m = memberOf(s.userId);
        if (!m) continue;
        const chip = document.createElement('span');
        chip.className = `sh-chip${s.userId === sh.me && !sh.canEdit ? ' mine' : ''}`;
        // On the rota a name takes the colour of its shift.
        chip.style.setProperty('--c', colorFor(type));
        chip.append(text('span', short(m)));
        chip.title = m.name;
        // Own hours, when they differ from the shift's: shown next to the name.
        if (s.start) {
          chip.append(text('small', `${s.start}–${s.end}`, 'sh-time'));
          chip.classList.add('has-time');
          chip.title = `${m.name} · ${s.start}–${s.end}`;
        }
        if (sh.canEdit) {
          chip.classList.add('movable');
          chip.onpointerdown = e => shStartDrag(e, { shiftId: s.id });
          // A click (not a drag) opens this person's hours on the shift.
          chip.onclick = e => { e.stopPropagation(); if (!shDragged) openShiftHours(s, type, m); };
          const x = text('button', '×', 'sh-x');
          x.type = 'button';
          x.setAttribute('aria-label', t('Take {name} off this shift', { name: m.name }));
          x.onpointerdown = e => e.stopPropagation();
          x.onclick = e => { e.stopPropagation(); shRemove(s.id); };
          chip.append(x);
        }
        cell.append(chip);
      }
      // Notes sit on the shift itself, as coloured chips after the names: a tap
      // opens one, whoever plans the rota drags it to another shift (or off: gone).
      for (const n of (sh.notes || []).filter(x => x.day === day && x.type === type.key)) {
        const chip = document.createElement('span');
        chip.className = 'sh-chip sh-note';
        chip.style.setProperty('--c', n.color || SH_NOTE_COLORS[0]);
        chip.append(shNoteIcon(), text('span', n.text)); // the team's own words: never translated
        chip.title = n.text;
        chip.tabIndex = 0;
        chip.setAttribute('role', 'button');
        chip.onclick = e => { e.stopPropagation(); if (!shDragged) openShiftNote(n, day, type.key); };
        chip.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShiftNote(n, day, type.key); } };
        if (sh.canEdit) {
          chip.classList.add('movable');
          chip.onpointerdown = e => shStartDrag(e, { noteId: n.id });
        }
        cell.append(chip);
      }
      if (sh.canEdit) {
        cell.classList.add('tappable');
        cell.onclick = () => {
          if (shDragged) return;
          if (shPick) shAssign(day, type.key, shPick);
          else openShiftNote(null, day, type.key);
        };
      }
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  week.append(table);

  // The hours are next to the names at the top.
  $('sh-hours').hidden = true;
  fitShiftNames();
  requestAnimationFrame(fitShiftNames);
  document.fonts.ready.then(() => requestAnimationFrame(fitShiftNames));
}

// A name next to its own hours: smaller rather than cut off ("Kakan…");
// when even that is not enough, the hours go under the name.
function fitShiftNames() {
  for (const chip of document.querySelectorAll('.sh-chip.has-time')) {
    const name = chip.firstChild;
    if (!chip.offsetParent) continue; // not on screen: measured when it is
    chip.classList.remove('stacked');
    name.style.fontSize = '';
    const cut = () => name.scrollWidth > name.clientWidth;
    for (let px = parseFloat(getComputedStyle(name).fontSize) - 0.5; cut() && px >= 10.5; px -= 0.5) name.style.fontSize = `${px}px`;
    if (cut()) {
      name.style.fontSize = '';
      chip.classList.add('stacked');
    }
  }
}
// Measured again whenever the rota changes size: shown, turned, resized.
const shFit = new ResizeObserver(() => { if (sh) fitShiftNames(); });
shFit.observe($('sh-week'));
shFit.observe($('tab-shifts'));

// Each weekday its own colour (the stripe and tint of its row).
const SH_DAY_COLORS = ['#e07856', '#caa53a', '#4a9d5f', '#17c4aa', '#3a6fd4', '#9a5ad4', '#d4537e'];
// Each kind of shift its own colour, in the order of the day.
const SH_TYPE_COLORS = ['#e3a92b', '#e0603f', '#3a8fd4', '#8a5ad4', '#17a589', '#d4537e', '#6b7a8f'];
// The colours a note can have (the first is the default).
const SH_NOTE_COLORS = ['#6b7a8f', '#e3a92b', '#e0603f', '#3a8fd4', '#17a589', '#8a5ad4', '#d4537e'];

// Drag with a mouse or a finger: a copy follows the pointer, the shift under
// it lights up. A person dropped on a shift is put on it; a name from a shift
// is moved there, or taken off if dropped outside the rota.
let shDragEnd = null;      // the drag in progress: call it to end that drag
function shStartDrag(e, what) {
  if (!sh || !sh.canEdit || e.button > 0) return;
  if (shDragEnd) shDragEnd(false); // a drag that never got its pointerup
  const src = e.currentTarget;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost = null;
  let over = null;
  src.setPointerCapture(e.pointerId);
  const move = ev => {
    if (ev.pointerId !== e.pointerId) return;
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      ghost = src.cloneNode(true);
      ghost.classList.add('sh-ghost');
      document.body.append(ghost);
      if (what.shiftId || what.noteId) src.classList.add('dragging');
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const cell = under && under.closest('.sh-cell');
    if (cell !== over) {
      if (over) over.classList.remove('over');
      over = cell;
      if (over) over.classList.add('over');
    }
  };
  // The listeners sit on the window, not on the chip: the rota can redraw
  // mid-drag (a save, a refresh) and take the chip away, and then its
  // pointerup never came — the copy stayed stuck on screen, even on other
  // tabs (Bob, 22. 10.). A cancel (Escape, the window losing focus) just
  // puts everything back; the browser's own drag of the chip never starts.
  const end = drop => {
    if (shDragEnd !== end) return;
    shDragEnd = null;
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    removeEventListener('keydown', onKey);
    removeEventListener('blur', onCancel);
    src.removeEventListener('dragstart', noNativeDrag);
    if (!ghost) return; // a tap: the click handler has it
    ghost.remove();
    src.classList.remove('dragging');
    if (over) over.classList.remove('over');
    shDragged = true;
    setTimeout(() => { shDragged = false; }, 0);
    if (!drop) return;
    if (what.userId && over) shAssign(over.dataset.day, over.dataset.type, what.userId);
    else if (what.noteId) {
      const n = (sh.notes || []).find(x => x.id === what.noteId);
      if (!over) { if (n && confirm(t('Delete this note?'))) shNoteDelete(n); }
      else if (n && (n.day !== over.dataset.day || n.type !== over.dataset.type)) shNoteMove(n.id, over.dataset.day, over.dataset.type);
    }
    else if (what.shiftId) {
      const s = sh.shifts.find(x => x.id === what.shiftId);
      if (!over) shRemove(what.shiftId);
      else if (s && (s.day !== over.dataset.day || s.type !== over.dataset.type)) shMove(what.shiftId, over.dataset.day, over.dataset.type);
    }
  };
  const onUp = ev => { if (ev.pointerId === e.pointerId) end(true); };
  const onCancel = () => end(false);
  const noNativeDrag = ev => ev.preventDefault();
  const onKey = ev => { if (ev.key === 'Escape') end(false); };
  shDragEnd = end;
  addEventListener('pointermove', move);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onCancel);
  addEventListener('keydown', onKey);
  addEventListener('blur', onCancel);
  src.addEventListener('dragstart', noNativeDrag);
}

async function shAssign(day, type, userId) {
  if (sh.shifts.some(s => s.day === day && s.type === type && s.userId === userId)) return; // already there
  try { await api('POST', `/api/properties/${state.property.id}/shifts`, { day, type, userId }); }
  catch (err) { toast(tx(err.message)); }
  loadShifts();
}
async function shMove(id, day, type) {
  try { await api('PUT', `/api/properties/${state.property.id}/shifts/${id}`, { day, type }); }
  catch (err) { toast(tx(err.message)); }
  loadShifts();
}
async function shRemove(id) {
  try { await api('DELETE', `/api/properties/${state.property.id}/shifts/${id}`); }
  catch (err) { toast(tx(err.message)); }
  loadShifts();
}

// ===== Notes on the rota =====

// The small note icon (a page with lines), drawn here: no images, no inline markup.
function shNoteIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sh-note-ico');
  for (const d of ['M6 3h9l4 4v14H6z', 'M9 11h7M9 15h7M9 7h3']) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// One note, in a small sheet: whoever plans the rota writes, rewrites,
// colours or deletes it; everyone else reads it. A shift can have several.
let shNoteEditing = null;
let snColor = SH_NOTE_COLORS[0];
function openShiftNote(note, day, typeKey) {
  const type = sh.types.find(x => x.key === typeKey);
  if (!type) return;
  const edit = sh.canEdit;
  shNoteEditing = { note, day, type: typeKey };
  $('sn-title').textContent = t(note || !edit ? 'Note on this shift' : 'New note');
  $('sn-where').textContent = `${t(type.name)} · ${shDate(day).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'short' })}`;
  // The team's own words: never run through the translations.
  $('sn-text').value = note ? note.text : '';
  $('sn-text').readOnly = !edit;
  $('sn-count').hidden = !edit;
  $('sn-save').hidden = !edit;
  $('sn-color-box').hidden = !edit;
  snColor = (note && note.color) || SH_NOTE_COLORS[0];
  renderNoteColors();
  $('sn-cancel').textContent = t(edit ? 'Cancel' : 'Close');
  $('sn-delete').hidden = !edit || !note;
  $('sn-err').textContent = '';
  shNoteCount();
  $('sn-modal').hidden = false;
  if (edit) $('sn-text').focus();
}
function renderNoteColors() {
  $('sn-colors').replaceChildren(...SH_NOTE_COLORS.map(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'um-color' + (c === snColor ? ' on' : '');
    b.style.background = c;
    b.setAttribute('aria-label', c);
    b.setAttribute('aria-pressed', String(c === snColor));
    b.onclick = () => { snColor = c; renderNoteColors(); };
    return b;
  }));
}
function shNoteCount() { $('sn-count').textContent = `${$('sn-text').value.length}/200`; }
function closeShiftNote() { $('sn-modal').hidden = true; shNoteEditing = null; }
$('sn-text').oninput = shNoteCount;
$('sn-close').onclick = closeShiftNote;
$('sn-cancel').onclick = closeShiftNote;
$('sn-modal').addEventListener('click', e => { if (e.target === $('sn-modal')) closeShiftNote(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sn-modal').hidden) closeShiftNote(); });
const shNotesUrl = () => `/api/properties/${state.property.id}/shifts/notes`;
async function shNoteDelete(note) {
  closeShiftNote();
  try { await api('DELETE', `${shNotesUrl()}/${note.id}`); }
  catch (err) { toast(tx(err.message)); }
  loadShifts();
}
async function shNoteMove(id, day, type) {
  try { await api('PUT', `${shNotesUrl()}/${id}`, { day, type }); }
  catch (err) { toast(tx(err.message)); }
  loadShifts();
}
$('sn-delete').onclick = () => shNoteDelete(shNoteEditing.note);
bindForm('form-shift-note', 'sn-err', async () => {
  if (!sh.canEdit) return closeShiftNote();
  const { note, day, type } = shNoteEditing;
  const words = $('sn-text').value.trim();
  // Emptied: the same as Delete.
  if (!words) return note ? shNoteDelete(note) : closeShiftNote();
  if (note) await api('PUT', `${shNotesUrl()}/${note.id}`, { text: words, color: snColor });
  else await api('POST', shNotesUrl(), { day, type, text: words, color: snColor });
  closeShiftNote();
  loadShifts();
});

// Someone's own hours on a shift (in for two hours, or leaving early): click
// the name. Hours that differ from the shift's show next to the name and count.
function hoursOfShift(s, typeOf) {
  if (s.start && s.end) return shiftHours({ start: s.start, end: s.end });
  const type = typeOf(s.type);
  return type ? shiftHours(type) : 0;
}
let shEditing = null;
// The time pickers: hours and minutes in steps of ten, two big selects (a
// wheel on phones). An odd time (e.g. 07:45 from the settings) stays choosable.
function setTimePick(id, value) {
  const [h, m] = String(value || '08:00').split(':');
  const box = $(`${id}-pick`);
  const hs = box.querySelector('.tp-h');
  const ms = box.querySelector('.tp-m');
  const two = n => String(n).padStart(2, '0');
  hs.replaceChildren(...Array.from({ length: 24 }, (_, i) => new Option(two(i), two(i))));
  const mins = ['00', '10', '20', '30', '40', '50'];
  if (!mins.includes(m)) mins.push(m), mins.sort();
  ms.replaceChildren(...mins.map(x => new Option(x, x)));
  hs.value = h;
  ms.value = m;
  const sync = () => { $(id).value = `${hs.value}:${ms.value}`; };
  hs.onchange = sync;
  ms.onchange = sync;
  sync();
}
function openShiftHours(s, type, m) {
  const locale = LOCALE;
  shEditing = { s, type };
  $('ex-who').textContent = `${m.name} · ${t(type.name)} · ${shDate(s.day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })}`;
  setTimePick('ex-start', s.start || type.start);
  setTimePick('ex-end', s.end || type.end);
  $('ex-usual').textContent = t('Usual hours: {h}', { h: `${type.start}–${type.end}` });
  $('ex-reset').hidden = !s.start;
  $('ex-err').textContent = '';
  $('ex-modal').hidden = false;
  $('ex-start-pick').querySelector('select').focus();
}
function closeShiftHours() { $('ex-modal').hidden = true; shEditing = null; }
$('ex-close').onclick = closeShiftHours;
$('ex-cancel').onclick = closeShiftHours;
$('ex-modal').addEventListener('click', e => { if (e.target === $('ex-modal')) closeShiftHours(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ex-modal').hidden) closeShiftHours(); });
async function saveShiftHours(start, end) {
  await api('PUT', `/api/properties/${state.property.id}/shifts/${shEditing.s.id}`, { start, end });
  closeShiftHours();
  loadShifts();
}
$('ex-reset').onclick = () => saveShiftHours(null, null).catch(err => { $('ex-err').textContent = tx(err.message); });
bindForm('form-extra', 'ex-err', async () => {
  const { type } = shEditing;
  const start = $('ex-start').value;
  const end = $('ex-end').value;
  // The usual hours again: nothing of their own to keep.
  if (start === type.start && end === type.end) await saveShiftHours(null, null);
  else await saveShiftHours(start, end);
});

$('sh-prev').onclick = () => { shFrom = shAddDays(shFrom, -7); loadShifts(); };
$('sh-next').onclick = () => { shFrom = shAddDays(shFrom, 7); loadShifts(); };
$('sh-today').onclick = () => { shFrom = shMonday(new Date()); loadShifts(); };

// Bottom left, for whoever plans the rota: the week shown replaces the week
// after (the view stays here — Bob, 27. 10.), or the week emptied.
async function shiftsWeekAction(action) {
  try {
    await api('POST', `/api/properties/${state.property.id}/shifts/week`, { from: sh.from, action });
  } catch (err) { return toast(tx(err.message)); }
  if (action === 'copy') toast(t('Copied to next week'));
  loadShifts();
}
$('sh-copy').onclick = () => {
  if (!sh || !sh.shifts.length) return toast(t('No shifts this week to copy'));
  if (confirm(t("Copy this week to next week? Next week's shifts will be replaced."))) shiftsWeekAction('copy');
};
$('sh-clear').onclick = () => {
  if (!sh || (!sh.shifts.length && !sh.notes.length)) return;
  if (confirm(t('Remove all shifts and notes from this week?'))) shiftsWeekAction('clear');
};

// ===== Settings → Shifts: the kinds of shift =====

function renderShiftTypes(types) {
  const box = $('st-items');
  box.replaceChildren();
  for (const type of types) {
    const row = document.createElement('div');
    row.className = 'ln-row st-row';
    row.dataset.key = type.key || '';
    // The order here is the order of the columns on the rota: drag the grip
    // (mouse or finger) or use the arrow keys on it. Saved with the form.
    const grip = text('button', '⠿', 'pr-grip');
    grip.type = 'button';
    grip.title = t('Drag to change the order');
    grip.setAttribute('aria-label', t('Move {name} — drag, or use the arrow keys', { name: t(type.name) || t('Shift') }));
    grip.onpointerdown = e => dragRow(e, row, () => {});
    grip.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (!to) return;
      if (e.key === 'ArrowUp') to.before(row); else to.after(row);
      grip.focus();
    };
    const name = document.createElement('input');
    name.value = t(type.name);
    name.dataset.orig = type.name;
    name.maxLength = 30;
    name.placeholder = t('e.g. Morning');
    name.setAttribute('aria-label', t('Name'));
    const start = document.createElement('input');
    start.type = 'time';
    start.value = type.start;
    start.setAttribute('aria-label', t('Starts'));
    const end = document.createElement('input');
    end.type = 'time';
    end.value = type.end;
    end.setAttribute('aria-label', t('Ends'));
    const len = text('span', '', 'muted st-len');
    const showLen = () => { len.textContent = start.value && end.value && start.value !== end.value ? fmtHours(shiftHours({ start: start.value, end: end.value })) : ''; };
    start.oninput = showLen;
    end.oninput = showLen;
    showLen();
    const del = text('button', '×', 'small');
    del.type = 'button';
    del.setAttribute('aria-label', t('Remove'));
    del.onclick = () => row.remove();
    row.append(grip, name, start, text('span', '–', 'muted'), end, len, del);
    box.append(row);
  }
}
function readShiftTypes() {
  return [...$('st-items').querySelectorAll('.st-row')].map(r => {
    const [name, start, end] = r.querySelectorAll('input');
    // An untouched default keeps its English name, so it stays translated.
    const label = name.dataset.orig && t(name.dataset.orig) === name.value ? name.dataset.orig : name.value;
    return { key: r.dataset.key || undefined, name: label, start: start.value, end: end.value };
  });
}
$('st-add').onclick = () => {
  renderShiftTypes([...readShiftTypes(), { name: '', start: '09:00', end: '17:00' }]);
  $('st-items').lastChild.querySelector('input').focus();
};
bindForm('form-shifts', 'st-err', async () => {
  const before = (state.settings && state.settings.shiftTypes) || [];
  const next = readShiftTypes();
  const gone = before.filter(b => !next.some(n => n.key === b.key));
  if (gone.length && !confirm(t('Removing {names} also removes everyone scheduled on it. Continue?', { names: gone.map(g => t(g.name)).join(', ') }))) return;
  renderSettings(await api('PUT', `/api/properties/${state.adminPropertyId}/settings`, { shiftTypes: next }));
  $('st-err').className = 'ok';
  $('st-err').textContent = t('Saved.');
  if (currentTab === 'shifts') loadShifts();
});
