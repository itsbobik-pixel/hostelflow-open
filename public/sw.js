// Service worker: makes HostelFlow installable and lets the app shell open
// without a connection. Guest data (/api) is never cached — it always comes
// fresh from the server, and nothing personal stays on the phone.

const CACHE = 'hostelflow-v359';
const SHELL = [
  '/', '/app', '/app.css', '/i18n-es.js', '/i18n-fr.js', '/i18n.js',
  '/js/theme.js', '/js/core.js', '/js/dashboard.js', '/js/housekeeping.js', '/js/checkin.js',
  '/js/istat.js', '/js/calendar.js', '/js/settings.js', '/js/shifts.js', '/js/vault.js', '/js/flowy.js', '/js/tour.js', '/js/install-guide.js', '/js/start.js', '/install-guide.css',
  '/manifest.webmanifest', '/icon.svg', '/header.svg', '/header-pc.svg', '/header-phone.svg', '/icon-192.png', '/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Videos come in pieces (Range requests), which the cache cannot store.
  if (url.pathname.startsWith('/video/')) return;
  // Network first, so a new version shows up right away; the cache is only
  // the offline fallback. 'no-cache' revalidates with the server (cheap, ETag)
  // instead of letting the browser's HTTP cache hand back an old page.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('/'))),
  );
});
