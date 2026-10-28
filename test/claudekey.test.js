import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { HttpError } from '../src/http.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));
const PHOTO = 'data:image/jpeg;base64,' + btoa('fake jpeg bytes');
const GOOD = 'sk-ant-api03-good-key-0123456789abcdef-WXYZ';

// The key each reading was made with, and what the next reading does.
let env, keys, readWith;
beforeEach(() => {
  keys = [];
  readWith = () => ({ fields: { surname: 'Rossi', given: 'Anna' }, confidence: 'high', notes: '', usage: {} });
  env = {
    DB: createD1(),
    ASSETS: { fetch: async () => new Response('app') },
    CREDENTIALS_KEY: KEY,
    ANTHROPIC_API_KEY: 'sk-ant-ours',
    OCR_SHADOW_RATE: '1',
    readDocument: async (e, _image, _client, model) => { keys.push([e.ANTHROPIC_API_KEY, model]); return readWith(); },
    checkClaudeKey: async apiKey => {
      if (apiKey !== GOOD) throw new HttpError(400, 'Claude did not accept this API key');
    },
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

test('connect: only a key that looks right and that Claude takes is saved, sealed', async () => {
  const { call, pid } = await setup();
  assert.deepEqual((await call('GET', `/api/properties/${pid}/claude`)).data, { connected: false, hint: null, lastError: null, serverKey: true, cost: { monthScans: 0, monthMicro: 0, perScanMicro: null } });
  assert.equal((await call('PUT', `/api/properties/${pid}/claude`, { apiKey: 'hello' })).status, 400);
  const bad = await call('PUT', `/api/properties/${pid}/claude`, { apiKey: 'sk-ant-api03-turned-down-0123456789' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /did not accept/);
  const ok = await call('PUT', `/api/properties/${pid}/claude`, { apiKey: GOOD });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { connected: true, hint: 'WXYZ', lastError: null, serverKey: true });
  const row = await env.DB.prepare('SELECT claude_credentials FROM properties WHERE id = ?').bind(pid).first();
  assert.ok(!row.claude_credentials.includes('good-key'));
  assert.equal((await call('DELETE', `/api/properties/${pid}/claude`)).data.connected, false);
});

test('only the owner sees or changes it', async () => {
  const { pid } = await setup();
  const stranger = client();
  await stranger('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'correct horse', propertyName: 'Other', acceptTerms: true });
  assert.equal((await stranger('GET', `/api/properties/${pid}/claude`)).status, 404);
  assert.equal((await stranger('PUT', `/api/properties/${pid}/claude`, { apiKey: GOOD })).status, 404);
});

test('scan: on its own key, with no limit and no extra comparison reading', async () => {
  const { call, pid } = await setup();
  await env.DB.prepare('UPDATE properties SET scan_limit = 1 WHERE id = ?').bind(pid).run();
  assert.equal((await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO })).data.fields.surname, 'Rossi');
  assert.equal(keys[0][0], 'sk-ant-ours');
  await call('PUT', `/api/properties/${pid}/claude`, { apiKey: GOOD });
  keys = [];
  const g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO }); // over the limit of 1 on ours
  assert.equal(g.data.fields.surname, 'Rossi');
  assert.equal(g.data.ocr.error, undefined);
  assert.deepEqual(keys.map(k => k[0]), [GOOD]); // one reading, on their key
  assert.equal((await call('GET', `/api/properties/${pid}/usage`)).data.limit, null);
  // What it cost them this month, and a scan on average (only this one was costed).
  const { cost } = (await call('GET', `/api/properties/${pid}/claude`)).data;
  assert.equal(cost.monthScans, 2);
  assert.equal(typeof cost.monthMicro, 'number');
});

test('scan: credit used up — staff are told, the owner sees why, no alert for us; the next good scan clears it', async () => {
  const { call, pid } = await setup();
  await call('PUT', `/api/properties/${pid}/claude`, { apiKey: GOOD });
  readWith = () => { throw new Anthropic.BadRequestError(400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } }, 'Your credit balance is too low to access the Anthropic API.', new Headers()); };
  const g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.match(g.data.ocr.error, /isn't working/);
  assert.match((await call('GET', `/api/properties/${pid}/claude`)).data.lastError, /credit has run out/);
  assert.equal(await env.DB.prepare("SELECT 1 FROM alerts WHERE kind = 'scan'").first(), null);
  readWith = () => ({ fields: { surname: 'Rossi' }, confidence: 'high', notes: '', usage: {} });
  await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.equal((await call('GET', `/api/properties/${pid}/claude`)).data.lastError, null);
});

test('a server without a key of its own: scans ask the owner to connect Claude', async () => {
  delete env.ANTHROPIC_API_KEY;
  delete env.readDocument;
  const { call, pid } = await setup();
  assert.equal((await call('GET', `/api/properties/${pid}/claude`)).data.serverKey, false);
  const g = await call('POST', `/api/properties/${pid}/guests`, { image: PHOTO });
  assert.match(g.data.ocr.error, /connects Claude/);
});

test('Flowy answers on the property\'s own key', async () => {
  const { call, pid } = await setup();
  await call('PUT', `/api/properties/${pid}/claude`, { apiKey: GOOD });
  let used;
  env.askModel = async e => { used = e.ANTHROPIC_API_KEY; return { text: 'Ciao', usage: {} }; };
  const r = await call('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'Help' }] });
  assert.equal(r.status, 200);
  assert.equal(used, GOOD);
});
