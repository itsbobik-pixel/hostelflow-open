import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));
const PHOTO = `data:image/jpeg;base64,${btoa('specimen')}`;

function setup() {
  const env = {
    DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY,
    OCR_BENCH_USERS: 'bob@example.com', OCR_SHADOW_MODEL: 'cheap-model',
    // Both models read the specimen; the cheap one misreads the document number.
    benchRead: async model => ({
      fields: { surname: 'MUSTERMANN', given: 'ERIKA', sex: 'F', docNumber: model === 'cheap-model' ? 'C01X00T4' : 'C01X00T47' },
      usage: { input_tokens: 3000, output_tokens: 600 },
    }),
  };
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await worker.fetch(new Request('https://hf.example' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      const set = res.headers.get('Set-Cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
  };
  return { env, client };
}

test('scan bench: only listed accounts; both readings kept side by side with the verdict per field', async () => {
  const { client } = setup();
  const bob = client();
  await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Test', acceptTerms: true });
  const other = client();
  await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'correct horse', propertyName: 'Other', acceptTerms: true });
  assert.equal((await other('POST', '/api/ocr-bench', { image: PHOTO })).status, 403);
  assert.equal((await other('GET', '/api/ocr-bench')).status, 403);

  const r = await bob('POST', '/api/ocr-bench', { image: PHOTO, label: 'DEU passport.jpg' });
  assert.equal(r.status, 201);
  assert.equal(r.data.main.fields.docNumber, 'C01X00T47');
  assert.equal(r.data.shadow.fields.docNumber, 'C01X00T4');
  assert.equal(r.data.verdict.surname, 'same', 'read alike: right for both');
  assert.equal(r.data.verdict.docNumber, undefined, 'a difference waits for the person');
  assert.ok(r.data.shadow.cost < r.data.main.cost);

  assert.equal((await bob('PUT', `/api/ocr-bench/${r.data.id}`, { field: 'docNumber', verdict: 'main' })).data.verdict.docNumber, 'main');
  assert.equal((await bob('PUT', `/api/ocr-bench/${r.data.id}`, { field: 'docNumber', verdict: 'maybe' })).status, 400);
  const list = await bob('GET', '/api/ocr-bench');
  assert.equal(list.data.rows.length, 1);
  assert.equal(list.data.rows[0].verdict.docNumber, 'main');
  assert.equal((await other('DELETE', `/api/ocr-bench/${r.data.id}`)).status, 403);
  await bob('DELETE', `/api/ocr-bench/${r.data.id}`);
  assert.equal((await bob('GET', '/api/ocr-bench')).data.rows.length, 0);
});
