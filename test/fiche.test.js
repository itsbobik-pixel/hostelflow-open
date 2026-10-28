import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { cleanup } from '../src/guests.js';
import { guestToFiche } from '../src/registration/fr/fiche.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));
const PHOTO = 'data:image/jpeg;base64,' + btoa('fake jpeg bytes');
let env;
beforeEach(() => {
  env = {
    DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY,
    readDocument: async () => ({ fields: { surname: 'Weber', given: 'Lukas', dob: '14.03.1996', nationality: 'DEU', docType: 'passport', docNumber: 'C01X00T47' }, confidence: 'high', notes: '', usage: { input_tokens: 1, output_tokens: 1 } }),
  };
});
function client() {
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
}

test('fiche: what a foreign guest must give, and the printed form', () => {
  assert.deepEqual(guestToFiche({ surname: 'Weber', given: 'Lukas', dob: '14.03.1996', birthPlace: 'Hamburg', nationality: 'Germany', homeAddress: 'Hauptstr. 1, Berlin', email: 'l@w.de', arrival: '10.10.2026', nights: '3', docType: 'passport', docNumber: 'C01' }), {
    nom: 'WEBER', prenoms: 'Lukas', naissance: '14/03/1996', lieuNaissance: 'Hamburg', nationalite: 'DEU', domicile: 'Hauptstr. 1, Berlin',
    telephone: '', email: 'l@w.de', arrivee: '10/10/2026', depart: '13/10/2026', document: 'passport C01',
  });
  assert.throws(() => guestToFiche({ surname: 'Weber', nationality: 'DEU', dob: '14.03.1996', arrival: '10.10.2026', email: 'nope' }), err => {
    assert.deepEqual(err.errors, ['given names are missing', 'place of birth is missing', 'home address is missing', 'e-mail is not valid']);
    return true;
  });
});

test('France: send files the fiche of a foreign guest, encrypted, printed for a period, gone after six months; French guests need none', async () => {
  const call = client();
  const pid = (await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Auberge', acceptTerms: true })).data.properties[0].id;
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { registration: 'fr-fiche', credentials: { establishment: 'Auberge du Port', address: '1 quai, Nice' } })).status, 200);
  const base = `/api/properties/${pid}/guests`;
  const g = (await call('POST', base, { image: PHOTO })).data;
  const french = (await call('POST', base, { image: PHOTO })).data;
  await call('PUT', `${base}/${french.id}`, { fields: { ...french.fields, nationality: 'FRA', docNumber: 'FR998877' } });

  // The place of birth and the home address are missing first.
  let r = await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });
  assert.equal(r.data.ok, false);
  await call('PUT', `${base}/${g.id}`, { fields: { ...g.fields, birthPlace: 'Hamburg', homeAddress: 'Hauptstr. 1, Berlin', phone: '+49 151 000' } });
  r = await call('POST', `${base}/send`, { ids: [g.id, french.id], mode: 'send' });
  assert.equal(r.data.ok, true);
  assert.ok(r.data.results.every(x => !('keep' in x)), 'the fiche itself is not sent back');

  const rows = (await env.DB.prepare('SELECT id, fields, fiche, fiche_until FROM guests ORDER BY created_at').all()).results;
  const kept = rows.find(x => x.id === g.id);
  assert.match(kept.fiche, /^v1\./, 'stored encrypted');
  assert.doesNotMatch(kept.fiche + kept.fields, /Weber|Hamburg|Hauptstr/, 'no name in the clear');
  assert.equal(rows.find(x => x.id === french.id).fiche, null);

  // The guest's arrival day (Italian time — near midnight UTC is still yesterday).
  const today = g.fields.arrival.split('.').reverse().join('-');
  const list = await call('GET', `/api/properties/${pid}/fiches?from=${today}&to=${today}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.fiches.length, 1);
  assert.equal(list.data.fiches[0].nom, 'WEBER');
  assert.equal(list.data.fiches[0].etablissement, 'Auberge du Port');
  assert.equal(list.data.fiches[0].telephone, '+49 151 000');

  await cleanup(env.DB, kept.fiche_until + 1);
  assert.equal((await env.DB.prepare('SELECT fiche FROM guests WHERE id = ?').bind(g.id).first()).fiche, null, 'deleted after six months');
});
