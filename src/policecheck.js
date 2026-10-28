// The police login, checked every morning: the Alloggiati Web key changes
// with every password change (and the password expires now and then), and
// nobody should find out only when the guests won't send. At 7:00 Italian
// time each property with a login just signs in (no guest data); when the
// login itself is refused, the owners get an e-mail (again after 3 days if
// still broken) and the app shows a warning until it works again. When the
// portal itself is down, nothing is said — that's not theirs to fix.
import { getRegistrationModule } from './registration/index.js';
import { decryptCredentials } from './secrets.js';
import { mailEnabled, sendMail } from './mail.js';
import { structureAad } from './structures.js';
import { parseJson as parse } from './http.js';

const DAY = 86400000;
export const REMIND_MS = 3 * DAY;
const CHECK_HOUR = 7; // Europe/Rome

// The login was refused (not just a portal hiccup).
export const loginBroken = status => !!(status && status.ok === false && status.login);

// What a check or a send learnt about the login: ok, refused, or nothing
// (portal down: the last verdict stays).
export function nextStatus(prev, outcome, now = Date.now()) {
  if (outcome.ok) return { ok: true, at: now };
  if (!outcome.login) return prev;
  return { ok: false, at: now, message: outcome.message, login: true, notifiedAt: prev && prev.login ? prev.notifiedAt || null : null };
}

// structureId: a second structure's own login (src/structures.js); none = the property's.
export async function recordLogin(env, propertyId, outcome, now = Date.now(), structureId = null) {
  const row = structureId
    ? await env.DB.prepare('SELECT registration_status FROM structures WHERE id = ? AND property_id = ?').bind(structureId, propertyId).first()
    : await env.DB.prepare('SELECT registration_status FROM properties WHERE id = ?').bind(propertyId).first();
  const prev = parse(row && row.registration_status);
  const next = nextStatus(prev, outcome, now);
  if (next !== prev) await saveStatus(env, propertyId, structureId, next);
  return next;
}
function saveStatus(env, propertyId, structureId, status) {
  return (structureId
    ? env.DB.prepare('UPDATE structures SET registration_status = ? WHERE id = ? AND property_id = ?').bind(JSON.stringify(status), structureId, propertyId)
    : env.DB.prepare('UPDATE properties SET registration_status = ? WHERE id = ?').bind(JSON.stringify(status), propertyId)).run();
}

const romeHour = now => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(now));

export async function dailyPoliceCheck(env, now = Date.now(), { force = false } = {}) {
  if (!force && romeHour(now) !== CHECK_HOUR) return;
  const { results } = await env.DB.prepare(
    "SELECT id, name, registration, registration_credentials FROM properties WHERE registration IS NOT NULL AND registration_credentials IS NOT NULL",
  ).all();
  // A second structure (its own Alloggiati account) is checked the same way.
  const { results: extra } = await env.DB.prepare(
    `SELECT s.id AS structure_id, s.name AS structure_name, s.registration_credentials, p.id, p.name, p.registration
     FROM structures s JOIN properties p ON p.id = s.property_id
     WHERE p.registration IS NOT NULL AND s.registration_credentials IS NOT NULL`,
  ).all();
  for (const p of [...results, ...extra]) {
    const module = getRegistrationModule(p.registration);
    if (!module || !module.checkCredentials) continue;
    const sid = p.structure_id || null;
    let outcome;
    try {
      const creds = await decryptCredentials(env, sid ? structureAad(p.id, sid) : p.id, p.registration_credentials);
      await module.checkCredentials(creds);
      outcome = { ok: true };
    } catch (err) {
      outcome = { ok: false, login: err.code === 'login', message: String(err.message || err) };
    }
    const status = await recordLogin(env, p.id, outcome, now, sid);
    if (loginBroken(status) && (!status.notifiedAt || now - status.notifiedAt >= REMIND_MS)) {
      if (await tellOwners(env, sid ? { ...p, name: `${p.name} (${p.structure_name})` } : p)) {
        status.notifiedAt = now;
        await saveStatus(env, p.id, sid, status);
      }
    }
  }
}

async function tellOwners(env, p) {
  if (!mailEnabled(env)) return false;
  const { results: owners } = await env.DB.prepare(
    "SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.property_id = ? AND m.role = 'owner'",
  ).bind(p.id).all();
  let sent = false;
  for (const o of owners) {
    try {
      await sendMail(env, {
        to: o.email,
        subject: `Alloggiati Web: il login di ${p.name} non funziona più`,
        text: `Ciao ${o.name || ''},

stamattina HostelFlow non è riuscito ad accedere ad Alloggiati Web per ${p.name}: probabilmente la password è scaduta o la Chiave Web Service è cambiata (cambia a ogni nuova password).

Finché non viene aggiornato, gli ospiti non possono essere registrati in Questura (nessuno viene segnato come inviato per errore: restano nella lista da registrare).

Come risolvere (2 minuti):
1. Accedi ad Alloggiati Web → clicca il tuo nome utente in alto a destra → «Chiave Web Service» → copia il codice.
2. In HostelFlow: Impostazioni → Comunicazioni → incolla la nuova chiave (e la nuova password, se l'hai cambiata) → Salva → «Verifica connessione».

— English —
This morning HostelFlow could not sign in to Alloggiati Web for ${p.name}: the password has probably expired or the Web Service key changed (it changes with every new password). Until it's updated, guests can't be registered (none is marked as sent by mistake — they stay in the list to register). Fix: copy the new key from Alloggiati Web (your user name → "Chiave Web Service"), paste it in HostelFlow → Settings → Reports → Save → "Check connection".

HostelFlow`,
      });
      sent = true;
    } catch (err) { console.error('police login mail failed', err); }
  }
  return sent;
}
