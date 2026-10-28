// HostelFlow — Dashboard: needs attention, notes, guidelines.
// Plain scripts loaded in order by index.html; they share globals.

// ===== Dashboard =====

const NOTE_CATEGORY_LABELS = {
  checkins: 'Check-ins', guests: 'Guests', laundry: 'Laundry', broken: 'Broken stuff',
  shopping: 'Shopping', payments: 'Payments', other: 'Other',
};
// The colours from Costello's dashboard.
const NOTE_CATEGORY_COLORS = {
  checkins: '#3a6fd4', guests: '#17c4aa', laundry: '#caa53a', broken: '#c65d5d',
  shopping: '#a85d7a', payments: '#4a9d5f', other: '#888',
};
// A person's badge colour: what they chose in the user menu, else one from their name (core.js).
const personColor = (name, chosen) => colorOf(name, chosen);
const boardBase = () => `/api/properties/${state.property.id}`;
let board = null;
// What the board says this person may do (see src/auth.js PERMISSIONS).
const boardCan = p => !!(board && (board.can || []).includes(p));
let rtOffset = 0;        // routine block shown, relative to the current one
let noteCategory = null;

async function loadBoard() {
  // Check-in-only plans have no Dashboard: nothing to load (the server would say 402).
  if (!state.property || !fullApp()) return;
  try {
    board = await api('GET', `${boardBase()}/board`);
  } catch (err) {
    if (err.status === 401) return show('view-login');
    return toast(err.message);
  }
  renderBoard();
}

// Keep the board fresh while it's on screen: the team works on several phones.
const boardOnScreen = () => !document.hidden && state.property && !$('view-app').hidden && !$('tab-board').hidden;
setInterval(() => { if (boardOnScreen()) loadBoard(); }, 30000); // another tab: it loads when opened
document.addEventListener('visibilitychange', () => { if (boardOnScreen()) loadBoard(); });

// Our own hostel one-liners, one per day.
const DAY_LINES = [
  'A clean bathroom is a five-star review waiting to happen.',
  'Every bunk tells a story. Most of them involve snoring.',
  'Coffee first. Check-ins second. Everything else third.',
  'The best hostels run on kindness and spare toilet paper.',
  'Somebody always arrives at 2 a.m. Today, be ready.',
  'A smile at reception is worth three free breakfasts.',
  'Lost keys are just adventures in disguise.',
  'Strangers in the morning, friends by the evening.',
  'Fresh sheets, happy guests, quiet mornings.',
  'The terrace at sunset is part of the job description.',
  'Today’s guests are tomorrow’s best reviews.',
  'Lockers locked, music on, kettle full. You’ve got this.',
];
function renderHello() {
  const h = new Date().getHours();
  const name = (state.me.user.name || '').split(' ')[0];
  const hi = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('hello-hi').textContent = `${t(hi)}${name ? `, ${name}` : ''} ${h >= 5 && h < 18 ? '☀️' : '🌙'}`;
  $('hello-date').textContent = new Date().toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
  const day = Math.floor(Date.now() / 86400000);
  $('hello-line').textContent = t(DAY_LINES[day % DAY_LINES.length]);
}

function renderBoard() {
  renderHello();
  renderHandover();
  renderAttention();
  renderRoutine();
  renderNotes();
}

function attentionButton(cls, icon, label, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `att-item ${cls}`;
  b.append(text('span', icon), text('span', label, 'grow'), text('span', '›'));
  b.onclick = onclick;
  return b;
}

function taskRow(task, side, onTick) {
  const row = document.createElement('div');
  row.className = 'task' + (task.done ? ' done' : '');
  const check = text('span', task.done ? '✓' : '', 'check');
  row.append(check, text('span', task.text, 'txt'));
  if (side) row.append(text('span', side, 'by'));
  row.onclick = () => onTick(row, check);
  return row;
}

// Ticks show at once (the board is updated here first); the server is told in
// the background, and if that fails the real state is loaded back.
function tickLocally(ids, done) {
  const me = state.me.user.name || state.me.user.email;
  for (const b of board.routine) for (const t of b.tasks) if (ids.includes(t.id)) t.done = done ? { by: me, at: Date.now() } : null;
  if (done) board.attention = board.attention.filter(a => !(a.type === 'task' && ids.includes(a.id)));
}
async function tick(ids, done = true) {
  tickLocally(ids, done);
  try {
    await api('POST', `${boardBase()}/board/routine`, { taskIds: ids, done });
    if (!done) loadBoard(); // an unticked past task goes back to "Needs attention"
  } catch (err) {
    toast(err.message);
    loadBoard();
  }
}

// Fold a ticked row away, then redraw (the list closes up smoothly).
function foldAway(rows, then) {
  for (const r of rows) {
    r.style.maxHeight = `${r.offsetHeight}px`;
    void r.offsetHeight;
    r.classList.add('completing');
  }
  setTimeout(then, 300);
}

let hadAttention = false;
function confetti(el) {
  el.style.position = 'relative';
  const colors = ['#ff7a1a', '#3a6fd4', '#12a08c', '#e0b030', '#d4537e'];
  for (let i = 0; i < 16; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.background = colors[i % colors.length];
    c.style.left = `${45 + Math.random() * 10}%`;
    c.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 220)}px`);
    c.style.animationDelay = `${Math.random() * 0.15}s`;
    el.append(c);
    setTimeout(() => c.remove(), 1300);
  }
}


// From "Needs attention" to the note itself: scroll to it and make it blink once.
function showNote(id) {
  const el = document.querySelector(`.note[data-note-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function renderAttention() {
  const box = $('bd-attention');
  box.replaceChildren();
  const tasks = board.attention.filter(a => a.type === 'task');
  for (const a of board.attention) {
    if (a.type === 'note') {
      // A note the owner marked: click shows it among the notes.
      const label = a.text.length > 110 ? `${a.text.slice(0, 107)}…` : a.text;
      const b = attentionButton('note', '!', label, () => showNote(a.id));
      if (a.author) b.querySelector('.grow').append(Object.assign(text('small', firstName(a.author), 'att-by'), { title: a.author }));
      if (boardCan('attention')) {
        // Done: out of Needs attention (the note itself stays).
        const done = text('span', '✓', 'att-done');
        done.setAttribute('role', 'button');
        done.setAttribute('tabindex', '0');
        done.title = t('Remove from Needs attention');
        done.setAttribute('aria-label', done.title);
        const off = async e => {
          e.stopPropagation();
          foldAway([b], async () => {
            try { await api('POST', `${boardBase()}/notes/${a.id}/attention`, { on: false }); } catch (err) { toast(err.message); }
            loadBoard();
          });
        };
        done.onclick = off;
        done.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') off(e); };
        b.lastChild.replaceWith(done);
      }
      box.append(b);
    } else if (a.type === 'late') {
      box.append(attentionButton('danger', '⏰', t(a.count === 1 ? '1 guest from an earlier day is not registered yet' : '{n} guests from earlier days are not registered yet', { n: a.count }), () => showTab('checkin')));
    } else if (a.type === 'waiting') {
      box.append(attentionButton('go', '🛂', t(a.count === 1 ? '1 guest waiting for police registration' : '{n} guests waiting for police registration', { n: a.count }), () => showTab('checkin')));
    } else if (a.type === 'arrivals') {
      box.append(attentionButton('go', '🧳', t(a.count === 1 ? '1 arrival today' : '{n} arrivals today', { n: a.count }), () => showTab('calendar')));
    } else if (a.type === 'departures') {
      box.append(attentionButton('go', '👋', t(a.count === 1 ? '1 departure today' : '{n} departures today', { n: a.count }), () => showTab('calendar')));
    } else if (a.type === 'beds') {
      box.append(attentionButton('go', '🛏️', t(a.count === 1 ? '1 bed to make up' : '{n} beds to make up', { n: a.count }), () => showTab('housekeeping')));
    } else if (a.type === 'sheets') {
      box.append(attentionButton('warn', '🛏️', t(a.count === 1 ? '1 bed with sheets to change' : '{n} beds with sheets to change', { n: a.count }), () => showTab('housekeeping')));
    } else if (a.type === 'linen') {
      box.append(attentionButton('warn', '🧺', t(a.count === 1 ? '1 bed with linen to change' : '{n} beds with linen to change', { n: a.count }), () => showTab('housekeeping')));
    } else if (a.type === 'hktasks') {
      box.append(attentionButton('warn', '🧽', t(a.count === 1 ? '1 recurring task due' : '{n} recurring tasks due', { n: a.count }), () => showTab('housekeeping')));
    } else if (a.type === 'login') {
      const owner = boardCan('police');
      box.append(attentionButton('danger', '🔑', t(owner ? 'The Alloggiati Web login stopped working — update the password or key' : 'The Alloggiati Web login stopped working — ask the owner to update it'), () => { if (owner) openSection('sec-police'); }));
    } else if (a.type === 'setup') {
      const owner = boardCan('police');
      box.append(attentionButton('warn', '⚙️', t(owner ? 'Police registration is not set up yet' : 'Police registration is not set up yet — ask the owner'), () => { if (owner) showTab('settings'); }));
    }
  }
  if (tasks.length) box.append(text('div', 'Missed tasks', 'rt-label'));
  for (const a of tasks) {
    box.append(taskRow(a, a.block, (row, check) => {
      check.textContent = '✓';
      tick([a.id]);
      foldAway([row], renderBoard);
    }));
  }
  $('bd-clear').hidden = tasks.length < 2;
  $('bd-clear').onclick = () => {
    if (!confirm(t('Mark all {n} missed tasks as done?', { n: tasks.length }))) return;
    tick(tasks.map(a => a.id));
    foldAway([...box.querySelectorAll('.task')], renderBoard);
  };
  if (!box.children.length) {
    const done = text('div', '', 'all-done');
    done.append(text('span', '🎉', 'big'), t('All done — nothing needs attention.'));
    box.append(done);
    if (hadAttention) confetti(done);
  }
  hadAttention = box.querySelectorAll('.att-item, .task').length > 0;
}

// The block happening now, else the next one today, else the last one.
function currentBlockIndex() {
  const blocks = board.routine;
  const m = board.now.minutes;
  let i = blocks.findIndex(b => m >= b.from && m < b.to);
  if (i < 0) i = blocks.findIndex(b => b.from > m);
  return i < 0 ? blocks.length - 1 : i;
}

function renderRoutine() {
  const box = $('bd-routine');
  box.replaceChildren();
  const blocks = board.routine;
  $('bd-rt-nav').hidden = blocks.length < 2;
  if (!blocks.length) {
    // Not every place works by the clock: staff just don't see this card.
    $('bd-routine-card').hidden = !boardCan('guidelines');
    const p = text('p', 'Optional: a daily checklist for your team, by time of day.', 'muted');
    p.style.margin = '0 0 8px';
    const go = text('button', 'Set it up in Settings', 'link');
    go.type = 'button';
    go.onclick = () => openSection('sec-routine');
    box.append(p, go);
    return;
  }
  $('bd-routine-card').hidden = false;
  const cur = currentBlockIndex();
  const i = Math.max(0, Math.min(blocks.length - 1, cur + rtOffset));
  rtOffset = i - cur;
  const b = blocks[i];
  const isNow = board.now.minutes >= b.from && board.now.minutes < b.to;
  box.append(text('div', `${b.time}${b.label ? ' · ' + b.label : ''}${isNow ? ' · ' + t('now') : ''}`, 'rt-label' + (isNow ? ' now' : '')));
  box.classList.toggle('now', isNow); // the block happening now: blue boxes, as in Costello
  for (const task of b.tasks) {
    box.append(taskRow(task, task.done && task.done.by, (row, check) => {
      const done = !row.classList.contains('done');
      row.classList.toggle('done', done);
      check.textContent = done ? '✓' : '';
      tick([task.id], done);
      renderAttention(); // a ticked past task leaves "Needs attention" right away
    }));
  }
  $('bd-rt-prev').disabled = i === 0;
  $('bd-rt-next').disabled = i === blocks.length - 1;
}
renderNoteCategories();
function slideRoutine(dir) {
  rtOffset += dir;
  renderRoutine();
  const box = $('bd-routine');
  box.classList.remove('slide-l', 'slide-r');
  void box.offsetWidth;
  box.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
}
$('bd-rt-prev').onclick = () => slideRoutine(-1);
$('bd-rt-next').onclick = () => slideRoutine(1);

// "Today 17:31", or the day for older ones ("20/10 22:17").
function noteTime(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `${t('Today')} ${time}` : `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'numeric' })} ${time}`;
}
// On notes, end of shift and Needs attention just the first name: the full
// one with the category and the time didn't fit on one line (it shows on hover).
const firstName = name => String(name || '').trim().split(/\s+/)[0] || name;

function renderNoteCategories() {
  const box = $('nt-cats');
  box.replaceChildren();
  for (const key of Object.keys(NOTE_CATEGORY_LABELS)) {
    const c = text('button', t(NOTE_CATEGORY_LABELS[key]), 'chip cat' + (noteCategory === key ? ' on' : ''));
    c.type = 'button';
    c.style.setProperty('--c', NOTE_CATEGORY_COLORS[key]);
    c.onclick = () => { noteCategory = noteCategory === key ? null : key; renderNoteCategories(); };
    box.append(c);
  }
}

let seenNotes = null; // ids already shown; new ones pop in
// Which notes have their replies open, and half-typed replies — kept when the board refreshes.
const openThreads = new Set();
const replyDrafts = new Map();

function replyThread(n) {
  const thread = document.createElement('div');
  thread.className = 'replies';
  for (const r of n.replies) {
    const row = document.createElement('div');
    row.className = 'reply';
    const who = text('b', firstName(r.author));
    who.title = r.author;
    who.style.color = personColor(r.author, r.authorColor);
    // The name and the text get the whole width; the time and × go under it.
    const line = document.createElement('div');
    line.className = 'rline';
    line.append(who, ' ', text('span', r.text, 'rtext'));
    const foot = document.createElement('div');
    foot.className = 'rfoot';
    foot.append(text('time', noteTime(r.createdAt)));
    row.append(line, foot);
    if (r.canDelete) {
      const del = text('button', '×');
      del.type = 'button';
      del.setAttribute('aria-label', t('Delete'));
      del.onclick = async () => {
        try { await api('DELETE', `${boardBase()}/notes/${n.id}/replies/${r.id}`); } catch (err) { toast(err.message); }
        loadBoard();
      };
      foot.append(del);
    }
    thread.append(row);
  }
  if (!boardCan('notes')) return thread;
  const form = document.createElement('form');
  form.className = 'reply-new';
  const input = document.createElement('input');
  input.placeholder = t('Write a reply…');
  input.maxLength = 500;
  input.dataset.replyTo = n.id;
  input.value = replyDrafts.get(n.id) || '';
  input.oninput = () => replyDrafts.set(n.id, input.value);
  const send = document.createElement('button');
  send.type = 'submit';
  send.setAttribute('aria-label', t('Send'));
  send.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  form.onsubmit = async e => {
    e.preventDefault();
    if (!input.value.trim()) return;
    send.disabled = true;
    try {
      await api('POST', `${boardBase()}/notes/${n.id}/replies`, { text: input.value });
      replyDrafts.delete(n.id);
      await loadBoard();
      document.querySelector(`[data-reply-to="${n.id}"]`)?.focus();
    } catch (err) { toast(err.message); send.disabled = false; }
  };
  form.append(input, send);
  thread.append(form);
  return thread;
}

function renderNotes() {
  // A refresh while someone types a reply must not steal the cursor.
  const typing = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.replyTo : null;
  const box = $('bd-notes');
  box.replaceChildren();
  const fresh = seenNotes ? new Set(board.notes.filter(n => !seenNotes.has(n.id)).map(n => n.id)) : new Set();
  seenNotes = new Set(board.notes.map(n => n.id));
  if (!board.notes.length) {
    const none = text('p', 'No notes yet.', 'muted');
    none.style.margin = '14px 0 0';
    box.append(none);
  }
  for (const n of board.notes) {
    const el = document.createElement('div');
    el.className = 'note' + (n.attention ? ' flagged' : '');
    el.dataset.noteId = n.id;
    const meta = document.createElement('div');
    meta.className = 'meta';
    // The name and badges side by side; whatever doesn't fit goes under the
    // name, whole (not shrunk, not cut) — the time keeps its place top right.
    const tags = document.createElement('div');
    tags.className = 'tags';
    const who = text('span', firstName(n.author), 'badge');
    who.title = n.author;
    who.style.background = personColor(n.author, n.authorColor);
    tags.append(who);
    const cats = document.createElement('div');
    cats.className = 'cats';
    if (n.handover) cats.append(text('span', t('End of shift'), 'badge hand-badge'));
    if (n.category) {
      const cat = text('span', t(NOTE_CATEGORY_LABELS[n.category] || n.category), 'badge');
      cat.style.background = NOTE_CATEGORY_COLORS[n.category] || '#888';
      cats.append(cat);
    }
    if (cats.childElementCount) tags.append(cats);
    const when = text('span', noteTime(n.createdAt), 'when');
    meta.append(tags, when);

    const acts = document.createElement('div');
    acts.className = 'acts';
    const like = text('button', n.likes.length ? `👍 ${n.likes.length}` : '👍', n.liked ? 'liked' : '');
    like.type = 'button';
    like.setAttribute('aria-label', t('Like'));
    like.onclick = async () => {
      like.classList.add('bounce');
      try { await api('POST', `${boardBase()}/notes/${n.id}/like`, {}); } catch (err) { toast(err.message); }
      loadBoard();
    };
    // Notes only to read (Settings → Team): no likes, no replies of their own.
    if (boardCan('notes')) acts.append(like);
    if (n.likes.length) acts.append(text('span', n.likes.map(firstName).join(', ')));
    // Replies stay folded away, so the list keeps its overview; 💬 opens them.
    const open = openThreads.has(n.id);
    const reply = text('button', n.replies.length ? `💬 ${n.replies.length}` : t('Reply'), open ? 'on' : '');
    reply.type = 'button';
    reply.setAttribute('aria-expanded', String(open));
    reply.onclick = () => {
      if (open) openThreads.delete(n.id); else openThreads.add(n.id);
      renderNotes();
      if (!open) document.querySelector(`[data-reply-to="${n.id}"]`)?.focus();
    };
    acts.append(reply);
    if (n.canDelete) {
      const ed = text('button', 'Edit');
      ed.type = 'button';
      ed.style.marginLeft = 'auto';
      ed.onclick = () => openNoteModal(n);
      acts.append(ed);
      const del = text('button', 'Delete');
      del.type = 'button';
      del.onclick = async () => {
        if (!confirm(t('Delete this note?'))) return;
        try { await api('DELETE', `${boardBase()}/notes/${n.id}`); } catch (err) { toast(err.message); }
        loadBoard();
      };
      acts.append(del);
    }
    el.append(meta, text('div', n.text, 'body'), acts);
    // A tap on one's own note (not on its buttons or replies) opens the edit.
    if (n.canDelete) {
      el.classList.add('editable');
      el.onclick = e => {
        if (e.target.closest('button, a, input, textarea, form, .replies')) return;
        if (String(getSelection())) return; // selecting text to copy it
        openNoteModal(n);
      };
    }
    if (open) el.append(replyThread(n));
    if (fresh.has(n.id)) el.classList.add('pop-in');
    box.append(el);
  }
  if (typing) document.querySelector(`[data-reply-to="${typing}"]`)?.focus();
}

// End of shift: the handovers of the last day, above "Needs attention".
const HANDOVER_MS = 24 * 3600 * 1000;
function renderHandover() {
  const list = board.notes.filter(n => n.handover && !n.handoverDone && Date.now() - n.createdAt < HANDOVER_MS);
  $('bd-handover-card').hidden = !list.length;
  $('bd-handover').replaceChildren(...list.map(n => {
    const el = document.createElement('div');
    el.className = 'handover';
    const main = document.createElement('div');
    main.className = 'ho-main';
    main.setAttribute('role', 'button');
    main.tabIndex = 0;
    const who = text('span', firstName(n.author), 'badge');
    who.title = n.author;
    who.style.background = personColor(n.author, n.authorColor);
    const head = document.createElement('div');
    head.className = 'meta';
    head.append(who, text('span', noteTime(n.createdAt)));
    main.append(head, text('div', n.text, 'body'));
    main.onclick = () => showNote(n.id);
    main.onkeydown = e => { if (e.key === 'Enter') showNote(n.id); };
    // Read and done: off the Dashboard for everyone (it stays in Notes).
    const tick = text('button', '✓', 'ho-tick');
    tick.type = 'button';
    tick.title = t('Done — take it off the Dashboard');
    tick.setAttribute('aria-label', tick.title);
    tick.onclick = async () => {
      el.classList.add('gone');
      n.handoverDone = true;
      try { await api('POST', `${boardBase()}/notes/${n.id}/handover-done`, { done: true }); } catch (err) { n.handoverDone = false; toast(tx(err.message)); }
      setTimeout(renderHandover, 220);
    };
    el.append(main);
    if (boardCan('notes')) el.append(tick);
    return el;
  }));
}

let noteHandover = false;
function renderNoteHandover() {
  $('nt-hand').classList.toggle('on', noteHandover);
  $('nt-hand').setAttribute('aria-pressed', String(noteHandover));
}
$('nt-hand').onclick = () => { noteHandover = !noteHandover; renderNoteHandover(); };

let noteAttention = false;
function renderNoteAttention() {
  $('nt-attn').hidden = !board || !boardCan('attention');
  $('nt-attn').classList.toggle('on', noteAttention);
  $('nt-attn').setAttribute('aria-pressed', String(noteAttention));
}
$('nt-attn').onclick = () => { noteAttention = !noteAttention; renderNoteAttention(); };

// The same window for a new note and for changing one (note = the one being changed).
let editingNote = null;
function openNoteModal(note) {
  editingNote = note && note.id ? note : null;
  if (editingNote) {
    $('nt-text').value = editingNote.text;
    noteCategory = editingNote.category || null;
    noteAttention = !!editingNote.attention;
    noteHandover = !!editingNote.handover;
  } else if (editingNote === null && $('form-note').dataset.mode === 'edit') {
    // Coming from an edit: start a new note empty.
    $('nt-text').value = '';
    noteCategory = null;
    noteAttention = false;
    noteHandover = false;
  }
  $('form-note').dataset.mode = editingNote ? 'edit' : 'new';
  $('nt-title').textContent = t(editingNote ? 'Edit note' : 'New note');
  $('form-note').querySelector('button[type=submit]').textContent = t(editingNote ? 'Save' : 'Post');
  renderNoteCategories();
  renderNoteAttention();
  renderNoteHandover();
  const name = state.me.user.name || state.me.user.email;
  $('nt-author').textContent = firstName(name);
  $('nt-author').style.background = personColor(name, state.me.user.color);
  $('nt-err').textContent = '';
  $('note-modal').hidden = false;
  $('nt-text').focus();
}
function closeNoteModal() { $('note-modal').hidden = true; }
$('nt-open').onclick = () => openNoteModal();
$('nt-close').onclick = closeNoteModal;
$('nt-cancel').onclick = closeNoteModal;
$('note-modal').addEventListener('click', e => { if (e.target === $('note-modal')) closeNoteModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('note-modal').hidden) closeNoteModal(); });

bindForm('form-note', 'nt-err', async () => {
  const body = { text: $('nt-text').value, category: noteCategory, attention: noteAttention, handover: noteHandover };
  if (editingNote) await api('PUT', `${boardBase()}/notes/${editingNote.id}`, body);
  else await api('POST', `${boardBase()}/notes`, body);
  editingNote = null;
  $('nt-text').value = '';
  noteCategory = null;
  noteAttention = false;
  noteHandover = false;
  renderNoteCategories();
  closeNoteModal();
  await loadBoard();
});
$('nt-text').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('form-note').requestSubmit();
});

bindForm('form-routine', 'rt-err', async () => {
  renderSettings(await api('PUT', `/api/properties/${state.adminPropertyId}/settings`, { routine: $('rt-text').value }));
  rtOffset = 0;
  $('rt-err').className = 'ok';
  $('rt-err').textContent = t('Saved.');
});
