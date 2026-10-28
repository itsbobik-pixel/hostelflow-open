import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDocument, OCR_MODEL } from '../src/ocr.js';
import { mrzSex, checkDigit } from '../src/mrz.js';

function fakeClient(answer, stop_reason = 'end_turn') {
  const calls = [];
  return {
    calls,
    messages: {
      create: async params => {
        calls.push(params);
        return { stop_reason, content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  };
}

const answer = {
  surname: 'NOVAK', given: 'JAN', docNumber: 'AB123', nationality: 'Czech', nationalityCode: 'CZE',
  dob: '01.01.1990', sex: 'M', expiry: '01.01.2030', country: 'Czech Republic', countryCode: '',
  docType: 'passport', birthPlace: '', birthProvince: '', issuePlace: '', issueProvince: '',
  residencePlace: '', residenceProvince: '', confidence: 'high', notes: '',
};

test('sends the image with a JSON schema and maps the answer to guest fields', async () => {
  const client = fakeClient(answer);
  const r = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, client);
  const p = client.calls[0];
  assert.equal(p.model, OCR_MODEL);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.deepEqual(p.thinking, { type: 'disabled' }, 'no paid thinking for plain transcription');
  assert.deepEqual(p.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });
  assert.equal(r.fields.nationality, 'CZE', 'ISO code wins over the printed name');
  assert.equal(r.fields.country, 'Czech Republic', 'falls back to the name without a code');
  assert.equal('birthPlace' in r.fields, false, 'empty fields are dropped');
  assert.equal(r.confidence, 'high');
});

test('Italian ID: birth and issuing comune come through for Alloggiati', async () => {
  const cie = { ...answer, nationalityCode: 'ITA', countryCode: 'ITA', docType: 'electronic_id',
    birthPlace: 'GENOVA', birthProvince: 'GE', issuePlace: 'LA SPEZIA', issueProvince: '' };
  const r = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient(cie));
  assert.equal(r.fields.docType, 'electronic_id');
  assert.equal(r.fields.birthPlace, 'GENOVA');
  assert.equal(r.fields.birthProvince, 'GE');
  assert.equal(r.fields.issuePlace, 'LA SPEZIA');
  assert.equal('issueProvince' in r.fields, false);
});

test('a sex the model did not see on the document is dropped (a gap for the main model), not guessed', async () => {
  const r = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...answer, sexSource: 'not_visible', sex: 'M' }));
  assert.equal('sex' in r.fields, false);
  const seen = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...answer, sexSource: 'mrz', sex: 'F' }));
  assert.equal(seen.fields.sex, 'F');
});

// The ICAO 9303 specimens: born 12.08.1974, F, expires 15.04.2012.
const TD3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
const TD1 = 'I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<';

test('MRZ: the sex is taken only from a line whose date check digits match', () => {
  assert.equal(checkDigit('740812'), '2');
  assert.equal(mrzSex(TD3), 'F');
  assert.equal(mrzSex(TD1), 'F');
  assert.equal(mrzSex(TD3.replace('7408122F', '7408132F')), '', 'a misread birth date: no answer');
  assert.equal(mrzSex(TD3.replace('2F1204159', '2F1204158')), '', 'a misread expiry: no answer');
  assert.equal(mrzSex(TD3.replace('2F12', '2<12')), '', '"<" = not stated');
  assert.equal(mrzSex(' l898902C36UTO 7408122M1204159ZE184226B<<<<<10'), 'M', 'spaces and case do not matter');
  assert.equal(mrzSex(''), '');
});

test('a sex proved by the MRZ wins over the model, also when it said it did not see one', async () => {
  const r = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...answer, mrz: TD3, sexSource: 'not_visible', sex: '' }));
  assert.equal(r.fields.sex, 'F');
  assert.equal(r.sexFromMrz, true);
  const wrong = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...answer, mrz: TD1, sexSource: 'printed', sex: 'M' }));
  assert.equal(wrong.fields.sex, 'F');
  const none = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...answer, mrz: '', sexSource: 'printed', sex: 'M' }));
  assert.equal(none.fields.sex, 'M', 'no MRZ: the model as before');
  assert.equal('sexFromMrz' in none, false);
});

test('a refusal is an error, not empty data', async () => {
  await assert.rejects(readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient(answer, 'refusal')), /could not be read/);
});

test('Italian ID: the residence printed on the card, else the province of the comune that issued it', async () => {
  const card = { ...answer, nationalityCode: 'ITA', countryCode: 'ITA', docType: 'electronic_id', birthPlace: 'MONTEVIDEO', birthCountry: 'URY', issuePlace: 'PISA' };
  const printed = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...card, residencePlace: 'LA SPEZIA', residenceProvince: 'SP' }));
  assert.equal(printed.fields.residenceProvince, 'SP');
  assert.equal(printed.fields.residencePlace, 'LA SPEZIA');
  const issued = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient(card));
  assert.equal(issued.fields.residenceProvince, 'PI', 'issued by Pisa');
  assert.equal('residencePlace' in issued.fields, false);
  const passport = await readDocument({}, { mediaType: 'image/jpeg', data: 'QUJD' }, fakeClient({ ...card, docType: 'passport' }));
  assert.equal('residenceProvince' in passport.fields, false, 'a passport says nothing about where one lives');
});
