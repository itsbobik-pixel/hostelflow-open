// Check-in: guests of a property, document photos, OCR, and sending them to
// the police through the property's registration module. Owners and staff
// can do all of this; only settings are owner-only.

import { HttpError, json, readJson, parseJson as parse } from './http.js';
import { requireUser, requirePermission, requireSees } from './auth.js';
import { encryptCredentials, decryptCredentials, docFingerprint, fieldPrint } from './secrets.js';
import { requireCanSend } from './billing.js';
import { REGISTRATION_MODULES } from './registration/index.js';
import { readDocument, OCR_MODEL, costMicro, REQUIRED_READ } from './ocr.js';
import { alert } from './alerts.js';
import { logActivity } from './activity.js';
import * as ross from './stats/ross1000.js';
import * as rimovcli from './stats/rimovcli.js';
import { zip } from './stats/zip.js';
import { recordLogin } from './policecheck.js';
import { dailyMovement, nationalityReport, parseDay, touchesDay, residenceOf } from './stats/istat.js';
import { MAIN, structureAad, extraStructures, loadStructure, structureWhere } from './structures.js';
import { arrivalsFor, nightsFromCloudbeds, RETRY_WAIT_MS } from './cloudbeds.js';
import { demoGuest, demoMark } from './demo.js';
import { claudeEnv, keyProblem, noteKeyProblem } from './claudekey.js';

const HOUR = 3600 * 1000;
const PHOTO_MAX_AGE_MS = 48 * HOUR;
// Kept after registering only for the regional statistics (Ross1000), then deleted.
const STATS_FIELDS = ['sex', 'dob', 'birthCountry', 'birthPlace', 'birthProvince', 'residencePlace'];
const STATS_KEEP_DAYS = 90;    // photos never outlive this, sent or not
const DRAFT_MAX_AGE_MS = 3 * 24 * HOUR; // unsent guests this old can't be registered any more
const MAX_PHOTO_BASE64 = 1_500_000;    // D1 rows are capped at 2 MB

// What staff can edit. Everything is a short string; the registration module
// decides what's valid.
const FIELDS = [
  'surname', 'given', 'sex', 'dob', 'nationality', 'birthCountry', 'birthPlace', 'birthProvince',
  'docType', 'docNumber', 'country', 'issuePlace', 'issueProvince', 'expiry',
  'arrival', 'nights', 'guestType', 'groupLeader',
  'residenceCountry', 'residenceProvince', // for ISTAT; residence defaults to nationality
  'visa', 'homeAddress', 'phone', 'email', // asked by some countries' police (Czechia, France)
  'residencePlace', // comune of residence (Italians; Ross1000 statistics)
];

const LEADER_TYPES = ['17', '18'];
const MEMBER_TYPES = ['19', '20'];
// Alloggiati's pairs: a family member (19) belongs to a head of family (17),
// a group member (20) to a group leader (18).
const LEADER_OF = { 19: '17', 20: '18' };

function cleanFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'fields must be an object');
  const out = {};
  for (const key of FIELDS) {
    let v = input[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') throw new HttpError(400, `${key} must be text`);
    v = v.trim();
    if (v.length > 100) throw new HttpError(400, `${key} is too long`);
    if (v) out[key] = v;
  }
  return out;
}

// DD.MM.YYYY in the property's time zone.
export function todayIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('day')}.${get('month')}.${get('year')}`;
}

// Settings → Team: 'read' looks at the guests and the statistics, 'edit'
// scans, corrects and sends them.
async function context(env, request, propertyId, edit = true) {
  const user = await requireUser(env.DB, request);
  await (edit ? requirePermission : requireSees)(env.DB, user.id, propertyId, 'checkin');
  const property = await env.DB.prepare(
    `SELECT id, timezone, registration, registration_credentials, billing_status, trial_ends_at, scan_limit, billing_parent, paused_at, created_at,
       cloudbeds_credentials, cloudbeds_property_id, cloudbeds_nights, cloudbeds_last_error, demo_until,
       claude_credentials, claude_last_error
     FROM properties WHERE id = ?`,
  ).bind(propertyId).first();
  const module = property.registration ? REGISTRATION_MODULES[property.registration] : null;
  return { user, property, module };
}

// Cloudbeds had no booking for the guest and nobody picked the nights since:
// not sent as "1 night" by default.
const NIGHTS_UNPICKED = 'pick the number of nights';
const nightsUnpicked = (ocr, fields) => !fields.nights && !!(parse(ocr) || {}).nightsMissed;

function view(module, row) {
  const fields = parse(row.fields) || {};
  let problems = [];
  if (module && row.status !== 'sent') {
    const v = module.validate({ id: row.id, fields });
    if (!v.ok) problems = v.errors;
  }
  if (row.status !== 'sent' && nightsUnpicked(row.ocr, fields)) problems = [...problems, NIGHTS_UNPICKED];
  return {
    id: row.id,
    status: row.status === 'sent' ? 'sent' : 'draft',
    fields,
    problems,
    ocr: parse(row.ocr),
    lastCheck: parse(row.last_check),
    hasPhoto: !!row.has_photo,
    structure: row.structure_id || MAIN,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

const SELECT_GUEST = `SELECT g.*, EXISTS (SELECT 1 FROM guest_photos ph WHERE ph.guest_id = g.id) AS has_photo
  FROM guests g`;

async function loadGuest(db, propertyId, guestId) {
  const row = await db.prepare(`${SELECT_GUEST} WHERE g.id = ? AND g.property_id = ?`).bind(guestId, propertyId).first();
  if (!row) throw new HttpError(404, 'guest not found');
  return row;
}

export async function listGuests(env, request, propertyId) {
  const { module } = await context(env, request, propertyId, false);
  const { results } = await env.DB.prepare(
    `${SELECT_GUEST} WHERE g.property_id = ? AND g.status != 'sent'
     ORDER BY g.created_at DESC LIMIT 300`,
  ).bind(propertyId).all();
  return json(results.map(r => view(module, r)));
}

export function parseImage(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'the photo must be a JPEG, PNG or WebP');
  if (m[2].length > MAX_PHOTO_BASE64) throw new HttpError(413, 'photo is too large');
  return { mediaType: m[1], data: m[2] };
}

// Body: { image?: dataURL, fields?: {...} }. With an image the document is
// read right away; if that fails the guest is still created, for manual entry.
export async function createGuest(env, request, propertyId) {
  const db = env.DB;
  const { user, property, module } = await context(env, request, propertyId);
  const body = await readJson(request);
  const image = body.image !== undefined ? parseImage(body.image) : null;
  const now = Date.now();
  const id = crypto.randomUUID();
  let fields = { arrival: todayIn(property.timezone), ...cleanFields(body.fields || {}) };
  // Two structures: the one picked on the phone (the last one used) comes along.
  const structure = await loadStructure(db, propertyId, body.structure);

  const statements = [
    db.prepare('INSERT INTO guests (id, property_id, status, fields, created_by, created_at, updated_at, structure_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, propertyId, 'draft', JSON.stringify(fields), user.id, now, now, structure ? structure.id : null),
  ];
  if (image) {
    statements.push(db.prepare('INSERT INTO guest_photos (guest_id, property_id, media_type, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, propertyId, image.mediaType, image.data, now));
  }
  await db.batch(statements);

  if (image) {
    let ocr;
    const month = new Date(now).toISOString().slice(0, 7);
    // Settings → Check-in scan: on the property's own key and credit,
    // with no limit from us (src/claudekey.js).
    const claude = await claudeEnv(env, property);
    const cenv = claude.env;
    const limit = claude.own ? null : scanLimit(env, property);
    const used = limit === null ? 0 : await scansUsed(db, property, now);
    if (property.demo_until) {
      // The demo (src/demo.js): a made-up guest, without asking Claude.
      fields = { ...demoGuest(fields.arrival), ...fields };
      ocr = { confidence: 'high', notes: '', demo: true };
      await demoMark(db, propertyId, 'tried');
    } else if (!cenv.ANTHROPIC_API_KEY && !env.readDocument) {
      ocr = { error: 'to scan documents, the owner connects Claude in Settings → Check-in scan' };
    } else if (limit !== null && used >= limit) {
      ocr = { error: trialWide(property)
        ? `the ${limit} free document scans are used up — fill in by hand, or the owner connects Claude in Settings → Check-in scan`
        : `monthly limit of ${limit} document scans reached — fill in by hand; it resets on the 1st` };
    } else {
      // Cloudbeds (Settings → Integrations): the day's bookings are fetched
      // while the document is read, then matched by the name read.
      const bookings = fields.nights ? null : arrivalsFor(env, property, fields.arrival);
      try {
        const reader = env.readDocument || readDocument; // env.readDocument: test stand-in
        // The first reading: the cheaper model when env.OCR_PRIMARY_MODEL says so, else the main one.
        const primary = cenv.OCR_PRIMARY_MODEL || OCR_MODEL;
        const cheapFirst = primary !== OCR_MODEL;
        // Alongside, for comparison: with the main model first, the cheaper one on every scan
        // (env.OCR_SHADOW_MODEL); with the cheaper first, the main one on a share of them (env.OCR_SHADOW_RATE).
        const otherModel = cheapFirst ? OCR_MODEL : cenv.OCR_SHADOW_MODEL;
        const sample = cheapFirst ? Math.random() < Number(cenv.OCR_SHADOW_RATE || 0) : true;
        const shadow = otherModel && sample && (env.shadowReadDocument || !env.readDocument) ? shadowRead(cenv, image, otherModel) : null;
        const first = await reader(cenv, image, undefined, primary);
        const used = [[primary, first.usage]];
        let read = first;
        // The cheaper model left something needed empty: the main model reads it again and fills the gaps.
        const missing = cheapFirst ? REQUIRED_READ.filter(k => !String((first.fields || {})[k] || '').trim()) : [];
        let second = null;
        if (missing.length) {
          const started = Date.now();
          try {
            const again = shadow ? (await shadow).read : null;
            second = again ? { read: again, ms: Date.now() - started } : { read: await reader(cenv, image, undefined, OCR_MODEL), ms: Date.now() - started };
            if (!again) used.push([OCR_MODEL, second.read.usage]);
            const merged = {};
            for (const k of new Set([...Object.keys(second.read.fields || {}), ...Object.keys(first.fields || {})])) {
              merged[k] = String((first.fields || {})[k] || '').trim() ? first.fields[k] : second.read.fields[k];
            }
            read = { fields: merged, confidence: second.read.confidence, notes: second.read.notes || first.notes };
          } catch (err) { console.error('second reading failed', err); }
        }
        const compared = second || (shadow ? await shadow : null);
        if (shadow && !second) used.push([otherModel, compared.read && compared.read.usage]);
        // The cheaper model misreads the sex far more than anything else (13.–20. 10.
        // the main one was right 10 times of 11, even after the MRZ hint): whenever
        // the main model read the scan too, its sex counts.
        // Not when the MRZ check digits already proved the cheaper one's (mrz.js).
        const mainSex = cheapFirst && !first.sexFromMrz && compared && compared.read && String((compared.read.fields || {}).sex || '').trim();
        if (mainSex) read = { ...read, fields: { ...read.fields, sex: mainSex } };
        if (compared) await recordShadow(env, propertyId, id, first, compared, `${primary}>${cheapFirst ? OCR_MODEL : otherModel}`, missing);
        ocr = { confidence: read.confidence, notes: read.notes };
        if (claude.own && property.claude_last_error) await noteKeyProblem(env, propertyId, null);
        // How often the MRZ settles the sex (no guest data, only where it came from).
        if (first.sexFromMrz) ocr.sexFrom = 'mrz';
        fields = { ...read.fields, ...fields };
        if (!fields.nights) {
          const why = {};
          const nights = await nightsFromCloudbeds(env, property, bookings, fields, why);
          if (nights) { fields.nights = String(nights); ocr.nightsFrom = 'cloudbeds'; }
          // Looked for and not found: Check-in asks staff to pick the nights.
          else if (bookings) { ocr.nightsMissed = true; ocr.nightsWhy = why; }
        }
        const tokens = k => used.reduce((n, [, u]) => n + ((u && u[k]) || 0), 0);
        const cost = used.reduce((n, [m, u]) => n + costMicro(m, u || {}), 0);
        await db.batch([
          db.prepare(
            `INSERT INTO usage_monthly (property_id, month, scans, input_tokens, output_tokens, cost_micro) VALUES (?, ?, 1, ?, ?, ?)
             ON CONFLICT (property_id, month) DO UPDATE SET scans = scans + 1,
               input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
               cost_micro = cost_micro + excluded.cost_micro`,
          ).bind(propertyId, month, tokens('input_tokens'), tokens('output_tokens'), cost),
          // Per (Italian) day too, for the admin centre.
          db.prepare(
            `INSERT INTO usage_daily (property_id, day, scans, cost_micro) VALUES (?, ?, 1, ?)
             ON CONFLICT (property_id, day) DO UPDATE SET scans = scans + 1, cost_micro = cost_micro + excluded.cost_micro`,
          ).bind(propertyId, new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now), cost),
        ]);
      } catch (err) {
        console.error('ocr failed', err);
        const problem = keyProblem(err);
        // The property's own key turned down or its credit used up: the owner
        // sees why in Settings; it's theirs to fix, not an alert for us.
        if (claude.own && problem) await noteKeyProblem(env, propertyId, problem);
        else await alert(env, 'scan', `Document reading failed (property ${propertyId}): ${err.message || err}`);
        // A setup problem (bad or wrongly scoped API key, no credit) fails every
        // scan — say so, instead of making staff retry photos that are fine.
        ocr = problem
          ? { error: 'document reading isn\'t working. Fill in the details by hand and tell the owner' }
          : { error: 'the document could not be read — fill in the fields by hand' };
      }
    }
    await db.prepare('UPDATE guests SET fields = ?, ocr = ?, updated_at = ? WHERE id = ? AND property_id = ?')
      .bind(JSON.stringify(fields), JSON.stringify(ocr), Date.now(), id, propertyId).run();
  }
  return json(view(module, await loadGuest(db, propertyId, id)), 201);
}

// Body: { fields, structure? }. Replaces all fields. Sent guests are final.
export async function updateGuest(env, request, propertyId, guestId) {
  const { module } = await context(env, request, propertyId);
  const row = await loadGuest(env.DB, propertyId, guestId);
  if (row.status === 'sent') throw new HttpError(409, 'this guest is already registered');
  const body = await readJson(request);
  const fields = cleanFields(body.fields);
  const structureId = body.structure === undefined ? row.structure_id
    : ((await loadStructure(env.DB, propertyId, body.structure)) || { id: null }).id;
  // Only while it is still a draft: sent (or being sent) a moment ago, it keeps
  // what the sending left of it, never the full personal data again.
  const r = await env.DB.prepare(`UPDATE guests SET fields = ?, structure_id = ?, updated_at = ? WHERE id = ? AND property_id = ? AND status NOT IN ('sent', 'sending')`)
    .bind(JSON.stringify(fields), structureId, Date.now(), guestId, propertyId).run();
  if (!r.meta.changes) throw new HttpError(409, 'this guest is already registered');
  return json(view(module, await loadGuest(env.DB, propertyId, guestId)));
}

// Cloudbeds was too slow for the scan: asked again, waiting longer, for a
// guest whose nights nobody has picked yet. Only the nights change.
export async function retryNights(env, request, propertyId, guestId) {
  const { module, property } = await context(env, request, propertyId);
  const row = await loadGuest(env.DB, propertyId, guestId);
  const fields = parse(row.fields) || {};
  const ocr = parse(row.ocr) || {};
  if (row.status === 'sent' || fields.nights || !ocr.nightsMissed) return json(view(module, row));
  const why = {};
  const nights = await nightsFromCloudbeds(env, property, arrivalsFor(env, property, fields.arrival), fields, why, RETRY_WAIT_MS);
  if (nights) {
    delete ocr.nightsMissed;
    delete ocr.nightsWhy;
    ocr.nightsFrom = 'cloudbeds';
  } else ocr.nightsWhy = why;
  // Only into what's still there unchanged: staff may have picked the nights meanwhile.
  const found = nights ? [String(nights)] : [];
  await env.DB.prepare(`UPDATE guests SET ${nights ? "fields = json_set(fields, '$.nights', ?), " : ''}ocr = ?, updated_at = ?
     WHERE id = ? AND property_id = ? AND status = 'draft' AND json_extract(fields, '$.nights') IS NULL`)
    .bind(...found, JSON.stringify(ocr), Date.now(), guestId, propertyId).run();
  return json(view(module, await loadGuest(env.DB, propertyId, guestId)));
}

export async function deleteGuest(env, request, propertyId, guestId) {
  await context(env, request, propertyId);
  const row = await loadGuest(env.DB, propertyId, guestId);
  // Registered guests stay (the police have them; the statistics already
  // counted them — a day sent to RiMovCli must not change afterwards).
  if (row.status === 'sent') throw new HttpError(409, 'this guest is already registered');
  await env.DB.prepare(`DELETE FROM guests WHERE id = ? AND property_id = ? AND status NOT IN ('sent', 'sending')`).bind(guestId, propertyId).run();
  return json({ ok: true });
}

// Body: { ids }. Deletes these guests if not registered yet (photos go with
// them) — only the ones on the caller's screen, never a guest a colleague
// scanned meanwhile. Registered guests stay: needed for ISTAT and as a record.
export async function clearDrafts(env, request, propertyId) {
  await context(env, request, propertyId);
  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(i => typeof i === 'string'))].slice(0, 300) : [];
  if (!ids.length) return json({ deleted: 0 });
  const r = await env.DB.prepare(
    `DELETE FROM guests WHERE property_id = ? AND status NOT IN ('sent', 'sending') AND id IN (${ids.map(() => '?').join(',')})`,
  ).bind(propertyId, ...ids).run();
  return json({ deleted: r.meta.changes });
}

export async function guestPhoto(env, request, propertyId, guestId) {
  await context(env, request, propertyId, false);
  const photo = await env.DB.prepare('SELECT media_type, data FROM guest_photos WHERE guest_id = ? AND property_id = ?')
    .bind(guestId, propertyId).first();
  if (!photo) throw new HttpError(404, 'no photo');
  const bytes = Uint8Array.from(atob(photo.data), c => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { 'Content-Type': photo.media_type, 'Cache-Control': 'private, no-store' },
  });
}

// Families and groups go in as leader first, members right after it.
// Members point at their leader with fields.groupLeader (a guest id).
export function orderForSubmission(guests) {
  const byId = new Map(guests.map(g => [g.id, g]));
  const members = new Map();
  for (const g of guests) {
    if (!MEMBER_TYPES.includes(g.fields.guestType)) continue;
    const leader = byId.get(g.fields.groupLeader);
    const name = `${g.fields.given || ''} ${g.fields.surname || ''}`.trim() || 'a guest';
    if (!leader || !LEADER_TYPES.includes(leader.fields.guestType)) {
      throw new HttpError(400, `${name} is a family/group member — send them together with their head of family or group leader`);
    }
    if (leader.fields.guestType !== LEADER_OF[g.fields.guestType]) {
      throw new HttpError(400, g.fields.guestType === '19'
        ? `${name} is a family member — they belong to a head of family, not a group leader`
        : `${name} is a group member — they belong to a group leader, not a head of family`);
    }
    if (!members.has(leader.id)) members.set(leader.id, []);
    members.get(leader.id).push(g);
  }
  const out = [];
  for (const g of guests) {
    if (MEMBER_TYPES.includes(g.fields.guestType)) continue;
    out.push(g, ...(members.get(g.id) || []));
  }
  return out;
}

// The shadow comparison: which fields a second model read differently. Only
// the field names are stored, never what is on the document.
const COMPARED = ['surname', 'given', 'sex', 'dob', 'nationality', 'docType', 'docNumber', 'country', 'expiry', 'birthPlace'];
async function shadowRead(env, image, model) {
  const started = Date.now();
  try {
    // Never holds the scan up for long: the main reading is what counts.
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000));
    const reader = env.shadowReadDocument || readDocument; // env.shadowReadDocument: test stand-in
    return { read: await Promise.race([reader(env, image, undefined, model), late]), ms: Date.now() - started };
  } catch (err) {
    return { error: String(err.message || err).slice(0, 200), ms: Date.now() - started };
  }
}
export function shadowDiff(a, b) {
  const norm = v => String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
  return COMPARED.filter(k => norm(a[k]) !== norm(b[k]));
}
async function recordShadow(env, propertyId, guestId, main, shadow, pair, gaps = []) {
  try {
    const differs = shadow.read ? shadowDiff(main.fields, shadow.read.fields) : null;
    // Where they differ: a print of each reading, to see at sending who was right.
    let prints = null;
    if (differs && differs.length) {
      prints = {};
      for (const k of differs) {
        prints[k] = [await fieldPrint(env, propertyId, k, main.fields[k]), await fieldPrint(env, propertyId, k, shadow.read.fields[k])];
      }
    }
    await env.DB.prepare('INSERT INTO ocr_shadow (id, model, created_at, differs, error, input_tokens, output_tokens, ms, guest_id, prints, pair, gaps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), String(shadow.read ? 'ok' : 'error'), Date.now(),
        differs ? JSON.stringify(differs) : null, shadow.error || null,
        (shadow.read && shadow.read.usage && shadow.read.usage.input_tokens) || 0, (shadow.read && shadow.read.usage && shadow.read.usage.output_tokens) || 0, shadow.ms,
        guestId, prints ? JSON.stringify(prints) : null, pair || null, JSON.stringify(gaps || []))
      .run();
  } catch (err) { console.error('shadow record failed', err); }
}

// A guest that passed Test or was sent: for each field the two models read
// differently, whose reading matches what staff checked. Only the verdict stays
// — { field: 'main' | 'shadow' | 'neither' }; on sending the prints go too.
async function judgeShadow(env, propertyId, guest, final) {
  try {
    const row = await env.DB.prepare('SELECT id, prints FROM ocr_shadow WHERE guest_id = ? AND prints IS NOT NULL').bind(guest.id).first();
    if (!row) return;
    const verdict = {};
    for (const [k, [m, s]] of Object.entries(JSON.parse(row.prints))) {
      const sent = await fieldPrint(env, propertyId, k, guest.fields[k]);
      verdict[k] = sent === m ? 'main' : sent === s ? 'shadow' : 'neither';
    }
    await env.DB.prepare(`UPDATE ocr_shadow SET verdict = ?${final ? ', prints = NULL' : ''} WHERE id = ?`).bind(JSON.stringify(verdict), row.id).run();
  } catch (err) { console.error('shadow verdict failed', err); }
}

// What a registered guest keeps: ISTAT needs nationality, arrival and nights.
// Everything personal goes the moment the police has it.
const KEEP_AFTER_SEND = ['nationality', 'residenceCountry', 'residenceProvince', 'arrival', 'nights', 'guestType'];
const DUPLICATE_WINDOW_MS = 30 * 24 * HOUR;

// In Italy the regional statistics (Ross1000) want sex, birth and residence
// per guest too: those stay STATS_KEEP_DAYS, then the cleanup takes them.
function minimize(fields, module) {
  const keep = module && module.id === 'it-alloggiati' ? [...KEEP_AFTER_SEND, ...STATS_FIELDS, 'groupLeader'] : KEEP_AFTER_SEND;
  const out = {};
  for (const k of keep) if (fields[k]) out[k] = fields[k];
  return out;
}

const guestName = g => `${g.fields.given || ''} ${g.fields.surname || ''}`.trim() || 'a guest';

// The same document twice in this batch, or already registered in the last
// 30 days. Returns human-readable lines; empty when all is fine.
async function findDuplicates(db, property, guests, prints) {
  const lines = [];
  const seen = new Map();
  guests.forEach((g, i) => {
    if (!prints[i]) return;
    if (seen.has(prints[i])) lines.push(`${guestName(g)} and ${guestName(seen.get(prints[i]))} have the same document number`);
    else seen.set(prints[i], g);
  });
  const unique = [...seen.keys()];
  if (unique.length) {
    const { results } = await db.prepare(
      `SELECT doc_hash, MAX(sent_at) AS sent_at FROM guests
       WHERE property_id = ? AND status = 'sent' AND sent_at > ? AND doc_hash IN (${unique.map(() => '?').join(',')})
       GROUP BY doc_hash`,
    ).bind(property.id, Date.now() - DUPLICATE_WINDOW_MS, ...unique).all();
    for (const row of results) {
      const g = seen.get(row.doc_hash);
      lines.push(`${guestName(g)}: this document was already registered on ${todayIn(property.timezone, new Date(row.sent_at))}`);
    }
  }
  return lines;
}

// How long a Send holds its guests ('sending'); after that a send that died
// lets go of them. Longer than a submission of 100 guests ever takes.
const SEND_CLAIM_MS = 3 * 60 * 1000;
// Our own claim (stamped with this send's time) back to a draft.
async function releaseClaim(db, propertyId, ids, claimedAt) {
  await db.prepare(
    `UPDATE guests SET status = 'draft' WHERE property_id = ? AND status = 'sending' AND updated_at = ? AND id IN (${ids.map(() => '?').join(',')})`,
  ).bind(propertyId, claimedAt, ...ids).run();
}

// Body: { ids: [...], mode: 'test' | 'send', allowDuplicates? }. 'send' always
// tests first and sends nothing unless every guest passes, so a batch never
// goes in half. Possible duplicates stop both modes until confirmed.
// A property with two structures has two police accounts: the guests go in
// one submission per structure, each to its own account — never mixed.
export async function sendGuests(env, request, propertyId) {
  const db = env.DB;
  const { user, property, module } = await context(env, request, propertyId);
  const body = await readJson(request);
  const mode = body.mode === 'send' ? 'send' : 'test';
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(i => typeof i === 'string'))] : [];
  if (!ids.length) throw new HttpError(400, 'choose at least one guest');
  if (ids.length > 100) throw new HttpError(400, 'send at most 100 guests at once');
  if (!module) throw new HttpError(400, 'the owner has not set up police registration yet (Settings)');
  await requireCanSend(env, property); // scanning and editing stay free; sending needs a subscription after the trial

  const { results: rows } = await db.prepare(
    `SELECT id, status, fields, structure_id, ocr FROM guests WHERE property_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
  ).bind(propertyId, ...ids).all();
  if (rows.length !== ids.length) throw new HttpError(404, 'some of these guests no longer exist');
  if (rows.some(r => r.status === 'sent')) throw new HttpError(409, 'some of these guests are already registered');
  if (rows.some(r => nightsUnpicked(r.ocr, parse(r.fields) || {}))) throw new HttpError(400, 'some of these guests weren\'t found in Cloudbeds — pick their nights first');

  // One batch per structure, each with that structure's login.
  const extra = await extraStructures(db, propertyId);
  const batches = [];
  for (const sid of new Set(rows.map(r => r.structure_id || null))) {
    const structure = sid ? extra.find(s => s.id === sid) : null;
    if (sid && !structure) throw new HttpError(400, 'some of these guests are in a structure that no longer exists — open them and choose another');
    const creds = property.demo_until ? null : structure
      ? await decryptCredentials(env, structureAad(propertyId, sid), structure.registration_credentials)
      : await decryptCredentials(env, property.id, property.registration_credentials);
    if (creds && module.credentialFields.some(f => !f.optional && !creds[f.key])) {
      throw new HttpError(400, structure
        ? `${structure.name}: the police portal login is incomplete — the owner can fix it in Settings`
        : 'the police portal login is incomplete — the owner can fix it in Settings');
    }
    // Family/group members must be in the same structure as their leader: else they don't find them here.
    // No arrival date (someone emptied it): Alloggiati takes today in Italy —
    // filled in here, so what is stored for the statistics is what was sent.
    // (Other countries' modules ask for the date instead.)
    const fill = module.id === 'it-alloggiati' ? { arrival: todayIn('Europe/Rome') } : {};
    const guests = orderForSubmission(rows.filter(r => (r.structure_id || null) === sid)
      .map(r => ({ id: r.id, fields: { ...fill, ...(parse(r.fields) || {}) } })));
    batches.push({ sid, creds, guests });
  }
  const guests = batches.flatMap(b => b.guests);

  // Family/group members are sent without a document, so only the others count.
  const prints = await Promise.all(guests.map(g => (MEMBER_TYPES.includes(g.fields.guestType)
    ? null : docFingerprint(env, propertyId, g.fields.docNumber))));
  if (!body.allowDuplicates) {
    const duplicates = await findDuplicates(db, property, guests, prints);
    if (duplicates.length) {
      return json({ error: 'possible duplicates', code: 'duplicate', duplicates }, 409);
    }
  }

  const now = Date.now();
  const run = async (b, m) => {
    // The demo (src/demo.js): checked here as the police would, nothing leaves HostelFlow.
    if (property.demo_until) {
      const results = b.guests.map(g => { const { record, ...r } = { id: g.id, ...module.validate(g) }; return r; });
      return { ok: results.every(r => r.ok), results };
    }
    try {
      const r = await module.submit(b.creds, b.guests, m);
      await recordLogin(env, propertyId, { ok: true }, Date.now(), b.sid);
      return r;
    } catch (err) {
      if (err.code === 'login') await recordLogin(env, propertyId, { ok: false, login: true, message: String(err.message || err) }, Date.now(), b.sid);
      await alert(env, `police-${module.id}`, `${m === 'send' ? 'Sending' : 'Checking'} guests failed (property ${propertyId}${b.sid ? ', second structure' : ''}): ${err.message || err}`);
      throw new HttpError(502, String(err.message || err));
    }
  };
  // Every batch is tested first; only when all pass does anything go in.
  const tested = [];
  for (const b of batches) tested.push(await run(b, 'test'));
  let results = tested.flatMap(r => r.results);
  let ok = tested.every(r => r.ok);
  let sent = false;
  let failure = null;
  let claimed = false;
  if (mode === 'send' && ok) {
    // These guests are ours to send: two Sends at once (a double tap, two
    // colleagues) would otherwise both get through and register them twice.
    // All or none, in one statement; a claim left by a send that died is free
    // again after a few minutes.
    const marks = ids.map(() => '?').join(',');
    const claim = await db.prepare(
      `UPDATE guests SET status = 'sending', updated_at = ? WHERE property_id = ? AND id IN (${marks})
         AND NOT EXISTS (SELECT 1 FROM guests WHERE property_id = ? AND id IN (${marks})
           AND (status = 'sent' OR (status = 'sending' AND updated_at > ?)))`,
    ).bind(now, propertyId, ...ids, propertyId, ...ids, now - SEND_CLAIM_MS).run();
    claimed = true;
    if (claim.meta.changes !== ids.length) {
      await releaseClaim(db, propertyId, ids, now); // one was deleted meanwhile: none go
      throw new HttpError(409, 'these guests are being sent right now — wait a moment and refresh');
    }
    sent = true;
    results = [];
    for (const b of batches) {
      try {
        const r = await run(b, 'send');
        results.push(...r.results);
        ok = ok && r.ok;
      } catch (err) {
        // The batches already in are recorded below; this one and the rest stay to send.
        failure = err;
        break;
      }
    }
  }

  const statements = [];
  for (const r of results) {
    const check = JSON.stringify({ mode: sent ? 'send' : 'test', ok: r.ok, errors: r.errors || [], at: now });
    if (sent && r.ok) {
      const i = guests.findIndex(g => g.id === r.id);
      statements.push(
        db.prepare(
          `UPDATE guests SET status = 'sent', sent_at = ?, last_check = ?, fields = ?, doc_hash = ?, ocr = NULL,
             updated_at = ? WHERE id = ?`,
        ).bind(now, check, JSON.stringify(minimize(guests[i].fields, module)), prints[i], now, r.id),
        // France: the fiche stays (encrypted) for the months the law asks, then the cleanup deletes it.
        ...(r.keep && module.keepsFiches ? [db.prepare('UPDATE guests SET fiche = ?, fiche_until = ? WHERE id = ?')
          .bind(await encryptCredentials(env, propertyId, r.keep), now + module.keepsFiches * 24 * HOUR, r.id)] : []),
        db.prepare('DELETE FROM guest_photos WHERE guest_id = ?').bind(r.id),
      );
    } else {
      statements.push(db.prepare('UPDATE guests SET last_check = ?, updated_at = ? WHERE id = ?').bind(check, now, r.id));
    }
  }
  if (statements.length) await db.batch(statements);
  // Whatever didn't go in (refused, or a batch that failed) is a draft again.
  if (claimed) await releaseClaim(db, propertyId, ids, now);
  const registered = sent ? results.filter(r => r.ok).length : 0;
  if (registered) await logActivity(db, propertyId, user, 'guests_sent', registered);
  // Test passed or sent: the checked fields say which model read them right.
  for (const r of results) if (r.ok) await judgeShadow(env, propertyId, guests.find(g => g.id === r.id), sent);
  if (property.demo_until) await demoMark(db, propertyId, 'tried');
  if (failure) throw failure;
  return json({ mode: sent ? 'send' : 'test', ok, results: results.map(({ keep, ...r }) => r) });
}

// Body: { nights }. For a registered guest who left early (or stayed longer):
// the police don't need to know, but ISTAT counts nights.
// Body: { nights?, residenceCountry?, residenceProvince? } — also for the
// ISTAT tab: an Italian resident's province is often only known later.
export async function updateStay(env, request, propertyId, guestId) {
  const { module } = await context(env, request, propertyId);
  const row = await loadGuest(env.DB, propertyId, guestId);
  const body = await readJson(request);
  const fields = { ...(parse(row.fields) || {}) };
  if (body.nights !== undefined) {
    const nights = Number(body.nights);
    if (!Number.isInteger(nights) || nights < 1 || nights > 30) throw new HttpError(400, 'nights must be between 1 and 30');
    fields.nights = String(nights);
  }
  for (const key of ['residenceCountry', 'residenceProvince']) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string' || body[key].length > 60) throw new HttpError(400, `${key} must be short text`);
    const v = body[key].trim();
    if (v) fields[key] = key === 'residenceProvince' ? v.toUpperCase() : v; else delete fields[key];
  }
  await env.DB.prepare('UPDATE guests SET fields = ?, updated_at = ? WHERE id = ? AND property_id = ?')
    .bind(JSON.stringify(fields), Date.now(), guestId, propertyId).run();
  return json(view(module, await loadGuest(env.DB, propertyId, guestId)));
}

// GET ?date=YYYY-MM-DD[&structure=id]: ISTAT movement for that day from
// registered guests (of one structure: the main one when not said).
export async function istatDay(env, request, propertyId) {
  await context(env, request, propertyId, false);
  const q = new URL(request.url).searchParams;
  const date = q.get('date');
  const day = parseDay(date);
  if (day === null) throw new HttpError(400, 'date must be YYYY-MM-DD');
  const where = structureWhere(await loadStructure(env.DB, propertyId, q.get('structure')));
  // Guests are registered within a day of arriving and stay at most 30 nights.
  const { results } = await env.DB.prepare(
    `SELECT id, fields FROM guests WHERE property_id = ? AND status = 'sent' AND sent_at BETWEEN ? AND ? AND ${where.sql} ORDER BY sent_at`,
  ).bind(propertyId, day - 33 * 24 * HOUR, day + 2 * 24 * HOUR, ...where.args).all();
  const registered = results.map(r => ({ id: r.id, fields: parse(r.fields) || {} }));
  // Registered guests leave the check-in list; this is where they can still
  // be corrected (left early, residence for ISTAT).
  const guests = registered.filter(g => touchesDay(g.fields, day)).map(g => ({
    id: g.id, fields: g.fields, place: residenceOf(g.fields).label,
  }));
  return json({ date, ...dailyMovement(registered, day), guests });
}

// Settings → ISTAT report: nationalities arrived and departed per day.
const REPORT_MAX_DAYS = 62;
export async function istatReport(env, request, propertyId) {
  await context(env, request, propertyId, false);
  const q = new URL(request.url).searchParams;
  const from = parseDay(q.get('from'));
  const to = parseDay(q.get('to'));
  if (from === null || to === null || to < from) throw new HttpError(400, 'choose a start and an end day');
  if ((to - from) / (24 * HOUR) >= REPORT_MAX_DAYS) throw new HttpError(400, 'at most two months at a time');
  const where = structureWhere(await loadStructure(env.DB, propertyId, q.get('structure')));
  const { results } = await env.DB.prepare(
    `SELECT fields FROM guests WHERE property_id = ? AND status = 'sent' AND sent_at BETWEEN ? AND ? AND ${where.sql}`,
  ).bind(propertyId, from - 33 * 24 * HOUR, to + 2 * 24 * HOUR, ...where.args).all();
  const guests = results.map(r => ({ fields: parse(r.fields) || {} }));
  return json({ days: nationalityReport(guests, from, to) });
}

// France: the kept fiches of guests who arrived between two days, for the
// police or the gendarmerie when they ask (printed in the app).
export async function fichesReport(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requirePermission(env.DB, user.id, propertyId, 'police');
  const q = new URL(request.url).searchParams;
  const from = parseDay(q.get('from'));
  const to = parseDay(q.get('to'));
  if (from === null || to === null || to < from) throw new HttpError(400, 'choose a start and an end day');
  const { results } = await env.DB.prepare(
    "SELECT fiche FROM guests WHERE property_id = ? AND status = 'sent' AND fiche IS NOT NULL AND sent_at BETWEEN ? AND ? ORDER BY sent_at",
  ).bind(propertyId, from - 2 * 24 * HOUR, to + 2 * 24 * HOUR).all();
  const fiches = [];
  for (const r of results) fiches.push(await decryptCredentials(env, propertyId, r.fiche));
  const day = s => { const [d, m, y] = s.split('/').map(Number); return Date.UTC(y, m - 1, d); };
  return json({ fiches: fiches.filter(f => { const a = day(f.arrivee); return a >= from && a <= to + 12 * HOUR; }) });
}

// Ross1000 (Italian regional statistics): the days from..to as a file to
// upload, or sent through the region's web service. With two structures each
// has its own codes and counts only its own guests (?structure=, or
// body.structure; the main one when not said).
async function statsContext(env, request, propertyId, structureId) {
  const user = await requireUser(env.DB, request);
  await requirePermission(env.DB, user.id, propertyId, 'police');
  const p = await env.DB.prepare('SELECT id, stats_settings FROM properties WHERE id = ?').bind(propertyId).first();
  const structure = await loadStructure(env.DB, propertyId, structureId);
  const main = await decryptCredentials(env, propertyId, p.stats_settings);
  if (structure) {
    // The region is the same house's; the codes, login, rooms and beds are its own.
    const settings = await decryptCredentials(env, structureAad(propertyId, structure.id), structure.stats_settings);
    settings.region = settings.region || main.region;
    // Settings → Property lists the rooms of the whole house: here they must be said.
    if (!settings.rooms || !settings.beds) throw new HttpError(400, `${structure.name}: fill in its rooms and beds first`);
    return { settings, structure };
  }
  const settings = main;
  // Rooms and beds: as set, else counted from Settings → Property.
  if (!settings.rooms || !settings.beds) {
    const rooms = await env.DB.prepare("SELECT COUNT(*) AS n FROM rooms WHERE property_id = ? AND kind = 'room'").bind(propertyId).first('n');
    const beds = await env.DB.prepare('SELECT COUNT(*) AS n FROM beds WHERE property_id = ?').bind(propertyId).first('n');
    settings.rooms = settings.rooms || rooms || 1;
    settings.beds = settings.beds || beds || 1;
  }
  return { settings, structure: null };
}
// Registered guests of one structure who may have been in the house between
// from and to. Each structure's days follow on from its own nights only.
async function statsGuests(env, propertyId, structure, from, to) {
  if (from === null || to === null || to < from) throw new HttpError(400, 'choose a start and an end day');
  if ((to - from) / (24 * HOUR) >= REPORT_MAX_DAYS) throw new HttpError(400, 'at most two months at a time');
  const where = structureWhere(structure);
  const { results } = await env.DB.prepare(
    `SELECT id, fields FROM guests WHERE property_id = ? AND status = 'sent' AND sent_at BETWEEN ? AND ? AND ${where.sql} ORDER BY sent_at`,
  ).bind(propertyId, from - 33 * 24 * HOUR, to + 2 * 24 * HOUR, ...where.args).all();
  return results.map(r => ({ id: r.id, fields: parse(r.fields) || {} }));
}
// A file name says which structure it is for, so two downloads don't get mixed up.
const fileTag = structure => (structure ? `-${structure.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'structure'}` : '');
async function rossBuild(env, request, propertyId, from, to, structureId) {
  const { settings, structure } = await statsContext(env, request, propertyId, structureId);
  if (!settings.codice) throw new HttpError(400, 'fill in the Ross1000 code of the property first');
  const guests = await statsGuests(env, propertyId, structure, from, to);
  return { settings, structure, ...ross.movimenti(guests, from, to, settings) };
}
export async function rossFile(env, request, propertyId) {
  const q = new URL(request.url).searchParams;
  const { inner, problems, structure } = await rossBuild(env, request, propertyId, parseDay(q.get('from')), parseDay(q.get('to')), q.get('structure'));
  if (q.get('check')) return json({ problems });
  return new Response(ross.fileXml(inner), { headers: {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="ross1000${fileTag(structure)}-${q.get('from')}-${q.get('to')}.xml"`,
  } });
}
// RiMovCli (Liguria, C/59): a file per day — one day as XML, more as a zip.
export async function rimovcliFile(env, request, propertyId) {
  const q = new URL(request.url).searchParams;
  const { settings, structure } = await statsContext(env, request, propertyId, q.get('structure'));
  if (!settings.c59) throw new HttpError(400, 'fill in the regional property code first');
  if (rimovcli.looksLikeCitr(settings.c59)) throw new HttpError(400, rimovcli.CITR_NOT_C59); // saved before this check existed
  const from = parseDay(q.get('from'));
  const to = parseDay(q.get('to'));
  const guests = await statsGuests(env, propertyId, structure, from, to);
  const start = settings.start && parseDay(settings.start.date);
  if (start && from <= start) throw new HttpError(400, 'the portal already has these days — start the day after the last day already on the portal');
  const out = rimovcli.files(guests, from, to, { idstruttura: settings.c59, rooms: settings.rooms, beds: settings.beds, start: settings.start });
  if (q.get('check')) {
    // Who is left out, by name, so the owner can fill in where they live (updateStay).
    const missing = rimovcli.uncoded(guests, from, to).map(({ id, fields: f }) => ({
      id, name: [f.given, f.surname].filter(Boolean).join(' '), arrival: f.arrival || null,
      italy: residenceOf(f).italy,
    }));
    return json({ problems: out.problems, missing });
  }
  if (out.files.length === 1) {
    return new Response(out.files[0].text, { headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.files[0].name}"`,
    } });
  }
  return new Response(zip(out.files), { headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="rimovcli${fileTag(structure)}-${q.get('from')}-${q.get('to')}.zip"`,
  } });
}
export async function rossSend(env, request, propertyId) {
  const body = await readJson(request);
  const { settings, inner, problems } = await rossBuild(env, request, propertyId, parseDay(body.from), parseDay(body.to), body.structure);
  if (!settings.region || !settings.user || !settings.password) throw new HttpError(400, 'fill in the region and the Ross1000 web-service login first');
  let answer;
  try {
    answer = await ross.send(settings, inner, env.rossFetch || fetch);
  } catch (err) {
    await alert(env, 'ross1000', `Sending to Ross1000 failed (property ${propertyId}, ${settings.region}): ${err.message || err}`);
    throw new HttpError(502, String(err.message || err));
  }
  const refused = answer.results.filter(r => !r.ok);
  return json({ sent: answer.results.length - refused.length, refused, problems });
}

// Hourly (cron): photos older than 48 h go, and so do unsent guests too old
// to be registered.
export async function cleanup(db, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM guest_photos WHERE created_at < ?').bind(now - PHOTO_MAX_AGE_MS),
    db.prepare("DELETE FROM guests WHERE status != 'sent' AND created_at < ?").bind(now - DRAFT_MAX_AGE_MS),
    db.prepare('UPDATE guests SET fiche = NULL, fiche_until = NULL WHERE fiche_until < ?').bind(now),
    // A scan never sent: its shadow prints go with the unsent guest.
    db.prepare('UPDATE ocr_shadow SET prints = NULL WHERE prints IS NOT NULL AND created_at < ?').bind(now - DRAFT_MAX_AGE_MS),
    // What only the statistics needed goes after STATS_KEEP_DAYS.
    db.prepare(`UPDATE guests SET fields = json_remove(fields, ${STATS_FIELDS.map(k => `'$.${k}'`).join(', ')})
      WHERE status = 'sent' AND sent_at < ? AND (${STATS_FIELDS.map(k => `json_extract(fields, '$.${k}') IS NOT NULL`).join(' OR ')})`).bind(now - STATS_KEEP_DAYS * 24 * HOUR),
  ]);
}

// AI scans per property and month cost money (Anthropic API, under a cent
// each), so each property has a monthly cap; free ('comp') properties have
// none. The free trial gets a smaller one — plenty to try it, little to lose.
// A limit set by hand on the property (properties.scan_limit, e.g. for a
// busy beta tester) wins, also during the trial. Paid by guests since 24. 10.:
// more scans mean more guests paid for, so the cap only stops a runaway.
export const DEFAULT_SCAN_LIMIT = 10000;
// On HostelFlow's Claude key a new property has 20 scans for good — enough to see
// it work; after that its own Claude account (Bob, 29. 10.). Those that signed up
// earlier keep what they were given: 200, or 500 before 28. 10.
export const TRIAL_SCAN_LIMIT = 20;
export const MID_TRIAL_SCAN_LIMIT = 200;
export const EARLY_TRIAL_SCAN_LIMIT = 500;
const TRIAL_200_FROM = Date.parse('2026-10-28T00:00:00+01:00');
const TRIAL_20_FROM = Date.parse('2026-10-29T15:40:00Z'); // no property signed up between 13. 10. and then
export function scanLimit(env, property) {
  if (property.billing_status === 'comp') return null;
  if (property.scan_limit) return property.scan_limit;
  const limit = Number(env.SCAN_LIMIT) || DEFAULT_SCAN_LIMIT;
  if (property.billing_status !== 'trial') return limit;
  const created = property.created_at || Infinity;
  const trial = created < TRIAL_200_FROM ? EARLY_TRIAL_SCAN_LIMIT : created < TRIAL_20_FROM ? MID_TRIAL_SCAN_LIMIT : TRIAL_SCAN_LIMIT;
  return Math.min(limit, trial);
}

// The free trial's scans are for the whole trial, not a month (Bob, 27. 10.);
// a limit of its own from the admin centre stays per month.
export const trialWide = property => property.billing_status === 'trial' && !property.scan_limit;

// The scans counted against the limit: the whole trial, or this month.
export async function scansUsed(db, property, now = Date.now()) {
  const row = trialWide(property)
    ? await db.prepare('SELECT SUM(scans) AS scans FROM usage_monthly WHERE property_id = ?').bind(property.id).first()
    : await db.prepare('SELECT scans FROM usage_monthly WHERE property_id = ? AND month = ?').bind(property.id, new Date(now).toISOString().slice(0, 7)).first();
  return (row && row.scans) || 0;
}

export async function scanUsage(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requireSees(env.DB, user.id, propertyId, 'police');
  const { results } = await env.DB.prepare(
    'SELECT month, scans FROM usage_monthly WHERE property_id = ? ORDER BY month DESC LIMIT 12',
  ).bind(propertyId).all();
  const p = await env.DB.prepare('SELECT id, billing_status, scan_limit, created_at, claude_credentials FROM properties WHERE id = ?').bind(propertyId).first();
  // On its own Claude key (Settings → Check-in scan) a property has no limit.
  if (p.claude_credentials) return json({ months: results, limit: null, trial: false, used: 0 });
  // Only how many scans: what they cost us stays ours (scripts/report-costs.mjs).
  // trial: the limit is for the whole free trial, `used` counts all of it.
  return json({ months: results, limit: scanLimit(env, p), trial: trialWide(p), used: await scansUsed(env.DB, p) });
}
