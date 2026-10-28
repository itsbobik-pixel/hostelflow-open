import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { LEGAL_LIVE } from '../src/api.js';
import { SITE_HIDDEN } from '../src/site.js';

// ASSETS answers with the path it was asked for, so we see which page was served.
const env = { DB: createD1(), ASSETS: { fetch: async req => new Response(`page:${new URL(req.url).pathname}`) } };
const get = (path, cookie) => worker.fetch(new Request('https://hostelflow.it' + path, { headers: cookie ? { Cookie: cookie } : {} }), env);

test('the front door: the app (its sign-in) at / and /app, the public page at /welcome', async () => {
  assert.equal(await (await get('/')).text(), 'page:/');
  if (!SITE_HIDDEN) assert.equal(await (await get('/welcome')).text(), 'page:/beta');
  assert.equal(await (await get('/', 'theme=x; hf_session=abc')).text(), 'page:/');
  assert.equal(await (await get('/app')).text(), 'page:/');
  assert.equal(await (await get('/app/')).text(), 'page:/');
  const r = await get('/');
  assert.equal(r.headers.get('Vary'), 'Cookie');
  assert.equal(r.headers.get('Cache-Control'), 'no-cache');
  assert.match(r.headers.get('Content-Security-Policy'), /script-src 'self'/);
  // The public page only at /welcome; the full product page is parked for now.
  const front = SITE_HIDDEN ? '/' : '/welcome';
  for (const [path, to] of [['/beta', front], ['/beta.html', front], ['/landing', '/'], ['/landing.html', '/']]) {
    const r = await get(path);
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.get('Location'), `https://hostelflow.it${to}`);
  }
  // Everything else as before.
  assert.equal(await (await get('/app.css')).text(), 'page:/app.css');
});

test('the legal pages are built from docs/legal and linked from the site and the sign-up form', async () => {
  const { readFileSync } = await import('node:fs');
  const { PAGES, renderLegal } = await import('../scripts/build-legal.mjs');
  const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // CRLF on Windows checkouts
  for (const [page, file] of Object.entries(PAGES)) {
    const html = read(`public/${page}.html`);
    assert.equal(html, renderLegal(read(`docs/legal/${file}`), page).html, `public/${page}.html is out of date: npm run build:legal`);
    assert.match(html, /<section class="it" lang="it">/);
    assert.match(html, /<section class="en" lang="en">/);
    assert.doesNotMatch(html, /BOZZA \/ DRAFT/, 'the note for us stays out of the public page');
    assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0, 'no inline script (CSP)');
    // Linked from the site and the sign-up form — hidden until LEGAL_LIVE.
    for (const f of ['landing.html', 'beta.html', 'index.html']) {
      assert.match(read(`public/${f}`), new RegExp(`<a href="/${page}"`), `${f} links /${page}`);
    }
    assert.equal(read('public/sitemap.xml').includes(`/${page}<`), LEGAL_LIVE);
    assert.equal((await get(`/${page}`)).status, LEGAL_LIVE ? 200 : 302, `/${page}`);
  }
  // Everything the switch covers is shown or hidden together.
  for (const f of ['landing.html', 'beta.html', 'index.html']) {
    const marked = [...read(`public/${f}`).matchAll(/<[^>]*\bdata-legal\b[^>]*>/g)];
    assert.ok(marked.length, f);
    for (const [tag] of marked) assert.equal(/\shidden\b/.test(tag), !LEGAL_LIVE, `${f}: ${tag}`);
  }
  assert.match(read('public/index.html'), LEGAL_LIVE ? /id="rg-terms" type="checkbox" required/ : /id="rg-terms" type="checkbox">/);
});

test('the front page: Italian at /welcome, the same page in English at /en, each its own address', async () => {
  const { readFileSync } = await import('node:fs');
  const { inEnglish } = await import('../src/site.js');
  const it = readFileSync(new URL('../public/beta.html', import.meta.url), 'utf8');
  assert.match(it, /<html lang="it" class="it" data-lang="it" data-auto>/);
  assert.match(it, /<link rel="canonical" href="https:\/\/hostelflow\.it\/welcome">/);
  assert.match(it, /hreflang="en" href="https:\/\/hostelflow\.it\/en"/);
  const en = inEnglish(it);
  assert.match(en, /<html lang="en" class="en" data-lang="en">/);
  assert.match(en, /<link rel="canonical" href="https:\/\/hostelflow\.it\/en">/);
  assert.match(en, /<meta property="og:url" content="https:\/\/hostelflow\.it\/en">/);
  assert.match(en, /<title>HostelFlow — Alloggiati Web on autopilot: guest check-in from one photo<\/title>/);
  assert.doesNotMatch(en, /Alloggiati Web automatico: check-in con una foto/);
  for (const page of ['rimovcli-liguria', 'scansione-documenti-check-in', 'alloggiati-web-guida', 'check-in-affitti-brevi', 'en']) {
    assert.ok(readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').includes(`/${page}<`), page);
  }
});

test('the front page video comes in pieces, so iPhones play it', async () => {
  const bytes = new Uint8Array(100).map((_, i) => i);
  const env = { DB: createD1(), ASSETS: { fetch: async () => new Response(bytes, { headers: { 'Content-Type': 'video/mp4' } }) } };
  const get = range => worker.fetch(new Request('https://hostelflow.it/video/checkin-it.mp4', { headers: range ? { Range: range } : {} }), env);
  const whole = await get();
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 100);
  const first = await get('bytes=0-1');
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('Content-Range'), 'bytes 0-1/100');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [0, 1]);
  const rest = await get('bytes=90-');
  assert.equal(rest.headers.get('Content-Range'), 'bytes 90-99/100');
  const tail = await get('bytes=-5');
  assert.equal(tail.headers.get('Content-Range'), 'bytes 95-99/100');
  assert.equal((await get('bytes=200-')).status, 416);
});

test('while the site is hidden, every marketing page leads to the sign-in', { skip: !SITE_HIDDEN }, async () => {
  for (const path of ['/welcome', '/en', '/es', '/fr.html', '/alloggiati-web-automatico', '/gestionale-ostello.html', '/check-in-affitti-brevi']) {
    const r = await get(path);
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.get('Location'), 'https://hostelflow.it/', path);
  }
  assert.equal((await get('/sitemap.xml')).status, 404);
  assert.equal(await (await get('/install')).text(), 'page:/install');
  assert.equal(await (await get('/')).text(), 'page:/');
});
