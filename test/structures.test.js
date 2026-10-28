// Two structures in one property (src/structures.js): two Alloggiati Web
// accounts and two sets of ISTAT codes, each guest in one of them.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { todayIn } from '../src/guests.js';
import { decryptCredentials } from '../src/secrets.js';
import { structureAad } from '../src/structures.js';
import { createD1 } from './helpers/d1.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const GUEST = {
  surname: 'Novak', given: 'Jan', sex: 'M', dob: '01.01.1990', nationality: 'CZE',
  docType: 'passport', docNumber: 'AB123456', country: 'CZE', nights: '1',
};

let env, realFetch, portal;
beforeEach(() => {
  env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY };
  // Fake Alloggiati: remembers which account each call was made with.
  portal = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const action = init.headers.SOAPAction.replace(/"/g, '').split('/')[1];
    const user = (init.body.match(/<Utente>([\s\S]*?)<\/Utente>/) || [])[1];
    const records = [...init.body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(m => m[1]);
    portal.push({ action, user, records });
    const ok = '<esito>true</esito>';
    const xml = action === 'GenerateToken'
      ? `<GenerateTokenResult><token>T-${user}</token></GenerateTokenResult><result>${ok}</result>`
      : `<${action}Result>${ok}</${action}Result><result><Dettaglio>${records.map(() => `<EsitoOperazioneServizio>${ok}</EsitoOperazioneServizio>`).join('')}</Dettaglio></result>`;
    return { ok: true, status: 200, text: async () => xml };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('Content-Type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

async function owner(email = 'bob@example.com', propertyName = 'Costello', login = 'COSTELLO1') {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email, password: 'correct horse', propertyName, acceptTerms: true });
  const pid = r.data.properties[0].id;
  await call('PUT', `/api/properties/${pid}/settings`, { registration: 'it-alloggiati', credentials: { user: login, password: 'p', wskey: 'k' } });
  const put = body => call('PUT', `/api/properties/${pid}/settings`, body);
  return { call, pid, put, base: `/api/properties/${pid}/guests` };
}
// Costello: the main house plus the room on another floor.
async function costello() {
  const o = await owner();
  const added = await o.put({ addStructure: { name: 'Annex', mainName: 'Main' } });
  assert.equal(added.status, 200);
  const annex = added.data.added;
  const saved = await o.put({ structure: annex, registration: 'it-alloggiati', credentials: { user: 'COSTELLO2', password: 'p2', wskey: 'k2' } });
  assert.equal(saved.status, 200);
  return { ...o, annex };
}

test('a property with one structure works as before: nothing to choose, all to its account', async () => {
  const { call, pid, base } = await owner();
  const me = await call('GET', '/api/me');
  assert.deepEqual(me.data.properties[0].structures, []);
  const s = await call('GET', `/api/properties/${pid}/settings`);
  assert.deepEqual(s.data.structures, []);
  const g = await call('POST', base, { fields: GUEST });
  assert.equal(g.data.structure, 'main');
  const r = await call('POST', `${base}/send`, { ids: [g.data.id], mode: 'send' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'send');
  assert.deepEqual([...new Set(portal.map(p => p.user))], ['COSTELLO1']);
  const day = await call('GET', `/api/properties/${pid}/istat?date=${todayIn('Europe/Rome').split('.').reverse().join('-')}`);
  assert.equal(day.data.guests.length, 1);
});

test('two police connections are saved encrypted, each on its own, and shown without secrets', async () => {
  const { call, pid, annex, put } = await costello();
  const row = await env.DB.prepare('SELECT * FROM structures WHERE id = ?').bind(annex).first();
  assert.equal(row.property_id, pid);
  assert.ok(!row.registration_credentials.includes('COSTELLO2'), 'stored encrypted');
  assert.equal((await decryptCredentials(env, structureAad(pid, annex), row.registration_credentials)).user, 'COSTELLO2');
  await assert.rejects(decryptCredentials(env, pid, row.registration_credentials), 'bound to the structure, not just the property');
  const main = await env.DB.prepare('SELECT registration_credentials, structure_name FROM properties WHERE id = ?').bind(pid).first();
  assert.equal((await decryptCredentials(env, pid, main.registration_credentials)).user, 'COSTELLO1');
  assert.equal(main.structure_name, 'Main');

  const s = (await call('GET', `/api/properties/${pid}/settings`)).data;
  assert.equal(s.mainName, 'Main');
  assert.equal(s.credentials.user.value, 'COSTELLO1');
  assert.equal(s.structures.length, 1);
  assert.equal(s.structures[0].name, 'Annex');
  assert.equal(s.structures[0].credentials.user.value, 'COSTELLO2');
  assert.deepEqual(s.structures[0].credentials.password, { set: true });
  assert.ok(!JSON.stringify(s).includes('p2'));
  const me = (await call('GET', '/api/me')).data.properties[0];
  assert.deepEqual(me.structures.map(x => x.name), ['Main', 'Annex']);

  // Only one second structure; renaming works.
  assert.equal((await put({ addStructure: { name: 'Third' } })).status, 409);
  assert.equal((await put({ structure: annex, structureName: 'Room 9' })).data.structures[0].name, 'Room 9');

  // Disconnect is per structure: the annex's login goes, the main one stays.
  const off = await put({ structure: annex, clearCredentials: true });
  assert.equal(off.status, 200);
  assert.equal(off.data.structures[0].credentials.user.set, false);
  assert.equal(off.data.credentials.user.value, 'COSTELLO1');
  assert.equal((await env.DB.prepare('SELECT police_login_fp FROM structures WHERE id = ?').bind(annex).first()).police_login_fp, null);
});

test('one police login stays unique: not on both structures, not at another property', async () => {
  const { put, annex } = await costello();
  const twice = await put({ structure: annex, credentials: { user: 'costello1 ' } });
  assert.equal(twice.status, 409);
  assert.match(twice.data.error, /your other structure/);
  const other = await owner('eve@example.com', 'Other', 'EVE');
  const steal = await other.put({ credentials: { user: 'COSTELLO2' } });
  assert.equal(steal.status, 409);
  assert.match(steal.data.error, /another property/);
  // …nor as the other property's own second structure.
  const second = (await other.put({ addStructure: { name: 'Annex' } })).data.added;
  assert.equal((await other.put({ structure: second, credentials: { user: 'COSTELLO1', password: 'x', wskey: 'y' } })).status, 409);
  assert.equal((await other.put({ structure: second, credentials: { user: 'EVE2', password: 'x', wskey: 'y' } })).status, 200);
});

test('Check-in: each guest goes to the chosen structure\'s account, never mixed in one submission', async () => {
  const { call, base, annex } = await costello();
  const a = (await call('POST', base, { fields: GUEST })).data;
  const b = (await call('POST', base, { fields: { ...GUEST, surname: 'Rossi', docNumber: 'CD999' }, structure: annex })).data;
  assert.equal(a.structure, 'main');
  assert.equal(b.structure, annex);
  // Changed on the card: and back.
  assert.equal((await call('PUT', `${base}/${a.id}`, { fields: GUEST, structure: annex })).data.structure, annex);
  assert.equal((await call('PUT', `${base}/${a.id}`, { fields: GUEST, structure: 'main' })).data.structure, 'main');
  assert.equal((await call('PUT', `${base}/${a.id}`, { fields: GUEST })).data.structure, 'main', 'no structure in the body keeps it');

  const test1 = await call('POST', `${base}/send`, { ids: [a.id, b.id], mode: 'test' });
  assert.equal(test1.status, 200);
  assert.equal(test1.data.ok, true);
  const sent = await call('POST', `${base}/send`, { ids: [a.id, b.id], mode: 'send' });
  assert.equal(sent.data.mode, 'send');
  assert.equal(sent.data.results.length, 2);
  const sends = portal.filter(p => p.action === 'Send');
  assert.equal(sends.length, 2, 'one submission per structure');
  const byUser = Object.fromEntries(sends.map(p => [p.user, p.records]));
  assert.equal(byUser.COSTELLO1.length, 1);
  assert.match(byUser.COSTELLO1[0], /NOVAK/);
  assert.equal(byUser.COSTELLO2.length, 1);
  assert.match(byUser.COSTELLO2[0], /ROSSI/);
  for (const p of portal.filter(x => x.action !== 'GenerateToken')) assert.equal(p.records.length, 1);
  const rows = (await env.DB.prepare("SELECT structure_id FROM guests WHERE status = 'sent' ORDER BY structure_id").all()).results;
  assert.deepEqual(rows.map(r => r.structure_id), [null, annex]);

  // A family member can't be in another structure than the head of the family.
  const lead = (await call('POST', base, { fields: { ...GUEST, docNumber: 'L1', guestType: '17' } })).data;
  const kid = (await call('POST', base, { fields: { ...GUEST, docNumber: '', guestType: '19', groupLeader: lead.id }, structure: annex })).data;
  const mixed = await call('POST', `${base}/send`, { ids: [lead.id, kid.id], mode: 'test' });
  assert.equal(mixed.status, 400);
});

test('a second structure without a complete login stops only its guests', async () => {
  const { call, base, annex, put } = await costello();
  await put({ structure: annex, clearCredentials: true });
  const a = (await call('POST', base, { fields: GUEST })).data;
  const b = (await call('POST', base, { fields: { ...GUEST, docNumber: 'X2' }, structure: annex })).data;
  const r = await call('POST', `${base}/send`, { ids: [a.id, b.id], mode: 'send' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /^Annex: the police portal login is incomplete/);
  assert.equal(portal.length, 0, 'nothing went out');
  assert.equal((await call('POST', `${base}/send`, { ids: [a.id], mode: 'send' })).status, 200);
});

test('ISTAT, Ross1000 and RiMovCli count each structure on its own, with its own code', async () => {
  const { call, pid, put, annex } = await costello();
  await put({ ross: { region: 'liguria', codice: 'MAIN01', c59: '111', rooms: 8, beds: 30 } });
  // Rooms and beds must be said for the annex (Settings → Property lists the whole house).
  await put({ structure: annex, ross: { codice: 'ANX01', c59: '222' } });
  const rm = `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-15`;
  assert.equal((await call('GET', `${rm}&structure=${annex}`)).status, 400);
  const s = await put({ structure: annex, ross: { rooms: 1, beds: 4 } });
  assert.equal(s.data.structures[0].ross.c59, '222');
  assert.equal(s.data.ross.c59, '111');

  const now = Date.now();
  const add = (id, nat, sid) => env.DB.prepare("INSERT INTO guests (id, property_id, status, fields, created_at, updated_at, sent_at, structure_id) VALUES (?, ?, 'sent', ?, ?, ?, ?, ?)")
    .bind(id, pid, JSON.stringify({ arrival: '15.10.2026', nights: '2', nationality: nat, sex: 'M', dob: '01.01.1990' }), now, now, Date.UTC(2026, 9, 15, 15), sid).run();
  await add('g-main', 'DEU', null);
  await add('g-annex1', 'FRA', annex);
  await add('g-annex2', 'FRA', annex);

  const mainFile = await call('GET', rm);
  assert.match(mainFile.data, /idstruttura="111"/);
  assert.match(mainFile.data, /numcameredisp="8" numlettidisp="30"/);
  assert.match(mainFile.data, /arrivati="1"/);
  assert.doesNotMatch(mainFile.data, /arrivati="2"/);
  const annexFile = await call('GET', `${rm}&structure=${annex}`);
  assert.match(annexFile.headers.get('Content-Disposition'), /222_20261015\.xml/);
  assert.match(annexFile.data, /idstruttura="222"/);
  assert.match(annexFile.data, /numcameredisp="1" numlettidisp="4"/);
  assert.match(annexFile.data, /arrivati="2" partiti="0" presenti="2"/);
  // The next day follows on from the annex's own night before.
  const zip = await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-17&structure=${annex}`);
  assert.match(zip.headers.get('Content-Disposition'), /rimovcli-annex-2026-10-15-2026-10-17\.zip/);

  const rossMain = await call('GET', `/api/properties/${pid}/ross1000?from=2026-10-15&to=2026-10-15`);
  assert.match(rossMain.data, /<codice>MAIN01<\/codice>/);
  const rossAnnex = await call('GET', `/api/properties/${pid}/ross1000?from=2026-10-15&to=2026-10-15&structure=${annex}`);
  assert.match(rossAnnex.data, /<codice>ANX01<\/codice>/);
  assert.equal((rossAnnex.data.match(/<arrivo>/g) || []).length, 2);
  assert.equal((rossMain.data.match(/<arrivo>/g) || []).length, 1);

  const rep = (sid = '') => call('GET', `/api/properties/${pid}/istat/report?from=2026-10-15&to=2026-10-15${sid ? `&structure=${sid}` : ''}`);
  assert.deepEqual((await rep()).data.days[0].arrived, [{ nationality: 'Germania', n: 1 }]);
  assert.deepEqual((await rep(annex)).data.days[0].arrived, [{ nationality: 'Francia', n: 2 }]);
  const day = await call('GET', `/api/properties/${pid}/istat?date=2026-10-15&structure=${annex}`);
  assert.equal(day.data.guests.length, 2);

  // With its guests in, the annex stays (its numbers must stay counted).
  assert.equal((await put({ removeStructure: annex })).status, 409);
});

test('a structure belongs to its property only', async () => {
  const { annex } = await costello();
  const eve = await owner('eve@example.com', 'Other', 'EVE');
  assert.equal((await eve.call('POST', eve.base, { fields: GUEST, structure: annex })).status, 404);
  assert.equal((await eve.put({ structure: annex, credentials: { user: 'NEW' } })).status, 404);
  assert.equal((await eve.put({ removeStructure: annex })).status, 404);
  assert.equal((await eve.call('GET', `/api/properties/${eve.pid}/istat/report?from=2026-10-15&to=2026-10-15&structure=${annex}`)).status, 404);
  assert.equal((await eve.call('GET', `/api/properties/${eve.pid}/rimovcli?from=2026-10-15&to=2026-10-15&structure=${annex}`)).status, 404);
  assert.deepEqual((await eve.call('GET', `/api/properties/${eve.pid}/settings`)).data.structures, []);
  assert.deepEqual((await eve.call('GET', '/api/me')).data.properties[0].structures, []);
});

test('an empty second structure can be removed; the main one cannot', async () => {
  const o = await owner();
  const sid = (await o.put({ addStructure: { name: 'Annex' } })).data.added;
  assert.equal((await o.put({ removeStructure: 'main' })).status, 400);
  const r = await o.put({ removeStructure: sid });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.structures, []);
});

test('an Italian property adds a second structure before saving its first Alloggiati login', async () => {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Ann', email: 'ann@example.com', password: 'correct horse', propertyName: 'Annex house', acceptTerms: true });
  const pid = r.data.properties[0].id;
  const added = await call('PUT', `/api/properties/${pid}/settings`, { addStructure: { name: 'Annex', mainName: 'Main' } });
  assert.equal(added.status, 200);
  assert.equal(added.data.registration, 'it-alloggiati');
  assert.equal(added.data.structures.length, 1);
});
