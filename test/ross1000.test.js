import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { cleanup } from '../src/guests.js';
import { movimenti, parseAnswer, idswh, fileXml } from '../src/stats/ross1000.js';
import { createD1 } from './helpers/d1.js';

const DAY = 86400000;
const d = s => Date.UTC(...s.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));

test('Ross1000: a day per <movimento>, arrivals with Alloggiati codes, departures, rooms from the beds', () => {
  const guests = [
    { id: 'aaaa-1111', fields: { arrival: '02.01.2026', nights: '2', guestType: '18', sex: 'M', dob: '11.06.1972', nationality: 'ITA', residenceProvince: 'SP', residencePlace: 'La Spezia', birthCountry: 'ITA', birthPlace: 'La Spezia', birthProvince: 'SP' } },
    { id: 'bbbb-2222', fields: { arrival: '02.01.2026', nights: '2', guestType: '20', groupLeader: 'aaaa-1111', sex: 'F', dob: '22.09.1975', nationality: 'DEU' } },
    { id: 'cccc-3333', fields: { arrival: '03.01.2026', nights: '1', sex: '', dob: '01.01.1990', nationality: 'FRA' } },
  ];
  const { inner, problems } = movimenti(guests, d('2026-01-02'), d('2026-01-04'), { codice: 'A00927P', rooms: 4, beds: 16 });
  const x = fileXml(inner);
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<movimenti><codice>A00927P<\/codice><prodotto>HostelFlow<\/prodotto><movimento><data>20260102<\/data>/);
  assert.match(x, /<data>20260102<\/data><struttura><apertura>SI<\/apertura><camereoccupate>1<\/camereoccupate><cameredisponibili>4<\/cameredisponibili><lettidisponibili>16<\/lettidisponibili><\/struttura><arrivi><arrivo><idswh>aaaa1111<\/idswh><tipoalloggiato>18<\/tipoalloggiato><idcapo><\/idcapo><sesso>M<\/sesso><cittadinanza>100000100<\/cittadinanza><statoresidenza>100000100<\/statoresidenza><luogoresidenza>4\d{8}<\/luogoresidenza><datanascita>19720611<\/datanascita><statonascita>100000100<\/statonascita><comunenascita>4\d{8}<\/comunenascita><tipoturismo>NON SPECIFICATO<\/tipoturismo>/);
  assert.match(x, /<idswh>bbbb2222<\/idswh><tipoalloggiato>20<\/tipoalloggiato><idcapo>aaaa1111<\/idcapo><sesso>F<\/sesso><cittadinanza>100000216<\/cittadinanza><statoresidenza>100000216<\/statoresidenza><luogoresidenza><\/luogoresidenza><datanascita>19750922<\/datanascita><statonascita>100000216<\/statonascita><comunenascita><\/comunenascita>/);
  assert.match(x, /<data>20260104<\/data><struttura><apertura>SI<\/apertura><camereoccupate>0<\/camereoccupate>.*<partenze><partenza><idswh>aaaa1111<\/idswh><tipoalloggiato>18<\/tipoalloggiato><arrivo>20260102<\/arrivo><\/partenza>/);
  assert.equal((x.match(/<movimento>/g) || []).length, 3);
  assert.deepEqual(problems, [{ id: 'cccc-3333', day: '20260103', missing: ['sex'] }, { id: 'cccc-3333', day: '20260104', missing: ['sex'] }],
    'a guest without sex is left out (arrival and departure) and reported');
  assert.doesNotMatch(x, /<idswh>cccc3333<\/idswh>/);
  assert.equal(idswh('0f8e2c1a-1234-4abc-9def-0123456789ab').length, 20);
  assert.deepEqual(parseAnswer('<return><risultatiGiorno><arrivi><arrivo><idswh>aaaa1111</idswh><successo>true</successo></arrivo><arrivo><idswh>bbbb2222</idswh><successo>false</successo><errore>Codice cittadinanza errato</errore></arrivo></arrivi></risultatiGiorno></return>').results,
    [{ idswh: 'aaaa1111', ok: true, error: '' }, { idswh: 'bbbb2222', ok: false, error: 'Codice cittadinanza errato' }]);
  assert.throws(() => parseAnswer('<S:Fault><faultstring>Utente non autorizzato</faultstring></S:Fault>'), /Ross1000: Utente non autorizzato/);
});

test('Ross1000: an Italian born abroad has the birth country the police got; a guest whose arrival cannot go in has no departure either', () => {
  const guests = [
    { id: 'dddd-4444', fields: { arrival: '02.01.2026', nights: '1', sex: 'F', dob: '01.02.1980', nationality: 'ITA', residenceProvince: 'SP', residencePlace: 'La Spezia', birthPlace: 'BUENOS AIRES (ARG)' } },
    // An Italian without the comune of residence: no arrival, so no departure.
    { id: 'eeee-5555', fields: { arrival: '01.01.2026', nights: '2', sex: 'M', dob: '01.02.1980', nationality: 'ITA' } },
  ];
  const { inner, problems } = movimenti(guests, d('2026-01-02'), d('2026-01-03'), { codice: 'X', rooms: 1, beds: 4 });
  assert.match(inner, /<idswh>dddd4444<\/idswh>.*<statonascita>100000602<\/statonascita><comunenascita><\/comunenascita>/);
  assert.doesNotMatch(inner, /eeee5555/);
  assert.deepEqual(problems, [{ id: 'eeee-5555', day: '20260103', missing: ['comune of residence'] }]);
});

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 11)));
let env, sent;
beforeEach(() => {
  sent = [];
  env = {
    DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY,
    rossFetch: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, text: async () => '<return><risultatiGiorno><arrivi><arrivo><idswh>x</idswh><successo>true</successo></arrivo></arrivi></risultatiGiorno></return>' }; },
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
    const type = res.headers.get('Content-Type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

test('Ross1000 in Settings: the login is kept encrypted, the file downloads, the web service gets the days; statistics fields go after 90 days', async () => {
  const call = client();
  const pid = (await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Ostello', acceptTerms: true })).data.properties[0].id;
  assert.equal((await call('GET', `/api/properties/${pid}/ross1000?from=2026-10-01&to=2026-10-02`)).status, 400, 'no code yet');
  const s = await call('PUT', `/api/properties/${pid}/settings`, { ross: { region: 'liguria', codice: 'B01205', user: 'ws-user', password: 'ws-secret', rooms: 5, beds: 24 } });
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.ross, { region: 'liguria', codice: 'B01205', c59: '', user: 'ws-user', passwordSet: true, rooms: 5, beds: 24, start: null });
  assert.doesNotMatch(JSON.stringify(s.data), /ws-secret/);
  const stored = await env.DB.prepare('SELECT stats_settings FROM properties WHERE id = ?').bind(pid).first('stats_settings');
  assert.match(stored, /^v1\./);
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { ross: { region: 'atlantis' } })).status, 400);

  // A registered guest (as after Alloggiati): the statistics fields are kept.
  const now = Date.now();
  await env.DB.prepare("INSERT INTO guests (id, property_id, status, fields, created_at, updated_at, sent_at) VALUES (?, ?, 'sent', ?, ?, ?, ?)")
    .bind('g-1', pid, JSON.stringify({ arrival: '01.10.2026', nights: '1', nationality: 'DEU', sex: 'F', dob: '02.07.1999', guestType: '16' }), now, now, Date.UTC(2026, 9, 1, 15)).run();
  const file = await call('GET', `/api/properties/${pid}/ross1000?from=2026-10-01&to=2026-10-02`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('Content-Disposition'), /ross1000-2026-10-01-2026-10-02\.xml/);
  assert.match(file.data, /<codice>B01205<\/codice>.*<cameredisponibili>5<\/cameredisponibili><lettidisponibili>24<\/lettidisponibili>.*<idswh>g1<\/idswh>/s);

  const r = await call('POST', `/api/properties/${pid}/ross1000`, { from: '2026-10-01', to: '2026-10-02' });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, 1);
  assert.equal(sent[0].url, 'https://turismows.regione.liguria.it/ws/checkinV2');
  assert.equal(sent[0].init.headers.Authorization, `Basic ${btoa('ws-user:ws-secret')}`);
  assert.match(sent[0].init.body, /<ns2:inviaMovimentazione xmlns:ns2="http:\/\/checkin.ws.service.turismo5.gies.it\/"><movimentazione><codice>B01205<\/codice>/);

  await cleanup(env.DB, Date.UTC(2026, 9, 1, 15) + 91 * DAY);
  const left = JSON.parse(await env.DB.prepare('SELECT fields FROM guests WHERE id = ?').bind('g-1').first('fields'));
  assert.deepEqual(left, { arrival: '01.10.2026', nights: '1', nationality: 'DEU', guestType: '16' });
});
