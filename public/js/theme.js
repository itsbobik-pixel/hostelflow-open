// Applies the theme and light/dark mode chosen in Settings (per device)
// before the page paints, so it never flashes the wrong colours.
try {
  // One look for now (black and white); the colour themes are parked.
  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.mode = localStorage.getItem('hf_mode') || 'auto';
  // On staging a small badge says so (app.css), so it is never mistaken for the real app.
  if (/^staging\.|hostelflow-staging\./.test(location.hostname)) document.documentElement.dataset.staging = '1';
  // Just switched property: the veil stays up until the app is drawn (core.js).
  if (sessionStorage.getItem('hf_switching')) document.documentElement.dataset.switching = '1';
} catch { /* storage blocked: defaults */ }
