import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createD1 } from './helpers/d1.js';

let env;
beforeEach(() => { env = { DB: createD1(), ASSETS: { fetch: async () => new Response('app') } }; });

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
    return { status: res.status, data: await res.json() };
  };
}

// Bob owns the place; Gaia joins as staff.
async function team() {
  const bob = client();
  const pid = (await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'bob password', propertyName: 'Costello', acceptTerms: true })).data.properties[0].id;
  const gaiaId = (await bob('POST', `/api/properties/${pid}/staff`, { name: 'Gaia', email: 'gaia@example.com', password: 'gaia password' })).data.id;
  const gaia = client();
  await gaia('POST', '/api/auth/login', { email: 'gaia@example.com', password: 'gaia password' });
  const bobId = (await bob('GET', '/api/me')).data.user.id;
  return { bob, gaia, pid, gaiaId, bobId };
}

const DEFAULTS = { notes: 'edit', attention: 'read', guidelines: 'read', housekeeping: 'edit', shifts: 'read', calendar: 'read', vault: 'read', police: 'read', team: 'read' };

test('someone new: sees everything but check-in, writes notes, does the housekeeping; no police login', async () => {
  const { bob, gaia, pid } = await team();
  const mine = (await gaia('GET', '/api/me')).data.properties[0];
  assert.deepEqual(mine.can, ['notes', 'housekeeping']);
  assert.deepEqual(mine.sees, ['notes', 'attention', 'guidelines', 'housekeeping', 'shifts', 'calendar', 'vault', 'police', 'team']);
  assert.equal((await bob('GET', '/api/me')).data.properties[0].can.length, 11, 'owners may do everything');
  assert.equal((await gaia('GET', `/api/properties/${pid}/guests`)).status, 403);
  // Police registration to look at: whether it works, never the login.
  const s = await gaia('GET', `/api/properties/${pid}/settings`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.credentials, {});
  assert.equal((await gaia('GET', `/api/properties/${pid}/usage`)).status, 200);
  assert.equal((await gaia('GET', `/api/properties/${pid}/staff`)).status, 200);
  assert.equal((await gaia('GET', `/api/properties/${pid}/invites`)).status, 403);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/settings`, { credentials: { user: 'x' } })).status, 403);
});

test('the owner sets each area: Gaia may do just that', async () => {
  const { bob, gaia, pid, gaiaId, bobId } = await team();
  const r = await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { guidelines: 'edit', team: 'edit', checkin: 'edit', police: 'read' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.can, ['checkin', 'guidelines', 'team']);
  assert.deepEqual((await bob('GET', `/api/properties/${pid}/staff`)).data.find(m => m.id === gaiaId).levels, { checkin: 'edit', guidelines: 'edit', police: 'read', team: 'edit' });

  const s = await gaia('GET', `/api/properties/${pid}/settings`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.credentials, {}, 'no police login without that permission');
  assert.equal((await gaia('PUT', `/api/properties/${pid}/settings`, { routine: '08:00 Opening\nOpen the door' })).status, 200);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/settings`, { credentials: { user: 'x' } })).status, 403);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/settings`, { name: 'Mine now' })).status, 403);
  assert.equal((await gaia('POST', `/api/properties/${pid}/registration/check`, {})).status, 403);

  // Team: anyone but owners; who may do what stays with the owners.
  assert.equal((await gaia('GET', `/api/properties/${pid}/staff`)).status, 200);
  assert.equal((await gaia('POST', `/api/properties/${pid}/invites`, { email: 'new@example.com' })).status, 201);
  assert.equal((await gaia('POST', `/api/properties/${pid}/invites`, { email: 'boss@example.com', role: 'owner' })).status, 403);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { police: 'edit' } })).status, 403);
  assert.equal((await gaia('DELETE', `/api/properties/${pid}/staff/${bobId}`)).status, 403);

  // Nothing of the Dashboard, housekeeping, rota, calendar or Vault: none of it opens.
  const board = (await gaia('GET', `/api/properties/${pid}/board`)).data;
  assert.deepEqual([board.notes, board.attention], [[], []]);
  assert.equal((await gaia('POST', `/api/properties/${pid}/notes`, { text: 'Hi' })).status, 403);
  assert.equal((await gaia('GET', `/api/properties/${pid}/housekeeping`)).status, 403);
  assert.equal((await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-12&days=7`)).status, 403);
  assert.equal((await gaia('GET', `/api/properties/${pid}/vault`)).status, 403);
});

test('levels: check-in to look at only, then to change; unknown areas and levels are dropped', async () => {
  const { bob, gaia, pid, gaiaId } = await team();
  let r = await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'read' } });
  assert.deepEqual([r.data.role, r.data.can, r.data.levels], ['member', [], { checkin: 'read' }]);
  assert.equal((await gaia('GET', `/api/properties/${pid}/guests`)).status, 200);
  assert.equal((await gaia('POST', `/api/properties/${pid}/guests`, { fields: { surname: 'X' } })).status, 403);
  r = await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'edit' } });
  assert.equal((await gaia('POST', `/api/properties/${pid}/guests`, { fields: { surname: 'X' } })).status, 201);
  r = await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { checkin: 'all', everything: 'edit', moderate: 'read', vault: 'read' } });
  assert.deepEqual(r.data.levels, { vault: 'read' });
  assert.equal((await gaia('GET', `/api/properties/${pid}/guests`)).status, 403);
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: ['checkin'] })).status, 400);
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { role: 'king' })).status, 400);
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { role: 'staff' })).status, 400);
});

test('saved before the levels: old roles and ticks keep what they could do', async () => {
  const { gaia, pid, gaiaId } = await team();
  const set = (role, permissions) => env.DB.prepare('UPDATE memberships SET role = ?, permissions = ? WHERE user_id = ? AND property_id = ?').bind(role, permissions, gaiaId, pid).run();
  const mine = async () => (await gaia('GET', '/api/me')).data.properties[0];
  await set('staff', null);
  assert.deepEqual((await mine()).can, ['checkin', 'notes', 'housekeeping', 'calendar']);
  await set('volunteer', null);
  assert.deepEqual((await mine()).can, ['notes', 'housekeeping']);
  assert.ok((await mine()).sees.includes('calendar'));
  await set('staff', JSON.stringify(['shifts', 'police']));
  const m = await mine();
  assert.deepEqual(m.can, ['notes', 'housekeeping', 'shifts', 'calendar', 'police']);
  assert.ok(!m.sees.includes('checkin') && !m.sees.includes('team'));
});

test('notes: own notes need Notes, others\' "Everyone\'s notes"; "Needs attention" its own', async () => {
  const { bob, gaia, pid, gaiaId } = await team();
  const note = (await bob('POST', `/api/properties/${pid}/notes`, { text: 'Towels in room 3' })).data;
  const noteId = note.id || (note.notes && note.notes[0].id);
  assert.ok(noteId);
  assert.equal((await gaia('DELETE', `/api/properties/${pid}/notes/${noteId}`)).status, 403);
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { ...DEFAULTS, moderate: 'edit', attention: 'edit' } });
  const b = (await gaia('GET', `/api/properties/${pid}/board`)).data;
  assert.equal(b.notes.find(n => n.id === noteId).canDelete, true);
  assert.equal(b.notes.find(n => n.id === noteId).canFlag, true);
  assert.equal((await gaia('DELETE', `/api/properties/${pid}/notes/${noteId}`)).status, 200);
  // Notes only to read: no writing, no likes, not even on her own.
  const own = (await gaia('POST', `/api/properties/${pid}/notes`, { text: 'Mine' })).data.id;
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { ...DEFAULTS, notes: 'read' } });
  assert.equal((await gaia('GET', `/api/properties/${pid}/board`)).data.notes.find(n => n.id === own).canDelete, false);
  assert.equal((await gaia('POST', `/api/properties/${pid}/notes/${own}/like`, {})).status, 403);
  assert.equal((await gaia('DELETE', `/api/properties/${pid}/notes/${own}`)).status, 403);
});

test('owners stay owners: their access is not changed here, promoting is', async () => {
  const { bob, pid, gaiaId, bobId } = await team();
  assert.equal((await bob('PUT', `/api/properties/${pid}/staff/${bobId}/access`, { levels: {} })).status, 403);
  const r = await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { role: 'owner' });
  assert.equal(r.data.role, 'owner');
  assert.equal(r.data.can.length, 11, 'owners may do everything');
});

test('shifts: who may look sees the rota, only who may plan it changes it; kinds of shift in the settings', async () => {
  const { bob, gaia, pid, gaiaId, bobId } = await team();
  let r = await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-12&days=7`);
  assert.equal(r.status, 200);
  assert.equal(r.data.canEdit, false);
  assert.deepEqual(r.data.types.map(t => t.key), ['morning', 'evening']);
  assert.deepEqual(r.data.members.map(m => m.name).sort(), ['Bob', 'Gaia']);

  assert.equal((await gaia('POST', `/api/properties/${pid}/shifts`, { day: '2026-10-12', type: 'morning', userId: gaiaId })).status, 403);
  const add = await bob('POST', `/api/properties/${pid}/shifts`, { day: '2026-10-12', type: 'morning', userId: gaiaId });
  assert.equal(add.status, 201);
  assert.equal((await bob('POST', `/api/properties/${pid}/shifts`, { day: '2026-10-12', type: 'morning', userId: gaiaId })).status, 409);
  assert.equal((await bob('POST', `/api/properties/${pid}/shifts`, { day: '2026-10-12', type: 'night', userId: gaiaId })).status, 400);
  assert.equal((await bob('POST', `/api/properties/${pid}/shifts`, { day: 'monday', type: 'morning', userId: gaiaId })).status, 400);
  assert.equal((await bob('POST', `/api/properties/${pid}/shifts`, { day: '2026-10-12', type: 'morning', userId: 'stranger' })).status, 400);

  // Gaia may plan now: she moves her shift to the evening of the next day.
  await bob('PUT', `/api/properties/${pid}/staff/${gaiaId}/access`, { levels: { ...DEFAULTS, shifts: 'edit' } });
  assert.equal((await gaia('PUT', `/api/properties/${pid}/shifts/${add.data.id}`, { day: '2026-10-13', type: 'evening' })).status, 200);
  await gaia('POST', `/api/properties/${pid}/shifts`, { day: '2026-10-14', type: 'morning', userId: bobId });
  r = await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-12&days=7`);
  assert.equal(r.data.canEdit, true);
  assert.deepEqual(r.data.shifts.map(s => [s.day, s.type, s.userId]), [['2026-10-13', 'evening', gaiaId], ['2026-10-14', 'morning', bobId]]);
  assert.equal((await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-19&days=7`)).data.shifts.length, 0, 'next week is empty');

  // Own hours on a shift: Bob in only until noon on Wednesday; dragged to Thursday's
  // morning he keeps them, onto an evening they go; null brings the usual back.
  const bob14 = r.data.shifts.find(x => x.userId === bobId);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/shifts/${bob14.id}`, { start: '08:00', end: '08:00' })).status, 400);
  assert.equal((await gaia('PUT', `/api/properties/${pid}/shifts/${bob14.id}`, { start: '08:00', end: '12:00' })).status, 200);
  const hoursOf = async () => (await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-12&days=7`)).data.shifts.find(x => x.id === bob14.id);
  assert.deepEqual(await hoursOf(), { id: bob14.id, day: '2026-10-14', type: 'morning', userId: bobId, start: '08:00', end: '12:00' });
  await gaia('PUT', `/api/properties/${pid}/shifts/${bob14.id}`, { day: '2026-10-15', type: 'morning' });
  assert.equal((await hoursOf()).start, '08:00');
  await gaia('PUT', `/api/properties/${pid}/shifts/${bob14.id}`, { start: null, end: null });
  assert.equal((await hoursOf()).start, undefined);
  await gaia('PUT', `/api/properties/${pid}/shifts/${bob14.id}`, { day: '2026-10-14', type: 'morning' });

  // Settings → Shifts: Gaia may change the kinds; one taken out takes its shifts.
  assert.equal((await gaia('PUT', `/api/properties/${pid}/settings`, { shiftTypes: [{ name: 'Day', start: '08:00', end: '08:00' }] })).status, 400);
  const s = await gaia('PUT', `/api/properties/${pid}/settings`, { shiftTypes: [{ key: 'morning', name: 'Morning', start: '06:00', end: '14:00' }, { name: 'Night', start: '22:00', end: '06:00' }] });
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.shiftTypes.map(t => [t.name, t.start, t.end]), [['Morning', '06:00', '14:00'], ['Night', '22:00', '06:00']]);
  r = await gaia('GET', `/api/properties/${pid}/shifts?from=2026-10-12&days=7`);
  assert.deepEqual(r.data.shifts.map(x => x.type), ['morning'], 'the evening shift went with its kind');
  assert.equal((await gaia('DELETE', `/api/properties/${pid}/shifts/${r.data.shifts[0].id}`)).status, 200);
});
