// HostelFlow — the welcome tour. At a person's first sign-in it walks them
// through the app, one highlighted part at a time, with what to set up first.
// Seen once per person (users.tour_done_at); Help & support can replay it.

let tourState = null;

// The steps for this person's role. `target` is a list of selectors: the
// first one that is visible gets the highlight (Check-in is a tab on phones
// and normal properties, the "+" in preview). A step whose target isn't on
// screen is skipped, unless it has none (a centred card).
function tourSteps() {
  const steps = [
    { title: 'Welcome to HostelFlow, {name}! 👋', text: 'Let me show you around — it takes a minute. You can skip anytime.' },
    { tab: 'board', target: ['header.bar button[data-tab=board]'], title: 'Dashboard', text: "Your team's home: notes, things that need attention and each shift's guidelines." },
    { tab: 'board', target: ['#bd-notes'], title: 'Notes', text: 'Leave notes and handovers for the next shift. Pick a colour, reply or like.' },
    { tab: 'board', target: ['#bd-routine-card'], title: 'Guidelines', text: 'The tasks of the current shift. Tick them off; anything missed shows up under "Needs attention".' },
  ];
  if (can('checkin')) {
    steps.push({ target: ['header.bar button[data-tab=checkin]', '#tab-plus'], title: 'Check-in', text: 'Take a photo of a passport or ID card: AI fills in the guest, you check the details, press Test, then Send to the police.' });
  }
  steps.push({ target: ['header.bar button[data-tab=housekeeping]'], title: 'Housekeeping', text: 'Which beds to make up and which linen is due — and recurring jobs like cleaning the fridge.' });
  steps.push({ target: ['header.bar button[data-tab=shifts]'], title: 'Shifts', text: can('shifts') ? 'Plan the week: drag people onto shifts, click a name to change their hours. Set up shift types in Settings → Shifts.' : 'Your team, on one page: who works when. Your own shifts are highlighted.' });
  steps.push({ target: ['header.bar button[data-tab=settings]'], title: 'Settings', text: 'All your one-time setup is here.' });
  // The settings this person may change (Settings → Team → Access).
  if (can('police')) steps.push({ tab: 'settings', target: ['#sec-police > summary'], title: 'Start here: Reports', text: 'Pick your country, enter the police login (Alloggiati Web in Italy) and press Check connection. Statistics like ISTAT are here too.' });
  if (can('team')) steps.push({ tab: 'settings', target: ['#sec-team > summary'], title: 'Team', text: 'Invite your colleagues by e-mail or with a WhatsApp link, and choose what each of them may do.' });
  if (can('guidelines')) steps.push({ tab: 'settings', target: ['#sec-routine > summary'], title: 'Guidelines', text: 'Optional: give each shift its tasks, and the team sees them on the Dashboard at the right time.' });
  steps.push({ tab: 'settings', target: ['#sec-account > summary'], title: 'Your account', text: 'Choose which tabs you see on your phone and on your computer.' });
  steps.push({ tab: 'settings', target: ['#sec-support > summary'], title: 'Help & support', text: 'Stuck? Write to us, read the common questions, or ask Flowy, our assistant.' });
  steps.push(can('police') && !state.property.registration
    ? { title: "You're all set! 🎉", text: 'Start with Reports: choose your country and connect its police registration. It takes two minutes.', action: 'Set up Reports', run: () => openSection('sec-police') }
    : { title: "You're all set! 🎉", text: 'Have a good shift!', run: () => showTab('board') });
  return steps;
}

function maybeStartTour() {
  if (state.me && state.me.user && !state.me.user.tourDone && state.property) startTour();
}

function startTour() {
  endTour({ save: false });
  const block = document.createElement('div');
  block.className = 'tour-block';
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const card = document.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  document.body.append(block, spot, card);
  tourState = { steps: tourSteps(), i: 0, block, spot, card, target: null };
  addEventListener('resize', placeTour);
  addEventListener('scroll', placeTour, true);
  addEventListener('keydown', tourKeys);
  showTourStep(0, 1);
}

function tourKeys(e) {
  if (!tourState) return;
  if (e.key === 'Escape') endTour();
  if (e.key === 'ArrowRight') showTourStep(tourState.i + 1, 1);
  if (e.key === 'ArrowLeft') showTourStep(tourState.i - 1, -1);
}

const tourVisible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';

async function showTourStep(i, dir) {
  const ts = tourState;
  if (!ts || i < 0) return;
  if (i >= ts.steps.length) return endTour();
  const step = ts.steps[i];
  if (step.tab && currentTab !== step.tab) {
    showTab(step.tab);
    await new Promise(r => setTimeout(r, 250)); // the tab fades in
  }
  let target = null;
  if (step.target) {
    target = step.target.map(s => document.querySelector(s)).find(tourVisible) || null;
    if (!target) return showTourStep(i + dir, dir); // not on screen for this person: next one
    target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  if (tourState !== ts) return; // ended meanwhile
  ts.i = i;
  ts.target = target;

  const last = i === ts.steps.length - 1;
  const total = ts.steps.length;
  const card = ts.card;
  card.replaceChildren();
  const count = text('div', t('{n} of {total}', { n: i + 1, total }), 'tour-count');
  const title = document.createElement('h3');
  title.textContent = t(step.title, { name: (state.me.user.name || '').split(' ')[0] });
  const body = text('p', t(step.text));
  const nav = document.createElement('div');
  nav.className = 'tour-nav';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'link';
  skip.textContent = t(last ? 'Close' : 'Skip tour');
  skip.onclick = () => endTour();
  nav.append(skip);
  if (i > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = t('Back');
    back.onclick = () => showTourStep(i - 1, -1);
    nav.append(back);
  }
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'primary';
  next.textContent = t(last ? (step.action || 'Done') : i === 0 ? "Let's go" : 'Next');
  next.onclick = () => {
    if (!last) return showTourStep(i + 1, 1);
    endTour();
    if (step.run) step.run();
  };
  nav.append(next);
  card.append(count, title, body, nav);
  card.classList.toggle('centered', !target);
  ts.spot.hidden = !target;
  placeTour();
  // Let the smooth scroll settle, then place again.
  setTimeout(placeTour, 350);
  next.focus({ preventScroll: true });
}

function placeTour() {
  const ts = tourState;
  if (!ts) return;
  const { spot, card, target } = ts;
  const vw = innerWidth;
  const vh = innerHeight;
  const m = 12;
  if (!target) {
    card.style.left = `${Math.max(m, (vw - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(m, (vh - card.offsetHeight) / 2)}px`;
    return;
  }
  const r = target.getBoundingClientRect();
  const pad = 6;
  Object.assign(spot.style, {
    left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });
  // The card below the highlight if it fits, else above; never off screen.
  const below = r.bottom + pad + m;
  const top = below + card.offsetHeight <= vh - m ? below : Math.max(m, r.top - pad - m - card.offsetHeight);
  const left = Math.min(Math.max(m, r.left + r.width / 2 - card.offsetWidth / 2), vw - card.offsetWidth - m);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function endTour({ save = true } = {}) {
  const ts = tourState;
  if (!ts) return;
  tourState = null;
  ts.block.remove();
  ts.spot.remove();
  ts.card.remove();
  removeEventListener('resize', placeTour);
  removeEventListener('scroll', placeTour, true);
  removeEventListener('keydown', tourKeys);
  if (save && state.me && !state.me.user.tourDone) {
    state.me.user.tourDone = true;
    api('PUT', '/api/me', { tourDone: true }).catch(() => {}); // worst case it shows once more
  }
}

$('tour-again').onclick = () => { if (state.property) startTour(); };
