import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/worker.js';

// The page has no build step, so a stray quote would only show up in the
// browser. Parse every script here instead.
const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('every page script parses', () => {
  assert.doesNotThrow(() => new Function(read('i18n.js')));
  const files = readdirSync(new URL('../public/js/', import.meta.url)).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 5);
  for (const f of files) assert.doesNotThrow(() => new Function(read(`js/${f}`)), f);
});

test('no two page scripts declare the same global name', () => {
  // They share one global scope: a second `const x` stops that whole file.
  const files = readdirSync(new URL('../public/js/', import.meta.url)).filter(f => f.endsWith('.js'));
  const seen = new Map();
  for (const f of files) {
    for (const m of read(`js/${f}`).matchAll(/^(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen.has(m[1]), `${m[1]} is declared in both ${seen.get(m[1])} and ${f}`);
      seen.set(m[1], f);
    }
  }
});

test('index.html has no inline script (the CSP forbids it) and loads them all', () => {
  const html = read('index.html');
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0);
  assert.doesNotMatch(html, /\son[a-z]+="/, 'no inline event handlers');
  const files = readdirSync(new URL('../public/js/', import.meta.url)).filter(f => f.endsWith('.js'));
  for (const f of files) assert.match(html, new RegExp(`src="/js/${f.replace('.', '\\.')}"`), f);
});

test('the service worker caches the files the page needs', () => {
  const sw = read('sw.js');
  for (const f of ['/app.css', '/i18n.js', '/js/core.js', '/js/start.js']) assert.ok(sw.includes(`'${f}'`), f);
});

test('security headers on pages, API answers and redirects', async () => {
  const env = { ASSETS: { fetch: async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) } };
  // Visits are counted on the public pages only, never in the app.
  const pub = await worker.fetch(new Request('https://hostelflow.it/welcome'), env);
  assert.match(pub.headers.get('Content-Security-Policy'), /script-src 'self' https:\/\/static\.cloudflareinsights\.com;/);
  assert.match(pub.headers.get('Content-Security-Policy'), /connect-src 'self' https:\/\/cloudflareinsights\.com;/);
  for (const url of ['https://hostelflow.it/', 'https://hostelflow.it/api/health', 'https://www.hostelflow.it/x']) {
    const r = await worker.fetch(new Request(url), env);
    assert.match(r.headers.get('Content-Security-Policy'), /script-src 'self'(;|$)/, url);
    assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/, url);
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff', url);
    assert.equal(r.headers.get('X-Frame-Options'), 'DENY', url);
    assert.match(r.headers.get('Strict-Transport-Security'), /max-age=31536000/, url);
  }
});

test('only the HEIC converter page may use eval and blob workers', async () => {
  const env = { ASSETS: { fetch: async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) } };
  const heic = await worker.fetch(new Request('https://hostelflow.it/heic.html'), env);
  assert.match(heic.headers.get('Content-Security-Policy'), /'unsafe-eval'/);
  assert.match(heic.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/);
  assert.equal(heic.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  const page = await worker.fetch(new Request('https://hostelflow.it/'), env);
  assert.doesNotMatch(page.headers.get('Content-Security-Policy'), /unsafe-eval/);
  assert.doesNotMatch(read('heic.html'), /<script(?![^>]*\bsrc=)[^>]*>/);
});
