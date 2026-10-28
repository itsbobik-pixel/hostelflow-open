import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { cleanup, todayIn } from '../src/guests.js';
import { createD1 } from './helpers/d1.js';
import Anthropic from '@anthropic-ai/sdk';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const PHOTO = 'data:image/jpeg;base64,' + btoa('fake jpeg bytes');
const OCR_FIELDS = {
  surname: 'Novak', given: 'Jan', sex: 'M', dob: '01.01.1990', nationality: 'CZE',
  docType: 'passport', docNumber: 'AB123456', country: 'CZE',
};

let env, realFetch, portal, ocrCalls;
beforeEach(() => {
  ocrCalls = 0;
  env = {
    DB: createD1(),
    ASSETS: { fetch: async () => new Response('app') },
    CREDENTIALS_KEY: KEY,
    readDocument: async (_env, image) => {
      ocrCalls++;
      if (image.data === btoa('unreadable')) throw new Error('boom');
      return { fields: { ...OCR_FIELDS }, confidence: 'high', notes: '', usage: { input_tokens: 2000, output_tokens: 300 } };
    },
  };
  // Fake Alloggiati: every record passes unless its surname contains "REJECT".
  portal = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const action = init.headers.SOAPAction.replace(/"/g, '').split('/')[1];
    const records = [...init.body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(m => m[1]);
    portal.push({ action, records });
    const ok = '<esito>true</esito>';
    let xml;
    if (action === 'GenerateToken') {
      xml = `<GenerateTokenResult><token>T</token></GenerateTokenResult><result>${ok}</result>`;
    } else {
      const rows = records.map(r => r.includes('REJECT')
        ? '<EsitoOperazioneServizio><esito>false</esito><ErroreDes>DOCUMENTO NON VALIDO</ErroreDes></EsitoOperazioneServizio>'
        : `<EsitoOperazioneServizio>${ok}</EsitoOperazioneServizio>`).join('');
      xml = `<${action}Result>${ok}</${action}Result><result><Dettaglio>${rows}</Dettaglio></result>`;
    }
    return { ok: true, status: 200, text: async () => xml };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

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
    const type = res.headers.get('Content-Type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

async function setup({ registration = true } = {}) {
  const call = client();
  const r = await call('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'correct horse', propertyName: 'Costello', acceptTerms: true });
  const pid = r.data.properties[0].id;
  if (registration) {
    await call('PUT', `/api/properties/${pid}/settings`, {
      registration: 'it-alloggiati', credentials: { user: 'u', password: 'p', wskey: 'k' },
    });
  }
  return { call, pid, base: `/api/properties/${pid}/guests` };
}

test('scanning a document creates a ready guest with today as arrival', async () => {
  const { call, pid, base } = await setup();
  const r = await call('POST', base, { image: PHOTO });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'draft');
  assert.equal(r.data.fields.surname, 'Novak');
  assert.equal(r.data.fields.arrival, todayIn('Europe/Rome'));
  assert.deepEqual(r.data.problems, []);
  assert.equal(r.data.hasPhoto, true);
  assert.equal(r.data.ocr.confidence, 'high');

  const photo = await call('GET', `${base}/${r.data.id}/photo`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(photo.data, 'fake jpeg bytes');

  const usage = await call('GET', `/api/properties/${pid}/usage`);
  assert.equal(usage.data.months[0].scans, 1);
  assert.equal(usage.data.limit, (Date.now() < Date.parse('2026-10-28T00:00:00+01:00') ? 500 : 200)); // the free trial's cap (500 before 28. 10. 2026)
  await env.DB.prepare("UPDATE properties SET billing_status = 'active' WHERE id = ?").bind(pid).run();
  assert.equal((await call('GET', `/api/properties/${pid}/usage`)).data.limit, 10000); // paying: the usual one
  assert.deepEqual(Object.keys(usage.data.months[0]).sort(), ['month', 'scans'], 'what scans cost is not shown to hostels');
  const cost = await env.DB.prepare('SELECT input_tokens, cost_micro FROM usage_monthly WHERE property_id = ?').bind(pid).first();
  assert.equal(cost.input_tokens, 2000);
  assert.equal(cost.cost_micro, 2000 * 2 + 300 * 10, 'counted for our reports');

  const list = await call('GET', base);
  assert.deepEqual(list.data.map(g => g.id), [r.data.id]);
});

test('unreadable document still creates a guest for manual entry', async () => {
  const { call, base } = await setup();
  const r = await call('POST', base, { image: 'data:image/jpeg;base64,' + btoa('unreadable') });
  assert.equal(r.status, 201);
  assert.match(r.data.ocr.error, /could not be read/);
  assert.ok(r.data.problems.some(p => /surname/.test(p)));
});

test('a wrongly set up API key is reported as a setup problem, not a bad photo', async () => {
  const { call, base } = await setup();
  env.readDocument = async () => {
    const err = Object.create(Anthropic.BadRequestError.prototype);
    err.message = '400 This API key is not scoped to a workspace';
    throw err;
  };
  const r = await call('POST', base, { image: PHOTO });
  assert.equal(r.status, 201);
  assert.match(r.data.ocr.error, /document reading isn't working/);
});

test('the free trial\'s 200 scans are for the whole trial, not per month', async () => {
  const { call, pid, base } = await setup();
  // Signed up after the 200 came in (28. 10. 2026); 199 used in an earlier month: one more, then no more.
  await env.DB.prepare('UPDATE properties SET created_at = ?').bind(Date.parse('2026-11-02T10:00:00Z')).run();
  await env.DB.prepare("INSERT INTO usage_monthly (property_id, month, scans) VALUES (?, '2026-01', 199)").bind(pid).run();
  await call('POST', base, { image: PHOTO });
  const over = (await call('POST', base, { image: PHOTO })).data;
  assert.equal(ocrCalls, 1);
  assert.match(over.ocr.error, /200 free document scans are used up/);
  const usage = (await call('GET', `/api/properties/${pid}/usage`)).data;
  assert.equal(usage.trial, true);
  assert.equal(usage.used, 200);
  // Signed up before it: 500 for the trial (to 31. 12.).
  await env.DB.prepare('UPDATE properties SET created_at = ?').bind(Date.parse('2026-10-20T10:00:00Z')).run();
  await call('POST', base, { image: PHOTO });
  assert.equal(ocrCalls, 2);
  assert.equal((await call('GET', `/api/properties/${pid}/usage`)).data.limit, 500);
  // Paying: the month counts again.
  await env.DB.prepare("UPDATE properties SET billing_status = 'active'").run();
  await call('POST', base, { image: PHOTO });
  assert.equal(ocrCalls, 3);
});

test('monthly scan limit: over it the photo is kept but not read by AI; comp has no limit', async () => {
  const { call, pid, base } = await setup();
  await env.DB.prepare('UPDATE properties SET scan_limit = 2').run();
  await call('POST', base, { image: PHOTO });
  await call('POST', base, { image: PHOTO });
  const third = (await call('POST', base, { image: PHOTO })).data;
  assert.equal(ocrCalls, 2);
  assert.match(third.ocr.error, /monthly limit of 2/);
  assert.equal(third.hasPhoto, true);
  assert.equal((await call('GET', `/api/properties/${pid}/usage`)).data.months[0].scans, 2);

  await env.DB.prepare("UPDATE properties SET billing_status = 'comp'").run();
  await call('POST', base, { image: PHOTO });
  assert.equal(ocrCalls, 3);
  assert.equal((await call('GET', `/api/properties/${pid}/usage`)).data.limit, null);
});

test('bad images are rejected before anything is stored', async () => {
  const { call, base } = await setup();
  assert.equal((await call('POST', base, { image: 'data:text/html;base64,PGI+' })).status, 400);
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(1_500_004);
  assert.equal((await call('POST', base, { image: huge })).status, 413);
  assert.equal((await call('GET', base)).data.length, 0);
  assert.equal(ocrCalls, 0);
});

test('editing keeps only known fields and re-validates', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  const r = await call('PUT', `${base}/${g.id}`, { fields: { ...g.fields, nationality: 'Atlantis', hack: 'x', nights: 3 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.fields.hack, undefined);
  assert.equal(r.data.fields.nights, '3');
  assert.ok(r.data.problems.some(p => /nationality/.test(p)));
  assert.equal((await call('PUT', `${base}/${g.id}`, { fields: { surname: ['x'] } })).status, 400);
});

test('test mode checks with the portal but registers nothing', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  const r = await call('POST', `${base}/send`, { ids: [g.id], mode: 'test' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.deepEqual(portal.map(p => p.action), ['GenerateToken', 'Test']);
  const after = (await call('GET', base)).data[0];
  assert.equal(after.status, 'draft');
  assert.equal(after.lastCheck.ok, true);
});

test('send registers, deletes the photo and locks the guest', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  const r = await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });
  assert.equal(r.data.mode, 'send');
  assert.equal(r.data.ok, true);
  assert.deepEqual(portal.map(p => p.action), ['GenerateToken', 'Test', 'GenerateToken', 'Send']);
  assert.equal(portal[3].records[0].length, 168);

  assert.deepEqual((await call('GET', base)).data, [], 'registered guests leave the check-in list');
  const row = await env.DB.prepare('SELECT status, sent_at FROM guests WHERE id = ?').bind(g.id).first();
  assert.equal(row.status, 'sent');
  assert.ok(row.sent_at);
  assert.equal((await call('GET', `${base}/${g.id}/photo`)).status, 404);
  assert.equal((await call('PUT', `${base}/${g.id}`, { fields: {} })).status, 409);
  assert.equal((await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' })).status, 409);
});

test('if one guest fails the test, nobody is sent', async () => {
  const { call, base } = await setup();
  const a = (await call('POST', base, { image: PHOTO })).data;
  const b = (await call('POST', base, { fields: { ...OCR_FIELDS, surname: 'Reject', docNumber: 'ZZ999' } })).data;
  const r = await call('POST', `${base}/send`, { ids: [a.id, b.id], mode: 'send' });
  assert.equal(r.data.mode, 'test');
  assert.equal(r.data.ok, false);
  assert.match(r.data.results.find(x => x.id === b.id).errors[0], /DOCUMENTO NON VALIDO/);
  assert.ok(!portal.some(p => p.action === 'Send'));
  const list = (await call('GET', base)).data;
  assert.ok(list.every(g => g.status === 'draft'));
  assert.equal(list.find(g => g.id === b.id).lastCheck.ok, false);
});

test('families go in leader first; a member alone is refused', async () => {
  const { call, base } = await setup();
  const member = (await call('POST', base, { fields: { ...OCR_FIELDS, given: 'Eva', guestType: '19' } })).data;
  const leader = (await call('POST', base, { fields: { ...OCR_FIELDS, given: 'Petr', guestType: '17' } })).data;
  await call('PUT', `${base}/${member.id}`, { fields: { ...member.fields, groupLeader: leader.id } });

  const alone = await call('POST', `${base}/send`, { ids: [member.id], mode: 'test' });
  assert.equal(alone.status, 400);
  assert.match(alone.data.error, /Eva Novak/);

  const r = await call('POST', `${base}/send`, { ids: [member.id, leader.id], mode: 'send' });
  assert.equal(r.data.ok, true);
  const sent = portal.find(p => p.action === 'Send').records;
  assert.deepEqual(sent.map(s => s.slice(0, 2)), ['17', '19']);
});

test('a family member belongs to a head of family, a group member to a group leader', async () => {
  const { call, base } = await setup();
  const leader = (await call('POST', base, { fields: { ...OCR_FIELDS, given: 'Petr', guestType: '18' } })).data;
  const member = (await call('POST', base, { fields: { ...OCR_FIELDS, given: 'Eva', guestType: '19', groupLeader: leader.id } })).data;
  const r = await call('POST', `${base}/send`, { ids: [member.id, leader.id], mode: 'test' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /^Eva Novak is a family member — they belong to a head of family, not a group leader$/);
  await call('PUT', `${base}/${leader.id}`, { fields: { ...leader.fields, guestType: '17' } });
  await call('PUT', `${base}/${member.id}`, { fields: { ...member.fields, guestType: '20' } });
  const again = await call('POST', `${base}/send`, { ids: [member.id, leader.id], mode: 'test' });
  assert.match(again.data.error, /^Eva Novak is a group member — they belong to a group leader, not a head of family$/);
  assert.ok(!portal.length, 'nothing went to the portal');
});

test('a registered guest cannot be deleted (the statistics already counted them)', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });
  const r = await call('DELETE', `${base}/${g.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'this guest is already registered');
  assert.ok(await env.DB.prepare('SELECT 1 AS x FROM guests WHERE id = ?').bind(g.id).first());
  // A draft still goes.
  const d = (await call('POST', base, { image: PHOTO })).data;
  assert.equal((await call('DELETE', `${base}/${d.id}`)).status, 200);
});

test('an emptied arrival date: the police get today, and the statistics keep that day', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  const { arrival, ...rest } = g.fields;
  await call('PUT', `${base}/${g.id}`, { fields: rest });
  assert.equal((await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' })).data.ok, true);
  const today = todayIn('Europe/Rome');
  const stored = JSON.parse((await env.DB.prepare('SELECT fields FROM guests WHERE id = ?').bind(g.id).first()).fields);
  assert.equal(stored.arrival, today);
  assert.ok(portal.find(p => p.action === 'Send').records[0].includes(today.replace(/\./g, '/')));
});

test('without police registration set up, guests can be scanned but not sent', async () => {
  const { call, base } = await setup({ registration: false });
  const g = (await call('POST', base, { image: PHOTO })).data;
  assert.deepEqual(g.problems, []);
  const r = await call('POST', `${base}/send`, { ids: [g.id], mode: 'test' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Settings/);
});

test('staff can check in; other properties cannot see the guests', async () => {
  const { call, pid, base } = await setup();
  const gaiaId = (await call('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'staffpass1' })).data.id;
  await call('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'edit' } });
  const staff = client();
  await staff('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'staffpass1' });
  const g = await staff('POST', base, { image: PHOTO });
  assert.equal(g.status, 201);
  assert.equal((await staff('POST', `${base}/send`, { ids: [g.data.id], mode: 'send' })).data.ok, true);
  assert.equal((await staff('GET', `/api/properties/${pid}/usage`)).status, 403);

  const other = client();
  await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  assert.equal((await other('GET', base)).status, 404);
  assert.equal((await other('GET', `${base}/${g.data.id}/photo`)).status, 404);
  const own = (await other('GET', '/api/me')).data.properties[0].id;
  assert.equal((await other('GET', `/api/properties/${own}/guests/${g.data.id}/photo`)).status, 404);
  assert.equal((await other('DELETE', `/api/properties/${own}/guests/${g.data.id}`)).status, 404);
});

test('after sending, only what ISTAT and Ross1000 need is kept (sex and birth for 90 days), plus a keyed document fingerprint', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  await call('PUT', `${base}/${g.id}`, { fields: { ...g.fields, nights: '2' } });
  await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });
  const row = await env.DB.prepare('SELECT fields, doc_hash, ocr FROM guests').first();
  const after = JSON.parse(row.fields);
  assert.ok(Object.keys(after).every(k => ['arrival', 'guestType', 'nationality', 'nights', 'sex', 'dob'].includes(k)), Object.keys(after).join());
  assert.ok(!('surname' in after) && !('given' in after) && !('docNumber' in after));
  await cleanup(env.DB, Date.now() + 91 * 24 * 3600 * 1000);
  const later = JSON.parse((await env.DB.prepare('SELECT fields FROM guests').first()).fields);
  assert.ok(!('dob' in later) && !('sex' in later), 'the statistics fields go after 90 days');
  assert.equal(after.nights, '2');
  assert.equal(row.ocr, null);
  assert.ok(!row.fields.includes('Novak') && !row.fields.includes('AB123456'));
  assert.ok(row.doc_hash && !row.doc_hash.includes('AB123456'));
});

test('duplicates stop sending until confirmed', async () => {
  const { call, base } = await setup();
  const a = (await call('POST', base, { image: PHOTO })).data;
  const b = (await call('POST', base, { image: PHOTO })).data;

  // Same document twice in one batch.
  const both = await call('POST', `${base}/send`, { ids: [a.id, b.id], mode: 'send' });
  assert.equal(both.status, 409);
  assert.equal(both.data.code, 'duplicate');
  assert.match(both.data.duplicates[0], /same document number/);
  assert.equal(portal.length, 0, 'nothing reached the portal');

  await call('POST', `${base}/send`, { ids: [a.id], mode: 'send' });

  // Same document again later ("d-M-YYYY" spacing and case don't matter).
  await call('PUT', `${base}/${b.id}`, { fields: { ...b.fields, docNumber: 'ab 123-456' } });
  const again = await call('POST', `${base}/send`, { ids: [b.id], mode: 'test' });
  assert.equal(again.status, 409);
  assert.match(again.data.duplicates[0], /already registered on \d\d\.\d\d\.\d{4}/);

  const forced = await call('POST', `${base}/send`, { ids: [b.id], mode: 'send', allowDuplicates: true });
  assert.equal(forced.data.ok, true);
});

test('other properties never match the same document', async () => {
  const { call, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });

  const other = client();
  const r = await other('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'evepass12', propertyName: 'Other', acceptTerms: true });
  const pid2 = r.data.properties[0].id;
  await other('PUT', `/api/properties/${pid2}/settings`, { registration: 'it-alloggiati', credentials: { user: 'eve-login', password: 'p', wskey: 'k' } });
  const g2 = (await other('POST', `/api/properties/${pid2}/guests`, { image: PHOTO })).data;
  const s = await other('POST', `/api/properties/${pid2}/guests/send`, { ids: [g2.id], mode: 'test' });
  assert.equal(s.status, 200);
  const hashes = (await env.DB.prepare('SELECT doc_hash FROM guests WHERE doc_hash IS NOT NULL').all()).results;
  assert.equal(hashes.length, 1);
});

test('ISTAT day from registered guests; early departure fixes the nights', async () => {
  const { call, pid, base } = await setup();
  const g = (await call('POST', base, { image: PHOTO })).data;
  await call('PUT', `${base}/${g.id}`, { fields: { ...g.fields, nights: '3', residenceCountry: 'ITA', residenceProvince: 'SP' } });
  await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });
  const draft = (await call('POST', base, { image: PHOTO })).data; // not registered: doesn't count

  const [d, m, y] = g.fields.arrival.split('.');
  const today = `${y}-${m}-${d}`;
  const r = await call('GET', `/api/properties/${pid}/istat?date=${today}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.totals, { previousNight: 0, arrived: 1, departed: 0, presentTonight: 1 });
  assert.equal(r.data.rows[0].place, 'La Spezia (SP)');

  const tomorrow = new Date(Date.UTC(+y, +m - 1, +d + 1)).toISOString().slice(0, 10);
  assert.equal((await call('GET', `/api/properties/${pid}/istat?date=${tomorrow}`)).data.totals.presentTonight, 1);
  const stay = await call('PUT', `${base}/${g.id}/stay`, { nights: 1 });
  assert.equal(stay.data.fields.nights, '1');
  assert.deepEqual((await call('GET', `/api/properties/${pid}/istat?date=${tomorrow}`)).data.totals,
    { previousNight: 1, arrived: 0, departed: 1, presentTonight: 0 });

  assert.equal((await call('PUT', `${base}/${g.id}/stay`, { nights: 0 })).status, 400);
  assert.equal((await call('GET', `/api/properties/${pid}/istat?date=nope`)).status, 400);
  assert.ok(draft.id);

  // The ISTAT tab lists the registered guests of the day for corrections.
  const day = (await call('GET', `/api/properties/${pid}/istat?date=${today}`)).data;
  assert.deepEqual(day.guests.map(x => x.id), [g.id]);
  assert.equal(day.guests[0].place, 'La Spezia (SP)');
  const moved = await call('PUT', `${base}/${g.id}/stay`, { residenceCountry: 'Germany', residenceProvince: '' });
  assert.equal(moved.data.fields.residenceCountry, 'Germany');
  assert.equal('residenceProvince' in moved.data.fields, false);
  assert.equal((await call('GET', `/api/properties/${pid}/istat?date=${today}`)).data.rows[0].place, 'Germania');
});

test('clear all deletes unsent guests and their photos, keeps registered ones', async () => {
  const { call, base } = await setup();
  const sent = (await call('POST', base, { image: PHOTO })).data;
  await call('POST', `${base}/send`, { ids: [sent.id], mode: 'send' });
  const a = (await call('POST', base, { image: PHOTO })).data;
  const b = (await call('POST', base, { fields: {} })).data;
  const later = (await call('POST', base, { fields: {} })).data; // scanned by a colleague meanwhile
  const r = await call('DELETE', base, { ids: [a.id, b.id, sent.id] });
  assert.equal(r.data.deleted, 2);
  assert.deepEqual((await call('GET', base)).data.map(g => g.id), [later.id]);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM guests WHERE status = 'sent'").first()).n, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM guest_photos').first()).n, 0);
});

test('cleanup removes old photos and stale drafts, keeps sent guests', async () => {
  const { call, base } = await setup();
  const draft = (await call('POST', base, { image: PHOTO })).data;
  const sent = (await call('POST', base, { image: PHOTO })).data;
  await call('POST', `${base}/send`, { ids: [sent.id], mode: 'send' });
  const fresh = (await call('POST', base, { image: PHOTO })).data;
  const old = Date.now() - 4 * 24 * 3600 * 1000;
  await env.DB.prepare('UPDATE guests SET created_at = ? WHERE id IN (?, ?)').bind(old, draft.id, sent.id).run();
  await env.DB.prepare('UPDATE guest_photos SET created_at = ? WHERE guest_id = ?').bind(old, draft.id).run();

  await cleanup(env.DB);
  const ids = (await env.DB.prepare('SELECT id FROM guests ORDER BY created_at').all()).results.map(r => r.id);
  assert.deepEqual(ids.sort(), [sent.id, fresh.id].sort());
  const photos = (await env.DB.prepare('SELECT guest_id FROM guest_photos').all()).results.map(r => r.guest_id);
  assert.deepEqual(photos, [fresh.id]);
});

test('scan limits: 200 in the trial, 10000 paid, none for comp — a limit set by hand wins', async () => {
  const { scanLimit, TRIAL_SCAN_LIMIT, DEFAULT_SCAN_LIMIT } = await import('../src/guests.js');
  assert.equal(scanLimit({}, { billing_status: 'trial' }), TRIAL_SCAN_LIMIT);
  assert.equal(scanLimit({}, { billing_status: 'active' }), DEFAULT_SCAN_LIMIT);
  assert.equal(scanLimit({ SCAN_LIMIT: '5000' }, { billing_status: 'trial' }), TRIAL_SCAN_LIMIT);
  assert.equal(scanLimit({}, { billing_status: 'comp', scan_limit: 50 }), null);
  // A busy beta tester: raised by hand, also while still in the trial.
  assert.equal(scanLimit({}, { billing_status: 'trial', scan_limit: 500 }), 500);
  assert.equal(scanLimit({}, { billing_status: 'active', scan_limit: 2000 }), 2000);
});

test('cheaper model first: when it leaves a needed field empty, the main model reads again and fills only the gaps; cost counted per model', async () => {
  const { call, base } = await setup();
  env.OCR_PRIMARY_MODEL = 'cheap-model';
  const calls = [];
  env.readDocument = async (_env, _image, _client, model) => {
    calls.push(model);
    return model === 'cheap-model'
      ? { fields: { ...OCR_FIELDS, nationality: '', given: 'JAN' }, confidence: 'high', notes: '', usage: { input_tokens: 1000, output_tokens: 100 } }
      : { fields: { ...OCR_FIELDS, given: 'Jann' }, confidence: 'high', notes: '', usage: { input_tokens: 1000, output_tokens: 100 } };
  };
  const g = (await call('POST', base, { image: PHOTO })).data;
  assert.deepEqual(calls, ['cheap-model', 'claude-sonnet-5']);
  assert.equal(g.fields.nationality, 'CZE', 'the gap filled by the main model');
  assert.equal(g.fields.given, 'JAN', 'what the cheaper model read stays');
  const u = await env.DB.prepare('SELECT scans, cost_micro FROM usage_monthly').first();
  assert.equal(u.scans, 1);
  assert.equal(u.cost_micro, 2 * (1000 * 2 + 100 * 10), 'both readings counted (the stand-in has no price of its own, so the main one)');
  // Which needed field the cheaper model left empty is noted (the name only, no value).
  const sh = await env.DB.prepare('SELECT gaps FROM ocr_shadow WHERE guest_id = ?').bind(g.id).first();
  assert.deepEqual(JSON.parse(sh.gaps), ['nationality']);
  // Everything read: no second reading.
  calls.length = 0;
  env.readDocument = async (_env, _image, _client, model) => { calls.push(model); return { fields: { ...OCR_FIELDS }, confidence: 'high', notes: '', usage: {} }; };
  await call('POST', base, { image: PHOTO });
  assert.deepEqual(calls, ['cheap-model']);
});

test('cheaper model first: when the main model read the scan too, its sex wins over the cheaper one', async () => {
  const { call, base } = await setup();
  env.OCR_PRIMARY_MODEL = 'cheap-model';
  env.readDocument = async (_env, _image, _client, model) => model === 'cheap-model'
    ? { fields: { ...OCR_FIELDS, nationality: '', sex: 'M' }, confidence: 'high', notes: '', usage: {} }
    : { fields: { ...OCR_FIELDS, sex: 'F' }, confidence: 'high', notes: '', usage: {} };
  const g = (await call('POST', base, { image: PHOTO })).data;
  assert.equal(g.fields.sex, 'F');
  const sh = await env.DB.prepare('SELECT differs FROM ocr_shadow WHERE guest_id = ?').bind(g.id).first();
  assert.ok(JSON.parse(sh.differs).includes('sex'), 'the comparison still measures the cheaper model');
});

test('cheaper model first: a sex proved by the MRZ needs no second reading and is not overruled', async () => {
  const { call, base } = await setup();
  env.OCR_PRIMARY_MODEL = 'cheap-model';
  env.OCR_SHADOW_RATE = '1';
  const calls = [];
  env.readDocument = async (_env, _image, _client, model) => {
    calls.push(model);
    return model === 'cheap-model'
      ? { fields: { ...OCR_FIELDS, sex: 'F' }, sexFromMrz: true, confidence: 'high', notes: '', usage: {} }
      : { fields: { ...OCR_FIELDS, sex: 'M' }, confidence: 'high', notes: '', usage: {} };
  };
  env.shadowReadDocument = env.readDocument;
  const g = (await call('POST', base, { image: PHOTO })).data;
  assert.equal(g.fields.sex, 'F');
  assert.equal(g.ocr.sexFrom, 'mrz');
  delete env.OCR_SHADOW_RATE; delete env.shadowReadDocument;
  calls.length = 0;
  await call('POST', base, { image: PHOTO });
  assert.deepEqual(calls, ['cheap-model'], 'nothing left empty: no dearer reading');
});

test('the shadow comparison: who was right is judged against what staff checked, and only the verdict stays', async () => {
  const { call, base } = await setup();
  env.OCR_SHADOW_MODEL = 'cheap-model';
  // The cheaper model misreads the surname and gets the document number right
  // where the main model got it wrong; staff correct the number before testing.
  env.shadowReadDocument = async () => ({ fields: { ...OCR_FIELDS, surname: 'ROSSl', docNumber: 'YA1234567' }, usage: { input_tokens: 100, output_tokens: 20 } });
  env.readDocument = async () => ({ fields: { ...OCR_FIELDS, docNumber: 'YA12345G7' }, confidence: 'high', notes: '', usage: { input_tokens: 2000, output_tokens: 300 } });
  const g = (await call('POST', base, { image: PHOTO })).data;
  let row = await env.DB.prepare('SELECT differs, prints, verdict FROM ocr_shadow WHERE guest_id = ?').bind(g.id).first();
  assert.deepEqual(JSON.parse(row.differs).sort(), ['docNumber', 'surname']);
  assert.doesNotMatch(row.prints, /ROSS|YA123/, 'only fingerprints, never the readings');
  await call('PUT', `${base}/${g.id}`, { fields: { ...g.fields, docNumber: 'YA1234567' } });
  await call('POST', `${base}/send`, { ids: [g.id], mode: 'test' });
  row = await env.DB.prepare('SELECT prints, verdict FROM ocr_shadow WHERE guest_id = ?').bind(g.id).first();
  assert.deepEqual(JSON.parse(row.verdict), { surname: 'main', docNumber: 'shadow' });
  assert.ok(row.prints, 'kept until sending (the fields may still change)');
  await call('POST', `${base}/send`, { ids: [g.id], mode: 'send' });
  row = await env.DB.prepare('SELECT prints, verdict FROM ocr_shadow WHERE guest_id = ?').bind(g.id).first();
  assert.equal(row.prints, null);
  assert.deepEqual(JSON.parse(row.verdict), { surname: 'main', docNumber: 'shadow' });
});

test('the shadow comparison keeps only the names of fields read differently', async () => {
  const { shadowDiff } = await import('../src/guests.js');
  assert.deepEqual(shadowDiff({ surname: 'Novak', given: 'Jan', dob: '01.01.1990', docNumber: 'AB1' }, { surname: 'NOVAK ', given: 'Jan', dob: '01.01.1991', docNumber: 'AB1', sex: 'M' }), ['sex', 'dob']);
});
