import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { ASSISTANT_DAILY_LIMIT, ASSISTANT_MODEL } from '../src/assistant.js';

let env;
let asked;
beforeEach(() => {
  asked = [];
  env = {
    DB: createD1(), ASSETS: { fetch: async () => new Response('app') },
    // Stand-in for the model: remembers what it was asked, answers briefly.
    askModel: async (_env, req) => {
      asked.push(req);
      return { text: 'Settings → Police registration.', usage: { input_tokens: 1200, output_tokens: 40 } };
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

async function owner() {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  return { call, pid: r.data.properties[0].id };
}

test('Flowy answers from the guide, with who is asking and the conversation so far', async () => {
  const { call, pid } = await owner();
  const r = await call('POST', '/api/assistant', {
    propertyId: pid, lang: 'it',
    messages: [
      { role: 'assistant', content: 'Hi! I am Flowy' }, // the greeting in the page: dropped, the API starts with the user
      { role: 'user', content: 'How do I connect Alloggiati?' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.reply, 'Settings → Police registration.');
  assert.equal(r.data.left, ASSISTANT_DAILY_LIMIT - 1);
  const [req] = asked;
  assert.deepEqual(req.messages, [{ role: 'user', content: 'How do I connect Alloggiati?' }]);
  assert.match(req.system, /You are Flowy/);
  assert.match(req.system, /role owner, property "Costello"/);
  assert.match(req.system, /Alloggiati Web login saved: no/);
  assert.match(req.system, /interface language: Italian/);
  const u = await env.DB.prepare('SELECT messages, input_tokens, output_tokens FROM assistant_usage').first();
  assert.deepEqual(u, { messages: 1, input_tokens: 1200, output_tokens: 40 });
  assert.match(ASSISTANT_MODEL, /haiku/);
});

test('Flowy: signed in, own property, a real question, and a daily limit', async () => {
  const { call, pid } = await owner();
  assert.equal((await client()('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'hi' }] })).status, 401);
  const eve = client();
  await eve('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await eve('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'hi' }] })).status, 404);
  assert.equal((await call('POST', '/api/assistant', { propertyId: pid, messages: [] })).status, 400);
  assert.equal((await call('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'x'.repeat(1501) }] })).status, 400);
  assert.equal(asked.length, 0);

  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('INSERT INTO assistant_usage (property_id, day, messages) VALUES (?, ?, ?)').bind(pid, day, ASSISTANT_DAILY_LIMIT).run();
  const r = await call('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 429);
  assert.match(r.data.error, /today's limit/);
  assert.equal(asked.length, 0);
});

test('Flowy: a model that fails or declines gets a friendly answer', async () => {
  const { call, pid } = await owner();
  env.askModel = async () => ({ text: '', usage: {} });
  const r = await call('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /write to the team/);
  env.askModel = async () => { throw new Error('overloaded'); };
  assert.equal((await call('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'hi' }] })).status, 502);
  delete env.askModel;
  assert.equal((await call('POST', '/api/assistant', { propertyId: pid, messages: [{ role: 'user', content: 'hi' }] })).status, 503);
});
