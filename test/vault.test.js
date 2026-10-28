import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';
import { disposition } from '../src/vault.js';

// R2 stand-in: what the Vault uses of it (put, get, delete of one key or many).
function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, opts) { objects.set(key, { bytes: new Uint8Array(value), type: opts?.httpMetadata?.contentType }); },
    async get(key) { const o = objects.get(key); return o ? { body: o.bytes, httpMetadata: { contentType: o.type } } : null; },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
  };
}

let env;
beforeEach(() => { env = { DB: createD1(), VAULT: fakeR2(), ASSETS: { fetch: async () => new Response('app') } }; });

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    const raw = body instanceof Uint8Array;
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://hf.example' + path, {
      method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    }), env);
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    const isJson = (res.headers.get('Content-Type') || '').startsWith('application/json');
    return { status: res.status, headers: res.headers, data: isJson ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
  };
}

async function team() {
  const bob = client();
  const pid = (await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const gaiaId = (await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' })).data.id;
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  return { bob, gaia, pid, gaiaId };
}

const upload = (who, pid, name, bytes, folder) =>
  who('POST', `/api/properties/${pid}/vault/files${folder ? `?folder=${folder}` : ''}`, bytes, { 'X-Vault-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' });

test('folders, pages and files: add, view, search, rename, move, delete', async () => {
  const { bob, gaia, pid } = await team();
  const v = `/api/properties/${pid}/vault`;
  const folder = (await bob('POST', `${v}/folders`, { name: 'Procedures' })).data;
  const page = await bob('POST', `${v}/pages`, { title: 'Closing the bar', body: 'Lock the fridge\n- keys in the drawer', folderId: folder.id });
  assert.equal(page.status, 201);
  const pdf = new TextEncoder().encode('%PDF-1.4 fake');
  const file = await upload(bob, pid, 'Fire exits — piano 1.pdf', pdf, folder.id);
  assert.equal(file.status, 201);
  assert.equal(file.data.inline, true);
  assert.equal(env.VAULT.objects.size, 1);
  assert.ok([...env.VAULT.objects.keys()][0].startsWith(`${pid}/`));

  // Everyone on the team reads it: the list, a page, the file.
  const list = (await gaia('GET', v)).data;
  assert.equal(list.canEdit, false);
  assert.deepEqual(list.folders.map(f => f.name), ['Procedures']);
  assert.equal(list.items.length, 2);
  assert.equal(list.items.find(i => i.kind === 'page').body, undefined, 'no page text in the list');
  assert.equal((await gaia('GET', `${v}/items/${page.data.id}`)).data.body, 'Lock the fridge\n- keys in the drawer');
  const got = await gaia('GET', `${v}/items/${file.data.id}/file`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.data, pdf);
  assert.equal(got.headers.get('Content-Type'), 'application/pdf');
  assert.match(got.headers.get('Content-Disposition'), /^inline; filename="Fire exits _ piano 1.pdf"; filename\*=UTF-8''Fire%20exits%20%E2%80%94%20piano%201\.pdf$/);
  assert.equal(got.headers.get('Cache-Control'), 'private, no-store');
  assert.match(got.headers.get('Content-Security-Policy'), /default-src 'self'/, 'the CSP stays on files too');
  assert.match((await gaia('GET', `${v}/items/${file.data.id}/file?download=1`)).headers.get('Content-Disposition'), /^attachment;/);

  // Search: titles, file names and page text, any case.
  const search = async q => (await gaia('GET', `${v}?q=${encodeURIComponent(q)}`)).data.items.map(i => i.title);
  assert.deepEqual(await search('FRIDGE'), ['Closing the bar']);
  assert.deepEqual(await search('fire exits'), ['Fire exits — piano 1.pdf']);
  assert.deepEqual(await search('nothing like this'), []);

  // Rename (a file keeps its ending), move out of the folder, edit the text.
  let r = await bob('PUT', `${v}/items/${file.data.id}`, { title: 'Evacuation plan', folderId: null });
  assert.deepEqual([r.status, r.data.title, r.data.folderId], [200, 'Evacuation plan.pdf', null]);
  r = await bob('PUT', `${v}/items/${page.data.id}`, { body: 'New text' });
  assert.equal((await bob('GET', `${v}/items/${page.data.id}`)).data.body, 'New text');
  assert.equal((await bob('PUT', `${v}/items/${page.data.id}`, { folderId: 'nope' })).status, 400);
  assert.equal((await bob('PUT', `${v}/folders/${folder.id}`, { name: 'How we do things' })).data.name, 'How we do things');

  // Deleting a file deletes the R2 object too; a folder takes what's in it.
  const second = await upload(bob, pid, 'menu.png', new Uint8Array([1, 2, 3]), folder.id);
  assert.equal(env.VAULT.objects.size, 2);
  assert.equal((await bob('DELETE', `${v}/items/${file.data.id}`)).status, 200);
  assert.equal(env.VAULT.objects.size, 1);
  assert.equal((await bob('GET', `${v}/items/${file.data.id}/file`)).status, 404);
  r = await bob('DELETE', `${v}/folders/${folder.id}`);
  assert.deepEqual([r.status, r.data.deleted], [200, 1]);
  assert.equal(env.VAULT.objects.size, 0);
  assert.equal((await bob('GET', `${v}/items/${second.data.id}`)).status, 404);
  assert.equal((await bob('GET', `${v}/items/${page.data.id}`)).status, 404, 'the page went with its folder');
});

test('files: only allowed kinds, at most 10 MB, office documents always download', async () => {
  const { bob, pid } = await team();
  assert.equal((await upload(bob, pid, 'evil.html', new Uint8Array([60]))).status, 415);
  assert.equal((await upload(bob, pid, 'logo.svg', new Uint8Array([60]))).status, 415);
  assert.equal((await upload(bob, pid, 'noending', new Uint8Array([60]))).status, 415);
  assert.equal((await upload(bob, pid, 'empty.pdf', new Uint8Array(0))).status, 400);
  assert.equal((await upload(bob, pid, 'big.pdf', new Uint8Array(10 * 1024 * 1024 + 1))).status, 413);
  // Without the header (e.g. a form on another site) nothing is stored.
  assert.equal((await bob('POST', `/api/properties/${pid}/vault/files`, new Uint8Array([1]), { 'Content-Type': 'application/pdf' })).status, 400);
  const doc = await upload(bob, pid, 'contract.docx', new Uint8Array([80, 75]));
  assert.equal(doc.data.inline, false);
  const got = await bob('GET', `/api/properties/${pid}/vault/items/${doc.data.id}/file`);
  assert.match(got.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(got.headers.get('Content-Type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(env.VAULT.objects.size, 1);
});

test('without the R2 bucket: pages work, files say storage is not set up', async () => {
  const { bob, pid } = await team();
  delete env.VAULT;
  assert.equal((await bob('GET', `/api/properties/${pid}/vault`)).data.files, false);
  assert.equal((await bob('POST', `/api/properties/${pid}/vault/pages`, { title: 'Wi-Fi', body: 'costello2026' })).status, 201);
  assert.equal((await upload(bob, pid, 'a.pdf', new Uint8Array([1]))).status, 503);
});

test('editing needs the Vault at Edit; the owner can set it', async () => {
  const { bob, gaia, pid, gaiaId } = await team();
  const v = `/api/properties/${pid}/vault`;
  assert.ok((await bob('GET', '/api/me')).data.properties[0].can.includes('vault'));
  const page = (await bob('POST', `${v}/pages`, { title: 'Contacts', body: 'Plumber' })).data;
  for (const [method, path, body] of [
    ['POST', `${v}/folders`, { name: 'x' }],
    ['POST', `${v}/pages`, { title: 'x' }],
    ['PUT', `${v}/items/${page.id}`, { title: 'mine' }],
    ['DELETE', `${v}/items/${page.id}`],
  ]) assert.equal((await gaia(method, path, body)).status, 403, `${method} ${path}`);
  assert.equal((await upload(gaia, pid, 'a.pdf', new Uint8Array([1]))).status, 403);
  assert.equal(env.VAULT.objects.size, 0);

  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'edit', vault: 'edit' } });
  assert.equal((await gaia('GET', v)).data.canEdit, true);
  assert.equal((await gaia('PUT', `${v}/items/${page.id}`, { title: 'Phone numbers' })).status, 200);
  assert.equal((await upload(gaia, pid, 'a.pdf', new Uint8Array([1]))).status, 201);
});

test("another property's Vault is out of reach", async () => {
  const { bob, pid } = await team();
  const page = (await bob('POST', `/api/properties/${pid}/vault/pages`, { title: 'Safe code', body: '1234' })).data;
  const file = (await upload(bob, pid, 'plan.pdf', new Uint8Array([1]))).data;
  const eve = client();
  const evePid = (await eve('POST', '/api/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'eve password', propertyName: 'Other', acceptTerms: true })).data.properties[0].id;
  // Not a member: as if the property didn't exist.
  assert.equal((await eve('GET', `/api/properties/${pid}/vault`)).status, 404);
  assert.equal((await eve('GET', `/api/properties/${pid}/vault/items/${file.id}/file`)).status, 404);
  // Her own property's routes with Bob's ids: nothing found, nothing changed.
  assert.equal((await eve('GET', `/api/properties/${evePid}/vault/items/${page.id}`)).status, 404);
  assert.equal((await eve('GET', `/api/properties/${evePid}/vault/items/${file.id}/file`)).status, 404);
  assert.equal((await eve('PUT', `/api/properties/${evePid}/vault/items/${page.id}`, { title: 'hacked' })).status, 404);
  assert.equal((await eve('DELETE', `/api/properties/${evePid}/vault/items/${file.id}`)).status, 404);
  const folder = (await bob('POST', `/api/properties/${pid}/vault/folders`, { name: 'Bob only' })).data;
  assert.equal((await eve('POST', `/api/properties/${evePid}/vault/pages`, { title: 'x', folderId: folder.id })).status, 400);
  assert.equal((await eve('DELETE', `/api/properties/${evePid}/vault/folders/${folder.id}`)).status, 404);
  assert.deepEqual((await eve('GET', `/api/properties/${evePid}/vault?q=safe`)).data.items, []);
  assert.equal(env.VAULT.objects.size, 1);
  assert.equal((await bob('GET', `/api/properties/${pid}/vault/items/${page.id}`)).data.title, 'Safe code');
  // Signed out: nothing.
  assert.equal((await client()('GET', `/api/properties/${pid}/vault`)).status, 401);
});

test('the download name is safe in the header', () => {
  assert.equal(disposition('attachment', 'a"b\\c.pdf'), `attachment; filename="a_b_c.pdf"; filename*=UTF-8''a%22b%5Cc.pdf`);
  assert.equal(disposition('inline', "Città (1)'s.pdf"), `inline; filename="Citt_ (1)'s.pdf"; filename*=UTF-8''Citt%C3%A0%20%281%29%27s.pdf`);
});

test('an owner keeps a folder to chosen people or roles; for others it does not exist', async () => {
  const { bob, gaia, pid, gaiaId } = await team();
  const v = `/api/properties/${pid}/vault`;
  // Marco: staff too, with the vault permission (may edit, but not this folder).
  const marcoId = (await bob('POST', `/api/properties/${pid}/staff`, { name: 'Marco', email: 'marco@example.com', password: 'marco password' })).data.id;
  await bob('PUT', `/api/properties/${pid}/staff/${marcoId}/access`, { levels: { checkin: 'edit', vault: 'edit' } });
  const marco = client();
  await marco('POST', '/api/auth/login', { email: 'marco@example.com', password: 'marco password' });
  // A profile (no e-mail) can be chosen as well.
  const ugoId = (await bob('POST', `/api/properties/${pid}/profiles`, { name: 'Ugo' })).data.id;

  const folder = (await bob('POST', `${v}/folders`, { name: 'Salaries' })).data;
  const page = (await bob('POST', `${v}/pages`, { title: 'Pay day', body: 'secret numbers', folderId: folder.id })).data;
  const file = (await upload(bob, pid, 'payroll.pdf', new Uint8Array([1, 2]), folder.id)).data;
  await bob('POST', `${v}/pages`, { title: 'Open page', body: 'secret but public' });

  // Only the owner sets who sees it; the owner gets the team to choose from.
  assert.equal((await marco('PUT', `${v}/folders/${folder.id}/access`, { access: null })).status, 403);
  const own = (await bob('GET', v)).data;
  assert.deepEqual(own.members.map(m => m.name).sort(), ['Gaia', 'Marco', 'Ugo']);
  assert.equal((await marco('GET', v)).data.members, undefined);
  assert.equal((await bob('PUT', `${v}/folders/${folder.id}/access`, { access: { roles: ['owner'] } })).status, 400);
  assert.equal((await bob('PUT', `${v}/folders/${folder.id}/access`, { access: { users: ['stranger'] } })).status, 400);
  let r = await bob('PUT', `${v}/folders/${folder.id}/access`, { access: { users: [gaiaId, ugoId] } });
  assert.deepEqual(r.data.access, { roles: [], users: [gaiaId, ugoId] });

  // Marco: not listed, not found, every route 404 — even with the vault permission.
  const list = (await marco('GET', v)).data;
  assert.deepEqual(list.folders, []);
  assert.deepEqual(list.items.map(i => i.title), ['Open page']);
  assert.deepEqual((await marco('GET', `${v}?q=secret`)).data.items.map(i => i.title), ['Open page']);
  assert.deepEqual((await marco('GET', `${v}?q=payroll`)).data.items, []);
  assert.equal((await marco('GET', `${v}/items/${page.id}`)).status, 404);
  assert.equal((await marco('GET', `${v}/items/${file.id}/file`)).status, 404);
  assert.equal((await marco('GET', `${v}/items/${file.id}/file?download=1`)).status, 404);
  assert.equal((await marco('PUT', `${v}/items/${page.id}`, { title: 'mine' })).status, 404);
  assert.equal((await marco('DELETE', `${v}/items/${file.id}`)).status, 404);
  assert.equal((await marco('PUT', `${v}/folders/${folder.id}`, { name: 'x' })).status, 404);
  assert.equal((await marco('DELETE', `${v}/folders/${folder.id}`)).status, 404);
  assert.equal((await marco('POST', `${v}/pages`, { title: 'x', folderId: folder.id })).status, 400);
  assert.equal((await upload(marco, pid, 'x.pdf', new Uint8Array([1]), folder.id)).status, 400);
  assert.equal(env.VAULT.objects.size, 1);

  // Gaia was chosen: she sees it (and reads; no editing without the permission).
  const g = (await gaia('GET', v)).data;
  assert.deepEqual(g.folders.map(f => f.name), ['Salaries']);
  assert.equal(g.folders[0].access, undefined, 'only owners see the rule');
  assert.equal((await gaia('GET', `${v}/items/${file.id}/file`)).status, 200);
  assert.deepEqual((await gaia('GET', `${v}?q=numbers`)).data.items.map(i => i.title), ['Pay day']);

  // By role: all staff (Marco too); the owner always sees everything.
  await bob('PUT', `${v}/folders/${folder.id}/access`, { access: { roles: ['volunteer'] } });
  assert.equal((await gaia('GET', `${v}/items/${page.id}`)).status, 404);
  assert.equal((await bob('GET', `${v}/items/${page.id}`)).status, 200);
  assert.equal((await bob('GET', v)).data.items.length, 3);
  await bob('PUT', `${v}/folders/${folder.id}/access`, { access: { roles: ['staff'] } });
  assert.equal((await marco('PUT', `${v}/items/${page.id}`, { title: 'Pay day!' })).status, 200);
  // Back to everyone.
  await bob('PUT', `${v}/folders/${folder.id}/access`, { access: null });
  assert.equal((await gaia('GET', `${v}/items/${page.id}`)).status, 200);
});

test('500 MB for all of a property\'s files together', async () => {
  const { bob, pid } = await team();
  const { VAULT_LIMIT_BYTES } = await import('../src/vault.js');
  assert.equal(VAULT_LIMIT_BYTES, 500 * 1024 * 1024);
  await env.DB.prepare("INSERT INTO vault_items (id, property_id, kind, title, file_key, file_type, file_size, created_at, updated_at) VALUES ('big', ?, 'file', 'big.pdf', 'k', 'application/pdf', ?, 0, 0)")
    .bind(pid, VAULT_LIMIT_BYTES - 10).run();
  assert.equal((await upload(bob, pid, 'fits.pdf', new Uint8Array(10))).status, 201);
  const r = await upload(bob, pid, 'one-too-many.pdf', new Uint8Array(1));
  assert.equal(r.status, 409);
  assert.match(r.data.error, /not enough space/);
  const v = (await bob('GET', `/api/properties/${pid}/vault`)).data;
  assert.deepEqual([v.used, v.limit], [VAULT_LIMIT_BYTES, VAULT_LIMIT_BYTES]);
});

test('files sent at the same moment cannot take the Vault past 500 MB together', async () => {
  const { bob, pid } = await team();
  const { VAULT_LIMIT_BYTES } = await import('../src/vault.js');
  await env.DB.prepare("INSERT INTO vault_items (id, property_id, kind, title, file_key, file_type, file_size, created_at, updated_at) VALUES ('big', ?, 'file', 'big.pdf', 'k', 'application/pdf', ?, 0, 0)")
    .bind(pid, VAULT_LIMIT_BYTES - 10).run();
  // Another upload lands while this one is being stored: both passed the check before.
  const put = env.VAULT.put;
  env.VAULT.put = async (...args) => {
    await env.DB.prepare("INSERT INTO vault_items (id, property_id, kind, title, file_key, file_type, file_size, created_at, updated_at) VALUES ('other', ?, 'file', 'other.pdf', 'k2', 'application/pdf', 6, 0, 0)").bind(pid).run();
    return put(...args);
  };
  const r = await upload(bob, pid, 'second.pdf', new Uint8Array(6));
  assert.equal(r.status, 409);
  assert.match(r.data.error, /not enough space/);
  assert.equal(env.VAULT.objects.size, 0, 'the refused file is not left in storage');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM vault_items WHERE property_id = ?').bind(pid).first()).n, 2);
});
