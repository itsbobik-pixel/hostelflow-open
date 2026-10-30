// HostelFlow — the welcome tour. At a person's first sign-in a pop-up asks
// what they're interested in (Check-in, Flow or both); Flowy then walks them
// through it: each step goes to the right place and points at it, with a
// speech bubble — nothing is dimmed, the page stays usable.
// Seen once per person (users.tour_done_at); Help & support can replay it.

let tourState = null; // { steps, i, ring, bubble, target }

const FLOWY_FACE = '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M16 5c6.4 0 11 4.1 11 9.6 0 5.5-4.6 9.6-11 9.6-1.3 0-2.5-.2-3.6-.5L7 26.5l1.4-4.6C6.3 20.1 5 17.5 5 14.6 5 9.1 9.6 5 16 5z" fill="#fff"/><circle cx="12.2" cy="14" r="1.7" fill="#2b2b2b"/><circle cx="19.8" cy="14" r="1.7" fill="#2b2b2b"/><path d="M12.6 18.2c1.9 1.6 4.9 1.6 6.8 0" fill="none" stroke="#2b2b2b" stroke-width="1.6" stroke-linecap="round"/><path d="M25.6 3.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#fff"/></svg>';

const isOwnerHere = () => state.property && state.property.role === 'owner' && !state.property.demo;
const tabButton = tab => `header.bar button[data-tab=${tab}]`;
const italy = () => state.property && state.property.country === 'IT'; // Alloggiati, ISTAT
const section = id => ({ go: () => openSection(id), target: `#${id} > summary` });

// The steps of each part. A step whose spot isn't on screen for this person
// is skipped; `show` leaves out what they can't use anyway.
function checkinSteps() {
  const owner = isOwnerHere();
  return [
    { show: owner && can('police'), ...section('sec-police'), title: 'Connect to the police',
      say: italy() ? 'Pick your country and enter the Alloggiati Web login, then press Check connection. You do it once.'
        : 'Pick your country and enter the login of its police portal, then press Check connection. You do it once.' },
    { show: owner, ...section('sec-scan'), title: 'Connect your Claude account',
      say: 'Free scans are limited. Paste your Claude API key here and scan as many documents as you need — about $1 per 1,000 scans, from your Claude credit.' },
    { show: owner && can('police') && italy(), go: () => openSection('sec-police'), target: '#au-part-btn', title: 'ISTAT statistics',
      say: 'The statistics are here too: under Report pick ISTAT for the arrivals and departures of each day, or the regional system (Ross1000, RiMovCli) to send them.' },
    { show: sees('checkin'), go: () => showTab('checkin'), target: '#ci-add .big', title: 'Check in a guest',
      say: 'Tap here and take a photo of the passport or ID card. Check what it read, then press Send — the guest goes to the police.' },
  ];
}
function flowSteps() {
  const owner = isOwnerHere();
  return [
    { show: sees('notes'), go: () => showTab('board'), target: '#bd-notes-card', title: 'Notes',
      say: 'Leave a note for the next shift. Replies and likes keep everyone in the loop.' },
    { show: sees('attention'), go: () => showTab('board'), target: '#bd-att-card', title: 'Needs attention',
      say: 'Anything that needs someone: tasks missed, guests not sent yet, beds to make up.' },
    { show: sees('guidelines'), go: () => showTab('board'), target: '#bd-routine-card', title: 'Guidelines',
      say: 'The tasks of the shift that\'s on now. Tick them off; what\'s missed shows up under Needs attention.' },
    { show: owner, ...section('sec-routine'), title: 'Guidelines',
      say: 'Write the tasks of each shift here. They show up on the Dashboard during that shift.' },
    { show: sees('housekeeping'), target: tabButton('housekeeping'), title: 'Housekeeping',
      say: 'Which beds to make up today, the linen that is due, and jobs that come back every week.' },
    { show: owner, ...section('sec-property'), title: 'Rooms and beds',
      say: 'Add each room and how many beds it has. Housekeeping and the Calendar use them.' },
    { show: sees('shifts'), target: tabButton('shifts'), title: 'Shifts',
      say: 'Who works when. Your own shifts are highlighted.' },
    { show: inPreview() && sees('calendar'), target: tabButton('calendar'), title: 'Calendar',
      say: 'Bookings by room and bed, and arrivals ready for check-in.' },
    { show: isOwnerHere() && can('team'), ...section('sec-team'), title: 'Your team',
      say: 'Press “Add team member”, type a name and pick a colour, and choose what they can change. They sign in on this device by tapping their name.' },
  ];
}
// For everyone, whatever they picked.
function closingSteps() {
  return [
    { show: true, target: '#who-chips', title: 'Your name tag',
      say: 'Tap your name: switch to a colleague, open The Vault (the hostel\'s files), the Activity Log, or add the app to your home screen.' },
    { show: true, ...section('sec-support'), target: '#fl-open', title: 'Ask Flowy',
      say: 'That\'s me! Ask me anything about HostelFlow, any time — I\'m here in Help & support.' },
    { show: true, go: () => showTab(homeTab()), title: 'That\'s it! 🎉', say: 'Have a good shift. You can take the tour again in Settings → Help & support.' },
  ];
}

function maybeStartTour() {
  if (state.me && state.me.user && !state.me.user.tourDone && state.property && $('tour-modal').hidden && !tourState) openTourPick();
}

// "What are you interested in?" — without the Flow part (Check-in plan) straight to Check-in.
function openTourPick() {
  endTour({ save: false });
  if (!fullApp()) return startTour('checkin');
  $('tour-modal').hidden = false;
  $('tour-modal').querySelector('[data-pick]').focus();
}
for (const b of document.querySelectorAll('#tour-modal [data-pick]')) {
  b.onclick = () => { $('tour-modal').hidden = true; startTour(b.dataset.pick); };
}
$('tp-close').onclick = $('tp-skip').onclick = () => { $('tour-modal').hidden = true; endTour(); };

function startTour(pick) {
  endTour({ save: false });
  const steps = [
    ...(pick !== 'flow' ? checkinSteps() : []),
    ...(pick !== 'checkin' && fullApp() ? flowSteps() : []),
    ...closingSteps(),
  ].filter(s => s.show);
  const ring = document.createElement('div');
  ring.className = 'fp-ring';
  const bubble = document.createElement('div');
  bubble.className = 'fp-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-live', 'polite');
  document.body.append(ring, bubble);
  tourState = { steps, i: 0, ring, bubble, target: null };
  addEventListener('keydown', tourKeys);
  // Follow the spot while things move (smooth scroll, a section opening).
  const follow = () => { if (tourState && tourState.bubble === bubble) { placeTour(); requestAnimationFrame(follow); } };
  requestAnimationFrame(follow);
  showTourStep(0, 1);
}

function tourKeys(e) {
  if (!tourState) return;
  if (e.key === 'Escape') endTour();
  if (e.key === 'ArrowRight') showTourStep(tourState.i + 1, 1);
  if (e.key === 'ArrowLeft') showTourStep(tourState.i - 1, -1);
}

const tourVisible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const tourMotion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

async function showTourStep(i, dir) {
  const ts = tourState;
  if (!ts || i < 0) return;
  if (i >= ts.steps.length) return endTour();
  const step = ts.steps[i];
  if (step.go) {
    step.go();
    await new Promise(r => setTimeout(r, 380)); // the tab fades in, the section opens
  }
  if (tourState !== ts) return; // ended meanwhile
  let target = null;
  if (step.target) {
    target = document.querySelector(step.target);
    if (!tourVisible(target)) return showTourStep(i + dir, dir); // not on screen for this person: next one
  }
  ts.i = i;
  ts.target = target;
  if (target) {
    target.scrollIntoView({ block: 'center', behavior: tourMotion() });
    // A section opening scrolls the page too: once that's done, back to the middle.
    setTimeout(() => {
      if (!tourState || tourState.target !== target) return;
      const r = target.getBoundingClientRect();
      if (r.top < 140 || r.bottom > innerHeight - 140) target.scrollIntoView({ block: 'center', behavior: tourMotion() });
    }, 500);
  }

  const last = i === ts.steps.length - 1;
  const face = document.createElement('span');
  face.className = 'flowy-ico';
  face.innerHTML = FLOWY_FACE;
  const body = document.createElement('div');
  body.className = 'grow';
  const title = document.createElement('h3');
  title.textContent = t(step.title);
  const nav = document.createElement('div');
  nav.className = 'tour-nav';
  if (!last) {
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'link';
    skip.textContent = t('Skip tour');
    skip.onclick = () => endTour();
    nav.append(skip);
  }
  if (i > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'small';
    back.textContent = t('Back');
    back.onclick = () => showTourStep(i - 1, -1);
    nav.append(back);
  }
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'small primary';
  next.textContent = last ? t('Done') : `${t('Next')} · ${i + 1}/${ts.steps.length}`;
  next.onclick = () => showTourStep(i + 1, 1);
  nav.append(next);
  body.append(title, text('p', t(step.say)), nav);
  ts.bubble.replaceChildren(face, body);
  ts.bubble.classList.toggle('centered', !target);
  ts.ring.hidden = !target;
  placeTour();
  next.focus({ preventScroll: true });
}

function placeTour() {
  const ts = tourState;
  if (!ts) return;
  const { ring, bubble, target } = ts;
  const m = 12;
  if (!target) {
    bubble.style.left = `${Math.max(m, (innerWidth - bubble.offsetWidth) / 2)}px`;
    bubble.style.top = `${Math.max(m, (innerHeight - bubble.offsetHeight) / 2)}px`;
    return;
  }
  if (!target.isConnected) return;
  const r = target.getBoundingClientRect();
  const pad = 6;
  Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  // Above the spot when it fits (what comes below is usually what to fill
  // in), else below; never off screen.
  const below = r.bottom + pad + m;
  const above = r.top - pad - m - bubble.offsetHeight >= m || below + bubble.offsetHeight > innerHeight - m;
  const top = above ? Math.max(m, r.top - pad - m - bubble.offsetHeight) : below;
  const left = Math.min(Math.max(m, r.left + r.width / 2 - bubble.offsetWidth / 2), innerWidth - bubble.offsetWidth - m);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.classList.toggle('above', above);
  // The little tail points at the middle of the spot.
  bubble.style.setProperty('--tail', `${Math.min(Math.max(18, r.left + r.width / 2 - left), bubble.offsetWidth - 18)}px`);
}

function endTour({ save = true } = {}) {
  const ts = tourState;
  tourState = null;
  if (ts) {
    ts.ring.remove();
    ts.bubble.remove();
    removeEventListener('keydown', tourKeys);
  }
  if (save && state.me && !state.me.user.tourDone) {
    state.me.user.tourDone = true;
    api('PUT', '/api/me', { tourDone: true }).catch(() => {}); // worst case it shows once more
  }
}

$('tour-again').onclick = () => { if (state.property) openTourPick(); };
