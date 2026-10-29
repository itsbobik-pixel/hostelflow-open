// HostelFlow — Check-in: scanning guests, editing, sending to the police.
// Plain scripts loaded in order by index.html; they share globals.

// ===== Check-in =====

const GUEST_TYPES = [
  ['16', 'Single guest'], ['17', 'Head of family'], ['18', 'Group leader'],
  ['19', 'Family member'], ['20', 'Group member'],
];
const DOC_TYPES = [['passport', 'Passport'], ['id_card', 'ID card'], ['electronic_id', 'Italian electronic ID (CIE)'], ['driving_licence', 'Driving licence']];
const isItaly = v => /^(ita|italy|italia|italian|italiana|italiano)$/i.test(String(v || '').trim());
const isMember = f => f.guestType === '19' || f.guestType === '20';
// A family member (19) belongs to a head of family (17), a group member (20) to a group leader (18).
const leaderTypeOf = f => (f.guestType === '19' ? '17' : f.guestType === '20' ? '18' : null);

// DD.MM.YYYY in the property's time zone, offset in calendar days (not 24 h:
// the days the clocks change have 23 or 25 hours).
function dayIn(offset = 0) {
  const tz = (state.property && state.property.timezone) || 'Europe/Rome';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = t => Number(parts.find(p => p.type === t).value);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offset));
  const two = n => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
// Accepts DD.MM.YYYY, D/M/YYYY, DDMMYYYY, YYYY-MM-DD -> DD.MM.YYYY (or the input unchanged).
function normDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/) || s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

const base = () => `/api/properties/${state.property.id}/guests`;

// Two structures (Settings → Reports: two Alloggiati Web accounts): each guest
// is in one of them, picked like the nights. A new scan takes the last one
// picked on this phone. With one structure there is nothing to pick.
const ciStructures = () => (state.property && state.property.structures) || [];
const structureKey = () => `hf-structure-${state.property.id}`;
function lastStructure() {
  let v = null;
  try { v = localStorage.getItem(structureKey()); } catch { /* private mode: the main one */ }
  return ciStructures().some(x => x.id === v) ? v : 'main';
}
function structureSeg(g) {
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const x of ciStructures()) {
    const b = text('button', x.name, (g.structure || 'main') === x.id ? 'on' : '');
    b.type = 'button';
    b.onclick = e => {
      e.stopPropagation();
      g.structure = x.id;
      try { localStorage.setItem(structureKey(), x.id); } catch { /* remembered for this guest only */ }
      scheduleSave(g, 0);
      renderGuests();
    };
    seg.append(b);
  }
  return seg;
}

async function loadGuests() {
  if (!state.property) {
    $('ci-no-property').hidden = false;
    $('ci-add').hidden = true;
    return;
  }
  try {
    state.guests = await api('GET', base());
  } catch (err) {
    if (err.status === 401) return show('view-login');
    toast(err.message);
  }
  // Pre-select everything that's ready, keep manual choices for the rest.
  for (const g of state.guests) {
    if (g.status === 'draft' && !g.problems.length && !(g.lastCheck && !g.lastCheck.ok) && !state.seen.has(g.id)) state.selected.add(g.id);
    state.seen.add(g.id); // pre-select once; after that the user's choice stands
  }
  for (const id of [...state.selected]) if (!state.guests.some(g => g.id === id && g.status === 'draft')) state.selected.delete(id);
  renderGuests();
}

function guestState(g) {
  if (g.status === 'sent') return ['sent', t('Sent')];
  if (g.lastCheck && !g.lastCheck.ok) return ['error', t('Rejected')];
  if (g.problems.length) return ['fix', t('Check')];
  return ['ready', t('Ready')];
}

function duplicateOf(g) {
  const doc = (g.fields.docNumber || '').toUpperCase();
  if (!doc) return null;
  return state.guests.find(o => o.id !== g.id && (o.fields.docNumber || '').toUpperCase() === doc) || null;
}

function renderGuests() {
  const list = $('ci-list');
  list.replaceChildren();
  const drafts = state.guests.filter(g => g.status === 'draft');

  const module = state.property.registration;
  $('ci-setup').hidden = !!module;
  $('ci-setup').textContent = t(can('police')
    ? 'Police registration is not set up yet — open Settings → Reports and choose your country. You can already scan guests.'
    : 'Police registration is not set up yet — ask the owner to enter the Alloggiati login in Settings. You can already scan guests.');

  // The police login stopped working (checked every morning, src/policecheck.js): until fixed.
  const broken = !!(module && state.property.loginBroken);
  $('ci-login').hidden = !broken;
  if (broken) {
    const fix = can('police');
    $('ci-login').textContent = t(fix ? 'The Alloggiati Web login stopped working (expired password or new key?). Tap here to update it and send guests again.' : 'The Alloggiati Web login stopped working — guests can\'t be sent until the owner updates it in Settings.');
    $('ci-login').style.cursor = fix ? 'pointer' : '';
    $('ci-login').onclick = fix ? () => openSection('sec-police') : null;
  }

  const yesterday = dayIn(-1);
  const late = drafts.filter(g => normDate(g.fields.arrival) === yesterday);
  $('ci-deadline').hidden = !late.length;
  $('ci-deadline').textContent = t(late.length === 1 ? '1 guest from yesterday isn\'t registered yet. Today is the last day to send them.' : '{n} guests from yesterday aren\'t registered yet. Today is the last day to send them.', { n: late.length });

  if (state.busy.length || drafts.length) {
    const head = text('div', 'To register', 'section');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
    // Also for a single guest (Bob, 27. 10.).
    if (drafts.length) {
      const clear = text('button', t('Clear all ({n})', { n: drafts.length }), 'link');
      clear.style.cssText = 'font-size:12px;text-transform:none;letter-spacing:0;color:var(--danger)';
      clear.onclick = clearAll;
      head.append(clear);
    }
    list.append(head);
  }
  for (const b of state.busy) list.append(busyCard(b));
  for (const g of drafts) list.append(guestCard(g));
  $('ci-empty').hidden = !!(state.busy.length || state.guests.length);
  renderSendbar();
  // Check-in only to look at (Settings → Team): the guests open, nothing changes.
  if (!can('checkin')) list.querySelectorAll('input, select, textarea, .seg button, button.link, button.danger').forEach(el => { el.disabled = true; });
}

async function clearAll() {
  const ids = state.guests.filter(g => g.status === 'draft').map(g => g.id);
  if (!confirm(t(ids.length === 1 ? 'Delete 1 unregistered guest and their photo? Registered guests stay.' : 'Delete all {n} unregistered guests and their photos? Registered guests stay.', { n: ids.length }))) return;
  try {
    const r = await api('DELETE', base(), { ids });
    state.selected.clear();
    state.open = null;
    toast(t(r.deleted === 1 ? 'Deleted 1 guest' : 'Deleted {n} guests', { n: r.deleted }));
  } catch (err) { toast(err.message); }
  await loadGuests();
}

function busyCard(b) {
  const el = document.createElement('div');
  el.className = 'guest';
  const head = document.createElement('div');
  head.className = 'head';
  const sp = document.createElement('div');
  sp.className = 'spinner';
  const grow = document.createElement('div');
  grow.className = 'grow';
  grow.append(text('div', b.label, 'name'), text('div', 'Reading the document…', 'meta'));
  head.append(sp, grow);
  el.append(head);
  return el;
}

const shownGuests = new Set();
function guestCard(g) {
  const el = document.createElement('div');
  el.className = 'guest' + (shownGuests.has(g.id) ? '' : ' pop-in');
  shownGuests.add(g.id);
  el.dataset.id = g.id;
  const head = document.createElement('div');
  head.className = 'head';
  if (g.status === 'draft') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(g.id);
    cb.setAttribute('aria-label', t('Select for sending'));
    cb.onclick = e => {
      e.stopPropagation();
      cb.checked ? state.selected.add(g.id) : state.selected.delete(g.id);
      renderSendbar();
    };
    head.append(cb);
  }
  const f = g.fields;
  const grow = document.createElement('div');
  grow.className = 'grow';
  const nights = f.nights ? t(f.nights === '1' ? '1 night' : '{n} nights', { n: f.nights }) : '';
  let name, meta;
  if (g.status === 'sent') {
    // Personal data is deleted on registration; only ISTAT data remains.
    name = `Guest from ${f.nationality || '?'}`;
    meta = [`arrived ${f.arrival || '?'}`, nights, `registered ${new Date(g.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`].filter(Boolean).join(' · ');
  } else {
    name = [f.given, f.surname].filter(Boolean).join(' ') || 'Unnamed guest';
    // Closed, the nights are buttons below (no need to open the guest).
    meta = [normDate(f.arrival || '') === dayIn(-1) ? t('Arrived yesterday') : '', f.nationality, f.docNumber, state.open === g.id ? nights : ''].filter(Boolean).join(' · ') || 'No details yet';
  }
  grow.append(text('div', name, 'name'), text('div', meta, 'meta'));
  let nightsRow = null;
  if (g.status === 'draft' && state.open !== g.id) {
    nightsRow = document.createElement('div');
    const row = nightsRow;
    row.className = 'quick-head';
    const seg = document.createElement('div');
    seg.className = 'seg';
    row.append(text('span', 'Nights', 'qh-label'), seg);
    for (const v of ['1', '2', '3', '4', '5', '6', '7']) {
      const b = text('button', v, (f.nights || (nightsMissed(g) ? '' : '1')) === v ? 'on' : '');
      b.type = 'button';
      b.setAttribute('aria-label', t(v === '1' ? '1 night' : '{n} nights', { n: v }));
      b.onclick = e => {
        e.stopPropagation();
        f.nights = v;
        scheduleSave(g, 0);
        renderGuests();
      };
      seg.append(b);
    }
    // More than 7: shown as its own (on) button; changed inside the guest.
    if (f.nights && Number(f.nights) > 7) seg.append(text('button', f.nights, 'on'));
  }
  let structureRow = null;
  if (g.status === 'draft' && state.open !== g.id && ciStructures().length) {
    structureRow = document.createElement('div');
    structureRow.className = 'quick-head';
    structureRow.append(text('span', 'Structure', 'qh-label'), structureSeg(g));
  }
  const [cls, label] = guestState(g);
  head.append(grow, text('span', label, `state ${cls}`));
  // The nights under the name, as wide as the card (state stays top right).
  if (nightsRow) head.append(nightsRow);
  // Seen without opening the guest.
  if (nightsRow && nightsMissed(g)) head.append(nightsWarning(g, 'quick-head qh-warn'));
  if (structureRow) head.append(structureRow);
  head.onclick = () => {
    state.open = state.open === g.id ? null : g.id;
    renderGuests();
  };
  el.append(head);
  el.classList.toggle('open', state.open === g.id);
  if (state.open === g.id) el.append(guestEditor(g));
  return el;
}


function field(g, key, label, opts = {}) {
  const wrap = document.createElement('div');
  if (opts.full) wrap.className = 'full';
  const id = `gf-${g.id}-${key}`;
  const l = text('label', label);
  l.htmlFor = id;
  let input;
  if (opts.options) {
    input = document.createElement('select');
    input.append(new Option(opts.placeholder ? t(opts.placeholder) : '—', ''), ...opts.options.map(([v, label]) => new Option(t(label), v)));
    input.value = g.fields[key] || opts.default || '';
    if (!g.fields[key] && opts.default && g.status === 'draft') g.fields[key] = opts.default;
  } else {
    input = document.createElement('input');
    input.value = g.fields[key] || opts.default || '';
    if (!g.fields[key] && opts.default && g.status === 'draft') g.fields[key] = opts.default;
    if (opts.placeholder) input.placeholder = t(opts.placeholder);
    if (opts.inputmode) input.inputMode = opts.inputmode;
    input.autocomplete = 'off';
    input.autocapitalize = opts.caps || 'characters';
    input.spellcheck = false;
  }
  input.id = id;
  input.dataset.key = key;
  input.disabled = g.status === 'sent';
  wrap.append(l, input);
  // One tap instead of the keyboard (nights: 1–7), in one row with the field
  // (still there for more nights).
  if (opts.quick && g.status !== 'sent') {
    wrap.className = 'full';
    const row = document.createElement('div');
    row.className = 'quick';
    const seg = document.createElement('div');
    seg.className = 'seg';
    const mark = () => { for (const b of seg.children) b.classList.toggle('on', b.textContent === input.value); };
    for (const v of opts.quick) {
      const b = text('button', v);
      b.type = 'button';
      b.onclick = () => {
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        mark();
      };
      seg.append(b);
    }
    input.addEventListener('input', mark);
    mark();
    row.append(seg, input);
    wrap.append(row);
  }
  return wrap;
}

// Cloudbeds was asked and had no booking for this guest, and nobody has
// picked the nights yet.
const nightsMissed = g => g.status === 'draft' && !g.fields.nights && !!(g.ocr && g.ocr.nightsMissed);
// …because Cloudbeds didn't answer in time (or at all): worth asking again.
const cloudbedsLate = g => nightsMissed(g) && ['slow', 'error'].includes((g.ocr.nightsWhy || {}).reason);
const nightsAsking = new Set();
// Asks Cloudbeds again, waiting longer; the guest's card updates either way.
async function retryNights(g) {
  if (nightsAsking.has(g.id)) return;
  nightsAsking.add(g.id);
  renderGuests();
  try {
    const fresh = await api('POST', `${base()}/${g.id}/nights`);
    const now = state.guests.find(o => o.id === g.id);
    // Nights picked by hand meanwhile: those stay.
    if (now && !now.fields.nights) Object.assign(now, { fields: fresh.fields, ocr: fresh.ocr, problems: fresh.problems });
  } catch (err) {
    toast(tx(err.message));
  }
  nightsAsking.delete(g.id);
  renderGuests();
}
// The warning about the nights: on the closed card and inside the guest.
function nightsWarning(g, cls) {
  const box = document.createElement('div');
  box.className = cls;
  if (nightsAsking.has(g.id)) {
    box.append(text('span', t('Asking Cloudbeds again…')));
    return box;
  }
  box.append(text('span', t(cloudbedsLate(g) ? 'Cloudbeds didn\'t answer. Fill in the nights.' : 'Not found in Cloudbeds. Fill in the nights.')));
  if (cloudbedsLate(g)) {
    const again = text('button', t('Try again'), 'link');
    again.type = 'button';
    again.onclick = e => { e.stopPropagation(); retryNights(g); };
    box.append(' ', again);
  }
  return box;
}

// The guest scanned just before or after this one whose nights came from a
// Cloudbeds booking (same arrival, within 20 minutes), when this one found none.
function bookingMate(g) {
  // Nights already picked (by hand too): nothing to offer.
  if (g.status !== 'draft' || g.fields.nights || !g.ocr || g.ocr.nightsFrom || g.ocr.error || !g.hasPhoto) return null;
  const near = state.guests.filter(o => o.id !== g.id && o.ocr && o.ocr.nightsFrom === 'cloudbeds' && o.fields.nights
    && o.fields.arrival === g.fields.arrival && Math.abs(o.createdAt - g.createdAt) < 20 * 60 * 1000);
  if (!near.length) return null;
  near.sort((a, b) => Math.abs(a.createdAt - g.createdAt) - Math.abs(b.createdAt - g.createdAt));
  return near[0];
}

function guestEditor(g) {
  const body = document.createElement('div');
  body.className = 'body';
  if (g.hasPhoto) {
    const img = document.createElement('img');
    img.className = 'photo';
    img.alt = t('Document photo');
    img.src = `${base()}/${g.id}/photo`;
    img.onclick = () => zoom(img.src);
    body.append(img);
  }

  const notes = [];
  if (g.ocr && g.ocr.error) notes.push(['warn', [g.ocr.error]]);
  else if (g.ocr && (g.ocr.notes || g.ocr.confidence === 'low')) notes.push(['warn', [t('Check carefully: {note}', { note: g.ocr.notes || t('the photo is hard to read') })]]);
  if (g.ocr && g.ocr.nightsFrom === 'cloudbeds') notes.push(['info', [t('Nights from Cloudbeds. Change them if needed.')]]);
  const dup = duplicateOf(g);
  if (dup) notes.push(['warn', [t('Same document as {name}. Scanned twice?', { name: [dup.fields.given, dup.fields.surname].filter(Boolean).join(' ') || t('another guest') })]]);
  // The police don't need it, ISTAT does — and there's no "unknown" province.
  // (Born in Italy: ISTAT counts them in the province of birth, src/stats/istat.js.)
  if ((state.property.registration || 'it-alloggiati') === 'it-alloggiati' && livesInItaly(g.fields) && !g.fields.residenceProvince && !g.fields.birthProvince) notes.push(['warn', [t('Add the province of residence too. The police don\'t need it, but ISTAT does.')]]);
  if (g.lastCheck && !g.lastCheck.ok && g.lastCheck.errors.length) notes.push(['danger', g.lastCheck.errors.map(e => t('Portal: {e}', { e }))]);
  for (const [cls, items] of notes) {
    const box = document.createElement('div');
    box.className = `notes ${cls}`;
    fillProblems(box, items);
    body.append(box);
  }
  // Cloudbeds often names only whoever booked: the rest of the group gets
  // that booking's nights offered, one tap — never filled in by itself.
  const mate = bookingMate(g);
  if (mate) {
    const box = document.createElement('div');
    box.className = 'notes info mate-nights';
    const n = mate.fields.nights;
    box.append(text('span', t('With {name}? Their Cloudbeds booking: {nights}.', {
      name: [mate.fields.given, mate.fields.surname].filter(Boolean).join(' '),
      nights: t(n === '1' ? '1 night' : '{n} nights', { n }),
    })));
    const use = text('button', t('Same nights'), 'small');
    use.type = 'button';
    use.onclick = () => { g.fields.nights = n; scheduleSave(g, 0); renderGuests(); };
    box.append(use);
    body.append(box);
  } else if (nightsMissed(g)) {
    body.append(nightsWarning(g, 'notes warn'));
  }
  // Kept in place (updated on every save), so typing never re-renders the form.
  const problems = document.createElement('div');
  problems.className = 'notes danger problems';
  fillProblems(problems, g.problems);
  body.append(problems);

  const f = g.fields;
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.append(
    field(g, 'surname', 'Surname'),
    field(g, 'given', 'Given names'),
    field(g, 'sex', 'Sex', { options: [['M', 'Male'], ['F', 'Female']] }),
    field(g, 'dob', 'Date of birth', { placeholder: 'DD.MM.YYYY', inputmode: 'numeric' }),
    field(g, 'nationality', 'Nationality', { placeholder: 'e.g. CZE or Germany' }),
    field(g, 'docType', 'Document', { options: DOC_TYPES, default: 'passport' }),
    field(g, 'docNumber', 'Document number'),
    field(g, 'country', 'Issued by (country)', { placeholder: 'same as nationality' }),
    field(g, 'birthCountry', 'Born in (country)', { placeholder: 'same as nationality' }),
    field(g, 'arrival', 'Arrival', { placeholder: 'DD.MM.YYYY', inputmode: 'numeric' }),
    // Not found in Cloudbeds: left empty, so nobody sends 1 night without choosing.
    field(g, 'nights', 'Nights', { inputmode: 'numeric', default: nightsMissed(g) ? undefined : '1', quick: ['1', '2', '3', '4', '5', '6', '7'] }),
  );
  // What the police of this country asks for besides the usual.
  const system = state.property.registration || 'it-alloggiati';
  if (system === 'it-alloggiati') {
    if (bornInItaly(f)) {
      grid.append(field(g, 'birthPlace', 'Born in (town)'), field(g, 'birthProvince', 'Province (e.g. SP)'));
    }
    if (isItaly(f.country) || (!f.country && isItaly(f.nationality))) {
      grid.append(field(g, 'issuePlace', 'Issued in (town, or country if by a consulate)'), field(g, 'issueProvince', 'Province'));
    }
  }
  if (system === 'cz-ubyport') {
    grid.append(field(g, 'visa', 'Visa number (if any)'), field(g, 'homeAddress', 'Home address', { placeholder: 'town, country' }));
  }
  if (system === 'fr-fiche') {
    grid.append(
      field(g, 'birthPlace', 'Place of birth (town)'),
      field(g, 'homeAddress', 'Home address', { placeholder: 'street, town, country' }),
      field(g, 'phone', 'Mobile phone (optional)', { inputmode: 'tel' }),
      field(g, 'email', 'E-mail (optional)', { inputmode: 'email' }),
    );
  }
  // ISTAT counts guests by residence; most live where their passport is from.
  grid.append(field(g, 'residenceCountry', 'Lives in (country)', { placeholder: 'same as nationality', full: !(system === 'it-alloggiati' && livesInItaly(f)) }));
  if (system === 'it-alloggiati' && livesInItaly(f)) {
    // The regional statistics (Ross1000) want the comune as well.
    grid.append(field(g, 'residenceProvince', 'Province of residence', { placeholder: 'e.g. SP' }), field(g, 'residencePlace', 'Town of residence', { full: true }));
  }
  // Families and groups are an Alloggiati idea; elsewhere everyone is a guest of their own.
  if (system === 'it-alloggiati') grid.append(field(g, 'guestType', 'Type', { options: GUEST_TYPES, default: '16', full: !isMember(f) }));
  if (system === 'it-alloggiati' && isMember(f)) {
    const leaders = state.guests.filter(o => o.id !== g.id && o.status === 'draft' && o.fields.guestType === leaderTypeOf(f))
      .map(o => [o.id, [o.fields.given, o.fields.surname].filter(Boolean).join(' ') || 'Unnamed']);
    const none = f.guestType === '20' ? 'no group leader yet' : 'no head of family yet';
    grid.append(field(g, 'groupLeader', 'Belongs to', { options: leaders, placeholder: leaders.length ? 'choose…' : none }));
  }
  if (g.status === 'draft' && ciStructures().length) {
    const wrap = document.createElement('div');
    wrap.className = 'full';
    const row = document.createElement('div');
    row.className = 'quick';
    row.append(structureSeg(g));
    wrap.append(text('label', 'Structure'), row);
    grid.append(wrap);
  }
  body.append(grid);
  grid.dataset.layout = layoutKey(f);

  if (g.status === 'draft') {
    // g.fields is the single source of truth: every keystroke lands there at
    // once, saving is debounced, and a re-render never loses what was typed.
    grid.addEventListener('input', e => {
      const key = e.target.dataset.key;
      if (!key) return;
      // The iPhone number pad has no dot: put it in after the day and the
      // month, so 01051990 comes out as 01.05.1990 (deleting leaves it alone).
      if ((key === 'dob' || key === 'arrival') && /^insert/.test(e.inputType || '') && /^(\d{2}|\d{2}\.\d{2})$/.test(e.target.value)) e.target.value += '.';
      g.fields[key] = e.target.value;
      scheduleSave(g, e.target.tagName === 'SELECT' ? 0 : 700);
    });
    grid.addEventListener('change', e => {
      const key = e.target.dataset.key;
      if (!key) return;
      if (key === 'dob' || key === 'arrival') e.target.value = normDate(e.target.value);
      g.fields[key] = e.target.value;
      scheduleSave(g, 0);
      if (layoutKey(g.fields) !== grid.dataset.layout) {
        // Some fields appear or disappear (Italian birth place, "Belongs to").
        // Wait a tick: when leaving a field by tapping another, focus moves
        // after 'change' — re-focus that next field in the new form.
        setTimeout(() => {
          const focused = document.activeElement && document.activeElement.dataset.key;
          renderGuests();
          const again = focused && document.querySelector(`.guest[data-id="${g.id}"] [data-key="${focused}"]`);
          if (again) again.focus();
        });
      }
    });
  }

  const foot = document.createElement('div');
  foot.className = 'foot';
  const info = text('span', 'Changes save automatically', 'muted');
  info.id = `gs-${g.id}`;
  const del = text('button', 'Delete', 'small danger');
  del.onclick = async () => {
    if (!confirm(t('Delete this guest?'))) return;
    try {
      await api('DELETE', `${base()}/${g.id}`);
      state.guests = state.guests.filter(o => o.id !== g.id);
      state.selected.delete(g.id);
      renderGuests();
    } catch (err) {
      toast(err.message);
      // Registered meanwhile (from another phone): show it as it is now.
      if (err.status === 409) loadGuests();
    }
  };
  foot.append(info, del);
  body.append(foot);
  return body;
}

function fillProblems(box, items) {
  const ul = document.createElement('ul');
  for (const i of items) ul.append(text('li', i));
  box.replaceChildren(ul);
  box.hidden = !items.length;
}

// Which optional fields the editor shows; a change means re-rendering it.
const livesInItaly = f => isItaly(f.residenceCountry) || (!f.residenceCountry && isItaly(f.nationality));
// Comune and province of birth only for someone born in Italy: an Italian
// born in Argentina gets "Born in (country)" = Argentina, and no comune.
const bornInItaly = f => isItaly(f.birthCountry) || (!f.birthCountry && isItaly(f.nationality));
const layoutKey = f => [
  bornInItaly(f),
  isItaly(f.country) || (!f.country && isItaly(f.nationality)),
  livesInItaly(f),
  isMember(f),
].join();

const saveTimers = new Map();
function scheduleSave(g, delay) {
  clearTimeout(saveTimers.get(g.id));
  saveTimers.set(g.id, setTimeout(() => saveGuest(g), delay));
}

async function saveGuest(g) {
  const fields = { ...g.fields };
  for (const k of ['dob', 'arrival']) if (fields[k]) fields[k] = normDate(fields[k]);
  const info = $(`gs-${g.id}`);
  if (info) info.textContent = t('Saving…');
  try {
    const updated = await api('PUT', `${base()}/${g.id}`, ciStructures().length ? { fields, structure: g.structure || 'main' } : { fields });
    // Keep g.fields (it may have changed while saving); take the verdict.
    g.problems = updated.problems;
    g.lastCheck = updated.lastCheck;
    if (!g.problems.length) state.selected.add(g.id);
    // Refresh the header and problem list without rebuilding the inputs being typed in.
    const card = $('ci-list').querySelector(`.guest[data-id="${g.id}"]`);
    if (card) {
      const [cls, label] = guestState(g);
      const st = card.querySelector('.state');
      st.className = `state ${cls}`;
      st.textContent = label;
      const f = g.fields;
      card.querySelector('.name').textContent = [f.given, f.surname].filter(Boolean).join(' ') || t('Unnamed guest');
      card.querySelector('.head input[type=checkbox]').checked = state.selected.has(g.id);
      const box = card.querySelector('.problems');
      if (box) fillProblems(box, g.problems);
    }
    if (info) info.textContent = t('Saved');
    renderSendbar();
  } catch (err) {
    if (info) info.textContent = tx(err.message);
  }
}

function zoom(src) {
  const z = document.createElement('div');
  z.className = 'zoom';
  const img = document.createElement('img');
  img.src = src;
  z.append(img);
  z.onclick = () => z.remove();
  document.body.append(z);
}

function renderSendbar() {
  const onCheckin = !$('view-app').hidden && !$('tab-checkin').hidden;
  const n = state.selected.size;
  $('ci-sendbar').hidden = !onCheckin || !state.guests.some(g => g.status === 'draft');
  $('ci-send').textContent = n ? t(n === 1 ? 'Send 1 guest' : 'Send {n} guests', { n }) : t('Select guests to send');
  $('ci-send').disabled = !n || !state.property.registration;
  $('ci-test').disabled = !n || !state.property.registration;
}

async function submit(mode) {
  const ids = [...state.selected];
  if (mode === 'send' && !confirm(t(ids.length === 1 ? "Register 1 guest with the police (Alloggiati Web)? This can't be undone here." : "Register {n} guests with the police (Alloggiati Web)? This can't be undone here.", { n: ids.length }))) return;
  $('ci-send').disabled = $('ci-test').disabled = true;
  $('ci-send').textContent = t(mode === 'send' ? 'Sending…' : 'Testing…');
  try {
    let r;
    try {
      r = await api('POST', `${base()}/send`, { ids, mode });
    } catch (err) {
      if (!(err.status === 409 && err.data && err.data.code === 'duplicate')) throw err;
      const list = err.data.duplicates.map(d => `• ${tx(d)}`).join('\n');
      if (!confirm(t('This guest may already be registered:\n\n{list}\n\nSend anyway?', { list }))) {
        toast('Nothing was sent');
        return;
      }
      r = await api('POST', `${base()}/send`, { ids, mode, allowDuplicates: true });
    }
    const bad = r.results.filter(x => !x.ok).length;
    if (r.mode === 'send') {
      toast(t(ids.length === 1 ? '✓ 1 guest registered' : '✓ {n} guests registered', { n: ids.length }));
      for (const id of ids) state.selected.delete(id);
    } else if (r.ok) {
      toast(mode === 'send' ? 'Nothing was sent.' : '✓ Test passed — ready to send');
    } else {
      toast(t(bad === 1 ? '1 guest needs fixing — nothing was sent' : '{n} guests need fixing — nothing was sent', { n: bad }));
      const first = r.results.find(x => !x.ok);
      if (first) state.open = first.id;
    }
  } catch (err) {
    toast(err.message);
  } finally {
    await loadGuests(); // also re-enables the buttons
  }
}
$('ci-send').onclick = () => submit('send');
$('ci-test').onclick = () => submit('test');

// Downscale to keep uploads small (D1 row limit) and fast on mobile data.
// iPhone photos (HEIC) open in Safari but not in Chrome or Firefox: those are
// converted to JPEG first, on a separate page (heic.html) that is allowed to
// run the converter. Loaded only when a HEIC photo comes along.
const isHeic = file => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
let heicFrame = null;
function heicToJpeg(file) {
  if (!heicFrame) {
    heicFrame = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.src = '/heic.html';
      frame.hidden = true;
      const ready = e => {
        if (e.origin === location.origin && e.data && e.data.heicReady) { removeEventListener('message', ready); resolve(frame); }
      };
      addEventListener('message', ready);
      setTimeout(() => reject(new Error(t('the iPhone photo converter did not load'))), 20000);
      document.body.append(frame);
    });
    heicFrame.catch(() => { heicFrame = null; });
  }
  return heicFrame.then(frame => new Promise((resolve, reject) => {
    const heicId = Math.random().toString(36).slice(2);
    const done = e => {
      if (e.origin !== location.origin || !e.data || e.data.heicId !== heicId) return;
      removeEventListener('message', done);
      if (e.data.blob) resolve(e.data.blob); else reject(new Error(t('couldn\'t open this iPhone photo. Try again or use a JPEG.')));
    };
    addEventListener('message', done);
    frame.contentWindow.postMessage({ heicId, blob: file }, location.origin);
  }));
}

async function resizePhoto(file, maxSide = 1200) {
  try {
    return await drawSmaller(file, maxSide);
  } catch (err) {
    if (!isHeic(file)) throw err;
    return drawSmaller(await heicToJpeg(file), maxSide);
  }
}

function drawSmaller(file, maxSide) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let q = 0.85, out = canvas.toDataURL('image/jpeg', q);
      while (out.length > 1_400_000 && q > 0.4) out = canvas.toDataURL('image/jpeg', q -= 0.15);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('this file is not a photo'))); };
    img.src = url;
  });
}

// When the photo was taken (DD.MM.YYYY): the camera's own date in the photo
// (EXIF — in JPEG and in the iPhone's HEIC alike), else the file's date.
// Read before resizing — the smaller copy has none.
function exifDay(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // "Exif\0\0" followed by a TIFF header ("II*\0" or "MM\0*"): the same in both formats.
  for (let i = 0; i + 14 < bytes.length; i++) {
    if (bytes[i] !== 0x45 || bytes[i + 1] !== 0x78 || bytes[i + 2] !== 0x69 || bytes[i + 3] !== 0x66 || bytes[i + 4] || bytes[i + 5]) continue;
    const t = i + 6;
    const le = bytes[t] === 0x49 && bytes[t + 1] === 0x49;
    if (!le && !(bytes[t] === 0x4D && bytes[t + 1] === 0x4D)) continue;
    try {
      const u16 = q => v.getUint16(t + q, le), u32 = q => v.getUint32(t + q, le);
      if (u16(2) !== 42) continue;
      const find = (dir, tag) => { for (let k = 0, n = u16(dir); k < n; k++) if (u16(dir + 2 + k * 12) === tag) return dir + 2 + k * 12; return null; };
      const exif = find(u32(4), 0x8769);
      const entry = exif !== null && (find(u32(exif + 8), 0x9003) ?? find(u32(exif + 8), 0x9004));
      if (!entry) continue;
      const at = t + u32(entry + 8);
      const m = String.fromCharCode(...bytes.subarray(at, at + 10)).match(/^(\d{4}):(\d{2}):(\d{2})$/);
      if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    } catch { /* not a readable block — keep looking */ }
  }
  return null;
}
async function photoDay(file) {
  try {
    // Usually near the start; a HEIC can keep it further in.
    const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
    const day = exifDay(head) || (file.size > head.length && file.size < 40 * 1024 * 1024 ? exifDay(new Uint8Array(await file.arrayBuffer())) : null);
    if (day) return day;
  } catch { /* no readable date in the photo */ }
  if (!file.lastModified) return null;
  const tz = (state.property && state.property.timezone) || 'Europe/Rome';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(file.lastModified));
  const get = k => parts.find(x => x.type === k).value;
  return `${get('day')}.${get('month')}.${get('year')}`;
}

// Add manually: an empty guest, opened to be typed in (for a guest who'd rather
// not have their document photographed). Nothing is read, so no scan is used.
async function addGuestByHand() {
  $('ci-manual').disabled = true;
  try {
    const where = ciStructures().length ? { structure: lastStructure() } : {};
    const g = await api('POST', base(), { fields: {}, ...where });
    state.guests = [g, ...state.guests.filter(o => o.id !== g.id)];
    state.open = g.id;
    renderGuests();
    const card = document.querySelector('#ci-list .open input, #ci-list .open select');
    if (card) card.focus();
  } catch (err) { toast(tx(err.message)); }
  finally { $('ci-manual').disabled = false; }
}
$('ci-manual').onclick = addGuestByHand;

$('ci-files').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if ($('tab-checkin').hidden) showTab('checkin'); // picked from the "+" on another screen
  const jobs = files.map((file, i) => ({ file, label: files.length > 1 ? t('Photo {i} of {n}', { i: i + 1, n: files.length }) : t('New guest') }));
  state.busy.push(...jobs);
  renderGuests();
  // Two at a time: fast enough, and gentle on a phone's connection.
  const queue = [...jobs];
  const worker = async () => {
    for (let job; (job = queue.shift());) {
      try {
        // A photo from yesterday (uploaded today with the rest): the guest arrived yesterday —
        // for Alloggiati and ISTAT. Older ones keep today: Alloggiati takes only today or yesterday.
        const taken = await photoDay(job.file);
        const image = await resizePhoto(job.file);
        const where = ciStructures().length ? { structure: lastStructure() } : {};
        let g = await api('POST', base(), taken === dayIn(-1) ? { image, fields: { arrival: taken }, ...where } : { image, ...where });
        state.guests = [g, ...state.guests.filter(o => o.id !== g.id)]; // the list may have reloaded meanwhile
        if (!g.problems.length) state.selected.add(g.id);
        if (cloudbedsLate(g)) retryNights(g); // in the background: the next photo goes on
      } catch (err) {
        toast(`${job.label}: ${tx(err.message)}`);
      }
      state.busy = state.busy.filter(b => b !== job);
      renderGuests();
    }
  };
  await Promise.all([worker(), worker()]);
});
