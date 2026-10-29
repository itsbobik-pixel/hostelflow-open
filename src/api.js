// /api routes. Every property-scoped route checks the caller's membership
// first; owners manage staff, staff only work with guests (later).

import { HttpError, json, readJson, requireString, requireEmail, requirePassword, parseJson as parseStatus } from './http.js';
import {
  hashPassword, verifyPassword, needsRehash, createSession, getSessionUser, requireUser, requireRole, deleteSession,
  access, requirePermission, requireSees, permissionsOf, seesOf, levelsOf, cleanLevels, AREAS, DEFAULT_LEVELS, SHOWN_NAME,
  clearSessionCookie, checkLoginAllowed, recordLoginFailure, clearLoginFailures,
} from './auth.js';
import { encryptCredentials, decryptCredentials, loginFingerprint } from './secrets.js';
import { logActivity, logSignIn, listActivity } from './activity.js';
import { getBilling, startCheckout, openPortal, changePlan, setApartments, pauseSubscription, stripeWebhook, trialEnd, EARLY_ACCESS_ENDS, fullAppOf, requireFullApp, checkVoucher, redeemVoucher, applyVoucher } from './billing.js';
import { forgotPassword, resetPassword, sendWelcomeLink } from './reset.js';
import { mailEnabled } from './mail.js';
import { sendSupport, supportEnabled } from './support.js';
import { askAssistant } from './assistant.js';
import { getVault, getItem, addFolder, renameFolder, deleteFolder, setFolderAccess, addPage, uploadFile, updateItem, deleteItem, getFile } from './vault.js';
import { getShifts, addShift, moveShift, deleteShift, shiftsWeek, addShiftNote, updateShiftNote, deleteShiftNote, shiftTypesOf, checkShiftTypes } from './shifts.js';
import { needsConfirmation, sendConfirmation, confirmEmail, resendConfirmation, markConfirmed } from './verify.js';
import { listInvites, createInvite, deleteInvite, showInvite, acceptInvite } from './invites.js';
import { channexStatus, connectChannex, channexWebhook, testBooking } from './channex.js';
import { cloudbedsStatus, saveCloudbeds, deleteCloudbeds } from './cloudbeds.js';
import { claudeStatus, saveClaudeKey, deleteClaudeKey } from './claudekey.js';
import {
  listGuests, createGuest, updateGuest, retryNights, deleteGuest, clearDrafts, guestPhoto, sendGuests, scanUsage,
  updateStay, istatDay, istatReport, fichesReport, rossFile, rossSend, rimovcliFile,
} from './guests.js';
import { REGISTRATION_MODULES, getRegistrationModule } from './registration/index.js';
import { REGIONS as ROSS_REGIONS } from './stats/ross1000.js';
import { readPortalDay } from './stats/portalread.js';
import { looksLikeCitr, CITR_NOT_C59, parseStart } from './stats/rimovcli.js';
import { benchScan, benchList, benchJudge, benchDelete, benchAllowed } from './ocrbench.js';
import { provenAddress } from './admin.js';
import { deviceOwner, rememberDevice, forgetDevice, deviceTeam, onDeviceTeam, clearDeviceCookie } from './devices.js';
import { loginBroken } from './policecheck.js';
import { startDemo, refuseInDemo, isDemoOwner, isDemo, demoSignup } from './demo.js';
import { MAIN, MAX_EXTRA, structureAad, extraStructures, loadStructure, structureList, checkStructureName } from './structures.js';
import { getBoard, tickRoutine, addNote, deleteNote, likeNote, handoverDone, flagNote, editNote, addReply, deleteReply, checkRoutine } from './board.js';
import { getHousekeeping, saveMap, bedAction, linenOf, checkLinen, sheetsOf, checkSheets, saveTasks, taskDone } from './housekeeping.js';
import {
  listCalendars, addCalendar, deleteCalendar, syncCalendars,
  listReservations, addReservation, updateReservation, deleteReservation,
} from './reservations.js';

async function propertiesOf(db, userId, env = {}) {
  const { results } = await db.prepare(
    `SELECT p.id, p.name, p.country, p.timezone, p.plan, p.registration, p.registration_status, p.preview, p.billing_status, p.trial_ends_at, p.billing_parent,
       p.structure_name, p.demo_until IS NOT NULL AS demo, m.role, m.permissions FROM memberships m
     JOIN properties p ON p.id = m.property_id WHERE m.user_id = ? ORDER BY p.created_at`,
  ).bind(userId).all();
  // What the person may do there (Settings → Team), and whether the plan has
  // the whole app (Dashboard, Housekeeping, Shifts) or check-in only.
  return Promise.all(results.map(async ({ permissions, billing_status, trial_ends_at, billing_parent, registration_status, structure_name, ...p }) => {
    // Two structures (two police accounts): Check-in asks which one each guest is in.
    const extra = await extraStructures(db, p.id);
    const structures = structureList({ id: p.id, structure_name }, extra);
    return {
      ...p, demo: !!p.demo, role: p.role === 'owner' ? 'owner' : 'member',
      can: permissionsOf(p.role, permissions), sees: seesOf(p.role, permissions), structures,
      // The police login stopped working (src/policecheck.js): the app warns until it's fixed.
      loginBroken: [registration_status, ...extra.map(s => s.registration_status)].some(st => loginBroken(parseStatus(st))),
      full: await fullAppOf({ ...env, DB: db }, { ...p, billing_status, trial_ends_at, billing_parent }),
    };
  }));
}

// The palette people pick their colour from (the user menu); notes show it.
export const PERSON_COLORS = ['#e07856', '#3a6fd4', '#17c4aa', '#caa53a', '#9a5ad4', '#d4537e', '#4a9d5f', '#5b6475'];

async function me(db, user, env = {}) {
  const row = await db.prepare(`SELECT color, tour_done_at, tabs, profile_property, password_hash IS NOT NULL AS has_password, nickname, show_nickname, ${SHOWN_NAME('users')} AS shown FROM users WHERE id = ?`).bind(user.id).first();
  let tabs = null;
  try { tabs = row && row.tabs ? JSON.parse(row.tabs) : null; } catch { /* all tabs */ }
  const h = await db.prepare('SELECT art, pos, image IS NOT NULL AS has_image, updated_at FROM user_headers WHERE user_id = ?').bind(user.id).first();
  const header = h ? { art: h.art, pos: h.pos || null, image: !!h.has_image, v: h.updated_at } : null;
  return {
    user: { id: user.id, email: row && row.profile_property ? null : user.email, profile: !!(row && row.profile_property), hasPassword: !!(row && row.has_password), name: user.name, nickname: row ? row.nickname : null, showNickname: !!(row && row.show_nickname), shown: row ? row.shown : user.name, color: row ? row.color : null, tourDone: !!(row && row.tour_done_at), tabs, header },
    properties: await propertiesOf(db, user.id, env),
    supportEnabled: supportEnabled(env),
    // The scan bench, in the user menu: listed and proven addresses only.
    bench: benchAllowed(env, user.email) && await provenAddress(env, user.id),
  };
}

// The header picture (Settings → Language and design), kept with the account.
// The pictures to choose from: 'town' (the terrace), our photos in public/headers/,
// or 'photo' (the person's own upload).
const HEADER_ARTS = ['town', 'lights', 'clouds', 'sunset', 'mountains', 'stars', 'peaks', 'photo'];
// Body: { art?: one of HEADER_ARTS, pos?: 'x% y%', image?: data URL }
const HEADER_POS = /^(\d{1,3}(\.\d+)?)% (\d{1,3}(\.\d+)?)%$/;
async function updateHeader(env, request) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const body = await readJson(request);
  const cur = await db.prepare('SELECT art, pos, image FROM user_headers WHERE user_id = ?').bind(user.id).first() || { art: 'town', pos: null, image: null };
  let { art, pos, image } = cur;
  if (body.image !== undefined) {
    if (typeof body.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) throw new HttpError(400, 'that is not a picture');
    if (body.image.length > 1_500_000) throw new HttpError(400, 'the picture is too big — try a smaller one');
    image = body.image;
    pos = null;
  }
  if (body.art !== undefined) {
    if (!HEADER_ARTS.includes(body.art)) throw new HttpError(400, 'unknown header picture');
    art = body.art;
  }
  if (body.pos !== undefined) {
    if (body.pos !== null && !(HEADER_POS.test(body.pos) && body.pos.split(' ').every(p => parseFloat(p) <= 100))) throw new HttpError(400, 'unknown position');
    pos = body.pos;
  }
  if (art === 'photo' && !image) art = 'town';
  await db.prepare(`INSERT INTO user_headers (user_id, art, pos, image, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET art = excluded.art, pos = excluded.pos, image = excluded.image, updated_at = excluded.updated_at`)
    .bind(user.id, art, pos, image, Date.now()).run();
  return json(await me(db, user, env));
}
async function headerImage(env, request) {
  const user = await requireUser(env.DB, request);
  const h = await env.DB.prepare('SELECT image FROM user_headers WHERE user_id = ?').bind(user.id).first();
  const m = h && /^data:(image\/\w+);base64,(.*)$/.exec(h.image || '');
  if (!m) throw new HttpError(404, 'no picture');
  const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=31536000, immutable' } });
}

// The tabs someone may hide (Settings → Your account), per kind of device.
export const USER_TABS = ['board', 'checkin', 'housekeeping', 'shifts', 'calendar'];
function checkTabs(tabs) {
  const out = {};
  for (const device of ['phone', 'computer']) {
    const list = tabs && tabs[device];
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'keep at least one tab');
    out[device] = USER_TABS.filter(t => list.includes(t));
    if (!out[device].length) throw new HttpError(400, 'keep at least one tab');
  }
  return out;
}

// The user menu: own name and colour; the welcome tour seen; the tabs. Body: { name?, color?, tourDone?, tabs? }
async function updateMe(env, request) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const body = await readJson(request);
  if (body.name !== undefined) {
    const name = requireString(body, 'name', { max: 100, label: 'name' });
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    user.name = name;
  }
  await saveNickname(db, user.id, body);
  if (body.color !== undefined) {
    if (body.color !== null && !PERSON_COLORS.includes(body.color)) throw new HttpError(400, 'unknown colour');
    await db.prepare('UPDATE users SET color = ? WHERE id = ?').bind(body.color, user.id).run();
  }
  if (body.tabs !== undefined) {
    await db.prepare('UPDATE users SET tabs = ? WHERE id = ?').bind(body.tabs === null ? null : JSON.stringify(checkTabs(body.tabs)), user.id).run();
  }
  if (body.tourDone === true) {
    await db.prepare('UPDATE users SET tour_done_at = COALESCE(tour_done_at, ?) WHERE id = ?').bind(Date.now(), user.id).run();
  }
  return json(await me(db, user, env));
}

// ===== Auth =====

// The Terms of Service (public/terms.html) the owner accepts at sign-up.
// Bump it when the terms change in a way people must accept again.
export const TERMS_VERSION = '2026-10';
// /privacy and /terms are online and the sign-up box is required. Off until
// the drafts in docs/legal are filled in and checked; to switch on, set this
// to true and remove `hidden` from the [data-legal] elements (index.html,
// beta.html) — the box also gets `required` back.
export const LEGAL_LIVE = true;

async function register(env, request) {
  const db = env.DB;
  const body = await readJson(request);
  const name = requireString(body, 'name', { max: 100, label: 'name' });
  const email = requireEmail(body);
  const password = requirePassword(body);
  const propertyName = requireString(body, 'propertyName', { max: 100, label: 'property name' });
  if (LEGAL_LIVE && body.acceptTerms !== true) {
    throw new HttpError(400, 'accept the Terms of Service and the Privacy Policy to create an account');
  }

  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
    throw new HttpError(409, 'an account with this e-mail already exists');
  }
  // A voucher code (optional): checked before anything is created.
  const voucher = typeof body.voucher === 'string' && body.voucher.trim() ? body.voucher : null;
  if (voucher) await checkVoucher(db, voucher);
  const now = Date.now();
  const userId = crypto.randomUUID();
  const propertyId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db.batch([
    LEGAL_LIVE
      ? db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, terms_accepted_at, terms_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(userId, email, name, passwordHash, now, now, TERMS_VERSION)
      : db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, email, name, passwordHash, now),
    db.prepare('INSERT INTO properties (id, name, created_at, trial_ends_at) VALUES (?, ?, ?, ?)')
      .bind(propertyId, propertyName, now, trialEnd(now)),
    db.prepare("INSERT INTO memberships (user_id, property_id, role) VALUES (?, ?, 'owner')").bind(userId, propertyId),
  ]);
  // First the e-mail is confirmed (the link signs them in), unless e-mail isn't set up.
  // The voucher counts only then (src/verify.js), so made-up addresses can't use it up.
  if (needsConfirmation(env)) {
    if (voucher) await db.prepare('UPDATE properties SET pending_voucher = ? WHERE id = ?').bind(voucher, propertyId).run();
    await sendConfirmation(env, request, { id: userId, email, name });
    return json({ confirm: true, email }, 201);
  }
  if (voucher) await redeemVoucher(db, voucher, propertyId, now).catch(() => { /* used up a moment ago: the normal trial */ });
  await markConfirmed(db, userId).run();
  const { cookie } = await createSession(db, userId);
  return json(await me(db, { id: userId, email, name }, env), 201, { 'Set-Cookie': cookie });
}

// One more property for someone already signed in (a second hostel, an
// apartment): they own it, it starts its own free trial, and its own
// police login, rooms and team are set up in it like after a sign-up.
const MAX_OWNED = 30;
async function addProperty(env, request) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const name = requireString(await readJson(request), 'name', { max: 100, label: 'property name' });
  const owned = await db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ? AND role = 'owner'").bind(user.id).first();
  if (owned.n >= MAX_OWNED) throw new HttpError(400, 'that\'s a lot of properties. Write to us and we\'ll set them up together');
  const now = Date.now();
  const id = crypto.randomUUID();
  // One free trial per person: another own property shares what is left of
  // it (none left: it needs a subscription). Only someone who owns nothing
  // yet (e.g. staff starting their own place) gets a fresh one.
  const trial = owned.n
    ? (await db.prepare("SELECT MAX(p.trial_ends_at) AS t FROM memberships m JOIN properties p ON p.id = m.property_id WHERE m.user_id = ? AND m.role = 'owner'").bind(user.id).first()).t || now
    : trialEnd(now);
  await db.batch([
    db.prepare('INSERT INTO properties (id, name, created_at, trial_ends_at) VALUES (?, ?, ?, ?)').bind(id, name, now, Math.max(Math.min(trial, trialEnd(now) + 400 * 86400000), now, EARLY_ACCESS_ENDS)),
    db.prepare("INSERT INTO memberships (user_id, property_id, role) VALUES (?, ?, 'owner')").bind(user.id, id),
  ]);
  return json({ id, ...(await me(db, user, env)) }, 201);
}

async function login(env, request) {
  const db = env.DB;
  const body = await readJson(request);
  const email = requireEmail(body);
  const password = typeof body.password === 'string' ? body.password : '';
  await checkLoginAllowed(db, email);

  const user = await db.prepare('SELECT id, email, name, password_hash, email_confirmed_at, profile_property FROM users WHERE email = ?').bind(email).first();
  // A profile's password is for its name on the hostel's device, never with its placeholder address.
  if (!user || !user.password_hash || user.profile_property || !(await verifyPassword(password, user.password_hash))) {
    await recordLoginFailure(db, email);
    throw new HttpError(401, 'wrong e-mail or password');
  }
  await clearLoginFailures(db, email);
  if (!user.email_confirmed_at && needsConfirmation(env)) {
    throw new HttpError(403, 'confirm your e-mail first — open the link we sent you', 'unconfirmed');
  }
  if (needsRehash(user.password_hash)) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
  }
  const { cookie } = await createSession(db, user.id);
  await logSignIn(db, user);
  const res = json(await me(db, user, env), 200, { 'Set-Cookie': cookie });
  // An owner: from now on this device signs the team in by name (src/devices.js).
  const device = await rememberDevice(db, request, user.id);
  if (device) res.headers.append('Set-Cookie', device);
  return res;
}

async function changeOwnPassword(db, request) {
  const user = await requireUser(db, request);
  const body = await readJson(request);
  const row = await db.prepare('SELECT password_hash, profile_property FROM users WHERE id = ?').bind(user.id).first();
  // A profile may have no password (a tap on its name), set one, or drop it again.
  const newPassword = row.profile_property && body.newPassword === null ? null : requirePassword(body, 'newPassword');
  if (!row.password_hash ? !row.profile_property : !(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
    throw new HttpError(401, 'current password is wrong');
  }
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newPassword && await hashPassword(newPassword), user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id), // sign out everywhere else
    db.prepare('DELETE FROM devices WHERE owner_id = ?').bind(user.id), // and the hostel's devices ask for the e-mail again
  ]);
  const { cookie } = await createSession(db, user.id);
  const res = json({ ok: true }, 200, { 'Set-Cookie': cookie });
  const device = await rememberDevice(db, request, user.id); // except this one
  if (device) res.headers.append('Set-Cookie', device);
  return res;
}

// ===== Staff (owners, and whoever they let manage the team) =====

async function listStaff(db, request, propertyId) {
  const user = await requireUser(db, request);
  await requireSees(db, user.id, propertyId, 'team');
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.nickname, u.show_nickname, u.color, CASE WHEN u.profile_property IS NULL THEN u.email END AS email, u.profile_property IS NOT NULL AS profile, u.password_hash IS NOT NULL AS password, m.role, m.permissions FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.property_id = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name`,
  ).bind(propertyId).all();
  return json(results.map(({ permissions, profile, password, show_nickname, ...m }) => ({
    ...m, showNickname: !!show_nickname, role: m.role === 'owner' ? 'owner' : 'member', profile: !!profile, password: !!password,
    levels: levelsOf(m.role, permissions), can: permissionsOf(m.role, permissions),
  })));
}

// Owners only: what someone may do — { levels: { area: 'read' | 'edit' } }
// (an area left out: no access) — or { role: 'owner' }: everything. Owners
// can't be changed here (only they step down).
async function setStaffAccess(db, request, propertyId, staffId) {
  const user = await requireUser(db, request);
  await requireRole(db, user.id, propertyId, ['owner']);
  const m = await staffTarget(db, propertyId, staffId);
  const body = await readJson(request);
  const target = await db.prepare('SELECT name, profile_property FROM users WHERE id = ?').bind(staffId).first();
  let role = m.role;
  let permissions = m.permissions;
  if (body.role !== undefined) {
    if (body.role !== 'owner') throw new HttpError(400, 'unknown role');
    if (target.profile_property) throw new HttpError(400, 'a profile without e-mail cannot be an owner');
    role = 'owner';
    permissions = null;
  } else if (body.levels !== undefined) {
    if (!body.levels || typeof body.levels !== 'object' || Array.isArray(body.levels)) throw new HttpError(400, 'invalid access settings');
    permissions = JSON.stringify(cleanLevels(body.levels));
  }
  await db.prepare('UPDATE memberships SET role = ?, permissions = ? WHERE user_id = ? AND property_id = ?')
    .bind(role, permissions, staffId, propertyId).run();
  await logActivity(db, propertyId, user, 'access_changed', target.name);
  return json({ id: staffId, role: role === 'owner' ? 'owner' : 'member', levels: levelsOf(role, permissions), can: permissionsOf(role, permissions) });
}

// Creates the staff account with a password the owner hands over. If the
// e-mail already has an account (e.g. works at two places), it's just added.
async function addStaff(db, request, propertyId) {
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'team');
  const body = await readJson(request);
  const email = requireEmail(body);
  const existing = await db.prepare('SELECT id, email_confirmed_at FROM users WHERE email = ?').bind(email).first();
  let staffId = existing && existing.id;
  // An existing account keeps its own password (never replaced from here: that
  // would let anyone take over an account). Not confirmed yet: it can't sign in
  // until its owner confirms — with that account's password (src/verify.js).
  if (!staffId) {
    staffId = crypto.randomUUID();
    await db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(staffId, email, requireString(body, 'name', { max: 100, label: 'name' }),
        await hashPassword(requirePassword(body)), Date.now()).run();
  }
  const already = await db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND property_id = ?').bind(staffId, propertyId).first();
  if (already) throw new HttpError(409, 'this person is already on the team');
  await db.prepare("INSERT INTO memberships (user_id, property_id, role, permissions) VALUES (?, ?, 'staff', ?)")
    .bind(staffId, propertyId, JSON.stringify(DEFAULT_LEVELS)).run();
  await logActivity(db, propertyId, user, 'member_added', body.name || email);
  return json({ id: staffId, existingAccount: !!existing }, 201);
}

async function staffTarget(db, propertyId, staffId) {
  const m = await db.prepare('SELECT role, permissions FROM memberships WHERE user_id = ? AND property_id = ?').bind(staffId, propertyId).first();
  if (!m) throw new HttpError(404, 'not on this team');
  if (m.role === 'owner') throw new HttpError(403, 'owners manage their own account');
  return m;
}

// A team manager who isn't an owner may change only someone who can do no
// more than they can: else a new password (or removing them) would be a way
// to more than the owner gave them — the same rule as stepping into a profile.
async function staffWithin(db, a, propertyId, staffId) {
  const m = await staffTarget(db, propertyId, staffId);
  if (!mayEnter(a, m)) throw new HttpError(403, "you don't have permission for this — ask the owner");
  return m;
}

// The colour of someone added without e-mail (a profile of this property): they
// have no Account Settings of their own, so whoever manages the team picks it.
// People with an e-mail choose theirs (Settings → Your account). Body: { color }
async function setStaffColor(db, request, propertyId, staffId) {
  const user = await requireUser(db, request);
  const a = await requirePermission(db, user.id, propertyId, 'team');
  await staffWithin(db, a, propertyId, staffId);
  const prof = await db.prepare('SELECT profile_property FROM users WHERE id = ?').bind(staffId).first();
  if (prof.profile_property !== propertyId) throw new HttpError(403, 'they choose their own colour');
  const body = await readJson(request);
  if (body.color !== null && !PERSON_COLORS.includes(body.color)) throw new HttpError(400, 'unknown colour');
  await db.prepare('UPDATE users SET color = ? WHERE id = ?').bind(body.color, staffId).run();
  return json({ id: staffId, color: body.color });
}

// A nickname, and whether the name tags show it instead of the full name.
// Body: { nickname: '…' | null, showNickname: true | false } (either may be left out).
async function saveNickname(db, userId, body) {
  if (body.nickname !== undefined) {
    const nickname = body.nickname === null || String(body.nickname).trim() === '' ? null : requireString(body, 'nickname', { max: 40, label: 'nickname' });
    await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, userId).run();
  }
  if (body.showNickname !== undefined) {
    await db.prepare('UPDATE users SET show_nickname = ? WHERE id = ?').bind(body.showNickname ? 1 : 0, userId).run();
  }
}

// Settings → Team, a tap on someone: their name, nickname and — for someone
// added without e-mail — an e-mail, so they can sign in on their own phone.
// The name is the person's own when they also work elsewhere (as with the
// password). Body: { name?, nickname?, showNickname?, email? }
async function updateStaff(env, request, propertyId, staffId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const a = await requirePermission(db, user.id, propertyId, 'team');
  await staffWithin(db, a, propertyId, staffId);
  const target = await db.prepare('SELECT id, name, profile_property FROM users WHERE id = ?').bind(staffId).first();
  const body = await readJson(request);
  if (!target.profile_property) {
    const { results } = await db.prepare('SELECT property_id FROM memberships WHERE user_id = ?').bind(staffId).all();
    if (results.length > 1) throw new HttpError(403, 'this person also works at another property, so only they can change their name');
  }
  if (body.name !== undefined) {
    const name = requireString(body, 'name', { max: 100, label: 'name' });
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, staffId).run();
    target.name = name;
  }
  await saveNickname(db, staffId, body);
  let emailed = false;
  if (body.email !== undefined) {
    // Only a profile of this property gets one: it becomes an account of its
    // own (signs in with e-mail and password), confirmed by the link it gets.
    if (target.profile_property !== propertyId) throw new HttpError(400, 'they already have an e-mail');
    const email = requireEmail(body);
    const taken = await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (taken) throw new HttpError(409, 'this e-mail already has a HostelFlow account');
    await db.prepare('UPDATE users SET email = ?, profile_property = NULL, email_confirmed_at = NULL WHERE id = ?').bind(email, staffId).run();
    if (mailEnabled(env)) {
      try { await sendWelcomeLink(env, request, { id: staffId, name: target.name, email }); emailed = true; }
      catch { /* the owner can still set a password for them */ }
    }
  }
  await logActivity(db, propertyId, user, 'member_changed', target.name);
  return json({ ok: true, emailed });
}

async function resetStaffPassword(db, request, propertyId, staffId) {
  const user = await requireUser(db, request);
  const a = await requirePermission(db, user.id, propertyId, 'team');
  await staffWithin(db, a, propertyId, staffId);
  const prof = await db.prepare('SELECT profile_property FROM users WHERE id = ?').bind(staffId).first();
  const body = await readJson(request);
  // A profile's password is optional: null takes it away (a tap on the name again).
  if (prof.profile_property) {
    const password = body.password === null ? null : requirePassword(body);
    await db.batch([
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(password && await hashPassword(password), staffId),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(staffId),
    ]);
    return json({ ok: true });
  }
  // Someone who also works elsewhere: this owner must not take over that account.
  const { results } = await db.prepare('SELECT property_id FROM memberships WHERE user_id = ?').bind(staffId).all();
  if (results.length > 1) throw new HttpError(403, 'this person also works at another property, so only they can change their password');
  const password = requirePassword(body);
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), staffId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(staffId),
  ]);
  return json({ ok: true });
}

async function removeStaff(db, request, propertyId, staffId) {
  const user = await requireUser(db, request);
  const a = await requirePermission(db, user.id, propertyId, 'team');
  await staffWithin(db, a, propertyId, staffId);
  const target =await db.prepare('SELECT name, profile_property FROM users WHERE id = ?').bind(staffId).first();
  await db.prepare('DELETE FROM memberships WHERE user_id = ? AND property_id = ?').bind(staffId, propertyId).run();
  // A profile exists only for this property: it goes with the membership.
  if (target.profile_property === propertyId) await db.prepare('DELETE FROM users WHERE id = ?').bind(staffId).run();
  await logActivity(db, propertyId, user, 'member_removed', target.name);
  return json({ ok: true });
}

// ----- Profiles: team members without e-mail -----
// They are entered by their name on the hostel's device (src/devices.js), or
// by switching to them in the user menu where someone of this property is
// signed in. A password is their choice: without one a tap is enough.
// Never owners; the e-mail on the row is a placeholder nobody can use.

async function addProfile(db, request, propertyId) {
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'team');
  const body = await readJson(request);
  const name = requireString(body, 'name', { max: 100, label: 'name' });
  if (body.role === 'owner') throw new HttpError(400, 'a profile without e-mail cannot be an owner');
  // Access of their own (not the defaults): only owners decide who may do
  // what — the same rule as setStaffAccess.
  let levels = DEFAULT_LEVELS;
  if (body.levels != null) {
    if (typeof body.levels !== 'object' || Array.isArray(body.levels)) throw new HttpError(400, 'invalid access settings');
    await requireRole(db, user.id, propertyId, ['owner']);
    levels = cleanLevels(body.levels);
  }
  const role = 'staff'; // everyone but owners (the column still has the old names)
  const permissions = JSON.stringify(levels);
  const color = body.color == null ? null : body.color;
  if (color !== null && !PERSON_COLORS.includes(color)) throw new HttpError(400, 'unknown colour');
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO users (id, email, name, password_hash, email_confirmed_at, profile_property, color, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
      .bind(id, `profile-${id}@profiles.hostelflow.invalid`, name, Date.now(), propertyId, color, Date.now()),
    db.prepare('INSERT INTO memberships (user_id, property_id, role, permissions) VALUES (?, ?, ?, ?)').bind(id, propertyId, role, permissions),
  ]);
  await logActivity(db, propertyId, user, 'profile_added', name);
  return json({ id }, 201);
}

// Who may step into a profile here: owners, whoever manages the team, and the
// profiles themselves (so the reception computer can pass between them).
// Returns their access, or null.
async function mayUseProfiles(db, user, propertyId) {
  const a = await access(db, user.id, propertyId);
  if (a.role === 'owner' || a.can.has('team')) return a;
  const me = await db.prepare('SELECT profile_property FROM users WHERE id = ?').bind(user.id).first();
  return !!me && me.profile_property === propertyId ? a : null;
}

// Stepping into a profile must never give more than one already has: a
// non-owner (person or profile) may enter only a profile that sees and
// changes nothing more than they do. Profiles with the defaults stay shared
// at the reception computer; one the owner gave the police login or the
// Vault is entered by the owner, or by someone who already has those.
const RANK = { read: 1, edit: 2 };
function mayEnter(a, target) {
  if (a.role === 'owner') return true;
  const theirs = levelsOf(target.role, target.permissions);
  return AREAS.every(x => (RANK[theirs[x]] || 0) <= (RANK[a.levels[x]] || 0));
}

async function listProfiles(db, request, propertyId) {
  const user = await requireUser(db, request);
  const a = await mayUseProfiles(db, user, propertyId);
  if (!a) return json([]);
  // The demo (src/demo.js): the whole made-up team, its owner too, so a visitor
  // who stepped into someone can always get back.
  const demo = await isDemo(db, propertyId);
  const { results } = await db.prepare(
    `SELECT u.id, u.name, ${SHOWN_NAME()} AS shown, u.color, u.password_hash IS NOT NULL AS password, m.role, m.permissions FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.property_id = ? AND (u.profile_property = ? OR ?) AND u.id != ? ORDER BY m.role = 'owner' DESC, u.name`,
  ).bind(propertyId, propertyId, demo ? 1 : 0, user.id).all();
  return json(results.filter(p => demo || mayEnter(a, p)).map(({ id, name, shown, color, password }) => ({ id, name, shown, color: color || null, password: !!password })));
}

async function switchProfile(db, request, propertyId, profileId) {
  const user = await requireUser(db, request);
  const a = await mayUseProfiles(db, user, propertyId);
  if (!a) throw new HttpError(403, "you don't have permission for this — ask the owner");
  const demo = await isDemo(db, propertyId); // anyone on the made-up team (listProfiles)
  const target = await db.prepare(
    `SELECT u.id, u.name, u.email, u.password_hash, m.role, m.permissions FROM users u JOIN memberships m ON m.user_id = u.id AND m.property_id = ?
     WHERE u.id = ? AND (u.profile_property = ? OR ?)`,
  ).bind(propertyId, profileId, propertyId, demo ? 1 : 0).first();
  if (!target) throw new HttpError(404, 'not on this team');
  if (!demo && !mayEnter(a, target)) throw new HttpError(403, "you don't have permission for this — ask the owner");
  if (target.password_hash) await checkPassword(db, target, (await readJson(request)).password);
  const self = await db.prepare('SELECT profile_property FROM users WHERE id = ?').bind(user.id).first();
  if (self.profile_property) await deleteSession(db, request); // a profile's own session ends here
  const { cookie } = await createSession(db, target.id);
  await logActivity(db, propertyId, target, 'profile_switched', user.name);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}

// The password of someone signing in by name, with the same limit on wrong
// tries as the e-mail sign-in (per account).
async function checkPassword(db, person, password) {
  await checkLoginAllowed(db, person.email);
  if (!(await verifyPassword(typeof password === 'string' ? password : '', person.password_hash))) {
    await recordLoginFailure(db, person.email);
    throw new HttpError(401, 'wrong password');
  }
  await clearLoginFailures(db, person.email);
  if (needsRehash(person.password_hash)) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), person.id).run();
  }
}

// ----- The hostel's device: the team by name (src/devices.js) -----

// An owner who is in the app here (after signing up, a confirmation link…)
// makes it their hostel's device too, like signing in does.
async function getDevice(db, request) {
  let ownerId = await deviceOwner(db, request);
  let cookie = null;
  const user = !ownerId && await getSessionUser(db, request);
  if (user && (cookie = await rememberDevice(db, request, user.id))) ownerId = user.id;
  return json({ properties: ownerId ? await deviceTeam(db, ownerId) : [] }, 200, cookie ? { 'Set-Cookie': cookie } : {});
}

// A tap on a name: no password, and they're in; else the password, nothing
// more. Whoever was signed in on this device hands over.
async function deviceSignIn(env, request) {
  const db = env.DB;
  const ownerId = await deviceOwner(db, request);
  if (!ownerId) throw new HttpError(403, 'sign in with the e-mail first');
  const body = await readJson(request);
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id || !(await onDeviceTeam(db, ownerId, id))) throw new HttpError(404, 'not on this team');
  const person = await db.prepare('SELECT id, email, name, password_hash, email_confirmed_at, profile_property FROM users WHERE id = ?').bind(id).first();
  if (person.password_hash) await checkPassword(db, person, body.password);
  // Someone with an e-mail always has a password; one still without it can't come in.
  // (The demo's owner has none: src/demo.js.)
  else if (!person.profile_property && !isDemoOwner(person)) throw new HttpError(401, 'wrong password');
  if (!person.profile_property && !person.email_confirmed_at && needsConfirmation(env)) {
    throw new HttpError(403, 'confirm your e-mail first — open the link we sent you', 'unconfirmed');
  }
  await deleteSession(db, request);
  const { cookie } = await createSession(db, person.id);
  await logSignIn(db, person);
  return json(await me(db, person, env), 200, { 'Set-Cookie': cookie });
}

// ===== Property settings (owner only) =====

// A new check is refused this soon after the last one: every check is a login
// on the police portal, and hammering it with a wrong password could get the
// property's account blocked.
const CHECK_COOLDOWN_MS = 20 * 1000;

// Is this police login (fingerprint) already saved elsewhere? 'other': at
// another property; 'same': at the other structure of this one (two
// structures with one login would send their guests to one account). Older
// rows have no fingerprint yet: read theirs from the stored login, once.
async function policeLoginTaken(env, propertyId, system, fp, self = MAIN) {
  const db = env.DB;
  if (await db.prepare('SELECT 1 FROM properties WHERE police_login_fp = ? AND id != ?').bind(fp, propertyId).first()) return 'other';
  if (await db.prepare('SELECT 1 FROM structures WHERE police_login_fp = ? AND property_id != ?').bind(fp, propertyId).first()) return 'other';
  if (self !== MAIN && await db.prepare('SELECT 1 FROM properties WHERE police_login_fp = ? AND id = ?').bind(fp, propertyId).first()) return 'same';
  if (await db.prepare('SELECT 1 FROM structures WHERE police_login_fp = ? AND property_id = ? AND id != ?').bind(fp, propertyId, self).first()) return 'same';
  const { results } = await db.prepare(
    'SELECT id, registration_credentials FROM properties WHERE police_login_fp IS NULL AND registration = ? AND registration_credentials IS NOT NULL AND id != ?',
  ).bind(system, propertyId).all();
  for (const row of results) {
    let theirs = null;
    try { theirs = await loginFingerprint(env, system, (await decryptCredentials(env, row.id, row.registration_credentials)).user); } catch { /* unreadable: skip */ }
    if (!theirs) continue;
    await db.prepare('UPDATE properties SET police_login_fp = ? WHERE id = ?').bind(theirs, row.id).run();
    if (theirs === fp) return 'other';
  }
  return false;
}

async function loadProperty(db, propertyId) {
  return db.prepare(
    'SELECT id, name, country, registration, registration_credentials, registration_status, routine, linen, sheets_track, sheets_days, linen_in_use, shift_types, stats_settings, police_login_fp, structure_name FROM properties WHERE id = ?',
  ).bind(propertyId).first();
}

// Where one structure's settings are stored: the property's own columns for
// the main one, its row in structures for the others (sealed with their own binding).
function slotOf(p, structure) {
  return structure
    ? { aad: structureAad(p.id, structure.id), row: structure }
    : { aad: p.id, row: p };
}

// Ross1000 settings: the password never goes back to the browser.
async function rossView(env, aad, stored) {
  const r = await decryptCredentials(env, aad, stored);
  return { region: r.region || '', codice: r.codice || '', c59: r.c59 || '', user: r.user || '', passwordSet: !!r.password, rooms: r.rooms || null, beds: r.beds || null, start: r.start ? { date: r.start.date, text: r.start.text } : null };
}
function checkRoss(body, before) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'ross must be an object');
  const out = { ...before };
  const text = (k, max) => { if (k in body) { const v = String(body[k] ?? '').trim(); if (v.length > max) throw new HttpError(400, `${k} is too long`); if (v) out[k] = v; else delete out[k]; } };
  if ('region' in body && body.region && !ROSS_REGIONS[body.region]) throw new HttpError(400, 'unknown region');
  text('region', 30); text('codice', 30); text('c59', 40); text('user', 100);
  if (out.c59 && looksLikeCitr(out.c59)) throw new HttpError(400, CITR_NOT_C59);
  // RiMovCli's starting point (src/stats/rimovcli.js): a day and the portal's table of it; null clears it.
  if ('start' in body) {
    if (body.start === null) delete out.start;
    else {
      const date = String((body.start && body.start.date) || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'choose the last day already on the portal');
      const text = String(body.start.text || '').slice(0, 3000);
      const { present, bad } = parseStart(text);
      if (bad.length) throw new HttpError(400, `not understood: ${bad.slice(0, 3).join(', ')}`);
      out.start = { date, text, present };
    }
  }
  if (typeof body.password === 'string' && body.password) out.password = body.password.slice(0, 200);
  for (const k of ['rooms', 'beds']) {
    if (k in body) {
      const n = body[k] === null || body[k] === '' ? null : Number(body[k]);
      if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 5000)) throw new HttpError(400, `${k} must be a whole number`);
      if (n === null) delete out[k]; else out[k] = n;
    }
  }
  return out;
}

// Secret values never leave the server: the browser only learns whether they are set.
async function credentialsView(env, module, aad, stored) {
  const creds = await decryptCredentials(env, aad, stored);
  const credentials = {};
  for (const f of module ? module.credentialFields : []) {
    const value = typeof creds[f.key] === 'string' ? creds[f.key] : '';
    credentials[f.key] = f.secret ? { set: !!value } : { set: !!value, value };
  }
  return credentials;
}

async function settingsView(env, p) {
  const module = p.registration ? getRegistrationModule(p.registration) : null;
  // A second structure: its own login, check result and statistics codes.
  const structures = [];
  for (const s of await extraStructures(env.DB, p.id)) {
    const aad = structureAad(p.id, s.id);
    structures.push({
      id: s.id, name: s.name,
      credentials: await credentialsView(env, module, aad, s.registration_credentials),
      status: parseStatus(s.registration_status),
      ross: await rossView(env, aad, s.stats_settings),
    });
  }
  return {
    name: p.name,
    country: p.country,
    registration: p.registration,
    credentials: await credentialsView(env, module, p.id, p.registration_credentials),
    status: parseStatus(p.registration_status),
    routine: p.routine || '',
    linen: linenOf(p),
    sheets: sheetsOf(p),
    shiftTypes: shiftTypesOf(p),
    ross: await rossView(env, p.id, p.stats_settings),
    mainName: p.structure_name || '',
    structures,
    modules: Object.values(REGISTRATION_MODULES).map(m => ({
      id: m.id, name: m.name, country: m.country, portalUrl: m.portalUrl,
      fields: m.credentialFields.map(({ key, label, secret, help, optional }) => ({ key, label, secret: !!secret, help, optional: !!optional })),
      guestFields: m.guestFields || [],
    })),
  };
}

// Owners see all of it; someone allowed the police login or the guidelines
// sees the settings, without the login if they may only edit the guidelines.
async function getSettings(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  const { role, can, sees } = await access(env.DB, user.id, propertyId);
  if (role !== 'owner' && !sees.has('police') && !can.has('guidelines') && !can.has('shifts')) throw new HttpError(403, 'only the owner can do this');
  const view = await settingsView(env, await loadProperty(env.DB, propertyId));
  if (!can.has('police')) {
    // The login (and the Ross1000 login and codes with it) only for whoever
    // may change it; 'read' sees whether it works.
    const status = sees.has('police');
    view.credentials = {}; view.ross = null; if (!status) view.status = null;
    for (const s of view.structures) { s.credentials = {}; s.ross = null; if (!status) s.status = null; }
  }
  return json(view);
}

// Body: { name?, registration?: moduleId | null, credentials?: { key: value }, routine?: text,
// linen?: [{ key?, label, days }], sheets?: { track, days }, structure?: id, structureName?, addStructure?: { name, mainName? },
// removeStructure?: id }.
// An empty secret field keeps the stored value (the form can't show it);
// switching to another registration module drops the old credentials (of
// every structure). credentials, clearCredentials, ross and structureName
// apply to `structure` (the main one when absent).
async function updateSettings(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  const body = await readJson(request);
  // Each part of the settings needs its own permission; the rest are the owner's.
  const { role, can } = await access(db, user.id, propertyId);
  const needs = {
    name: 'owner', linen: 'owner', sheets: 'owner', registration: 'police', credentials: 'police', clearCredentials: 'police', routine: 'guidelines', shiftTypes: 'shifts', ross: 'police',
    structure: 'police', structureName: 'police', addStructure: 'owner', removeStructure: 'owner',
  };
  for (const [key, need] of Object.entries(needs)) {
    if (key in body && !(role === 'owner' || (need !== 'owner' && can.has(need)))) {
      throw new HttpError(403, need === 'owner' ? 'only the owner can do this' : "you don't have permission for this — ask the owner");
    }
  }
  const p = await loadProperty(db, propertyId);

  // A second structure: added empty (its login and codes are saved next), or
  // removed while no guest is in it yet — after that its guests must stay counted.
  if (body.addStructure !== undefined) {
    const a = body.addStructure || {};
    // An Italian property with no police system saved yet is on Alloggiati Web
    // all the same: the second structure can come before the first login.
    const italian = p.registration === 'it-alloggiati' || (!p.registration && (p.country || 'IT') === 'IT');
    if (!italian) throw new HttpError(400, 'a second structure is for Alloggiati Web (Italy) — choose it first');
    if ((await extraStructures(db, propertyId)).length >= MAX_EXTRA) throw new HttpError(409, 'this property already has a second structure');
    const sid = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO structures (id, property_id, name, created_at) VALUES (?, ?, ?, ?)').bind(sid, propertyId, checkStructureName(a.name), Date.now()),
      db.prepare("UPDATE properties SET structure_name = ?, registration = 'it-alloggiati' WHERE id = ?").bind(a.mainName ? checkStructureName(a.mainName) : p.structure_name, propertyId),
    ]);
    await logActivity(db, propertyId, user, 'structure_added', checkStructureName(a.name));
    return json({ ...(await settingsView(env, await loadProperty(db, propertyId))), added: sid });
  }
  if (body.removeStructure !== undefined) {
    const s = await loadStructure(db, propertyId, body.removeStructure);
    if (!s) throw new HttpError(400, 'the main structure can\'t be removed');
    if (await db.prepare('SELECT 1 FROM guests WHERE property_id = ? AND structure_id = ?').bind(propertyId, s.id).first()) {
      throw new HttpError(409, 'guests are already checked in to this structure — disconnect its police login instead');
    }
    await db.prepare('DELETE FROM structures WHERE id = ? AND property_id = ?').bind(s.id, propertyId).run();
    await logActivity(db, propertyId, user, 'structure_removed', s.name);
    return json(await settingsView(env, await loadProperty(db, propertyId)));
  }

  const structure = await loadStructure(db, propertyId, body.structure);
  const slot = slotOf(p, structure);

  const name = 'name' in body ? requireString(body, 'name', { max: 100, label: 'property name' }) : p.name;
  const routine = 'routine' in body ? checkRoutine(body.routine) : p.routine;
  const linen = 'linen' in body ? JSON.stringify(checkLinen(body.linen, linenOf(p))) : p.linen;
  const sheets = 'sheets' in body ? checkSheets(body.sheets) : sheetsOf(p);
  const shiftTypes = 'shiftTypes' in body ? checkShiftTypes(body.shiftTypes, shiftTypesOf(p)) : null;

  let registration = p.registration;
  if ('registration' in body) {
    if (body.registration !== null && !REGISTRATION_MODULES[body.registration]) {
      throw new HttpError(400, 'unknown registration system');
    }
    // Every structure reports to the same system: it is chosen with the main one.
    if (structure && body.registration !== p.registration) throw new HttpError(400, 'both structures use the same registration system');
    registration = body.registration;
  }
  const module = registration ? REGISTRATION_MODULES[registration] : null;
  const moduleChanged = registration !== p.registration;
  let creds = moduleChanged ? {} : await decryptCredentials(env, slot.aad, slot.row.registration_credentials);
  let credsChanged = moduleChanged;

  // Disconnect: forget the saved police login (the system stays chosen).
  if (body.clearCredentials === true) {
    if (!module) throw new HttpError(400, 'choose a registration system first');
    creds = {};
    credsChanged = true;
  }
  if (body.credentials !== undefined) {
    if (!module) throw new HttpError(400, 'choose a registration system first');
    if (!body.credentials || typeof body.credentials !== 'object' || Array.isArray(body.credentials)) {
      throw new HttpError(400, 'credentials must be an object');
    }
    creds = { ...creds };
    for (const f of module.credentialFields) {
      const v = body.credentials[f.key];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw new HttpError(400, `${f.label} must be text`);
      const value = v.trim();
      if (value.length > 500) throw new HttpError(400, `${f.label} is too long`);
      if (!value && f.secret) continue;
      if (value) creds[f.key] = value; else delete creds[f.key];
      credsChanged = true;
    }
  }

  // The same police login at two properties would send every guest twice;
  // at both structures of one, one structure's guests would go to the other's account.
  let loginFp = slot.row.police_login_fp;
  if (credsChanged) {
    loginFp = module && creds.user ? await loginFingerprint(env, module.id, creds.user) : null;
    const taken = loginFp && await policeLoginTaken(env, p.id, module.id, loginFp, structure ? structure.id : MAIN);
    if (taken === 'same') throw new HttpError(409, 'this police login is already used by your other structure — each structure needs its own');
    if (taken) throw new HttpError(409, 'this police login is already used by another property — each property needs its own');
  }
  const stored = !credsChanged ? slot.row.registration_credentials
    : Object.keys(creds).length ? await encryptCredentials(env, slot.aad, creds) : null;
  const statusAfter = credsChanged ? null : slot.row.registration_status; // old check result no longer applies
  const structureName = 'structureName' in body ? checkStructureName(body.structureName) : null;
  const writes = [
    db.prepare('UPDATE properties SET name = ?, registration = ?, country = ?, routine = ?, linen = ?, sheets_track = ?, sheets_days = ?, linen_in_use = ? WHERE id = ?')
      .bind(name, registration, module ? module.country : p.country, routine, linen, sheets.track ? 1 : 0, sheets.days, sheets.linenInUse ? 1 : 0, propertyId),
  ];
  if (structure) {
    writes.push(db.prepare('UPDATE structures SET registration_credentials = ?, registration_status = ?, police_login_fp = ?, name = ? WHERE id = ? AND property_id = ?')
      .bind(stored, statusAfter, loginFp, structureName || structure.name, structure.id, propertyId));
  } else {
    writes.push(db.prepare('UPDATE properties SET registration_credentials = ?, registration_status = ?, police_login_fp = ?, structure_name = ? WHERE id = ?')
      .bind(stored, statusAfter, loginFp, structureName || p.structure_name, propertyId));
  }
  // Another system for the property: the other structures' logins were for the old one.
  if (moduleChanged) {
    writes.push(db.prepare('UPDATE structures SET registration_credentials = NULL, registration_status = NULL, police_login_fp = NULL WHERE property_id = ?').bind(propertyId));
  }
  await db.batch(writes);
  if (credsChanged) await logActivity(db, propertyId, user, body.clearCredentials === true ? 'police_login_removed' : 'police_login_changed', structure ? structure.name : null);
  if ('ross' in body) {
    const before = await decryptCredentials(env, slot.aad, slot.row.stats_settings);
    const sealed = await encryptCredentials(env, slot.aad, checkRoss(body.ross, before));
    if (structure) await db.prepare('UPDATE structures SET stats_settings = ? WHERE id = ? AND property_id = ?').bind(sealed, structure.id, propertyId).run();
    else await db.prepare('UPDATE properties SET stats_settings = ? WHERE id = ?').bind(sealed, propertyId).run();
    await logActivity(db, propertyId, user, 'statistics_changed');
  }
  if (shiftTypes) {
    // A kind of shift taken out takes its shifts and notes with it.
    const keys = JSON.stringify(shiftTypes.map(t => t.key));
    await db.batch([
      db.prepare('UPDATE properties SET shift_types = ? WHERE id = ?').bind(JSON.stringify(shiftTypes), propertyId),
      db.prepare('DELETE FROM shifts WHERE property_id = ? AND type_key NOT IN (SELECT value FROM json_each(?))').bind(propertyId, keys),
      db.prepare('DELETE FROM shift_notes WHERE property_id = ? AND type_key NOT IN (SELECT value FROM json_each(?))').bind(propertyId, keys),
    ]);
  }
  return json(await settingsView(env, await loadProperty(db, propertyId)));
}

// Signs in to the police portal with the stored credentials; sends no guest data.
// Body: { structure? } — the main one when absent.
async function checkRegistration(env, request, propertyId) {
  const db = env.DB;
  const user = await requireUser(db, request);
  await requirePermission(db, user.id, propertyId, 'police');
  const p = await loadProperty(db, propertyId);
  if (!p.registration) throw new HttpError(400, 'choose a registration system first');
  let body = {};
  try { body = (await readJson(request)) || {}; } catch { /* no body: the main structure */ }
  const structure = await loadStructure(db, propertyId, body.structure);
  const slot = slotOf(p, structure);
  const module = getRegistrationModule(p.registration);
  const creds = await decryptCredentials(env, slot.aad, slot.row.registration_credentials);
  const missing = module.credentialFields.filter(f => !f.optional && !creds[f.key]).map(f => f.label);
  if (missing.length) throw new HttpError(400, `fill in: ${missing.join(', ')}`);

  const last = parseStatus(slot.row.registration_status);
  const now = Date.now();
  if (last && now - last.at < CHECK_COOLDOWN_MS) throw new HttpError(429, 'wait a few seconds before checking again');

  let status;
  try {
    await module.checkCredentials(creds);
    status = { ok: true, at: now };
  } catch (err) {
    status = { ok: false, at: now, message: String(err.message || err), login: err.code === 'login' };
  }
  if (structure) {
    await db.prepare('UPDATE structures SET registration_status = ? WHERE id = ? AND property_id = ?').bind(JSON.stringify(status), structure.id, propertyId).run();
  } else {
    await db.prepare('UPDATE properties SET registration_status = ? WHERE id = ?').bind(JSON.stringify(status), propertyId).run();
  }
  return json(status);
}

// ===== Router =====

export async function handleApi(request, env) {
  const db = env.DB;
  if (!db) return json({ error: 'database not configured' }, 500);
  const { pathname } = new URL(request.url);
  const method = request.method;
  try {
    if (pathname === '/api/auth/register' && method === 'POST') return await register(env, request);
    if (pathname === '/api/demo' && method === 'POST') {
      const { cookie, user } = await startDemo(env, request);
      return json(await me(db, user, env), 201, { 'Set-Cookie': cookie });
    }
    if (pathname === '/api/demo/signup' && method === 'POST') {
      await demoSignup(db, (await requireUser(db, request)).id);
      return json({ ok: true });
    }
    // The demo (src/demo.js): nothing that reaches the outside world or costs money.
    await refuseInDemo(db, request, pathname, method);
    if (pathname === '/api/auth/login' && method === 'POST') return await login(env, request);
    if (pathname === '/api/auth/confirm' && method === 'POST') return await confirmEmail(env, request);
    if (pathname === '/api/auth/confirm/resend' && method === 'POST') return await resendConfirmation(env, request);
    if (pathname === '/api/auth/logout' && method === 'POST') {
      await deleteSession(db, request);
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }
    if (pathname === '/api/auth/password' && method === 'POST') return await changeOwnPassword(db, request);
    if (pathname === '/api/device' && method === 'GET') return await getDevice(db, request);
    if (pathname === '/api/device/signin' && method === 'POST') return await deviceSignIn(env, request);
    if (pathname === '/api/device/forget' && method === 'POST') {
      // Signed out as well: an owner still in would make it theirs again (getDevice).
      await forgetDevice(db, request);
      await deleteSession(db, request);
      const res = json({ ok: true }, 200, { 'Set-Cookie': clearDeviceCookie() });
      res.headers.append('Set-Cookie', clearSessionCookie());
      return res;
    }
    if (pathname === '/api/auth/forgot' && method === 'POST') return await forgotPassword(env, request);
    if (pathname === '/api/auth/reset' && method === 'POST') return await resetPassword(env, request);
    if (pathname === '/api/invites/show' && method === 'POST') return await showInvite(env, request);
    if (pathname === '/api/invites/accept' && method === 'POST') return await acceptInvite(env, request);
    if (pathname === '/api/stripe/webhook' && method === 'POST') return await stripeWebhook(env, request);
    const hook = pathname.match(/^\/api\/channex\/webhook\/([\w-]+)$/);
    if (hook && method === 'POST') return await channexWebhook(env, hook[1]);
    if (pathname === '/api/me' && method === 'GET') return json(await me(db, await requireUser(db, request), env));
    if (pathname === '/api/properties' && method === 'POST') return await addProperty(env, request);
    // The Dashboard, Housekeeping, Shifts and the Vault: not in the check-in-only plan.
    const gated = pathname.match(/^\/api\/properties\/([\w-]+)\/(board|notes|housekeeping|beds|shifts|vault)(\/|$)/);
    // Only for members: the plan of someone else's property is none of the caller's business.
    if (gated) {
      await access(db, (await requireUser(db, request)).id, gated[1]);
      await requireFullApp(env, gated[1]);
    }
    if (pathname === '/api/me' && method === 'PUT') return await updateMe(env, request);
    if (pathname === '/api/me/header' && method === 'PUT') return await updateHeader(env, request);
    if (pathname === '/api/ocr-bench' && method === 'POST') return await benchScan(env, request);
    if (pathname === '/api/ocr-bench' && method === 'GET') return await benchList(env, request);
    const bench = pathname.match(/^\/api\/ocr-bench\/([\w-]+)$/);
    if (bench && method === 'PUT') return await benchJudge(env, request, bench[1]);
    if (bench && method === 'DELETE') return await benchDelete(env, request, bench[1]);
    if (pathname === '/api/me/header/image' && method === 'GET') return await headerImage(env, request);
    if (pathname === '/api/support' && method === 'POST') return await sendSupport(env, request);
    if (pathname === '/api/assistant' && method === 'POST') return await askAssistant(env, request);

    let m = pathname.match(/^\/api\/properties\/([\w-]+)\/settings$/);
    if (m && method === 'GET') return await getSettings(env, request, m[1]);
    if (m && method === 'PUT') return await updateSettings(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/registration\/check$/);
    if (m && method === 'POST') return await checkRegistration(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing$/);
    if (m && method === 'GET') return await getBilling(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing\/checkout$/);
    if (m && method === 'POST') return await startCheckout(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing\/plan$/);
    if (m && method === 'POST') return await changePlan(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing\/apartments$/);
    if (m && method === 'PUT') return await setApartments(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing\/voucher$/);
    if (m && method === 'POST') return await applyVoucher(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing\/pause$/);
    if (m && method === 'POST') return await pauseSubscription(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/billing\/portal$/);
    if (m && method === 'POST') return await openPortal(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/usage$/);
    if (m && method === 'GET') return await scanUsage(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/guests$/);
    if (m && method === 'GET') return await listGuests(env, request, m[1]);
    if (m && method === 'POST') return await createGuest(env, request, m[1]);
    if (m && method === 'DELETE') return await clearDrafts(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/guests\/send$/);
    if (m && method === 'POST') return await sendGuests(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/istat$/);
    if (m && method === 'GET') return await istatDay(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/istat\/report$/);
    if (m && method === 'GET') return await istatReport(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/ross1000$/);
    if (m && method === 'GET') return await rossFile(env, request, m[1]);
    if (m && method === 'POST') return await rossSend(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/rimovcli$/);
    if (m && method === 'GET') return await rimovcliFile(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/rimovcli\/read$/);
    if (m && method === 'POST') return await readPortalDay(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/fiches$/);
    if (m && method === 'GET') return await fichesReport(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/guests\/([\w-]+)\/stay$/);
    if (m && method === 'PUT') return await updateStay(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/guests\/([\w-]+)\/nights$/);
    if (m && method === 'POST') return await retryNights(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/guests\/([\w-]+)\/photo$/);
    if (m && method === 'GET') return await guestPhoto(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/guests\/([\w-]+)$/);
    if (m && method === 'PUT') return await updateGuest(env, request, m[1], m[2]);
    if (m && method === 'DELETE') return await deleteGuest(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/board$/);
    if (m && method === 'GET') return await getBoard(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/board\/routine$/);
    if (m && method === 'POST') return await tickRoutine(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/calendars$/);
    if (m && method === 'GET') return await listCalendars(env, request, m[1]);
    if (m && method === 'POST') return await addCalendar(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/calendars\/sync$/);
    if (m && method === 'POST') return await syncCalendars(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/calendars\/([\w-]+)$/);
    if (m && method === 'DELETE') return await deleteCalendar(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/reservations$/);
    if (m && method === 'GET') return await listReservations(env, request, m[1]);
    if (m && method === 'POST') return await addReservation(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/reservations\/([\w-]+)$/);
    if (m && method === 'PUT') return await updateReservation(env, request, m[1], m[2]);
    if (m && method === 'DELETE') return await deleteReservation(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/housekeeping$/);
    if (m && method === 'GET') return await getHousekeeping(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/shifts$/);
    if (m && method === 'GET') return await getShifts(env, request, m[1]);
    if (m && method === 'POST') return await addShift(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/shifts\/week$/);
    if (m && method === 'POST') return await shiftsWeek(env, request, m[1]);
    // Before /shifts/:id, which "notes" would otherwise match.
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/shifts\/notes$/);
    if (m && method === 'POST') return await addShiftNote(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/shifts\/notes\/([\w-]+)$/);
    if (m && method === 'PUT') return await updateShiftNote(env, request, m[1], m[2]);
    if (m && method === 'DELETE') return await deleteShiftNote(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/shifts\/([\w-]+)$/);
    if (m && method === 'PUT') return await moveShift(env, request, m[1], m[2]);
    if (m && method === 'DELETE') return await deleteShift(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault$/);
    if (m && method === 'GET') return await getVault(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/folders$/);
    if (m && method === 'POST') return await addFolder(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/folders\/([\w-]+)$/);
    if (m && method === 'PUT') return await renameFolder(env, request, m[1], m[2]);
    if (m && method === 'DELETE') return await deleteFolder(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/folders\/([\w-]+)\/access$/);
    if (m && method === 'PUT') return await setFolderAccess(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/pages$/);
    if (m && method === 'POST') return await addPage(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/files$/);
    if (m && method === 'POST') return await uploadFile(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/items\/([\w-]+)\/file$/);
    if (m && method === 'GET') return await getFile(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/vault\/items\/([\w-]+)$/);
    if (m && method === 'GET') return await getItem(env, request, m[1], m[2]);
    if (m && method === 'PUT') return await updateItem(env, request, m[1], m[2]);
    if (m && method === 'DELETE') return await deleteItem(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/housekeeping\/tasks$/);
    if (m && method === 'PUT') return await saveTasks(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/housekeeping\/tasks\/([\w-]+)\/done$/);
    if (m && method === 'POST') return await taskDone(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/housekeeping\/map$/);
    if (m && method === 'PUT') return await saveMap(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/beds\/([\w-]+)$/);
    if (m && method === 'POST') return await bedAction(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes$/);
    if (m && method === 'POST') return await addNote(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes\/([\w-]+)\/like$/);
    if (m && method === 'POST') return await likeNote(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes\/([\w-]+)\/handover-done$/);
    if (m && method === 'POST') return await handoverDone(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes\/([\w-]+)\/attention$/);
    if (m && method === 'POST') return await flagNote(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes\/([\w-]+)\/replies$/);
    if (m && method === 'POST') return await addReply(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes\/([\w-]+)\/replies\/([\w-]+)$/);
    if (m && method === 'DELETE') return await deleteReply(env, request, m[1], m[2], m[3]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/notes\/([\w-]+)$/);
    if (m && method === 'DELETE') return await deleteNote(env, request, m[1], m[2]);
    if (m && method === 'PUT') return await editNote(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/channex$/);
    if (m && method === 'GET') return await channexStatus(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/cloudbeds$/);
    if (m && method === 'GET') return await cloudbedsStatus(env, request, m[1]);
    if (m && method === 'PUT') return await saveCloudbeds(env, request, m[1]);
    if (m && method === 'DELETE') return await deleteCloudbeds(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/claude$/);
    if (m && method === 'GET') return await claudeStatus(env, request, m[1]);
    if (m && method === 'PUT') return await saveClaudeKey(env, request, m[1]);
    if (m && method === 'DELETE') return await deleteClaudeKey(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/channex\/connect$/);
    if (m && method === 'POST') return await connectChannex(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/channex\/test-booking$/);
    if (m && method === 'POST') return await testBooking(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/invites$/);
    if (m && method === 'GET') return await listInvites(env, request, m[1]);
    if (m && method === 'POST') return await createInvite(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/invites\/([\w-]+)$/);
    if (m && method === 'DELETE') return await deleteInvite(env, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/staff$/);
    if (m && method === 'GET') return await listStaff(db, request, m[1]);
    if (m && method === 'POST') return await addStaff(db, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/profiles$/);
    if (m && method === 'GET') return await listProfiles(db, request, m[1]);
    if (m && method === 'POST') return await addProfile(db, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/profiles\/([\w-]+)\/switch$/);
    if (m && method === 'POST') return await switchProfile(db, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/activity$/);
    if (m && method === 'GET') return await listActivity(env, request, m[1]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/staff\/([\w-]+)\/access$/);
    if (m && method === 'PUT') return await setStaffAccess(db, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/staff\/([\w-]+)\/color$/);
    if (m && method === 'PUT') return await setStaffColor(db, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/staff\/([\w-]+)\/password$/);
    if (m && method === 'POST') return await resetStaffPassword(db, request, m[1], m[2]);
    m = pathname.match(/^\/api\/properties\/([\w-]+)\/staff\/([\w-]+)$/);
    if (m && method === 'DELETE') return await removeStaff(db, request, m[1], m[2]);
    if (m && method === 'PUT') return await updateStaff(env, request, m[1], m[2]);

    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status);
    throw err;
  }
}
