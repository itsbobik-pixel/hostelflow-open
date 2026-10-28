// Run from the worker folder:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guestToRecord, resolveState, resolveComune, stateInPlace, resolveDocType, cleanName, toItalianDate,
  todayInItaly, submitRecords, generateToken, RECORD_LENGTH, ITALIA,
} from '../src/registration/it/alloggiati.js';
import { STATI } from '../src/registration/it/alloggiati-tables.js';

// 10:00 in Rome on 24 Sep 2026
const NOW = new Date('2026-09-24T08:00:00Z');

// Slices a record into named fields using the official offsets.
function fields(r) {
  const at = (from, len) => r.slice(from, from + len);
  return {
    type: at(0, 2), arrival: at(2, 10), nights: at(12, 2), surname: at(14, 50), given: at(64, 30),
    sex: at(94, 1), dob: at(95, 10), birthComune: at(105, 9), birthProv: at(114, 2),
    birthState: at(116, 9), citizenship: at(125, 9), docType: at(134, 5), docNumber: at(139, 20),
    issuePlace: at(159, 9),
  };
}

const czech = {
  surname: 'Nováková', given: 'Jana Marie', sex: 'F', dob: '03.07.1995',
  nationality: 'Czechia', country: 'Czechia', docNumber: '12345678', docType: 'passport',
};

test('foreign passport guest -> exact 168-char record', () => {
  const r = guestToRecord({ id: 'x', fields: czech }, { now: NOW });
  assert.equal(r.length, RECORD_LENGTH);
  const expected =
    '16' + '24/09/2026' + '01' +
    'NOVAKOVA'.padEnd(50) + 'JANA MARIE'.padEnd(30) +
    '2' + '03/07/1995' + ' '.repeat(9) + '  ' +
    '100000257' + '100000257' +
    'PASOR' + '12345678'.padEnd(20) + '100000257';
  assert.equal(r, expected);
});

test('field offsets match the manual', () => {
  const f = fields(guestToRecord({ ...czech, nights: 3, sex: 'm' }, { now: NOW }));
  assert.equal(f.type, '16');
  assert.equal(f.arrival, '24/09/2026');
  assert.equal(f.nights, '03');
  assert.equal(f.surname.trim(), 'NOVAKOVA');
  assert.equal(f.given.trim(), 'JANA MARIE');
  assert.equal(f.sex, '1');
  assert.equal(f.dob, '03/07/1995');
  assert.equal(f.birthState, '100000257');
  assert.equal(f.citizenship, '100000257');
  assert.equal(f.docType, 'PASOR');
  assert.equal(f.docNumber.trim(), '12345678');
  assert.equal(f.issuePlace, '100000257');
});

test('Italian-born guest with Italian ID card', () => {
  const r = guestToRecord({
    surname: 'Rossi', given: 'Paolo', sex: 'M', dob: '1973-03-13', nationality: 'ITA',
    birthPlace: 'La Spezia', docType: 'id_card', docNumber: 'CA12345BB',
    country: 'Italy', issuePlace: 'Genova', issueProvince: 'GE',
  }, { now: NOW });
  const f = fields(r);
  assert.equal(f.birthComune, '407011015');
  assert.equal(f.birthProv, 'SP');
  assert.equal(f.birthState, ITALIA);
  assert.equal(f.citizenship, ITALIA);
  assert.equal(f.docType, 'IDENT');
  assert.equal(f.issuePlace, resolveComune('GENOVA', 'GE').code);
});

test('born in Italy without comune is rejected', () => {
  assert.throws(() => guestToRecord({ ...czech, nationality: 'Italy', country: 'Italy' }, { now: NOW }),
    /birth comune/);
});

test('birth country different from nationality', () => {
  const f = fields(guestToRecord({ ...czech, birthCountry: 'SVK' }, { now: NOW }));
  assert.equal(f.birthState, '100000255');
  assert.equal(f.citizenship, '100000257');
});

test('family/group members get 34 blanks for the document part', () => {
  const r = guestToRecord({ ...czech, guestType: '20', docNumber: '' }, { now: NOW });
  assert.equal(r.length, RECORD_LENGTH);
  assert.equal(r.slice(134), ' '.repeat(34));
});

test('arrival: yesterday ok, older rejected, Rome timezone used', () => {
  assert.equal(fields(guestToRecord({ ...czech, arrival: '23.09.2026' }, { now: NOW })).arrival, '23/09/2026');
  assert.throws(() => guestToRecord({ ...czech, arrival: '22.09.2026' }, { now: NOW }), /today or yesterday/);
  // 23:30 UTC on 24 Sep is already 25 Sep in Rome
  assert.equal(todayInItaly(new Date('2026-09-24T23:30:00Z')), '25/09/2026');
});

test('yesterday is the calendar day before, also on the nights the clocks change', () => {
  // Sunday 25 Oct 2026, 23:30 in Rome (the day has 25 hours): yesterday is the 24th.
  const autumn = new Date('2026-10-25T22:30:00Z');
  assert.equal(todayInItaly(autumn), '25/10/2026');
  assert.equal(todayInItaly(autumn, -1), '24/10/2026');
  assert.equal(fields(guestToRecord({ ...czech, arrival: '24.10.2026' }, { now: autumn })).arrival, '24/10/2026');
  // Monday 29 Mar 2027, 00:30 in Rome (the day before had 23 hours): yesterday is the 28th.
  const spring = new Date('2027-03-28T22:30:00Z');
  assert.equal(todayInItaly(spring), '29/03/2027');
  assert.equal(todayInItaly(spring, -1), '28/03/2027');
  assert.equal(todayInItaly(new Date('2026-03-01T12:00:00Z'), -1), '28/02/2026');
});

test('reports every problem at once', () => {
  try {
    guestToRecord({ surname: '', given: 'A', sex: 'X', dob: '31.02.1990', nationality: 'Narnia', nights: 40 }, { now: NOW });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err.errors.length >= 5, err.message);
    assert.match(err.message, /surname missing/);
    assert.match(err.message, /sex must be M or F/);
    assert.match(err.message, /date of birth/);
    assert.match(err.message, /unknown nationality "Narnia"/);
    assert.match(err.message, /nights must be between 1 and 30/);
  }
});

test('long names are rejected, not silently truncated', () => {
  assert.throws(() => guestToRecord({ ...czech, given: 'A'.repeat(31) }, { now: NOW }), /given name longer/);
});

test('record is pure ASCII after cleaning (so 168 chars == 168 bytes)', () => {
  const r = guestToRecord({ ...czech, surname: 'Ördög-Smith/Jones', given: "Siobhán O'Neil" }, { now: NOW });
  assert.match(r, /^[\x20-\x7e]{168}$/);
  assert.equal(fields(r).surname.trim(), 'ORDOG SMITH JONES');
  assert.equal(fields(r).given.trim(), 'SIOBHAN O NEIL');
});

test('cleanName / toItalianDate helpers', () => {
  assert.equal(cleanName('  müller,  hans '), 'MULLER HANS');
  assert.equal(cleanName('Jean-Pierre'), 'JEAN PIERRE');
  assert.equal(cleanName('St. John-Smith, Jr.'), 'ST JOHN SMITH JR');
  assert.equal(cleanName('D’Angelo'), 'D ANGELO');
  assert.equal(toItalianDate('3.7.1995'), '03/07/1995');
  assert.equal(toItalianDate('1995-07-03'), '03/07/1995');
  assert.equal(toItalianDate('31.02.1995'), '');
  assert.equal(toItalianDate(''), '');
});

test('resolveState accepts ISO3, MRZ codes, Italian and English names', () => {
  assert.equal(resolveState('CZE'), '100000257');
  assert.equal(resolveState('D'), '100000216');
  assert.equal(resolveState('GBR'), '100000219');
  assert.equal(resolveState('United Kingdom'), '100000219');
  assert.equal(resolveState('british'), '100000219');
  assert.equal(resolveState("STATI UNITI D'AMERICA"), '100000536');
  assert.equal(resolveState('usa'), '100000536');
  assert.equal(resolveState('100000100'), ITALIA);
  assert.equal(resolveState('100000210'), ''); // Czechoslovakia: no longer valid
  assert.equal(resolveState('JEY'), ''); // Jersey: not in the Alloggiati table
  assert.equal(resolveState(''), '');
});

test('every ISO3 mapping points at a valid state in the official table', async () => {
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/registration/it/alloggiati.js', import.meta.url), 'utf8'));
  const block = src.slice(src.indexOf('const ISO3_TO_STATO'), src.indexOf('};', src.indexOf('const ISO3_TO_STATO')));
  const names = [...block.matchAll(/\b[A-Z]{1,3}: (['"])(.+?)\1/g)].map(m => m[2]);
  assert.ok(names.length > 200);
  const valid = new Set(Object.values(STATI));
  for (const n of names) assert.ok(valid.has(n), `not in table: ${n}`);
});

test('resolveComune needs a province when the name is ambiguous', () => {
  assert.deepEqual(resolveComune('la spezia'), { code: '407011015', prov: 'SP' });
  assert.equal(resolveComune('Nowhere'), null);
  // SAN TEODORO exists in both ME and NU
  assert.equal(resolveComune('San Teodoro'), null);
  assert.equal(resolveComune('San Teodoro', 'nu').prov, 'NU');
  assert.equal(resolveComune('San Teodoro (ME)').prov, 'ME');
});

test('resolveComune ignores accents and punctuation as printed on documents', () => {
  const aglie = resolveComune("AGLIE'");
  assert.ok(aglie);
  assert.deepEqual(resolveComune('Agliè'), aglie);
  assert.deepEqual(resolveComune('Aci Sant’Antonio'), resolveComune("ACI SANT'ANTONIO"));
  assert.deepEqual(resolveComune('Bellaria Igea Marina'), resolveComune('BELLARIA-IGEA MARINA'));
  assert.equal(resolveComune('La Spezia.', 'SP').prov, 'SP');
});

test('resolveDocType', () => {
  assert.equal(resolveDocType(''), 'PASOR');
  assert.equal(resolveDocType('passport'), 'PASOR');
  assert.equal(resolveDocType('id_card'), 'IDENT');
  assert.equal(resolveDocType('paten'), 'PATEN');
  assert.equal(resolveDocType('bogus'), '');
});

// ===== SOAP =====

function fakeFetch(responseXml, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => responseXml };
  };
}

test('generateToken sends credentials and reads the token', async () => {
  const calls = [];
  const xml = `<soap:Envelope><soap:Body><GenerateTokenResponse xmlns="AlloggiatiService"><GenerateTokenResult>
    <issued>2021-11-12T13:13:47</issued><expires>2021-11-12T14:13:47</expires><token>TOK&amp;EN</token>
    </GenerateTokenResult><result><esito>true</esito><ErroreCod/><ErroreDes/><ErroreDettaglio/></result>
    </GenerateTokenResponse></soap:Body></soap:Envelope>`;
  const res = await generateToken({ user: 'XX002458', password: 'p<w', wskey: 'KEY' }, fakeFetch(xml, calls));
  assert.equal(res.token, 'TOK&EN');
  assert.match(calls[0].init.body, /<Password>p&lt;w<\/Password>/);
  assert.equal(calls[0].init.headers.SOAPAction, '"AlloggiatiService/GenerateToken"');
});

test('generateToken surfaces the portal error', async () => {
  const xml = `<GenerateTokenResponse><GenerateTokenResult/><result><esito>false</esito><ErroreCod>3</ErroreCod>
    <ErroreDes>AUTENTICAZIONE_FALLITA</ErroreDes><ErroreDettaglio>WSKEY non valida</ErroreDettaglio></result></GenerateTokenResponse>`;
  await assert.rejects(generateToken({ user: 'u', password: 'p', wskey: 'k' }, fakeFetch(xml, [])), /WSKEY non valida/);
});

test('submitRecords (Test) parses per-row results like the manual example', async () => {
  const calls = [];
  const xml = `<TestResponse xmlns="AlloggiatiService"><TestResult><esito>true</esito><ErroreCod/><ErroreDes/><ErroreDettaglio/></TestResult>
    <result><SchedineValide>1</SchedineValide><Dettaglio>
      <EsitoOperazioneServizio><esito>false</esito><ErroreCod>11</ErroreCod><ErroreDes>SCHEDINA_FORMATO_NON_CORRETTO</ErroreDes><ErroreDettaglio>Dimensione Riga errata</ErroreDettaglio></EsitoOperazioneServizio>
      <EsitoOperazioneServizio><esito>true</esito><ErroreCod/><ErroreDes/><ErroreDettaglio/></EsitoOperazioneServizio>
    </Dettaglio></result></TestResponse>`;
  const res = await submitRecords({ user: 'u', token: 't', records: ['a', 'b'], mode: 'test' }, fakeFetch(xml, calls));
  assert.equal(res.ok, false);
  assert.equal(res.valid, 1);
  assert.equal(res.rows[0].ok, false);
  assert.equal(res.rows[0].detail, 'Dimensione Riga errata');
  assert.equal(res.rows[1].ok, true);
  assert.match(calls[0].init.body, /<Test xmlns="AlloggiatiService">.*<string>a<\/string><string>b<\/string>/s);
});

test('submitRecords uses Send only when asked', async () => {
  const calls = [];
  const xml = `<SendResult><esito>true</esito></SendResult><result><SchedineValide>1</SchedineValide><Dettaglio>
    <EsitoOperazioneServizio><esito>true</esito></EsitoOperazioneServizio></Dettaglio></result>`;
  const res = await submitRecords({ user: 'u', token: 't', records: ['a'], mode: 'send' }, fakeFetch(xml, calls));
  assert.equal(res.ok, true);
  assert.equal(calls[0].init.headers.SOAPAction, '"AlloggiatiService/Send"');
});

test('Italian citizen born abroad: no comune asked, birth country from the place or its own field', () => {
  const italianBornInArgentina = {
    surname: 'Rossi', given: 'Silvia', sex: 'F', dob: '02.02.1990', nationality: 'ITA',
    docType: 'passport', docNumber: 'YA1234567', country: 'ITA', issuePlace: 'La Spezia', issueProvince: 'SP',
  };
  const argentina = resolveState('ARG');
  // As the passport prints it.
  let f = fields(guestToRecord({ ...italianBornInArgentina, birthPlace: 'BUENOS AIRES (ARG)' }, { now: NOW }));
  assert.equal(f.birthState, argentina);
  assert.equal(f.birthComune.trim(), '');
  assert.equal(f.birthProv.trim(), '');
  assert.equal(f.citizenship, ITALIA);
  // Typed in by staff.
  f = fields(guestToRecord({ ...italianBornInArgentina, birthPlace: 'Buenos Aires', birthCountry: 'Argentina' }, { now: NOW }));
  assert.equal(f.birthState, argentina);
  assert.equal(f.birthComune.trim(), '');
  // A foreign city without a country: a clear message, not "add the province".
  assert.throws(() => guestToRecord({ ...italianBornInArgentina, birthPlace: 'Buenos Aires' }, { now: NOW }),
    /not an Italian comune.*Born in \(country\)/);
  // An Italian comune still works as before.
  f = fields(guestToRecord({ ...italianBornInArgentina, birthPlace: 'La Spezia' }, { now: NOW }));
  assert.equal(f.birthState, ITALIA);
  assert.equal(f.birthProv, 'SP');
});

test('Italian passport issued by a consulate abroad: place of issue is that country', () => {
  const g = {
    surname: 'Rossi', given: 'Silvia', sex: 'F', dob: '02.02.1990', nationality: 'ITA', birthCountry: 'ARG',
    docType: 'passport', docNumber: 'YA1234567', country: 'ITA',
  };
  assert.equal(fields(guestToRecord({ ...g, issuePlace: 'ARG' }, { now: NOW })).issuePlace, resolveState('ARG'));
  assert.equal(fields(guestToRecord({ ...g, issuePlace: 'Buenos Aires, Argentina' }, { now: NOW })).issuePlace, resolveState('ARG'));
  assert.throws(() => guestToRecord({ ...g, issuePlace: '' }, { now: NOW }), /consulate abroad/);
});

test('stateInPlace reads the country out of a printed place', () => {
  assert.equal(stateInPlace('BUENOS AIRES (ARG)'), resolveState('ARG'));
  assert.equal(stateInPlace('Buenos Aires Argentina'), resolveState('ARG'));
  assert.equal(stateInPlace('ROSARIO, ARGENTINA'), resolveState('ARG'));
  assert.equal(stateInPlace('Buenos Aires'), '');
  assert.equal(stateInPlace(''), '');
});
