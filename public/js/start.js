// HostelFlow — Signing in and out, starting the app.
// Plain scripts loaded in order by index.html; they share globals.

// ===== Account =====

// From a confirmation link: signing in with the account's password confirms it.
let confirmToken = null;
bindForm('form-login', 'li-err', async () => {
  if (confirmToken) {
    try {
      await api('POST', '/api/auth/confirm', { token: confirmToken, email: $('li-email').value, password: $('li-pass').value });
    } catch (err) {
      // Expired or used link: forget it (signing in then asks for a new one); wrong password: try again.
      if (!(err.data && err.data.code === 'confirm-password')) confirmToken = null;
      throw err;
    }
    confirmToken = null;
    toast(t('E-mail confirmed — welcome to HostelFlow!'));
  }
  try {
    state.me = await api('POST', '/api/auth/login', { email: $('li-email').value, password: $('li-pass').value });
  } catch (err) {
    // Right password, e-mail not confirmed yet: the "check your inbox" page.
    if (err.data && err.data.code === 'unconfirmed') return showConfirm($('li-email').value);
    throw err;
  }
  $('form-login').reset();
  renderApp();
});

// The demo: a made-up hostel of one's own, signed in as its owner (src/demo.js).
$('li-demo').onclick = async () => {
  $('li-demo').disabled = true;
  $('li-err').className = 'err';
  $('li-err').textContent = '';
  try {
    state.me = await api('POST', '/api/demo', {});
    renderApp();
  } catch (err) {
    $('li-err').textContent = tx(err.message);
  } finally {
    $('li-demo').disabled = false;
  }
};
// From the demo to a real account: out of the demo, on to the sign-up.
// The demo's names on this device go too, unless the device is a real hostel's.
$('demo-signup').onclick = async () => {
  await api('POST', '/api/demo/signup', {}).catch(() => {}); // counted for the admin centre (numbers only)
  const places = await loadDevice().catch(() => []);
  if (places.length && places.every(p => p.id === state.property.id)) await api('POST', '/api/device/forget', {}).catch(() => {});
  await signOut();
  show('view-register');
};

// New accounts confirm their e-mail first: the link (#confirm=<token>) signs them in.
function showConfirm(email) {
  $('cf-email').textContent = email;
  $('cf-err').textContent = '';
  show('view-confirm');
}
$('cf-resend').onclick = async () => {
  $('cf-resend').disabled = true;
  try {
    await api('POST', '/api/auth/confirm/resend', { email: $('cf-email').textContent });
    $('cf-err').className = 'ok';
    $('cf-err').textContent = t('Sent again — it can take a minute.');
  } catch (err) {
    $('cf-err').className = 'err';
    $('cf-err').textContent = tx(err.message);
  }
  setTimeout(() => { $('cf-resend').disabled = false; }, 20000); // no hammering
};
// The link proves the inbox; the account's password proves who set it up
// (src/verify.js). So: sign in once to confirm.
function confirmFromLink(token) {
  history.replaceState(null, '', location.pathname);
  confirmToken = token;
  show('view-login');
  $('li-err').className = 'ok';
  $('li-err').textContent = t('Almost there: sign in once to confirm your e-mail.');
  $('li-email').focus();
}

bindForm('form-forgot', 'fg-err', async () => {
  await api('POST', '/api/auth/forgot', { email: $('fg-email').value });
  $('fg-err').className = 'ok';
  $('fg-err').textContent = t('If this e-mail has an account, we\'ve sent a link. Check your inbox (and spam). It works for one hour.');
});

// Links from the e-mail look like https://hostelflow.it/#reset=<token>.
let resetToken = null;
bindForm('form-reset', 'rs-err', async () => {
  await api('POST', '/api/auth/reset', { token: resetToken, password: $('rs-pass').value });
  history.replaceState(null, '', location.pathname);
  resetToken = null;
  state.me = await api('GET', '/api/me');
  renderApp();
  toast(t('Password changed — you are signed in'));
});

bindForm('form-register', 'rg-err', async () => {
  const r = await api('POST', '/api/auth/register', {
    name: $('rg-name').value, propertyName: $('rg-property').value,
    email: $('rg-email').value, password: $('rg-pass').value,
    acceptTerms: $('rg-terms').checked, voucher: $('rg-voucher').value,
  });
  const email = $('rg-email').value;
  $('form-register').reset();
  if (r.confirm) return showConfirm(email);
  state.me = r;
  renderApp();
});

bindForm('form-password', 'pw-err', async () => {
  await api('POST', '/api/auth/password', { currentPassword: $('pw-current').value, newPassword: $('pw-new').value });
  $('form-password').reset();
  $('pw-err').className = 'ok';
  $('pw-err').textContent = t('Password changed. Other devices were signed out.');
});

// Sign out; "someone else" also empties the sign-in form, ready for the next person.
async function signOut({ switching = false } = {}) {
  await api('POST', '/api/auth/logout', {}).catch(() => {});
  history.replaceState(null, '', location.pathname); // the next person starts on the Dashboard
  state = { ...state, me: null, property: null, guests: [], selected: new Set(), seen: new Set(), open: null };
  $('form-login').reset();
  $('li-err').textContent = '';
  // "Another account": the e-mail form, also on the hostel's device (names otherwise).
  if (switching) showEmailForm();
  show('view-login');
  if (switching) $('li-email').focus();
}

// Write to us: a pop-up, with the name and e-mail of whoever is signed in
// filled in (they can change where the answer goes).
function openSupport() {
  $('sp-name').value = (state.me && state.me.user.name) || '';
  $('sp-email').value = (state.me && state.me.user.email) || '';
  $('sp-err').textContent = '';
  $('sp-err').className = 'err';
  $('sp-modal').hidden = false;
  $('sp-text').focus();
}
function closeSupport() { $('sp-modal').hidden = true; }
$('sp-open').onclick = openSupport;
$('au-soon-write').onclick = openSupport; // Report: a country we don't have yet
// Donations: the header's "Support this project" and Help & support open a
// small window with the links. Empty = not set up yet, and nothing shows.
const DONATE = { kofi: 'https://ko-fi.com/hostelflow', github: '' };
if (DONATE.kofi || DONATE.github) {
  $('donate-open').hidden = $('donate-open-help').hidden = false;
  if (DONATE.kofi) { $('donate-kofi').href = DONATE.kofi; $('donate-kofi').hidden = false; }
  if (DONATE.github) { $('donate-github').href = DONATE.github; $('donate-github').hidden = false; }
}
function closeDonate() { $('donate-modal').hidden = true; }
$('donate-open').onclick = $('donate-open-help').onclick = () => { $('donate-modal').hidden = false; };
$('donate-close').onclick = closeDonate;
$('donate-modal').addEventListener('click', e => { if (e.target === $('donate-modal')) closeDonate(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('donate-modal').hidden) closeDonate(); });
// Flowy in a pop-up, opened from Help & support.
function closeFlowy() { $('fl-modal').hidden = true; }
$('fl-open').onclick = () => { $('fl-modal').hidden = false; $('fl-text').focus(); };
$('fl-close').onclick = closeFlowy;
$('fl-modal').addEventListener('click', e => { if (e.target === $('fl-modal')) closeFlowy(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('fl-modal').hidden) closeFlowy(); });
$('sp-close').onclick = closeSupport;
$('sp-cancel').onclick = closeSupport;
$('sp-modal').addEventListener('click', e => { if (e.target === $('sp-modal')) closeSupport(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sp-modal').hidden) closeSupport(); });
bindForm('form-support', 'sp-err', async () => {
  await api('POST', '/api/support', { message: $('sp-text').value, name: $('sp-name').value, email: $('sp-email').value, propertyId: state.property && state.property.id });
  $('sp-text').value = '';
  closeSupport();
  toast(t('Sent — we will answer by e-mail.'));
});

document.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => show(b.dataset.show)));

// Refresh when coming back to the app (e.g. a colleague sent guests meanwhile).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me && !$('tab-checkin').hidden) loadGuests();
});

// A new version takes over by itself. Reception keeps the app open for days
// (and Safari brings an old tab back from memory), so: look for a new service
// worker whenever the app comes back to the screen and every half hour; when
// one takes over, reload — but never while someone is typing or uploading.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller; // the very first visit isn't an update
  let pending = false;
  const idle = () => {
    const el = document.activeElement;
    return !state.busy.length && !(el && el.matches('input, textarea, select, [contenteditable]'));
  };
  const reloadWhenIdle = () => {
    if (!pending) return;
    if (idle()) location.reload();
    else setTimeout(reloadWhenIdle, 5000);
  };
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    window.addEventListener('pageshow', e => { if (e.persisted) check(); }); // Safari's back-from-memory
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || pending) return;
    pending = true;
    reloadWhenIdle();
  });
}

// Language: fixed page text now, the rest as it is rendered (t / tx).
translateStatic();
renderHeaderPicker(); // needs resizePhoto (checkin.js), loaded by now
$('lang').replaceChildren(...Object.entries(LANGS).map(([code, name]) => new Option(name, code)));
$('lang').value = LANG;
$('lang').addEventListener('change', e => setLang(e.target.value));

// Invites look like https://hostelflow.it/#invite=<token>: the person sets
// their own name and password (or signs in, if they have an account).
let inviteToken = null;
async function openInvite(token) {
  inviteToken = token;
  show('view-invite');
  $('ia-err').textContent = '';
  const fields = $('form-invite-accept').querySelectorAll('input:not([readonly]),button');
  try {
    const inv = await api('POST', '/api/invites/show', { token });
    $('ia-title').textContent = t('Join {place}', { place: inv.property });
    $('ia-sub').textContent = t(inv.role === 'owner' ? 'You are invited as an owner of {place} on HostelFlow.' : 'You are invited to the team of {place} on HostelFlow.', { place: inv.property });
    $('ia-email').value = inv.email || '';
    $('ia-email').disabled = false;
    $('ia-new').hidden = inv.hasAccount === true;
    $('ia-name').required = inv.hasAccount === false;
    $('ia-pass-label').textContent = t(inv.hasAccount ? 'You already have a HostelFlow account. Enter your password' : 'Choose a password (at least 8 characters)');
    $('ia-pass').autocomplete = inv.hasAccount ? 'current-password' : 'new-password';
    $('ia-submit').textContent = t(inv.hasAccount ? 'Sign in and join' : 'Join');
    fields.forEach(el => { el.disabled = false; });
  } catch (err) {
    $('ia-sub').textContent = '';
    $('ia-err').textContent = tx(err.message);
    fields.forEach(el => { el.disabled = true; });
  }
}
bindForm('form-invite-accept', 'ia-err', async () => {
  const r = await api('POST', '/api/invites/accept', { token: inviteToken, email: $('ia-email').value, name: $('ia-name').value, password: $('ia-pass').value });
  history.replaceState(null, '', location.pathname);
  inviteToken = null;
  const email = $('ia-email').value;
  $('form-invite-accept').reset();
  // A new account from an open link: first the e-mail is confirmed (its link signs them in).
  if (r.confirm) return showConfirm(email);
  state.me = await api('GET', '/api/me');
  renderApp();
  toast(t('Welcome to the team!'));
});

function checkResetLink() {
  // "Try it free" on the public page leads to /app#signup.
  // …or /app#signup=CODE: the voucher code is filled in (links in e-mails).
  const su = location.hash.match(/^#signup(?:=([\w-]+))?$/);
  if (su && !state.me) {
    history.replaceState(null, '', location.pathname);
    show('view-register');
    if (su[1]) $('rg-voucher').value = su[1].toUpperCase();
    // Already signed in on this device? Then straight into the app.
    api('GET', '/api/me').then(me => { state.me = me; renderApp(); }, () => {});
    return true;
  }
  const cf = location.hash.match(/^#confirm=([\w-]+)$/);
  if (cf) { confirmFromLink(cf[1]); return true; }
  const inv = location.hash.match(/^#invite=([\w-]+)$/);
  if (inv) { openInvite(inv[1]); return true; }
  const m = location.hash.match(/^#reset=([\w-]+)$/);
  if (!m) return false;
  resetToken = m[1];
  show('view-reset');
  return true;
}
// Also when the link opens in a tab where the app is already running.
window.addEventListener('hashchange', checkResetLink);
if (!checkResetLink()) {
  // Only a failed /api/me means "signed out"; a bug while drawing the app must
  // not hide behind the sign-in screen.
  api('GET', '/api/me').then(me => { state.me = me; renderApp(); }, () => show('view-login'));
}
