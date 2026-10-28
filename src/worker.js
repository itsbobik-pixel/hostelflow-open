// HostelFlow Worker: serves the app (public/, via the ASSETS binding) and the
// API under /api on the same origin — no CORS, no shared secret in the page.

import { handleApi, LEGAL_LIVE } from './api.js';
import { json } from './http.js';
import { cleanup } from './guests.js';
import { boardCleanup } from './board.js';
import { syncAllCalendars } from './reservations.js';
import { pullAllChannex } from './channex.js';
import { alert } from './alerts.js';
import { reportUsage } from './billing.js';
import { dailyPoliceCheck } from './policecheck.js';
import { pruneActivity } from './activity.js';
import { pruneAuth } from './auth.js';
import { pruneDemos } from './demo.js';
import { handleAdmin } from './admin.js';
import { refreshClaudeCosts } from './claudecredit.js';
import { SITE_HIDDEN, inEnglish } from './site.js';

// What visitors see at hostelflow.it. While we look for beta testers it's
// the beta page; the full product page (landing.html) is parked — set this
// back to '/landing' to bring it back.
const FRONT_PAGE = '/beta';
const PARKED_PAGES = ['/landing', '/landing.html'];
// The legal pages stay hidden until their texts are final (LEGAL_LIVE).
const LEGAL_PAGES = ['/privacy', '/privacy.html', '/terms', '/terms.html'];

// Sent with every response. The page loads only its own scripts (no inline
// ones, no other sites), can't be framed, and talks only to this origin.
// Inline style attributes stay allowed: the markup uses them, and styles
// can't run code.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// The public pages (not the app) count visits with Cloudflare Web Analytics:
// its script, and where it reports to.
// The front page is Italian at /welcome; /en is the same page starting in
// English, with its own title and address, so search engines list both.
// One piece of a video file for a "Range: bytes=start-end" request (the
// whole file, saying pieces are possible, when there is no Range).
async function videoPiece(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!res.ok || !m || (m[1] === '' && m[2] === '')) {
    const whole = new Response(res.body, res);
    whole.headers.set('Accept-Ranges', 'bytes');
    return whole;
  }
  const body = await res.arrayBuffer(), size = body.byteLength;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const piece = new Response(body.slice(start, end + 1), { status: 206, headers: res.headers });
  piece.headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  piece.headers.set('Content-Length', String(end - start + 1));
  piece.headers.set('Accept-Ranges', 'bytes');
  return piece;
}

const PUBLIC_PAGES = ['/welcome', '/en', '/install', '/es', '/fr', '/alloggiati-web-automatico', '/istat-ross1000', '/gestionale-ostello', '/rimovcli-liguria', '/scansione-documenti-check-in', '/alloggiati-web-guida', '/check-in-affitti-brevi'];
const isMarketingPage = path => {
  const page = path.replace(/\.html$/, '');
  return page === FRONT_PAGE || (PUBLIC_PAGES.includes(page) && page !== '/install');
};
const PUBLIC_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Security-Policy': CSP
    .replace("script-src 'self'", "script-src 'self' https://static.cloudflareinsights.com")
    .replace("connect-src 'self'", "connect-src 'self' https://cloudflareinsights.com"),
};

// heic.html converts iPhone photos; its converter needs eval and a blob:
// worker, so only that page gets them — framed by our own page, no network.
const HEIC_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src blob:; img-src blob: data:; connect-src blob: data:; frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
};

function secure(response, path, env = {}) {
  const r = new Response(response.body, response);
  // Staging (staging.hostelflow.it) is never indexed by search engines.
  if (env.STAGING === '1') r.headers.set('X-Robots-Tag', 'noindex, nofollow');
  const page = path.replace(/\.html$/, '');
  const headers = page === '/heic' ? HEIC_HEADERS : PUBLIC_PAGES.includes(page) ? PUBLIC_HEADERS : SECURITY_HEADERS;
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}

async function route(request, env) {
  const url = new URL(request.url);
  // Never over plain http (passwords, passports), and one address for
  // everyone (one set of session cookies): www -> bare domain.
  // `wrangler dev` presents requests as http://hostelflow.it (the first
  // route), so local development sets DEV=1 in .dev.vars.
  const local = env.DEV === '1' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if ((url.protocol === 'http:' && !local) || url.hostname.startsWith('www.')) {
    url.protocol = local ? url.protocol : 'https:';
    if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  if (env.STAGING === '1' && url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  }
  try {
    if (url.pathname === '/api/health') {
      return json({ ok: true, db: !!env.DB });
    }
    // The admin centre lives on its own address (admin.hostelflow.it): its own
    // accounts and cookie, nothing of the app there. Locally it's at /admin.
    const adminHost = env.ADMIN_HOST || 'admin.hostelflow.it';
    if (url.hostname === adminHost) {
      if (url.pathname.startsWith('/api/admin')) return await handleAdmin(request, env);
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
      if (['/admin.js', '/admin.css', '/icon.svg', '/icon-192.png'].includes(url.pathname)) return env.ASSETS.fetch(request);
      // (/admin, not /admin.html: the assets would answer that with a redirect.)
      if (url.pathname !== '/') return Response.redirect(new URL('/', url).toString(), 302);
      const res = await env.ASSETS.fetch(new Request(new URL('/admin', url), request));
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'no-store');
      out.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return out;
    }
    if (url.pathname.startsWith('/api/admin')) {
      return local ? await handleAdmin(request, env) : json({ error: 'not found' }, 404);
    }
    if (!local && ['/admin', '/admin.html'].includes(url.pathname)) {
      return Response.redirect(`https://${adminHost}/`, 302);
    }
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(request, env);
    }
    if (SITE_HIDDEN && (url.pathname === '/sitemap.xml' || isMarketingPage(url.pathname))) {
      return url.pathname === '/sitemap.xml' ? new Response('Not found', { status: 404 })
        : Response.redirect(new URL('/', url).toString(), 302);
    }
    // The public page lives at /welcome, not at its file name; the parked page is hidden.
    if ([FRONT_PAGE, FRONT_PAGE + '.html'].includes(url.pathname)) {
      return Response.redirect(new URL('/welcome', url).toString(), 302);
    }
    if ([...PARKED_PAGES, ...(LEGAL_LIVE ? [] : LEGAL_PAGES)].includes(url.pathname)) {
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    // The site's front door is the app (the sign-in when signed out); it is
    // also at /app. The public page is at /welcome.
    if (request.method === 'GET' && ['/', '/app', '/app/', '/welcome', '/en'].includes(url.pathname)) {
      const page = ['/welcome', '/en'].includes(url.pathname) ? FRONT_PAGE : '/';
      const res = await env.ASSETS.fetch(new Request(new URL(page, url), request));
      const out = new Response(url.pathname === '/en' ? inEnglish(await res.text()) : res.body, res);
      out.headers.delete('Content-Length'); // /en: the text changed
      out.headers.set('Cache-Control', 'no-cache');
      out.headers.set('Vary', 'Cookie');
      return out;
    }
    // The front page's video: iPhones only play a video when the server sends
    // it in pieces (Range → 206), which ASSETS does not do — cut them here.
    if (request.method === 'GET' && url.pathname.startsWith('/video/')) {
      return videoPiece(await env.ASSETS.fetch(new Request(url, { method: 'GET' })), request.headers.get('Range'));
    }
    return env.ASSETS.fetch(request);
  } catch (err) {
    console.error(err);
    await alert(env, 'server-error', `${request.method} ${url.pathname}

${err && err.stack || err}`);
    return json({ error: 'server error' }, 500);
  }
}

export default {
  async fetch(request, env) {
    return secure(await route(request, env), new URL(request.url).pathname, env);
  },

  // Hourly: delete old document photos, unsendable drafts, old routine
  // ticks and finished demos; fetch the booking channels' calendars and Channex bookings.
  async scheduled(event, env, ctx) {
    // Each job on its own: one failing must not stop the others, and we hear about it.
    const jobs = { cleanup: () => cleanup(env.DB), board: () => boardCleanup(env.DB), calendars: () => syncAllCalendars(env), channex: () => pullAllChannex(env), usage: () => reportUsage(env), police: () => dailyPoliceCheck(env), activity: () => pruneActivity(env.DB), auth: () => pruneAuth(env.DB), demos: () => pruneDemos(env.DB), claudeCosts: () => refreshClaudeCosts(env, Date.now()).catch(err => {
      // A key Anthropic refuses (401/403) is no outage: the admin centre's Claude
      // credit card shows it, so no e-mail every hour until the key is fixed.
      if (err.status === 401 || err.status === 403) { console.error('claudeCosts', err.message); return; }
      throw err;
    }) };
    ctx.waitUntil(Promise.all(Object.entries(jobs).map(([name, job]) => job().catch(err => {
      console.error(name, err);
      return alert(env, `hourly-${name}`, `The hourly job "${name}" failed:

${err && err.stack || err}`);
    }))));
  },
};
