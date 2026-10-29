import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { startFromPage } from '../src/stats/portalread.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));
const SHOT = 'data:image/jpeg;base64,' + btoa('fake screenshot');
const GOOD = 'sk-ant-api03-good-key-0123456789abcdef-WXYZ';

// The portal's page as on San Giorgio's screenshot (Bob, 29. 10. 2026).
const PAGE = { date: '2026-09-16', confirmed: false, totalPresent: 4, rows: [
  { place: 'Francia', previous: 2, present: 2 },
  { place: 'Svizzera (incluso Liechtenstein)', previous: 2, present: 2 },
] };

let env, keys;
beforeEach(() => {
  keys = [];
  env = {
    DB: createD1(),
    ASSETS: { fetch: async () => new Response('app') },
    CREDENTIALS_KEY: KEY,
    ANTHROPIC_API_KEY: 'sk-ant-ours',
    readPortalDay: async e => { keys.push(e.ANTHROPIC_API_KEY); return PAGE; },
    checkClaudeKey: async () => {},
  };
});

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

async function setup() {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  return { call, pid: r.data.properties[0].id };
}

test('a day not yet confirmed: the night before it, from "Pres. notte prec."', () => {
  assert.deepEqual(startFromPage(PAGE), { date: '2026-09-15', text: 'Francia 2\nSvizzera 2', unread: [], missing: 0 });
});

test('a confirmed day: that day, from "Pres."; empty rows left out', () => {
  const page = { date: '2026-09-16', confirmed: true, totalPresent: -1, rows: [
    { place: 'Francia', previous: 2, present: 0 }, { place: 'Germania', previous: 0, present: 3 }, { place: 'Atlantide', previous: 0, present: 1 },
  ] };
  assert.deepEqual(startFromPage(page), { date: '2026-09-16', text: 'Germania 3\nAtlantide 1', unread: ['Atlantide 1'], missing: 0 });
});

// "Ultimo giorno caricato" on the portal's home page (Bob, 29. 10. 2026): TOTALE 6, five rows of 1 visible.
test('"Ultimo giorno caricato": that day, and a row cut off the screenshot is pointed out', () => {
  const rows = ['Belgio', 'Canada', 'Francia', 'India', 'Portogallo'].map(place => ({ place, previous: 0, present: 1 }));
  assert.deepEqual(startFromPage({ date: '2026-10-27', confirmed: true, totalPresent: 6, rows }),
    { date: '2026-10-27', text: 'Belgio 1\nCanada 1\nFrancia 1\nIndia 1\nPortogallo 1', unread: [], missing: 1 });
});

test('on our key five screenshots per property, then the form by hand', async () => {
  const { call, pid } = await setup();
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', `/api/properties/${pid}/rimovcli/read`, { image: SHOT });
    assert.equal(r.status, 200);
    assert.equal(r.data.text, 'Francia 2\nSvizzera 2');
  }
  const sixth = await call('POST', `/api/properties/${pid}/rimovcli/read`, { image: SHOT });
  assert.equal(sixth.status, 400);
  assert.match(sixth.data.error, /5 times/);
  assert.deepEqual(keys, Array(5).fill('sk-ant-ours'));
  // Nothing was saved: the form is filled in, the owner presses Save.
  const s = await call('GET', `/api/properties/${pid}/settings`);
  assert.equal(s.data.ross.start, null);
});

test('on its own Claude key no limit, and not counted', async () => {
  const { call, pid } = await setup();
  assert.equal((await call('PUT', `/api/properties/${pid}/claude`, { apiKey: GOOD })).status, 200);
  for (let i = 0; i < 7; i++) assert.equal((await call('POST', `/api/properties/${pid}/rimovcli/read`, { image: SHOT })).status, 200);
  assert.deepEqual(keys, Array(7).fill(GOOD));
});

test('several screenshots of the scrolled table go to Claude together, as one reading', async () => {
  const { call, pid } = await setup();
  let seen;
  env.readPortalDay = async (_e, images) => { seen = images.length; return PAGE; };
  assert.equal((await call('POST', `/api/properties/${pid}/rimovcli/read`, { images: [SHOT, SHOT] })).status, 200);
  assert.equal(seen, 2);
  assert.equal((await call('POST', `/api/properties/${pid}/rimovcli/read`, { images: [SHOT, SHOT, SHOT, SHOT, SHOT] })).status, 400);
});

test('not a picture: refused before Claude is asked', async () => {
  const { call, pid } = await setup();
  assert.equal((await call('POST', `/api/properties/${pid}/rimovcli/read`, { image: 'hello' })).status, 400);
  assert.deepEqual(keys, []);
});
