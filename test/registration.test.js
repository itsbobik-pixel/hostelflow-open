import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRegistrationModule, REGISTRATION_MODULES } from '../src/registration/index.js';
import { todayInItaly } from '../src/registration/it/alloggiati.js';

const guest = {
  id: 'g1',
  fields: {
    surname: 'Novak', given: 'Jan', sex: 'M', dob: '01.01.1990', nationality: 'CZE',
    country: 'CZE', docNumber: 'AB123', arrival: todayInItaly().replace(/\//g, '.'),
  },
};

test('every module has the common shape', () => {
  for (const m of Object.values(REGISTRATION_MODULES)) {
    assert.equal(typeof m.validate, 'function');
    assert.equal(typeof m.submit, 'function');
    assert.equal(typeof m.checkCredentials, 'function');
    assert.ok(Array.isArray(m.credentialFields));
  }
  assert.throws(() => getRegistrationModule('xx'), /unknown/);
});

test('italy: validate works offline', () => {
  const m = getRegistrationModule('it-alloggiati');
  assert.equal(m.validate(guest).record.length, 168);
  assert.equal(m.validate({ id: 'x', fields: {} }).ok, false);
});

test('italy: submit only sends valid guests and never returns the raw record', async () => {
  const actions = [];
  const ok = '<esito>true</esito>';
  const fakeFetch = async (url, init) => {
    const action = init.headers.SOAPAction.replace(/"/g, '').split('/')[1];
    actions.push(action);
    const xml = action === 'GenerateToken'
      ? `<GenerateTokenResult><token>T</token></GenerateTokenResult><result>${ok}</result>`
      : `<${action}Result>${ok}</${action}Result><result><Dettaglio><EsitoOperazioneServizio>${ok}</EsitoOperazioneServizio></Dettaglio></result>`;
    return { ok: true, status: 200, text: async () => xml };
  };
  const res = await getRegistrationModule('it-alloggiati').submit(
    { user: 'u', password: 'p', wskey: 'k' }, [guest, { id: 'bad', fields: {} }], 'test', fakeFetch);
  assert.deepEqual(actions, ['GenerateToken', 'Test']);
  assert.equal(res.results.find(r => r.id === 'g1').ok, true);
  assert.equal(res.results.find(r => r.id === 'bad').ok, false);
  assert.ok(res.results.every(r => !('record' in r)));
});
