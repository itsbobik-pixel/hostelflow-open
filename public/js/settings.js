// HostelFlow — Settings: team, property and rooms, police registration, subscription.
// Plain scripts loaded in order by index.html; they share globals.

// ===== Settings: team =====

async function loadStaff() {
  const pid = state.adminPropertyId;
  // The team only to look at (Settings → Team, View): no inviting, adding or removing.
  const manage = can('team');
  // Inviting by e-mail is switched off for now (Bob, 24. 10.): people are added by name.
  $('form-invite').hidden = true;
  $('pf-open').hidden = !manage;
  $('invite-list').replaceChildren();
  if (manage) {
    renderInviteRoles();
    loadInvites().catch(() => {});
  }
  const members = await api('GET', `/api/properties/${pid}/staff`);
  const list = $('staff-list');
  list.replaceChildren();
  // Just the names; a tap opens the person (openMember). Owners are opened
  // only by themselves, the others by whoever manages the team.
  for (const m of members) {
    const self = m.id === state.me.user.id;
    const opens = self || (manage && m.role !== 'owner');
    const row = document.createElement(opens ? 'button' : 'div');
    row.className = 'row member';
    if (opens) {
      row.type = 'button';
      row.onclick = () => openMember(pid, m);
    }
    const dot = document.createElement('span');
    dot.className = 'member-dot';
    dot.style.background = colorOf(m.name || m.email, m.color);
    const name = document.createElement('span');
    name.className = 'grow';
    name.textContent = m.showNickname && m.nickname ? m.nickname : m.name || m.email; // a person's own name: never translated
    row.append(dot, name);
    if (m.role === 'owner') row.append(text('span', 'Owner', 'pill'));
    if (opens) row.append(Object.assign(document.createElement('span'), { className: 'member-chev', textContent: '›' }));
    list.append(row);
  }
}

// What each person may do (src/auth.js AREAS): for each area no access,
// View or Edit, as the owner sets it. Owners can do everything.
const AREA_LABELS = {
  checkin: ['Check-in', 'See the guests and the statistics', 'Scan, correct and register guests with the police'],
  notes: ['Notes', 'Read the notes', 'Write notes, replies and likes'],
  moderate: ["Everyone's notes", '', 'Edit and delete other people\'s notes and replies'],
  attention: ['Needs attention', 'See it', 'Add and clear items'],
  guidelines: ['Guidelines', 'See tasks and tick them off', 'Change the shift guidelines'],
  housekeeping: ['Housekeeping', 'See the beds and the linen', 'Mark linen, sheets and tasks done'],
  shifts: ['Shifts', 'See the rota', 'Plan who works when, and set up shift types'],
  calendar: ['Calendar', 'See the reservations', 'Add and change reservations'],
  vault: ['The Vault', 'Read it', 'Add, rename, move and delete pages and files'],
  police: ['Police registration', 'See the connection status and AI scans', 'Change the Alloggiati Web login'],
  team: ['Team', 'See who is on the team', 'Invite and remove people'],
};
const EDIT_ONLY_AREAS = ['moderate'];
// Someone new (src/auth.js DEFAULT_LEVELS): sees everything but check-in, writes notes, does the housekeeping.
const DEFAULT_LEVELS = { notes: 'edit', attention: 'read', guidelines: 'read', housekeeping: 'edit', shifts: 'read', calendar: 'read', vault: 'read', police: 'read', team: 'read' };
// The areas this property has: no Dashboard, Housekeeping or Shifts on check-in only; the Calendar in preview.
const shownAreas = () => Object.keys(AREA_LABELS).filter(a => (fullApp() || !['notes', 'moderate', 'attention', 'guidelines', 'housekeeping', 'shifts'].includes(a)) && (a !== 'calendar' || inPreview()));

// A switch per area (Bob, 24. 10.: Yes/No is enough). On = Edit; off = they
// only see it — but no access at all to Check-in (the guests' data) and to
// everyone's notes. The server keeps the three levels (src/auth.js), so an
// area left untouched keeps what it had. onChange(levels) after each tap
// (the caller decides when to save).
const offLevel = area => (area === 'checkin' || EDIT_ONLY_AREAS.includes(area) ? '' : 'read');
function levelRows(box, levels, onChange) {
  for (const area of shownAreas()) {
    const [label, readHelp, editHelp] = AREA_LABELS[area];
    const row = document.createElement('label');
    row.className = 'access-row level-row';
    const words = document.createElement('span');
    const on = levels[area] === 'edit';
    words.append(text('b', label), text('small', on ? editHelp : offLevel(area) ? readHelp : t('No access')));
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'switch';
    sw.checked = on;
    sw.onchange = () => {
      const next = { ...levels };
      const value = sw.checked ? 'edit' : offLevel(area);
      if (value) next[area] = value; else delete next[area];
      onChange(next);
    };
    row.append(words, sw);
    box.append(row);
  }
}

// ----- A person on the team: a tap on their name in Settings → Team -----
// Name, nickname (and which of the two their name tag shows), colour, e-mail,
// password, access and removing them, in one window; Save sends it all.
let mbMember = null;
let mbLevels = null;
let mbColor = null;
let mbShow = false;
function renderMemberShow() {
  const nick = !!$('mb-nick').value.trim();
  if (!nick) mbShow = false;
  for (const b of $('mb-show').children) {
    const on = (b.dataset.tag === 'nick') === mbShow;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('mb-show').lastElementChild.disabled = !nick;
}
$('mb-nick').oninput = renderMemberShow;
for (const b of $('mb-show').children) b.onclick = () => { mbShow = b.dataset.tag === 'nick'; renderMemberShow(); };
function renderMemberColors() {
  $('mb-colors').replaceChildren(...PERSON_COLORS.map(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'um-color' + (c === mbColor ? ' on' : '');
    b.style.background = c;
    b.setAttribute('aria-label', c);
    b.setAttribute('aria-pressed', c === mbColor ? 'true' : 'false');
    b.onclick = () => { mbColor = c; renderMemberColors(); };
    return b;
  }));
}
function renderMemberLevels() {
  $('mb-perms').replaceChildren();
  levelRows($('mb-perms'), mbLevels, next => { mbLevels = next; renderMemberLevels(); });
}
function openMember(pid, m) {
  mbMember = { pid, m };
  const self = m.id === state.me.user.id;
  const owner = !!(state.property && state.property.role === 'owner');
  $('mb-title').textContent = m.name || m.email; // a person's own name: never translated
  $('mb-name').value = m.name || '';
  $('mb-nick').value = m.nickname || '';
  mbShow = !!m.showNickname;
  renderMemberShow();
  // The colour is picked here: a profile's by the owner, your own in your own window.
  mbColor = m.color || null;
  $('mb-color-wrap').hidden = !(m.profile || self);
  renderMemberColors();
  // An e-mail for someone added without one: then they sign in on their own phone too.
  $('mb-email-wrap').hidden = !m.profile || self;
  $('mb-email').value = '';
  $('mb-email-shown').hidden = !!m.profile || !m.email;
  $('mb-email-shown').textContent = m.email || '';
  // What they may do: the owner decides, for everyone but owners.
  const access = owner && !self && m.role !== 'owner';
  $('mb-access-wrap').hidden = !access;
  mbLevels = { ...(m.levels || {}) };
  if (access) renderMemberLevels();
  $('mb-owner').hidden = !access || !!m.profile;
  $('mb-more').hidden = self;
  $('mb-pass').textContent = t(m.profile && !m.password ? 'Set password' : 'New password');
  $('mb-nopass').hidden = !(m.profile && m.password);
  $('mb-err').textContent = '';
  $('mb-modal').hidden = false;
}
function closeMember() { $('mb-modal').hidden = true; mbMember = null; }
$('mb-close').onclick = closeMember;
$('mb-cancel').onclick = closeMember;
$('mb-modal').addEventListener('click', e => { if (e.target === $('mb-modal')) closeMember(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('mb-modal').hidden) closeMember(); });
bindForm('form-member', 'mb-err', async () => {
  const { pid, m } = mbMember;
  const self = m.id === state.me.user.id;
  // Only what changed: someone who also works elsewhere keeps their own name.
  const body = {};
  const name = $('mb-name').value.trim();
  const nickname = $('mb-nick').value.trim() || null;
  if (name !== (m.name || '')) body.name = name;
  if (nickname !== (m.nickname || null)) body.nickname = nickname;
  if (mbShow !== !!m.showNickname) body.showNickname = mbShow;
  const color = mbColor && mbColor !== m.color ? mbColor : null;
  if (self) {
    if (color) body.color = color;
    if (Object.keys(body).length) { Object.assign(state.me, await api('PUT', '/api/me', body)); renderUserButton(); }
  } else {
    const email = $('mb-email-wrap').hidden ? '' : $('mb-email').value.trim();
    if (email) body.email = email;
    let r = null;
    if (Object.keys(body).length) r = await api('PUT', `/api/properties/${pid}/staff/${m.id}`, body);
    if (color && m.profile) await api('PUT', `/api/properties/${pid}/staff/${m.id}/color`, { color });
    const levelsChanged = JSON.stringify(Object.entries(mbLevels).sort()) !== JSON.stringify(Object.entries(m.levels || {}).sort());
    if (!$('mb-access-wrap').hidden && levelsChanged) await api('PUT', `/api/properties/${pid}/staff/${m.id}/access`, { levels: mbLevels });
    if (email) alert(t(r && r.emailed
      ? 'We sent {email} a link to choose their password. Until then they sign in on this device as before.'
      : 'E-mail saved. Set a password for them with New password, then they can sign in with {email}.', { email }));
  }
  closeMember();
  toast(t('Saved'));
  loadStaff();
});
$('mb-pass').onclick = async () => {
  const { pid, m } = mbMember;
  const pw = prompt(t('New password for {name} (at least 8 characters):', { name: m.name || m.email }));
  if (!pw) return;
  try {
    await api('POST', `/api/properties/${pid}/staff/${m.id}/password`, { password: pw });
    closeMember();
    alert(t('Password changed.'));
    loadStaff();
  } catch (err) { alert(tx(err.message)); }
};
$('mb-nopass').onclick = async () => {
  const { pid, m } = mbMember;
  if (!confirm(t("Remove {name}'s password? They'll sign in by tapping their name.", { name: m.name }))) return;
  try { await api('POST', `/api/properties/${pid}/staff/${m.id}/password`, { password: null }); closeMember(); loadStaff(); }
  catch (err) { alert(tx(err.message)); }
};
$('mb-remove').onclick = async () => {
  const { pid, m } = mbMember;
  if (!confirm(t('Remove {name} from the team?', { name: m.name || m.email }))) return;
  try { await api('DELETE', `/api/properties/${pid}/staff/${m.id}`); closeMember(); loadStaff(); }
  catch (err) { alert(tx(err.message)); }
};
// Someone with an e-mail can become an owner (a name without one can't).
$('mb-owner').onclick = async () => {
  const { pid, m } = mbMember;
  if (!confirm(t('Make {name} an owner? Owners can do everything, including billing and the team. Only they can remove themselves.', { name: m.name || m.email }))) return;
  try { await api('PUT', `/api/properties/${pid}/staff/${m.id}/access`, { role: 'owner' }); closeMember(); loadStaff(); }
  catch (err) { alert(tx(err.message)); }
};

// Invites: an e-mail; an owner can make the new person an owner too.
// Everyone else starts with DEFAULT_LEVELS (changed later under Access).
function renderInviteRoles() {
  const owner = !!(state.property && state.property.role === 'owner');
  $('iv-owner-row').hidden = !owner;
  if (!owner) $('iv-owner').checked = false;
  $('iv-role-help').textContent = t($('iv-owner').checked
    ? 'Everything, including settings, team and billing.'
    : 'They can see everything except check-in, write notes and do housekeeping. You can change this later under Access.');
}
$('iv-owner').onchange = renderInviteRoles;
renderInviteRoles();

async function loadInvites() {
  const pid = state.adminPropertyId;
  const invites = await api('GET', `/api/properties/${pid}/invites`);
  const list = $('invite-list');
  list.replaceChildren();
  for (const inv of invites) {
    const row = document.createElement('div');
    row.className = 'row invited';
    const grow = document.createElement('div');
    grow.className = 'grow';
    const until = new Date(inv.expiresAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
    grow.append(text('div', inv.email), text('div', t('Invited (link valid until {date})', { date: until }), 'muted'));
    const cancel = text('button', 'Cancel invite', 'small');
    cancel.onclick = async () => {
      try { await api('DELETE', `/api/properties/${pid}/invites/${inv.id}`); loadInvites(); }
      catch (err) { alert(tx(err.message)); }
    };
    row.append(grow);
    if (inv.role === 'owner') row.append(text('span', 'Owner', 'pill'));
    row.append(cancel);
    list.append(row);
  }
}

bindForm('form-invite', 'iv-err', async () => {
  const email = $('iv-email').value;
  const r = await api('POST', `/api/properties/${state.adminPropertyId}/invites`, { email, role: $('iv-owner').checked ? 'owner' : 'member' });
  $('form-invite').reset();
  renderInviteRoles();
  // Sent by e-mail: the link is only in their inbox (that proves the address).
  $('iv-link').value = r.link || '';
  $('iv-link').closest('.invite-link').hidden = !r.link;
  $('iv-done-title').textContent = t(r.emailed ? 'Invite sent to {email}' : 'Invite ready for {email}', { email });
  $('iv-done-sub').textContent = t(r.emailed
    ? 'They open the link in the e-mail and choose a password. Can\'t find it? Check spam or send the invite again. The link works for a week.'
    : 'Send them this link, e.g. on WhatsApp. They open it and choose a password. It works for a week.');
  $('iv-done').hidden = false;
  loadInvites();
});
// "Add team member": a profile — a name, a colour and what they may do; no
// e-mail, no password. The person is opened from the user menu. Never an
// owner (owners are invited by e-mail). Access of their own only from owners,
// as under Access; everyone else gives the defaults.
let pfColor = null;
let pfLevels = null; // null = the defaults
function renderProfileForm() {
  $('pf-colors').replaceChildren(...PERSON_COLORS.map(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'um-color' + (c === pfColor ? ' on' : '');
    b.style.background = c;
    b.setAttribute('aria-label', c);
    b.setAttribute('aria-pressed', c === pfColor ? 'true' : 'false');
    b.onclick = () => { pfColor = c; renderProfileForm(); };
    return b;
  }));
  const box = $('pf-perms');
  box.replaceChildren();
  const owner = !!(state.property && state.property.role === 'owner');
  $('pf-role-help').textContent = owner ? '' : t('They can see everything except check-in, write notes and do housekeeping. The owner can change this under Access.');
  $('pf-role-help').hidden = owner;
  if (!owner) return;
  levelRows(box, pfLevels || DEFAULT_LEVELS, next => { pfLevels = next; renderProfileForm(); });
}
function openProfileForm() {
  $('form-profile').reset();
  pfColor = PERSON_COLORS[0];
  pfLevels = null;
  $('pf-err').textContent = '';
  renderProfileForm();
  $('pf-modal').hidden = false;
  $('pf-name').focus();
}
function closeProfileForm() { $('pf-modal').hidden = true; }
$('pf-open').onclick = openProfileForm;
$('pf-close').onclick = closeProfileForm;
$('pf-cancel').onclick = closeProfileForm;
$('pf-modal').addEventListener('click', e => { if (e.target === $('pf-modal')) closeProfileForm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('pf-modal').hidden) closeProfileForm(); });
bindForm('form-profile', 'pf-err', async () => {
  const body = { name: $('pf-name').value, color: pfColor };
  if (pfLevels) body.levels = pfLevels;
  await api('POST', `/api/properties/${state.adminPropertyId}/profiles`, body);
  closeProfileForm();
  toast(t('Added to the team'));
  loadStaff();
});
$('iv-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('iv-link').value); toast(t('Link copied')); }
  catch { $('iv-link').select(); }
};

// ===== Settings: channel manager (Channex) =====

// Connecting creates the hostel at Channex with a room type per room; the
// channels themselves (Booking.com…) are then linked inside Channex.
async function loadChannex() {
  const pid = state.ownerPropertyId;
  const box = $('cx-body');
  const s = await api('GET', `/api/properties/${pid}/channex`);
  box.replaceChildren();
  if (!s.available) {
    box.append(text('p', 'Coming soon.', 'muted'));
    return;
  }
  box.append(text('p', s.connected
    ? 'Connected. Bookings from your channels appear in the Calendar instantly, with the guest\'s name.'
    : 'Connect your hostel to Channex. We create your rooms there, then you link Booking.com, Hostelworld or Airbnb to them in Channex. Bookings appear in the Calendar with the guest\'s name.', 'muted cx-intro'));
  const list = document.createElement('div');
  list.className = 'cx-rooms';
  for (const r of s.rooms) {
    const row = document.createElement('div');
    row.className = 'row';
    const grow = document.createElement('div');
    grow.className = 'grow';
    grow.append(text('div', r.name), text('div', r.dorm
      ? t('Dorm, {n} beds (sold per bed)', { n: r.beds })
      : t('Private room for {n}', { n: r.people }), 'muted'));
    row.append(grow, text('span', r.connected ? 'Connected' : 'Not yet', 'pill' + (r.connected ? ' ok' : '')));
    list.append(row);
  }
  if (!s.rooms.length) list.append(text('p', 'No rooms with beds yet — add them in Property first.', 'muted'));
  box.append(list);
  if (s.lastError) box.append(text('p', tx(s.lastError), 'err'));
  else if (s.lastSync) box.append(text('p', t('Bookings checked {when}', { when: new Date(s.lastSync).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }), 'muted cx-sync'));
  const acts = document.createElement('div');
  acts.className = 'cx-acts';
  const missing = s.rooms.some(r => !r.connected);
  if (!s.connected || missing) {
    const go = text('button', s.connected ? 'Add the new rooms' : 'Connect to Channex', 'primary');
    go.type = 'button';
    go.disabled = !s.rooms.length;
    go.onclick = async () => {
      go.disabled = true;
      try { await api('POST', `/api/properties/${pid}/channex/connect`, {}); toast(t('Connected to Channex')); loadChannex(); }
      catch (err) { toast(tx(err.message)); go.disabled = false; }
    };
    acts.append(go);
  }
  if (s.connected) {
    const sync = text('button', 'Check bookings now', 'small');
    sync.type = 'button';
    sync.onclick = async () => {
      sync.disabled = true;
      try { await api('POST', `/api/properties/${pid}/calendars/sync`, {}); loadChannex(); toast(t('Bookings checked')); }
      catch (err) { toast(tx(err.message)); sync.disabled = false; }
    };
    const open = document.createElement('a');
    open.className = 'button small';
    open.href = s.appUrl;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = t('Open Channex');
    acts.append(sync, open);
    if (s.staging) {
      // The Channex test system: a made-up booking for tomorrow, to try the whole way.
      const test = text('button', 'Send a test booking', 'small');
      test.type = 'button';
      test.onclick = async () => {
        test.disabled = true;
        try {
          const r = await api('POST', `/api/properties/${pid}/channex/test-booking`, {});
          toast(r.received ? t('Test booking for {day} is in the Calendar', { day: calDayLabel(r.arrival, { day: 'numeric', month: 'short' }) }) : t('Sent. It will appear in the Calendar shortly.'));
          loadChannex();
        } catch (err) { toast(tx(err.message)); test.disabled = false; }
      };
      acts.append(test);
    }
    box.append(acts, text('p', 'Next: in Channex open Channels, add Booking.com (or another channel) and link its rooms to these.', 'muted cx-next'));
  } else {
    box.append(acts);
  }
}

// ===== Settings: integrations (Cloudbeds) =====

// The property's own Cloudbeds API key; HostelFlow only reads bookings. Each
// helper it allows is a switch (for now: the nights at check-in).
async function loadCloudbeds() {
  const pid = state.ownerPropertyId;
  const box = $('cb-body');
  const s = await api('GET', `/api/properties/${pid}/cloudbeds`);
  box.replaceChildren();
  if (!s.connected) {
    box.append(text('p', 'Connect your Cloudbeds bookings with HostelFlow.', 'muted'));
    const form = document.createElement('form');
    const label = text('label', 'Cloudbeds API key');
    label.htmlFor = 'cb-key';
    const input = document.createElement('input');
    input.id = 'cb-key';
    input.type = 'password';
    input.autocomplete = 'off';
    input.required = true;
    input.maxLength = 200;
    // Where the key is made: the "i" next to the label, as for the police login.
    const head = document.createElement('div');
    head.className = 'field-head';
    addFieldHelp(head, label, 'cb-key-help', text('p', 'In Cloudbeds: Account → Apps & Marketplace → API credentials → create a new key (read access to reservations and guests is enough).'));
    const go = text('button', 'Connect', 'primary');
    go.type = 'submit';
    const err = text('div', '', 'err');
    form.append(head, input, go, err);
    form.onsubmit = async e => {
      e.preventDefault();
      go.disabled = true;
      err.textContent = '';
      try { await api('PUT', `/api/properties/${pid}/cloudbeds`, { apiKey: input.value }); toast(t('Connected to Cloudbeds')); loadCloudbeds(); }
      catch (ex) { err.textContent = tx(ex.message); go.disabled = false; }
    };
    box.append(form);
    return;
  }
  box.append(text('p', s.propertyName ? t('Connected to {name}.', { name: s.propertyName }) : t('Connected.'), 'muted'));
  const opt = document.createElement('label');
  opt.className = 'hk-opt';
  const words = document.createElement('span');
  words.append(text('b', 'Take nights from Cloudbeds'));
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.className = 'switch';
  sw.checked = s.nights;
  sw.onchange = async () => {
    sw.disabled = true;
    try { await api('PUT', `/api/properties/${pid}/cloudbeds`, { nights: sw.checked }); toast(t('Saved.')); }
    catch (ex) { sw.checked = !sw.checked; toast(tx(ex.message)); }
    sw.disabled = false;
  };
  opt.append(words, sw);
  box.append(opt);
  if (s.lastError) box.append(text('p', tx(s.lastError), 'err'));
  const off = text('button', 'Disconnect', 'small');
  off.type = 'button';
  off.onclick = async () => {
    if (!confirm(t('Disconnect Cloudbeds?'))) return;
    off.disabled = true;
    try { await api('DELETE', `/api/properties/${pid}/cloudbeds`); loadCloudbeds(); }
    catch (ex) { toast(tx(ex.message)); off.disabled = false; }
  };
  box.append(off);
}

// ===== Settings: integrations (Claude) =====

// The property's own Anthropic API key (src/claudekey.js): scans and Flowy run
// on its own Claude credit, which it tops up at Anthropic (auto-reload).
const CL_CONSOLE = 'https://platform.claude.com/';
function clLink(words) {
  const a = document.createElement('a');
  a.href = CL_CONSOLE;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = t(words);
  return a;
}
// Dollars from micro-dollars: a scan is a fraction of a cent, so three decimals below a cent.
const clMoney = micro => `$${(micro / 1e6).toFixed(micro < 10000 ? 3 : 2)}`;
async function loadClaude() {
  const pid = state.ownerPropertyId;
  const box = $('cl-body');
  const s = await api('GET', `/api/properties/${pid}/claude`);
  box.replaceChildren();
  const per = s.cost && s.cost.perScanMicro;
  if (!s.connected) {
    // Only where scans can't run without it (a server with no key of its own):
    // otherwise just the field (Bob, 28. 10.).
    if (!s.serverKey) box.append(text('p', 'To scan documents, connect your Claude account.', 'muted'));
    // Where the key is made: the "i" next to the label, as for Cloudbeds.
    const steps = document.createElement('ol');
    steps.append(document.createElement('li'));
    steps.firstChild.append(clLink('Sign up at platform.claude.com.'));
    for (const step of ['Billing: add a card, buy credit and turn on auto-reload, so it never runs out.', 'API keys: create a key that never expires and copy it.', 'Paste it here.']) {
      steps.append(text('li', step));
    }
    // The same steps with screenshots of the real pages (public/claude-key.html, English).
    const guide = document.createElement('a');
    guide.href = '/claude-key';
    guide.target = '_blank';
    guide.rel = 'noopener';
    guide.textContent = t('See the steps with pictures');
    const help = document.createElement('div');
    help.append(steps, guide);
    const form = document.createElement('form');
    const label = text('label', 'Claude API key');
    label.htmlFor = 'cl-key';
    const head = document.createElement('div');
    head.className = 'field-head';
    addFieldHelp(head, label, 'cl-key-help', help);
    const input = document.createElement('input');
    input.id = 'cl-key';
    input.type = 'password';
    input.autocomplete = 'off';
    input.required = true;
    input.maxLength = 300;
    input.placeholder = 'sk-ant-…';
    const go = text('button', 'Connect', 'primary');
    go.type = 'submit';
    const err = text('div', '', 'err');
    form.append(head, input, go, err);
    form.onsubmit = async e => {
      e.preventDefault();
      go.disabled = true;
      err.textContent = '';
      try { await api('PUT', `/api/properties/${pid}/claude`, { apiKey: input.value }); toast(t('Connected to Claude')); loadClaude(); }
      catch (ex) { err.textContent = tx(ex.message); go.disabled = false; }
    };
    box.append(form);
    return;
  }
  box.append(text('p', s.hint ? t('Connected. Key ending in {hint}.', { hint: s.hint }) : t('Connected.'), 'muted'));
  if (s.lastError) box.append(text('p', tx(s.lastError), 'err'));
  if (s.cost) {
    box.append(text('p', t('This month: {n} scans, about {cost} on your Claude account.', { n: s.cost.monthScans, cost: clMoney(s.cost.monthMicro) }), 'cl-usage'));
    if (per) box.append(text('p', t('A scan costs about {cost}.', { cost: clMoney(per) }), 'muted'));
  }
  const more = document.createElement('p');
  more.className = 'muted';
  more.append(clLink('Credit and auto-reload: platform.claude.com'));
  box.append(more);
  const off = text('button', 'Disconnect', 'small');
  off.type = 'button';
  off.onclick = async () => {
    if (!confirm(t('Disconnect Claude?'))) return;
    off.disabled = true;
    try { await api('DELETE', `/api/properties/${pid}/claude`); loadClaude(); }
    catch (ex) { toast(tx(ex.message)); off.disabled = false; }
  };
  box.append(off);
}

// ===== Settings: property =====

// Settings → Property: rooms with their number of beds. Saved through the same
// map endpoint Housekeeping uses; new rooms get a free spot on the map.
let prDraft = null;
async function loadRooms() {
  const data = await api('GET', `/api/properties/${state.ownerPropertyId}/housekeeping`);
  prDraft = JSON.parse(JSON.stringify({ rooms: data.rooms, frames: data.frames }));
  renderTaskSettings(data.tasks || [], data.rooms);
  for (const f of prDraft.frames) if (!f.roomId) f.roomId = (roomOf(f, prDraft.rooms) || {}).id || null;
  renderRooms();
}
function bedsOfRoom(id) { return prDraft.frames.filter(f => f.roomId === id).flatMap(f => f.beds); }
// The next free bed number in a room: every room counts from 1.
function nextLabelIn(draft, roomId) {
  const nums = draft.frames.filter(f => f.roomId === roomId).flatMap(f => f.beds).map(b => parseInt(b.label, 10)).filter(n => !Number.isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}
function renderRooms() {
  const box = $('pr-rooms');
  box.replaceChildren();
  if (!prDraft.rooms.length) box.append(text('p', 'No rooms yet — add the first one.', 'muted'));
  for (const r of prDraft.rooms) {
    const row = document.createElement('div');
    row.className = 'pr-row';
    row.dataset.id = r.id;
    // Drag the grip to change the order (mouse or finger), or the arrow keys on it.
    const grip = text('button', '⠿', 'pr-grip');
    grip.type = 'button';
    grip.title = t('Drag to change the order');
    grip.setAttribute('aria-label', t('Move {name} — drag, or use the arrow keys', { name: r.name }));
    grip.onpointerdown = e => dragRoom(e, row);
    grip.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const i = prDraft.rooms.indexOf(r);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= prDraft.rooms.length) return;
      prDraft.rooms.splice(i, 1);
      prDraft.rooms.splice(j, 0, r);
      renderRooms();
      $('pr-rooms').querySelectorAll('.pr-grip')[j].focus();
    };
    row.append(grip);
    const name = document.createElement('input');
    name.value = r.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', t('Room name'));
    name.oninput = () => { r.name = name.value; };
    row.append(name);
    {
      const n = bedsOfRoom(r.id).length;
      const step = document.createElement('span');
      step.className = 'stepper';
      const minus = text('button', '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', t('One bed less'));
      minus.disabled = !n;
      minus.onclick = () => {
        // The bed with the highest number goes (a bunk goes whole).
        const frames = prDraft.frames.filter(f => f.roomId === r.id);
        const last = frames.sort((a, b) => Math.max(...a.beds.map(x => parseInt(x.label, 10) || 0)) - Math.max(...b.beds.map(x => parseInt(x.label, 10) || 0))).pop();
        prDraft.frames = prDraft.frames.filter(f => f !== last);
        renderRooms();
      };
      const plus = text('button', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', t('One bed more'));
      plus.onclick = () => {
        prDraft.frames.push({ id: newId(), kind: 'single', roomId: r.id, x: 0, y: 0, w: 1, h: 1, beds: [{ id: newId(), level: 0, label: String(nextLabelIn(prDraft, r.id)) }] });
        renderRooms();
      };
      step.append(minus, text('span', t(n === 1 ? '1 bed' : '{n} beds', { n })), plus);
      row.append(step);
    }
    const del = text('button', '×', 'small');
    del.type = 'button';
    del.setAttribute('aria-label', t('Remove'));
    del.onclick = () => {
      const n = bedsOfRoom(r.id).length;
      if (n && !confirm(t('Remove this room and its {n} beds?', { n }))) return;
      prDraft.frames = prDraft.frames.filter(f => f.roomId !== r.id);
      prDraft.rooms = prDraft.rooms.filter(x => x !== r);
      renderRooms();
    };
    row.append(del);
    box.append(row);
  }
}
// The row follows the pointer and swaps places with its neighbours as it
// passes their middle; on release the new order goes into the draft (saved
// with the form).
function dragRoom(e, row) {
  dragRow(e, row, () => {
    const order = [...$('pr-rooms').querySelectorAll('.pr-row')].map(x => x.dataset.id);
    prDraft.rooms.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    renderRooms();
  });
}
// Any list row dragged by its grip (rooms, kinds of shift); done() reads the new order.
function dragRow(e, row, done) {
  if (e.button > 0) return;
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  let lastY = e.clientY;
  let shift = 0;
  row.classList.add('dragging');
  const move = ev => {
    shift += ev.clientY - lastY;
    lastY = ev.clientY;
    const prev = row.previousElementSibling;
    const next = row.nextElementSibling;
    // The neighbour moves, not the row: a row taken out of the page, even for
    // a moment, loses the pointer and would miss the release.
    if (next && shift > next.offsetHeight / 2) { row.before(next); shift -= next.offsetHeight; }
    else if (prev && shift < -prev.offsetHeight / 2) { row.after(prev); shift += prev.offsetHeight; }
    row.style.transform = `translateY(${shift}px)`;
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    row.classList.remove('dragging');
    row.style.transform = '';
    done();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}
function addRoom(kind) {
  const [w, h] = HK_SIZES[kind];
  const name = kind === 'room' ? t('Room {n}', { n: prDraft.rooms.filter(r => r.kind === 'room').length + 1 }) : t('Bathroom');
  const spot = freeSpotIn(prDraft.rooms, w, h);
  const id = newId();
  prDraft.rooms.push({ id, name, kind, w, h, ...spot });
  // A new room starts with one bed; + adds more.
  if (kind === 'room') prDraft.frames.push({ id: newId(), kind: 'single', roomId: id, x: 0, y: 0, w: 1, h: 1, beds: [{ id: newId(), level: 0, label: String(nextLabelIn(prDraft, id)) }] });
  renderRooms();
  const inputs = $('pr-rooms').querySelectorAll('input');
  inputs[inputs.length - 1].select();
}
// A free place for a new room on the map, left to right, top to bottom.
function freeSpotIn(rooms, w, h) {
  for (let y = 0; y < 400; y++) for (let x = 0; x + w <= 20; x++) if (!overlaps({ x, y, w, h }, rooms)) return { x, y };
  return { x: 0, y: Math.max(0, ...rooms.map(r => r.y + r.h)) };
}
$('pr-add-room').onclick = () => addRoom('room');

bindForm('form-property', 'pr-err', async () => {
  renderSettings(await api('PUT', `/api/properties/${state.ownerPropertyId}/settings`, { name: $('se-name').value }));
  // Rooms and beds belong to Housekeeping: not in the check-in-only plans.
  if (fullApp()) {
    hk = await api('PUT', `/api/properties/${state.ownerPropertyId}/housekeeping/map`, {
      rooms: prDraft.rooms.map(({ id, name, x, y, w, h }) => ({ id, name, kind: 'room', x, y, w, h })), // just rooms, for now
      frames: prDraft.frames.map(({ id, kind, roomId, x, y, w, h, beds }) => ({ id, kind, roomId, x, y, w, h, beds: beds.map(({ id, label }) => ({ id, label })) })),
    });
    prDraft = JSON.parse(JSON.stringify({ rooms: hk.rooms, frames: hk.frames }));
    renderRooms();
  }
  const p = state.me.properties.find(x => x.id === state.ownerPropertyId);
  p.name = state.settings.name;
  $('staff-property').textContent = p.name;
  $('hd-property').textContent = state.property ? state.property.name : '';
  renderPropertyList();
  $('pr-err').className = 'ok';
  $('pr-err').textContent = t('Saved.');
});

async function loadSettings() {
  const pid = state.adminPropertyId;
  if (state.ownerPropertyId) {
    if (fullApp()) loadRooms().catch(() => {});
    loadChannex().catch(() => {});
    loadChannelCalendars().catch(() => {});
    loadCloudbeds().catch(() => {});
    loadClaude().catch(() => {});
  }
  renderSettings(await api('GET', `/api/properties/${pid}/settings`));
  api('GET', `/api/properties/${pid}/usage`).then(u => {
    const month = new Date().toISOString().slice(0, 7);
    const cur = u.months.find(r => r.month === month);
    $('se-usage').textContent = u.trial
      ? t('Free document scans used: {n} of {limit}', { n: u.used, limit: u.limit })
      : t(u.limit ? 'Documents scanned this month: {n} of {limit}' : 'Documents scanned this month: {n}', { n: cur ? cur.scans : 0, limit: u.limit });
  }).catch(() => {});
}

function renderSettings(s) {
  state.settings = s;
  if (s.shiftTypes) renderShiftTypes(s.shiftTypes);
  $('se-name').value = s.name;
  const sel = $('se-registration');
  sel.replaceChildren(new Option(t('None'), ''), ...s.modules.map(m => new Option(m.name, m.id)));
  sel.value = s.registration || '';
  auCountry = null;
  renderAuthorities();
  renderRegPicker();
  renderStructures();
  renderCredentialFields();
  renderCheckStatus(stSlot().status);
  $('rt-text').value = s.routine || '';
  renderSheetsSettings(s.sheets);
  renderLinenSettings(s.linen || []);
}

// The police-registration picker: our own list, so every system shows its
// country's flag (drawn here — Windows shows emoji flags as two letters). The
// hidden <select> keeps the value; picking fires its change event.
const FLAGS = {
  IT: '<rect width="8" height="16" fill="#009246"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#ce2b37"/>',
  FR: '<rect width="8" height="16" fill="#0055a4"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#ef4135"/>',
  ES: '<rect width="24" height="16" fill="#aa151b"/><rect y="4" width="24" height="8" fill="#f1bf00"/>',
  CZ: '<rect width="24" height="8" fill="#fff"/><rect y="8" width="24" height="8" fill="#d7141a"/><path d="M0 0l12 8-12 8z" fill="#11457e"/>',
  SK: '<rect width="24" height="5.34" fill="#fff"/><rect y="5.33" width="24" height="5.34" fill="#0b4ea2"/><rect y="10.66" width="24" height="5.34" fill="#ee1c25"/><path d="M5 3.5h6v5.5c0 2-1.5 3.3-3 4-1.5-.7-3-2-3-4z" fill="#ee1c25" stroke="#fff" stroke-width=".8"/><path d="M8 5v6M6.4 6.6h3.2M6 8.2h4" stroke="#fff" stroke-width=".8"/>',
  PL: '<rect width="24" height="8" fill="#fff"/><rect y="8" width="24" height="8" fill="#dc143c"/>',
};
function flagEl(cc) {
  const box = document.createElement('span');
  box.className = 'reg-flag';
  if (FLAGS[cc]) box.innerHTML = `<svg viewBox="0 0 24 16" aria-hidden="true">${FLAGS[cc]}</svg>`;
  return box;
}
// Reports to authorities: a country first; then its police system and its statistics.
const COUNTRIES = [['IT', 'Italy'], ['CZ', 'Czechia'], ['FR', 'France']];
let auCountry = null;
function renderAuthorities() {
  const s = state.settings;
  const current = s.modules.find(m => m.id === $('se-registration').value);
  auCountry = auCountry || (current && current.country) || (COUNTRIES.some(([c]) => c === s.country) ? s.country : 'IT');
  // A drop-down like the police system's, each country with its flag.
  const label = cc => { const n = COUNTRIES.find(([c]) => c === cc)[1]; return [text('span', n, 'reg-name'), flagEl(cc)]; };
  $('au-btn').replaceChildren(...label(auCountry), text('span', '▾', 'reg-chev'));
  $('au-btn').onclick = () => {
    const open = $('au-list').hidden;
    $('au-list').hidden = !open;
    $('au-btn').setAttribute('aria-expanded', String(open));
  };
  $('au-list').replaceChildren(...COUNTRIES.map(([cc]) => {
    const c = document.createElement('li');
    c.setAttribute('role', 'option');
    c.setAttribute('aria-selected', String(cc === auCountry));
    c.tabIndex = 0;
    c.append(...label(cc));
    c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
    c.onclick = () => {
      $('au-list').hidden = true;
      $('au-btn').setAttribute('aria-expanded', 'false');
      auCountry = cc;
      // The country's system (each has one for now) is picked for you; Save keeps it.
      const m = s.modules.find(x => x.country === cc);
      if (m && $('se-registration').value !== m.id) {
        $('se-registration').value = m.id;
        $('se-registration').dispatchEvent(new Event('change', { bubbles: true }));
      }
      renderRegPicker();
      renderAuthorities();
    };
    return c;
  }));
  // Each country has one police system: it is simply the one shown (Save keeps it).
  const m = s.modules.find(x => x.country === auCountry);
  if (m && $('se-registration').value !== m.id) {
    $('se-registration').value = m.id;
    renderCredentialFields();
  }
  renderAuParts(m);
  $('au-stats-it').hidden = auCountry !== 'IT';
  renderRoss();
}

// What the country asks for, one at a time: its police registration or its statistics.
let auPart = 'police';
function renderAuParts(m) {
  const parts = [['police', 'Police registration', m ? m.name : '']];
  // All named the same way: what it is (bold) · which system, who runs it.
  if (auCountry === 'IT') parts.push(['rimovcli', 'Statistics', 'Region Liguria (RiMovCli)'], ['ross', 'Statistics', 'Ross1000 (regional ISTAT)'], ['istat', 'Statistics', 'Basic statistics (ISTAT)']);
  if (!parts.some(p => p[0] === auPart)) auPart = 'police';
  // One thing only: no second drop-down.
  $('au-part-pick').hidden = parts.length < 2;
  $('au-part-label').hidden = parts.length < 2;
  const label = ([, name, sub]) => {
    const n = text('span', t(name), 'reg-name');
    if (sub) n.append(text('span', ' · ' + t(sub), 'reg-sub'));
    return n;
  };
  $('au-part-btn').replaceChildren(label(parts.find(p => p[0] === auPart)), text('span', '▾', 'reg-chev'));
  $('au-part-btn').onclick = () => {
    const open = $('au-part-list').hidden;
    $('au-part-list').hidden = !open;
    $('au-part-btn').setAttribute('aria-expanded', String(open));
  };
  $('au-part-list').replaceChildren(...parts.map(p => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(p[0] === auPart));
    li.tabIndex = 0;
    li.append(label(p));
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); } };
    li.onclick = () => { closeRegList(); auPart = p[0]; renderAuParts(m); };
    return li;
  }));
  $('au-police').hidden = auPart !== 'police';
  $('au-stats').hidden = auPart === 'police';
  // Each statistics system has its own page: the picker above is the only drop-down.
  $('au-istat').hidden = auPart !== 'istat';
  for (const [id, part] of [['au-ross', 'ross'], ['au-rimovcli', 'rimovcli']]) {
    $(id).hidden = auPart !== part;
    $(id).open = true;
  }
}

// Two structures (two police accounts, e.g. a room on another floor): the
// chips pick which one the police login and statistics below are for. With
// one structure nothing shows but the button to add a second.
let stSel = 'main';
function stSlot() {
  const s = state.settings;
  return (stSel !== 'main' && s.structures.find(x => x.id === stSel)) || s;
}
// For the requests: which structure (nothing for the main one, as before).
const stBody = () => (stSel !== 'main' ? { structure: stSel } : {});
const stQuery = () => (stSel !== 'main' ? `&structure=${encodeURIComponent(stSel)}` : '');
function renderStructures() {
  const s = state.settings;
  if (!s.structures.some(x => x.id === stSel)) stSel = 'main';
  const list = s.structures.length ? [{ id: 'main', name: s.mainName || t('Main') }, ...s.structures] : [];
  $('st-box').hidden = !list.length;
  $('st-chips').replaceChildren(...list.map(x => {
    const c = text('button', x.name, 'chip' + (x.id === stSel ? ' on' : ''));
    c.type = 'button';
    c.onclick = () => { stSel = x.id; renderSettings(state.settings); };
    return c;
  }));
  const owner = state.ownerPropertyId === state.adminPropertyId;
  $('st-tools').hidden = !(owner && (s.registration === 'it-alloggiati' || (!s.registration && auCountry === 'IT')));
  $('st-add-row').hidden = !!list.length;
  $('st-edit').hidden = !list.length;
  $('st-err').textContent = '';
}
$('st-add-open').onclick = () => openStructures();
$('st-edit-open').onclick = () => openStructures();

// Two structures, on a page of their own: the two Alloggiati Web logins side
// by side, each with its name. Saving adds the second one (the first time),
// then stores the names and whatever login was typed in.
function openStructures() {
  const s = state.settings;
  const module = s.modules.find(m => m.id === 'it-alloggiati');
  const second = s.structures[0] || null;
  const slots = [[1, s.registration === 'it-alloggiati' ? s.credentials : {}], [2, second ? second.credentials : {}]];
  for (const [n, saved] of slots) {
    const box = $(`ts-fields-${n}`);
    box.replaceChildren();
    for (const f of module ? module.fields : []) {
      const label = text('label', f.label);
      label.htmlFor = `ts-cred-${n}-${f.key}`;
      const input = document.createElement('input');
      input.id = `ts-cred-${n}-${f.key}`;
      input.dataset.key = f.key;
      input.autocomplete = 'off';
      input.maxLength = 500;
      const cur = (saved || {})[f.key] || { set: false };
      if (f.secret) {
        input.type = 'password';
        input.autocomplete = 'new-password';
        input.placeholder = t(cur.set ? '•••••••• saved' : 'not set');
      } else input.value = cur.value || '';
      box.append(label, input);
    }
  }
  $('ts-name-1').value = s.mainName || '';
  $('ts-name-2').value = second ? second.name : '';
  $('ts-remove').hidden = !second;
  $('ts-err').textContent = '';
  showTab('structures');
  window.scrollTo({ top: 0 });
}
// What was typed for one structure: null when nothing (the saved login stays).
function tsLogin(n) {
  const inputs = [...$(`ts-fields-${n}`).querySelectorAll('input')];
  if (!inputs.some(i => i.value.trim())) return null;
  return Object.fromEntries(inputs.map(i => [i.dataset.key, i.value]));
}
const tsBack = () => { showTab('settings'); openSection('sec-police'); };
$('ts-back').onclick = tsBack;
$('ts-cancel').onclick = tsBack;
$('ts-save').onclick = async () => {
  const name1 = $('ts-name-1').value.trim();
  const name2 = $('ts-name-2').value.trim();
  $('ts-err').textContent = '';
  if (!name2) { $('ts-err').textContent = t('Name the second structure.'); $('ts-name-2').focus(); return; }
  const url = `/api/properties/${state.adminPropertyId}/settings`;
  const btn = $('ts-save');
  btn.disabled = true;
  try {
    let s = state.settings;
    let sid = s.structures[0] && s.structures[0].id;
    if (!sid) {
      const r = await api('PUT', url, { addStructure: { name: name2, mainName: name1 || null } });
      sid = r.added;
      renderSettings(r);
    } else {
      renderSettings(await api('PUT', url, { structureName: name1 }));
      renderSettings(await api('PUT', url, { structure: sid, structureName: name2 }));
    }
    refreshStructures();
    const login1 = tsLogin(1);
    if (login1) renderSettings(await api('PUT', url, { registration: 'it-alloggiati', credentials: login1 }));
    const login2 = tsLogin(2);
    if (login2) renderSettings(await api('PUT', url, { structure: sid, registration: 'it-alloggiati', credentials: login2 }));
    toast(t('Saved.'));
    tsBack();
  } catch (err) {
    $('ts-err').textContent = tx(err.message);
    if (state.settings.structures.length) $('ts-remove').hidden = false;
  } finally { btn.disabled = false; }
};
$('ts-remove').onclick = async () => {
  const second = state.settings.structures[0];
  if (!second || !confirm(t('Remove this structure and its police login? It must have no guests checked in.'))) return;
  try {
    stSel = 'main';
    renderSettings(await api('PUT', `/api/properties/${state.adminPropertyId}/settings`, { removeStructure: second.id }));
    refreshStructures();
    tsBack();
  } catch (err) { $('ts-err').textContent = tx(err.message); }
};
// Check-in learns the names (and whether to ask at all) from /api/me.
function refreshStructures() {
  const s = state.settings;
  const p = state.me.properties.find(x => x.id === state.adminPropertyId);
  if (p) p.structures = s.structures.length ? [{ id: 'main', name: s.mainName || 'Main' }, ...s.structures.map(x => ({ id: x.id, name: x.name }))] : [];
}

// The label with its "i" (same as the Alloggiati fields); rebuilt so a language change shows.
function renderRimovcliHelp() {
  const head = $('rm-c59-head');
  head.replaceChildren();
  head.className = 'field-head';
  const label = text('label', t('Regional property code'));
  label.htmlFor = 'rm-c59';
  addFieldHelp(head, label, 'rm-help-c59', text('p', t('The code the Region gives the property when it activates the service.')));
}

// The manual edit's title with its "i", as next to the fields. The bubble sits in
// the <summary>, so a tap in it mustn't fold the box.
function renderRmStartHelp() {
  const head = $('rm-start-head');
  head.replaceChildren(t('Manual edit for the first entry'));
  const bubble = document.createElement('div');
  bubble.className = 'help-bubble';
  bubble.id = 'rm-start-help';
  bubble.hidden = true;
  bubble.setAttribute('role', 'note');
  bubble.append(text('strong', t('What is this?')), text('p', "Use manual edit if your portal already has XML files from before and the numbers don't match. Easiest: on the portal, select the whole \"Ultimo giorno caricato\" box, copy it and paste it below, or upload screenshots of it."));
  // The same steps with a picture of the portal (public/rimovcli-first.html, English), as for Claude.
  const guide = document.createElement('a');
  guide.href = '/rimovcli-first';
  guide.target = '_blank';
  guide.rel = 'noopener';
  guide.textContent = t('See the steps with pictures');
  bubble.append(guide);
  // A tap in the bubble mustn't fold the box — but the link must still open.
  bubble.onclick = e => { if (!e.target.closest('a')) e.preventDefault(); };
  head.append(helpButton(bubble, t('What is this?')), bubble);
}

function renderRoss() {
  renderRimovcliHelp();
  renderRmStartHelp();
  const r = stSlot().ross || {};
  if (!$('ro-region').options.length) {
    $('ro-region').replaceChildren(new Option(t('Choose…'), ''), ...Object.entries(ROSS_REGIONS).map(([k, n]) => new Option(n, k)));
  }
  $('ro-region').value = r.region || '';
  $('ro-codice').value = r.codice || '';
  $('ro-rooms').value = r.rooms || '';
  $('ro-beds').value = r.beds || '';
  // A second structure's rooms aren't the ones in Settings → Property: they must be said.
  $('ro-rooms').placeholder = $('ro-beds').placeholder = stSel === 'main' ? t('from Property') : '';
  $('ro-user').value = r.user || '';
  $('ro-pass').value = '';
  $('ro-pass').placeholder = r.passwordSet ? t('Saved. Leave empty to keep it.') : '';
  if (!$('ro-to').value) {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth() - (today.getDate() < 6 ? 1 : 0), 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('ro-from').value = iso(first);
    $('ro-to').value = iso(last < today ? last : today);
  }
  $('rm-c59').value = r.c59 || '';
  // The starting point: shown open until one is saved.
  $('rm-start-date').value = r.start ? r.start.date : '';
  $('rm-start-text').value = r.start ? r.start.text : '';
  $('rm-start-clear').hidden = !r.start;
  if (!r.start) $('rm-start').open = true;
  if (!$('rm-to').value) {
    // Yesterday: the last full day.
    const d = new Date(Date.now() - 864e5);
    $('rm-from').value = $('rm-to').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
const ROSS_REGIONS = { liguria: 'Liguria', veneto: 'Veneto', lombardia: 'Lombardia', piemonte: 'Piemonte', emilia: 'Emilia-Romagna', toscana: 'Firenze, Pistoia, Prato', marche: 'Marche', abruzzo: 'Abruzzo', lazio: 'Lazio', sardegna: 'Sardegna', calabria: 'Calabria', molise: 'Molise' };
$('ro-save').onclick = async () => {
  $('ro-err').textContent = '';
  try {
    renderSettings(await api('PUT', `/api/properties/${state.ownerPropertyId}/settings`, { ...stBody(), ross: {
      region: $('ro-region').value, codice: $('ro-codice').value, user: $('ro-user').value,
      password: $('ro-pass').value, rooms: $('ro-rooms').value, beds: $('ro-beds').value,
    } }));
    $('ro-err').className = 'ok';
    $('ro-err').textContent = t('Saved.');
  } catch (err) { $('ro-err').className = 'err'; $('ro-err').textContent = tx(err.message); }
};
$('ro-send').onclick = async () => {
  $('ro-err').className = 'err';
  $('ro-err').textContent = '';
  $('ro-send').disabled = true;
  try {
    const r = await api('POST', `/api/properties/${state.ownerPropertyId}/ross1000`, { ...stBody(), from: $('ro-from').value, to: $('ro-to').value });
    $('ro-err').className = r.refused.length || r.problems.length ? 'err' : 'ok';
    $('ro-err').textContent = [
      t('Sent: {n} guests.', { n: r.sent }),
      r.refused.length ? t('Refused: {n} — {why}', { n: r.refused.length, why: r.refused.map(x => x.error).filter(Boolean).slice(0, 3).join('; ') }) : '',
      r.problems.length ? t('{n} guests skipped: missing details (e.g. sex or date of birth).', { n: r.problems.length }) : '',
    ].filter(Boolean).join(' ');
  } catch (err) { $('ro-err').textContent = tx(err.message); }
  finally { $('ro-send').disabled = false; }
};

// The RiMovCli starting point (src/stats/rimovcli.js parseStart): the portal's last day.
async function saveRmStart(start) {
  $('rm-start-err').className = 'err';
  $('rm-start-err').textContent = '';
  try {
    renderSettings(await api('PUT', `/api/properties/${state.ownerPropertyId}/settings`, { ...stBody(), ross: { start } }));
    $('rm-start-err').className = 'ok';
    $('rm-start-err').textContent = ''; // Create XML file says what comes next (below); Remove needs no word
    $('rm-start-dl').hidden = true;
    if (start) {
      // The new file: from the day after the portal's last one up to yesterday
      // (the dates of the download above follow, for the days after).
      const d = new Date(`${start.date}T12:00:00`);
      d.setDate(d.getDate() + 1);
      const from = isoOfDate(d);
      const to = isoOfDate(new Date(Date.now() - 864e5));
      $('rm-from').value = from;
      if (from > to) {
        $('rm-start-err').textContent = t('The portal already has every day up to yesterday — the next file is tomorrow.');
      } else {
        $('rm-to').value = to;
        $('rm-start-err').textContent = t('Ready: the file follows on from the portal. Download it and upload it to the portal.');
        $('rm-start-dl').hidden = false;
      }
    }
  } catch (err) { $('rm-start-err').textContent = tx(err.message); }
}
// The file made from the manual edit (the dates saveRmStart set above).
$('rm-start-dl').onclick = async () => {
  try {
    if (await rmCheck()) {
      $('rm-start-err').className = 'err';
      $('rm-start-err').textContent = $('rm-err').textContent;
      return;
    }
    location.href = `/api/properties/${state.ownerPropertyId}/rimovcli?${rmQuery()}`;
  } catch (err) { $('rm-start-err').className = 'err'; $('rm-start-err').textContent = tx(err.message); }
};
// The day comes with the box copied from the portal ("Ultimo giorno caricato: 27/10/2026")
// or from the screenshots; there is no date field to fill in.
const portalDayIn = text => {
  const m = String(text || '').match(/Ultimo giorno caricato:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
$('rm-start-save').onclick = () => {
  const date = portalDayIn($('rm-start-text').value) || $('rm-start-date').value;
  if (!date) {
    $('rm-start-err').className = 'err';
    $('rm-start-err').textContent = t('Copy the whole box from the portal, with the line "Ultimo giorno caricato".');
    return;
  }
  saveRmStart({ date, text: $('rm-start-text').value });
};
$('rm-start-clear').onclick = () => saveRmStart(null);
// The portal's "Ultimo giorno caricato" box pasted whole: its date goes in the date
// field; the table itself the server reads as it is (rimovcli.js parseStart).
$('rm-start-text').addEventListener('paste', e => {
  const day = portalDayIn(e.clipboardData.getData('text'));
  if (day) $('rm-start-date').value = day;
});
// A screenshot of the portal's day (src/stats/portalread.js): Claude fills in the
// form, staff check it and press Save — nothing is saved before that.
$('rm-shot').onclick = () => $('rm-shot-file').click();
$('rm-shot-file').onchange = async () => {
  const files = [...$('rm-shot-file').files];
  $('rm-shot-file').value = '';
  if (!files.length) return;
  if (files.length > 4) { $('rm-shot-err').className = 'err'; $('rm-shot-err').textContent = t('choose 1 to 4 screenshots'); return; }
  $('rm-shot-err').className = 'muted';
  $('rm-shot-err').textContent = t('Reading the screenshot…');
  $('rm-shot').disabled = true;
  try {
    const r = await api('POST', `/api/properties/${state.ownerPropertyId}/rimovcli/read`, { images: await Promise.all(files.map(f => resizePhoto(f, 1800))) });
    if (r.date) $('rm-start-date').value = r.date;
    $('rm-start-text').value = r.text;
    $('rm-shot-err').className = r.unread.length || r.missing ? 'err' : 'ok';
    $('rm-shot-err').textContent = [
      r.unread.length ? t('Check these lines, they were not understood: {lines}', { lines: r.unread.join(', ') }) : '',
      r.missing ? t('The total says {n} more guests than the rows — a row is probably cut off the screenshot. Add it by hand.', { n: r.missing }) : '',
    ].filter(Boolean).join(' ') || t('Filled in. Check the date and the numbers, then press Save.');
  } catch (err) { $('rm-shot-err').className = 'err'; $('rm-shot-err').textContent = tx(err.message); }
  finally { $('rm-shot').disabled = false; }
};
$('rm-save').onclick = async () => {
  $('rm-err').textContent = '';
  try {
    renderSettings(await api('PUT', `/api/properties/${state.ownerPropertyId}/settings`, { ...stBody(), ross: { c59: $('rm-c59').value } }));
    $('rm-err').className = 'ok';
    $('rm-err').textContent = t('Saved.');
  } catch (err) { $('rm-err').className = 'err'; $('rm-err').textContent = tx(err.message); }
};
// Guests left out of the files (no province or country of residence) are
// listed by name to fill in here; the download waits for them, unless the
// owner says to go without. Alloggiati never asks where a guest lives.
const rmQuery = () => `from=${$('rm-from').value}&to=${$('rm-to').value}${stQuery()}`;
async function rmCheck() {
  const check = await api('GET', `/api/properties/${state.ownerPropertyId}/rimovcli?${rmQuery()}&check=1`);
  renderRmMissing(check.missing);
  const n = check.missing.length;
  $('rm-err').className = n ? 'err' : 'ok';
  $('rm-err').textContent = n ? t('{n} guests are left out — their province or country of residence is missing.', { n }) : '';
  return n;
}
$('rm-file').onclick = async () => {
  $('rm-err').className = 'err';
  $('rm-err').textContent = '';
  try {
    if (await rmCheck()) return;
    location.href = `/api/properties/${state.ownerPropertyId}/rimovcli?${rmQuery()}`;
  } catch (err) { $('rm-err').className = 'err'; $('rm-err').textContent = tx(err.message); }
};
// ===== Quicklinks =====
// In the account menu, under The Vault: shortcuts to things deep in Settings, switched
// on in Settings → Quicklinks. Per person and property, on this device (a
// hostel's shared computer keeps each person's own). Only what the person
// may still do is shown.
// A file with a folded corner, a small arrow and an "XML" label across it.
const FAV_XML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 2.5h7.5l4.5 4.5v12.5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z"/><path d="M14 2.5V7h4.5"/><path d="M10 4.8v4.4M8.2 7.6 10 9.4l1.8-1.8"/><rect x="2.5" y="12" width="16" height="7" rx="1.8" fill="currentColor" stroke="none"/><text x="10.5" y="17.6" text-anchor="middle" font-size="5.6" font-weight="700" font-family="system-ui,sans-serif" letter-spacing=".3" stroke="none" style="fill:var(--surface)">XML</text></svg>';
// Room for this many icons; the free places show a + that leads to Settings → Quicklinks.
const FAV_SLOTS = 6;
const favKey = () => (state.me && state.property ? `hf-favs:${state.me.user.id}:${state.property.id}` : null);
function readFavs() {
  try { return JSON.parse(localStorage.getItem(favKey()) || '{}') || {}; } catch { return {}; }
}
function writeFavs(favs) {
  try { localStorage.setItem(favKey(), JSON.stringify(favs)); } catch { /* no storage here: nothing kept */ }
  renderFavs();
}
const FAVS = {
  // Yesterday's RiMovCli file (Settings → Reports), for the structure chosen
  // when it was switched on. Guests missing where they live: Settings shows them.
  rimovcli: {
    usable: () => !!state.ownerPropertyId,
    icon: FAV_XML,
    name: () => t("Yesterday's RiMovCli XML file"),
    label: f => (f.name ? t("Download yesterday's XML · {name}", { name: f.name }) : t("Download yesterday's XML")),
    run: async f => {
      const d = new Date(Date.now() - 864e5);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const q = `from=${day}&to=${day}${f.structure && f.structure !== 'main' ? `&structure=${encodeURIComponent(f.structure)}` : ''}`;
      try {
        const check = await api('GET', `/api/properties/${state.ownerPropertyId}/rimovcli?${q}&check=1`);
        if (check.missing.length) {
          openSection('sec-police');
          $('au-rimovcli').open = true;
          $('rm-from').value = $('rm-to').value = day;
          renderRmMissing(check.missing);
          $('rm-err').className = 'err';
          $('rm-err').textContent = t('{n} guests are left out — their province or country of residence is missing.', { n: check.missing.length });
          return;
        }
        location.href = `/api/properties/${state.ownerPropertyId}/rimovcli?${q}`;
      } catch (err) { toast(tx(err.message)); }
    },
  },
};
let favTab = 'board';
function renderFavs(tab = favTab) {
  favTab = tab;
  const box = $('favs-list');
  const on = favKey() ? Object.entries(readFavs()).filter(([k]) => FAVS[k] && FAVS[k].usable()) : [];
  const offered = favKey() ? Object.keys(FAVS).filter(k => FAVS[k].usable()) : [];
  // Shown whenever there's something this person could add.
  $('favs').hidden = $('sec-quick').hidden = !offered.length;
  box.replaceChildren();
  for (const [k, f] of on) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = 'um-quick-icon';
    b.innerHTML = FAVS[k].icon;
    b.dataset.tip = FAVS[k].label(f);
    b.setAttribute('aria-label', b.dataset.tip);
    b.onclick = () => { closeUserMenu(); FAVS[k].run(f); };
    box.append(b);
  }
  for (let i = on.length; i < FAV_SLOTS; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = 'um-quick-icon um-quick-add';
    b.textContent = '+';
    b.dataset.tip = t('Add a quicklink');
    b.setAttribute('aria-label', b.dataset.tip);
    b.onclick = () => { closeUserMenu(); openSection('sec-quick'); };
    box.append(b);
  }
  // Settings → Quicklinks: a switch for each one this person can use.
  $('qk-list').replaceChildren(...offered.map(k => {
    const row = document.createElement('label');
    row.className = 'hk-opt';
    const name = document.createElement('span');
    name.append(text('b', FAVS[k].name()));
    const sw = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'switch', checked: !!readFavs()[k] });
    sw.onchange = () => setFav(k, sw.checked);
    row.append(name, sw);
    return row;
  }));
}
// A tap opens the links under it (on a computer hovering does, to the side).
$('um-quick').onclick = () => {
  const open = $('favs').classList.toggle('open');
  $('um-quick').setAttribute('aria-expanded', open ? 'true' : 'false');
};
function setFav(k, on) {
  const favs = readFavs();
  if (on && k === 'rimovcli') {
    // For the structure picked in Reports at the time.
    const s = state.settings && state.settings.structures && state.settings.structures.find(x => x.id === stSel);
    favs.rimovcli = { structure: stSel, name: s ? s.name : '' };
  } else if (on) favs[k] = {};
  else delete favs[k];
  writeFavs(favs);
}

function renderRmMissing(list) {
  const box = $('rm-missing');
  box.hidden = !list.length;
  box.replaceChildren();
  if (!list.length) return;
  box.append(text('p', "ISTAT needs to know where each guest lives (the police don't). Italians born abroad need a province of residence; \"unknown\" isn't allowed.", 'muted'));
  for (const g of list) {
    const row = document.createElement('div');
    row.className = 'rm-miss';
    const who = document.createElement('div');
    who.className = 'grow';
    const name = document.createElement('b');
    name.textContent = g.name || t('Unnamed'); // a guest's own name: never translated
    who.append(name);
    if (g.arrival) who.append(text('small', t('arrived {date}', { date: g.arrival })));
    const input = document.createElement('input');
    input.placeholder = t(g.italy ? 'Province, e.g. SP' : 'Country of residence');
    input.maxLength = g.italy ? 2 : 60;
    if (g.italy) input.autocapitalize = 'characters';
    input.setAttribute('aria-label', `${input.placeholder}: ${g.name}`);
    const save = text('button', 'Save', 'small');
    const err = text('div', '', 'err');
    const store = async () => {
      if (!input.value.trim()) { input.focus(); return; }
      save.disabled = true;
      err.textContent = '';
      try {
        await api('PUT', `/api/properties/${state.ownerPropertyId}/guests/${g.id}/stay`, g.italy ? { residenceProvince: input.value } : { residenceCountry: input.value });
        const still = (await rmCheck(), [...$('rm-missing').querySelectorAll('.rm-miss')].some(r => r.dataset.id === g.id));
        if (still) {
          const again = $('rm-missing').querySelector(`.rm-miss[data-id="${g.id}"] .err`);
          if (again) again.textContent = t(g.italy ? 'Not a province — use the two letters, e.g. SP.' : 'Country not found — try its Italian name.');
        }
      } catch (ex) { err.textContent = tx(ex.message); save.disabled = false; }
    };
    save.onclick = store;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); store(); } };
    row.dataset.id = g.id;
    row.append(who, input);
    row.append(save, err);
    box.append(row);
  }
  const anyway = text('button', 'Download without them', 'link');
  anyway.type = 'button';
  anyway.onclick = () => { location.href = `/api/properties/${state.ownerPropertyId}/rimovcli?${rmQuery()}`; };
  box.append(anyway);
}

function renderRegPicker() {
  const s = state.settings;
  const sel = $('se-registration');
  const btn = $('se-reg-btn');
  const list = $('se-reg-list');
  const choices = [{ id: '', name: t('None') }, ...s.modules.filter(m => !auCountry || m.country === auCountry)];
  const row = (m, tag) => {
    const el = document.createElement(tag);
    el.append(text('span', m.name, 'reg-name'));
    if (m.country) el.append(flagEl(m.country));
    return el;
  };
  const current = choices.find(m => m.id === sel.value) || choices[0];
  btn.replaceChildren(...row(current, 'span').childNodes, text('span', '▾', 'reg-chev'));
  list.replaceChildren(...choices.map(m => {
    const li = row(m, 'li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(m.id === sel.value));
    li.tabIndex = 0;
    const pick = () => {
      closeRegList();
      if (sel.value === m.id) return;
      sel.value = m.id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      renderRegPicker();
    };
    li.onclick = pick;
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    return li;
  }));
  btn.onclick = () => {
    const open = list.hidden;
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) (list.querySelector('[aria-selected="true"]') || list.firstChild).focus();
  };
}
function closeRegList() {
  $('se-reg-list').hidden = true;
  $('se-reg-btn').setAttribute('aria-expanded', 'false');
  $('au-list').hidden = true;
  $('au-btn').setAttribute('aria-expanded', 'false');
  $('au-part-list').hidden = true;
  $('au-part-btn').setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => { if (!e.target.closest('.reg-pick')) closeRegList(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRegList(); });

function closeHelpBubbles() {
  for (const b of document.querySelectorAll('.help-bubble:not([hidden])')) b.hidden = true;
  for (const q of document.querySelectorAll('.help-toggle.on')) {
    q.classList.remove('on');
    q.setAttribute('aria-expanded', 'false');
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('.help-toggle, .help-bubble')) closeHelpBubbles();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelpBubbles(); });

// France: the kept fiches, printed for a period (the police may ask for them).
function fiFill(f) {
  const sheet = document.createElement('section');
  sheet.className = 'fiche';
  const row = (label, value) => { const p = document.createElement('p'); p.append(text('span', label, 'fl'), text('b', value || '—')); return p; };
  sheet.append(
    text('h2', 'Fiche individuelle de police'),
    text('div', [f.etablissement, f.adresse].filter(Boolean).join(' — '), 'fe'),
    row('Nom', f.nom), row('Prénoms', f.prenoms), row('Date et lieu de naissance', `${f.naissance} — ${f.lieuNaissance}`),
    row('Nationalité', f.nationalite), row('Domicile habituel', f.domicile), row('Téléphone mobile', f.telephone),
    row('Adresse électronique', f.email), row("Date d'arrivée", f.arrivee), row('Date de départ prévue', f.depart),
    row('Document', f.document), text('div', 'Signature :', 'fs'),
  );
  return sheet;
}
$('fi-print').onclick = async () => {
  $('fi-err').textContent = '';
  try {
    const r = await api('GET', `/api/properties/${state.ownerPropertyId}/fiches?from=${$('fi-from').value}&to=${$('fi-to').value}`);
    if (!r.fiches.length) { $('fi-err').textContent = t('No fiches for these days.'); return; }
    $('print-fiches').replaceChildren(...r.fiches.map(fiFill));
    window.print();
  } catch (err) { $('fi-err').textContent = tx(err.message); }
};

// The "i" next to a label that opens its help as a speech bubble over the field.
function addFieldHelp(head, label, id, body) {
  const bubble = document.createElement('div');
  bubble.className = 'help-bubble';
  bubble.id = id;
  bubble.hidden = true;
  bubble.setAttribute('role', 'note');
  bubble.append(text('strong', t('How to find this')), body);
  label.append(helpButton(bubble, t('How to find this')));
  head.append(label, bubble);
}
// An "i" that opens (and closes) a help bubble; one bubble open at a time.
function helpButton(bubble, name) {
  const q = document.createElement('button');
  q.type = 'button';
  q.className = 'help-toggle';
  q.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="ring" cx="10" cy="10" r="8.6"/>'
    + '<circle class="dot" cx="10.4" cy="5.4" r="1.6"/><path class="stem" d="M8 8.4h3.4v5.4h1.3v1.4H7.6v-1.4h1.3v-4H8z"/></svg>';
  q.setAttribute('aria-label', name);
  q.setAttribute('aria-expanded', 'false');
  q.setAttribute('aria-controls', bubble.id);
  q.onclick = e => {
    e.preventDefault(); // it sits inside the <label>: don't focus the input
    const open = bubble.hidden;
    closeHelpBubbles();
    if (!open) return;
    bubble.style.setProperty('--tail', `${q.offsetLeft + q.offsetWidth / 2}px`);
    bubble.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    q.classList.add('on');
  };
  return q;
}

// Fields of the system picked in the dropdown (it may not be saved yet).
function renderCredentialFields() {
  const s = state.settings;
  const id = $('se-registration').value;
  // France keeps fiches instead of sending: their printing shows instead of the connection check.
  $('se-fiches').hidden = !(id === 'fr-fiche' && s.registration === 'fr-fiche');
  if (!$('fi-to').value) {
    const d = new Date();
    $('fi-to').value = d.toISOString().slice(0, 10);
    $('fi-from').value = new Date(d.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  }
  const module = s.modules.find(m => m.id === id);
  const saved = id === s.registration ? stSlot().credentials : {};
  const box = $('se-fields');
  box.replaceChildren();
  for (const f of module ? module.fields : []) {
    const label = text('label', f.label);
    label.htmlFor = `se-cred-${f.key}`;
    const input = document.createElement('input');
    input.id = `se-cred-${f.key}`;
    input.dataset.key = f.key;
    input.autocomplete = 'off';
    input.maxLength = 500;
    const cur = saved[f.key] || { set: false };
    if (f.secret) {
      input.type = 'password';
      input.autocomplete = 'new-password'; // stop the browser filling in the HostelFlow password
      input.placeholder = t(cur.set ? '•••••••• saved' : 'not set');
    } else {
      input.value = cur.value || '';
    }
    if (!f.help) { box.append(label, input); continue; }
    // Where to find this value on the police portal: an "i" next to the
    // label opens it as a speech bubble over the field, so the form stays short.
    const head = document.createElement('div');
    head.className = 'field-head';
    const body = text('p', f.help);
    if (f.key === 'wskey' && module.portalUrl) {
      const a = document.createElement('a');
      a.href = module.portalUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = t('Open Alloggiati Web ↗');
      a.style.color = 'var(--link)';
      body.append(' ', a);
    }
    addFieldHelp(head, label, `se-help-${f.key}`, body);
    box.append(head, input);
  }
  $('se-note').hidden = !module;
  $('se-check').hidden = !(module && id === s.registration);
}

function renderCheckStatus(status) {
  const el = $('se-status');
  el.className = '';
  if (!status) {
    el.textContent = t('Connection not checked yet');
  } else if (status.ok) {
    el.textContent = t('✓ Connection works (checked {when})', { when: new Date(status.at).toLocaleString() });
    el.className = 'ok';
  } else {
    el.textContent = `✗ ${tx(status.message)}`;
    el.className = 'err';
  }
}

$('se-registration').addEventListener('change', renderCredentialFields);

bindForm('form-settings', 'se-err', async () => {
  const body = { ...stBody(), registration: $('se-registration').value || null };
  const inputs = $('se-fields').querySelectorAll('input');
  if (inputs.length) {
    body.credentials = {};
    for (const i of inputs) body.credentials[i.dataset.key] = i.value;
  }
  if (state.settings.registration && body.registration !== state.settings.registration
      && !confirm(t('Switching systems deletes the saved police login. Continue?'))) return;
  renderSettings(await api('PUT', `/api/properties/${state.adminPropertyId}/settings`, body));
  const p = state.me.properties.find(x => x.id === state.adminPropertyId);
  p.name = state.settings.name;
  p.registration = state.settings.registration;
  $('staff-property').textContent = p.name;
  $('hd-property').textContent = state.property ? state.property.name : '';
  renderPropertyList();
  $('se-err').className = 'ok';
  $('se-err').textContent = t('Saved.');
});

$('btn-check').onclick = async () => {
  const btn = $('btn-check');
  btn.disabled = true;
  $('se-status').className = 'muted';
  $('se-status').textContent = t('Checking…');
  try {
    const status = await api('POST', `/api/properties/${state.adminPropertyId}/registration/check`, stBody());
    stSlot().status = status;
    renderCheckStatus(status);
    // Working again: the warning goes (Check-in, Dashboard) — once every structure's login works.
    const all = [state.settings.status, ...state.settings.structures.map(x => x.status)];
    if (state.property && state.property.id === state.adminPropertyId) state.property.loginBroken = all.some(st => st && !st.ok && !!st.login);
  } catch (err) {
    $('se-status').className = 'err';
    $('se-status').textContent = tx(err.message);
  } finally {
    btn.disabled = false;
  }
};

// Disconnect: the saved police login is forgotten (nothing can be sent until a new one is saved).
$('btn-disconnect').onclick = async () => {
  if (!confirm(t('Disconnect the police login? You won\'t be able to send guests until you add it again.'))) return;
  try {
    renderSettings(await api('PUT', `/api/properties/${state.adminPropertyId}/settings`, { ...stBody(), clearCredentials: true }));
    toast(t('Disconnected'));
  } catch (err) { alert(tx(err.message)); }
};

// ===== Settings: subscription =====

const fmtDay = ms => new Date(ms).toLocaleDateString(LOCALE);

const PLAN_FEATURES = {
  checkin: ['Check-in from one photo of the ID', 'Automated police registration', 'Automated statistic reports', 'Logins for co-hosts or staff', 'No extra payments during the off-season: pay only when you have actual guests!'],
  flow: ['Everything in Check-in', 'Dashboard, notes, guidelines', 'Housekeeping and shifts', 'The Vault: procedures, contacts and files', 'Team with roles and invites'],
  one: ['Everything in HostelFlow', 'Calendar with all reservations', 'Booking.com / Airbnb calendars (iCal)', 'Soon: channel manager and one inbox'],
};

async function loadBilling() {
  let b;
  try { b = await api('GET', `/api/properties/${state.ownerPropertyId}/billing`); } catch { return; }
  $('sec-billing').hidden = !b.enabled;
  $('ci-billing').hidden = true;
  if (!b.enabled) return;
  const daysLeft = Math.ceil(((b.trialEndsAt || 0) - Date.now()) / 86400000);
  const lines = {
    trial: daysLeft > 0 ? t(daysLeft === 1 ? 'Free trial — 1 day left (until {date}).' : 'Free trial — {n} days left (until {date}).', { n: daysLeft, date: fmtDay(b.trialEndsAt) }) : t('The free trial has ended. Subscribe to keep registering guests.'),
    trialing: t('Subscribed. First payment on {date}.', { date: fmtDay(b.currentPeriodEnd || b.trialEndsAt) }),
    active: b.currentPeriodEnd ? t('Subscribed. Next payment around {date}.', { date: fmtDay(b.currentPeriodEnd) }) : t('Subscribed.'),
    past_due: t('Your last payment failed. Please update your card. The app keeps working for now.'),
    unpaid: t('Payment failed. Police reports are paused until you update your card.'),
    canceled: t('The subscription has ended. Subscribe again to keep registering guests.'),
    incomplete: t('The payment was not completed.'),
    comp: t('Free of charge (pilot).'),
  };
  const subscribed = ['active', 'trialing', 'past_due', 'unpaid'].includes(b.status);
  $('bi-status').textContent = b.paidBy ? t('Paid for by the subscription of {name}.', { name: b.paidBy.name })
    : b.cancelAt ? t('Cancelled. Active until {date}.', { date: fmtDay(b.cancelAt) })
    : b.paused && subscribed ? t('Paused for the season — nothing is charged. Resume when you open again.')
    : lines[b.status] || b.status;
  const fail = err => { $('bi-err').textContent = tx(err.message); };
  const pid = state.ownerPropertyId;
  // A property under another property's subscription: nothing to choose here.
  if (b.paidBy) {
    $('bi-plans').replaceChildren();
    $('bi-apts').hidden = true; $('bi-action').hidden = true; $('bi-pause').hidden = true;
    return;
  }
  // The plans side by side; the one being paid for is marked.
  // HostelOne (calendar, channels) is still in preview.
  $('bi-plans').replaceChildren(...b.plans.filter(pl => pl.id !== 'one' || inPreview()).map(pl => {
    const card = document.createElement('div');
    const current = subscribed && b.plan === pl.id;
    card.className = 'plan' + (pl.id === 'one' ? ' one' : '') + (current ? ' current' : '');
    // The lowest monthly price (paid by guests: a quiet month costs less, or nothing).
    const from = pl.price || (b.tiers ? b.tiers[0].price + (pl.team || 0) : null);
    const price = document.createElement('div');
    price.className = 'price';
    if (from) price.append(text('small', pl.price ? '' : t('Starting at'), 'from'), `${from} €`, text('small', t('/ month'), 'per'));
    card.append(text('b', pl.name, 'plan-name'), price);
    // In one line what the starting price buys; the "i" opens the whole table.
    if (b.tiers && pl.id === 'checkin') {
      const note = text('div', t('{price} € up to {n} guests a month', { price: b.tiers[0].price, n: b.tiers[0].upTo }), 'plan-note has-help');
      const bubble = document.createElement('div');
      bubble.className = 'help-bubble';
      bubble.id = 'bi-price-help';
      bubble.hidden = true;
      bubble.setAttribute('role', 'note');
      bubble.append(text('strong', t('Pricing')), priceTable(b),
        text('p', t('You pay at the end of each month for the guests you sent to the police that month. A quiet month costs less, an empty one nothing.')));
      note.append(helpButton(bubble, t('Pricing')), bubble);
      card.append(note);
    }
    if (b.tiers && pl.team) card.append(text('div', t('Check-in price + {price} € a month for Flow', { price: pl.team }), 'plan-note'));
    const ul = document.createElement('ul');
    for (const f of PLAN_FEATURES[pl.id] || []) ul.append(text('li', f));
    card.append(ul);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plan-btn go';
    const label = (words, arrow = true) => {
      btn.replaceChildren(text('span', words));
      if (arrow) btn.append(text('span', '→', 'arrow'));
    };
    if (b.status === 'comp') { btn.hidden = true; }
    else if (current) { btn.className = 'plan-btn mine'; label(b.cancelAt ? t('Your plan until {date}', { date: fmtDay(b.cancelAt) }) : `✓ ${t('Your plan')}`, false); btn.disabled = true; }
    else if (!pl.available) { btn.className = 'plan-btn soon'; label(t('Coming soon'), false); btn.disabled = true; }
    else if (subscribed) {
      label(t('Switch to this plan'));
      btn.onclick = async () => {
        if (!confirm(t('Switch to {plan}? You\'ll pay the difference on your next invoice.', { plan: t(pl.name) }))) return;
        btn.disabled = true;
        try { await api('POST', `/api/properties/${pid}/billing/plan`, { plan: pl.id }); loadBilling(); } catch (err) { fail(err); btn.disabled = false; }
      };
    } else {
      label(t('Subscribe'));
      btn.onclick = async () => {
        btn.disabled = true;
        try { location.href = (await api('POST', `/api/properties/${pid}/billing/checkout`, { plan: pl.id })).url; } catch (err) { fail(err); btn.disabled = false; }
      };
    }
    card.append(btn);
    // During the free trial: say that subscribing doesn't cut it short.
    if (!btn.hidden && !subscribed && !current && pl.available && b.status === 'trial' && daysLeft > 0) {
      card.append(text('div', 'Secure payment by Stripe · cancel any time', 'trial-note'));
    }
    return card;
  }));
  renderApartments(b, fail);
  $('bi-action').hidden = !subscribed;

  // Closed for the season: pause (nothing charged), resume on opening again.
  // Pausing is switched off for now: the card shows only to resume one already paused.
  $('bi-pause').hidden = !subscribed || b.status === 'unpaid' || !b.paused;
  $('bi-pause-title').textContent = t(b.paused ? 'Resume the subscription' : 'Pause for the season');
  $('bi-pause-sub').textContent = t(b.paused ? 'Reopen: police reports start again' : 'Closed for a while? You pay nothing and everything stays saved.');
  $('bi-pause-ico').classList.toggle('paused', !!b.paused);
  $('bi-pause').onclick = async () => {
    if (!b.paused && !confirm(t('Pause the subscription? You pay nothing while paused and everything stays saved. Guests can\'t be sent to the police until you resume.'))) return;
    $('bi-pause').disabled = true;
    try { await api('POST', `/api/properties/${pid}/billing/pause`, { pause: !b.paused }); await loadBilling(); } catch (err) { fail(err); }
    $('bi-pause').disabled = false;
  };
  $('bi-action').onclick = async () => {
    $('bi-action').disabled = true;
    $('bi-err').textContent = '';
    try {
      location.href = (await api('POST', `/api/properties/${state.ownerPropertyId}/billing/portal`, {})).url; // Stripe's own page; it sends the owner back here
    } catch (err) {
      fail(err);
      $('bi-action').disabled = false;
    }
  };
  // On the check-in screen: a nudge a week before the trial ends, or when sending is paused.
  const warn = (b.status === 'trial' && daysLeft <= 7) || !b.canSend || b.status === 'past_due';
  $('ci-billing').hidden = !warn;
  $('ci-billing').textContent = b.canSend
    ? t('{status} Settings → Subscription.', { status: $('bi-status').textContent })
    : b.paused ? t('Police reports are paused because the subscription is paused. Settings → Subscription.')
    : t('Police reports are paused: your trial or subscription has ended. Settings → Subscription.');
}

// What each number of guests costs (the "i" next to Check-in's price).
function priceTable(b) {
  const eur = n => n.toLocaleString(LOCALE, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const row = (what, price) => {
    const r = document.createElement('div');
    r.className = 'pc-row';
    r.append(text('span', what), text('b', price));
    return r;
  };
  const table = document.createElement('div');
  table.className = 'pc-table';
  table.append(
    row(t('0 or 1 guest'), t('Free')),
    ...b.tiers.map(x => row(t('Up to {n} guests', { n: x.upTo }), `${eur(x.price)} €`)),
    row(t('Above {n} guests', { n: b.tiers.at(-1).upTo }), t('+ {price} € a guest', { price: eur(b.perGuestAbove) })),
  );
  return table;
}

// Other own properties on this subscription: their guests count with this one's.
function renderApartments(b, fail) {
  const box = $('bi-apts');
  const pid = state.ownerPropertyId;
  const others = state.me.properties.filter(p => p.role === 'owner' && p.id !== pid);
  const plan = b.plans.find(p => p.id === 'checkin');
  box.hidden = !plan || !plan.available || b.status === 'comp' || !others.length;
  if (box.hidden) return;
  box.replaceChildren(text('b', 'Properties on this subscription'));
  for (const p of others) {
    const row = document.createElement('label');
    row.className = 'check-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = p.id;
    cb.checked = b.apartments.ids.includes(p.id);
    row.append(cb, text('span', p.name));
    box.append(row);
  }
  const save = text('button', 'Save', 'small');
  save.type = 'button';
  save.onclick = async () => {
    save.disabled = true;
    const ids = [...box.querySelectorAll('input:checked')].map(i => i.value);
    try { await api('PUT', `/api/properties/${pid}/billing/apartments`, { ids }); toast(t('Saved')); await loadBilling(); } catch (err) { fail(err); }
    save.disabled = false;
  };
  box.append(text('p', 'One subscription covers this property and the ones you tick. Their guests count together; each keeps its own police login.', 'muted'), save);
}

// Back from Stripe Checkout.
const billingReturn = new URLSearchParams(location.search).get('billing');
if (billingReturn) {
  history.replaceState(null, '', '/' + location.hash);
  setTimeout(() => toast(t(billingReturn === 'success' ? 'Thank you! Your subscription is being activated.' : 'Payment cancelled — nothing was charged.')), 500);
}

// ===== Settings: activity (owners) =====

// What src/activity.js records, as sentences.
const ACTIVITY_TEXT = {
  signed_in: '{who} signed in',
  invited: '{who} invited {detail}',
  member_joined: '{who} joined the team',
  member_added: '{who} added {detail} to the team',
  member_removed: '{who} removed {detail} from the team',
  access_changed: "{who} changed {detail}'s access",
  member_changed: "{who} changed {detail}'s details",
  profile_added: '{who} added {detail} without e-mail',
  profile_switched: '{who} took over from {detail}',
  police_login_changed: '{who} changed the police login',
  police_login_removed: '{who} disconnected the police login',
  statistics_changed: '{who} changed the statistics settings',
  structure_added: '{who} added the structure {detail}',
  structure_removed: '{who} removed the structure {detail}',
  guests_sent: '{who} sent guests to the police: {detail}',
};
let activityOldest = null;
async function loadActivity(more) {
  const pid = state.ownerPropertyId;
  if (!pid) return;
  const r = await api('GET', `/api/properties/${pid}/activity${more && activityOldest ? `?before=${activityOldest}` : ''}`);
  const list = $('ac-list');
  if (!more) list.replaceChildren();
  for (const i of r.items) {
    const row = document.createElement('div');
    row.className = 'row';
    const when = new Date(i.at).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const sentence = ACTIVITY_TEXT[i.action]
      ? t(ACTIVITY_TEXT[i.action], { who: i.who || t('Someone'), detail: i.detail || '' })
      : `${i.who || t('Someone')}: ${i.action}`;
    row.append(text('div', sentence, 'grow'), text('span', when, 'muted'));
    list.append(row);
    activityOldest = i.id;
  }
  $('ac-empty').hidden = list.childElementCount > 0;
  $('ac-more').hidden = !r.more;
}
$('ac-more').onclick = () => loadActivity(true).catch(() => {});
