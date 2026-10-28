import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../src/worker.js';
import { dayFile, files, countryCode, PROVINCE_CODES, fileName, parseStart } from '../src/stats/rimovcli.js';
import { STATI } from '../src/registration/it/alloggiati-tables.js';
import { PROVINCES } from '../src/stats/it-provinces.js';
import { zip } from '../src/stats/zip.js';
import { createD1 } from './helpers/d1.js';

const d = s => Date.UTC(...s.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
const docs = name => new URL(`../docs/istat/rimovcli/${name}`, import.meta.url);
const g = (arrival, nights, fields = {}) => ({ fields: { arrival, nights: String(nights), ...fields } });
const has = cmd => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };

// Validated against the region's schema when xmllint is there.
function validate(xml) {
  if (!has('xmllint')) return;
  const dir = mkdtempSync(join(tmpdir(), 'rimovcli-'));
  writeFileSync(join(dir, 'f.xml'), xml);
  execFileSync('xmllint', ['--noout', '--schema', docs('ModelloC59.xsd').pathname, join(dir, 'f.xml')], { stdio: 'pipe' });
}

test('a day: rows per province and country code, Italians first, groups added up, valid against the XSD', () => {
  const guests = [
    g('14.10.2026', 3, { nationality: 'ITA', residenceProvince: 'SP' }), // here last night and tonight
    g('15.10.2026', 2, { nationality: 'ITA', residenceProvince: 'GE' }),
    g('13.10.2026', 2, { nationality: 'DEU' }),                          // leaves today
    g('15.10.2026', 1, { nationality: 'DEU' }),
    g('15.10.2026', 1, { nationality: 'SRB' }),                          // other Europe…
    g('15.10.2026', 1, { nationality: 'ALB' }),                          // …the same row
    g('15.10.2026', 1, { nationality: 'CZE', residenceCountry: 'ITA', residenceProvince: 'MI' }),
    g('01.10.2026', 2, { nationality: 'FRA' }),                          // long gone
  ];
  const f = dayFile(guests, d('2026-10-15'), { idstruttura: '123456789', rooms: 6, beds: 30 });
  assert.equal(f.name, '123456789_20261015.xml');
  assert.equal(f.xml, `<?xml version="1.0" encoding="UTF-8"?>
<rm:c59 xmlns:rm="http://www.regione.liguria.it/turismo/rimovcli" idstruttura="123456789" data="2026-10-15">
\t<mensile numcameredisp="6" numlettidisp="30" softwaregestionale="HostelFlow"/>
\t<giornaliero>
\t\t<rigac59 nazione="i" residenza="010" arrivati="1" partiti="0" presenti="1"/>
\t\t<rigac59 nazione="i" residenza="011" arrivati="0" partiti="0" presenti="1"/>
\t\t<rigac59 nazione="i" residenza="015" arrivati="1" partiti="0" presenti="1"/>
\t\t<rigac59 nazione="e" residenza="004" arrivati="1" partiti="1" presenti="1"/>
\t\t<rigac59 nazione="e" residenza="100" arrivati="2" partiti="0" presenti="2"/>
\t</giornaliero>
</rm:c59>
`);
  assert.deepEqual(f.problems, []);
  validate(f.xml);
});

test('nobody in the house: no rows; unknown residence is left out and reported', () => {
  const empty = dayFile([], d('2026-10-15'), { idstruttura: 'X', rooms: 0, beds: 0 });
  assert.match(empty.xml, /<mensile softwaregestionale="HostelFlow"\/>\n\t<giornaliero\/>\n<\/rm:c59>/);
  validate(empty.xml);
  const f = dayFile([g('15.10.2026', 1, { nationality: 'ITA' }), g('15.10.2026', 1, { nationality: '' })], d('2026-10-15'), { idstruttura: 'X' });
  assert.doesNotMatch(f.xml, /rigac59/);
  assert.deepEqual(f.problems.map(p => p.guests), [1, 1]);
  assert.equal(fileName('a/b', d('2026-01-02')), 'a_b_20260102.xml');
  assert.equal(files([], d('2026-10-01'), d('2026-10-03'), { idstruttura: 'X' }).files.length, 3);
});

test('every Alloggiati state has a code from the circolare, every province one from the table', () => {
  const tsv = readFileSync(docs('stati-esteri-istat.tsv'), 'utf8');
  const valid = new Set([...tsv.matchAll(/\t\s*(\d{3})\s*$/gm)].map(m => m[1]));
  for (const code of Object.keys(STATI)) {
    if (code === '100000100') assert.equal(countryCode(code), '');
    else assert.ok(valid.has(countryCode(code)), `${STATI[code]} -> ${countryCode(code)}`);
  }
  assert.equal(countryCode('100000241'), '036', 'Svizzera');
  assert.equal(countryCode('100000225'), '036', 'Liechtenstein with Switzerland');
  assert.equal(countryCode('100000765'), '001', 'La Réunion with France');
  assert.equal(countryCode('100000436'), '230', 'Marocco: Mediterranean Africa');
  assert.equal(countryCode('100000332'), '750', 'Iran: West Asia');
  assert.equal(countryCode('100000758'), '410', 'Groenlandia: other North America');
  const table = Object.fromEntries(readFileSync(docs('province-istat.tsv'), 'utf8').trim().split('\n').slice(1).map(l => l.split('\t')).map(r => [r[2], r[0]]));
  for (const sigla of Object.keys(PROVINCES)) {
    assert.ok(PROVINCE_CODES[sigla], sigla);
    if (sigla !== 'SU') assert.equal(PROVINCE_CODES[sigla], table[sigla], sigla);
  }
});

test('zip: the files come back out', { skip: !has('unzip') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rimovcli-zip-'));
  writeFileSync(join(dir, 'a.zip'), zip([{ name: 'a.xml', text: '<a/>' }, { name: 'b.xml', text: 'è' }]));
  execFileSync('unzip', ['-q', '-t', join(dir, 'a.zip')]);
  assert.equal(execFileSync('unzip', ['-p', join(dir, 'a.zip'), 'b.xml']).toString(), 'è');
});

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 11)));
let env;
beforeEach(() => { env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') }, CREDENTIALS_KEY: KEY }; });
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
    return { status: res.status, data: type.includes('json') ? await res.json() : type.includes('zip') ? new Uint8Array(await res.arrayBuffer()) : await res.text(), headers: res.headers };
  };
}

test('Settings: regional code saved, one day downloads as XML, several as a zip', async () => {
  const call = client();
  const pid = (await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Ostello', acceptTerms: true })).data.properties[0].id;
  assert.equal((await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-15`)).status, 400, 'no regional code yet');
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { ross: { c59: '000000-OS-0000' } })).status, 400, 'the CITR is refused');
  const s = await call('PUT', `/api/properties/${pid}/settings`, { ross: { c59: '123456789', rooms: 6, beds: 30 } });
  assert.equal(s.data.ross.c59, '123456789');
  const now = Date.now();
  await env.DB.prepare("INSERT INTO guests (id, property_id, status, fields, created_at, updated_at, sent_at) VALUES (?, ?, 'sent', ?, ?, ?, ?)")
    .bind('g-1', pid, JSON.stringify({ arrival: '15.10.2026', nights: '2', nationality: 'DEU' }), now, now, Date.UTC(2026, 9, 15, 15)).run();
  const one = await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-15`);
  assert.equal(one.status, 200);
  assert.match(one.headers.get('Content-Disposition'), /filename="123456789_20261015\.xml"/);
  assert.match(one.data, /numcameredisp="6" numlettidisp="30".*<rigac59 nazione="e" residenza="004" arrivati="1" partiti="0" presenti="1"\/>/s);
  const many = await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-17`);
  assert.match(many.headers.get('Content-Disposition'), /rimovcli-2026-10-15-2026-10-17\.zip/);
  assert.deepEqual([...many.data.slice(0, 4)], [0x50, 0x4b, 3, 4]);
  assert.match(new TextDecoder().decode(many.data), /123456789_20261017\.xml.*partiti="1" presenti="0"/s);
  assert.deepEqual((await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-17&check=1`)).data, { problems: [], missing: [] });

  // An Italian resident born abroad: no province of birth to fall back on, and the
  // C/59 has no "unknown" one. Named once (not per day), filled in from Settings, then counted.
  await env.DB.prepare("INSERT INTO guests (id, property_id, status, fields, created_at, updated_at, sent_at) VALUES (?, ?, 'sent', ?, ?, ?, ?)")
    .bind('g-2', pid, JSON.stringify({ given: 'Mario', surname: 'Rossi', arrival: '15.10.2026', nights: '2', nationality: 'ITA', birthCountry: 'Germania' }), now, now, Date.UTC(2026, 9, 15, 16)).run();
  const check = (await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-17&check=1`)).data;
  assert.equal(check.problems.length, 3, 'three days with him');
  assert.deepEqual(check.missing, [{ id: 'g-2', name: 'Mario Rossi', arrival: '15.10.2026', italy: true }]);
  assert.equal((await call('PUT', `/api/properties/${pid}/guests/g-2/stay`, { residenceProvince: 'sp' })).status, 200);
  assert.deepEqual((await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-17&check=1`)).data, { problems: [], missing: [] });
  assert.match((await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-15&to=2026-10-15`)).data, /nazione="i" residenza="011" arrivati="1"/);
});

test("starting point: the first file follows from the portal's last day, the rest from HostelFlow", async () => {
  const { present, bad } = parseStart('Austria 2\nCina 1\nGermania 2\nLa Spezia 1\nSP 1\n\nAtlantide 3');
  assert.deepEqual(present, { e038: 2, e720: 1, e004: 2, i011: 2 });
  assert.deepEqual(bad, ['Atlantide 3']);
  // HostelFlow: a German from the 19th (2 nights), a Belgian 19th–20th, a Thai from the 20th.
  const guests = [
    { fields: { arrival: '19.10.2026', nights: '2', nationality: 'DEU' } },
    { fields: { arrival: '19.10.2026', nights: '1', nationality: 'BEL' } },
    { fields: { arrival: '20.10.2026', nights: '3', nationality: 'THA' } },
  ];
  const start = { date: '2026-10-19', present: { e038: 2, e720: 1, e004: 2 } };
  const out = files(guests, Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 21), { idstruttura: '123456789', start });
  const rowsOf = xml => [...xml.matchAll(/residenza="(\d+)" arrivati="(\d+)" partiti="(\d+)" presenti="(\d+)"/g)].map(m => m.slice(1).join(' '));
  // 20th: Austria and China leave, one of the two Germans stays (ours), the Thai arrives; the Belgian was never on the portal.
  assert.deepEqual(rowsOf(out.files[0].text), ['004 0 1 1', '038 0 2 0', '720 0 1 0', '760 1 0 1'].sort());
  // 21st: HostelFlow alone.
  assert.deepEqual(rowsOf(out.files[1].text), ['004 0 1 0', '760 0 0 1']);
});

test('Settings: the starting point is saved, and files start the day after it', async () => {
  const call = client();
  const pid = (await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Ostello', acceptTerms: true })).data.properties[0].id;
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { ross: { c59: '123456789', start: { date: '2026-10-19', text: 'Narnia 2' } } })).status, 400);
  const s = await call('PUT', `/api/properties/${pid}/settings`, { ross: { c59: '123456789', start: { date: '2026-10-19', text: 'Austria 2\nCina 1' } } });
  assert.deepEqual(s.data.ross.start, { date: '2026-10-19', text: 'Austria 2\nCina 1' });
  assert.equal((await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-19&to=2026-10-20`)).status, 400, 'the portal has the 19th');
  const day = await call('GET', `/api/properties/${pid}/rimovcli?from=2026-10-20&to=2026-10-20`);
  assert.match(day.data, /residenza="038" arrivati="0" partiti="2" presenti="0"/);
  assert.equal((await call('PUT', `/api/properties/${pid}/settings`, { ross: { start: null } })).data.ross.start, null);
});
