// Guest registration with the police is different in every country, so each
// country is a module with the same shape:
//
//   validate(guest)                      -> { ok, record?, errors? }   (no network)
//   submit(credentials, guests, mode)    -> { ok, results:[{ id, ok, errors? }] }
//                                           mode 'test' = validate on the authority's server,
//                                           mode 'send' = real registration
//   checkCredentials(credentials)        -> signs in to the authority only, sends nothing;
//                                           throws with the portal's message if it fails
//   credentialFields                     -> what the property owner fills in (for the settings UI);
//                                           secret ones are never sent back to the browser
//
// Italy (Alloggiati Web) and Czechia (Ubyport). Next candidates: France
// (fiche de police), Spain (SES.HOSPEDAJES), Slovakia, Poland.

import { guestToRecord, generateToken, submitRecords } from './it/alloggiati.js';
import * as uby from './cz/ubyport.js';
import * as fiche from './fr/fiche.js';

const italy = {
  id: 'it-alloggiati',
  country: 'IT',
  name: 'Alloggiati Web (Polizia di Stato)',
  // help: opens from an "i" next to the field in Settings (translated in public/i18n.js).
  // Steps from the official Alloggiati Web manual, chapter 10.
  portalUrl: 'https://alloggiatiweb.poliziadistato.it',
  credentialFields: [
    { key: 'user', label: 'Utente' },
    { key: 'password', label: 'Password', secret: true },
    {
      key: 'wskey', label: 'Chiave Web Services (WSKey)', secret: true,
      help: 'Sign in to Alloggiati Web → click your user name (top right) → "Chiave Web Service" → copy the whole code. "Genera Nuovo Codice" makes a new one (at most once a day) and the old one stops working. After every password change a new key is needed.',
    },
  ],

  async checkCredentials(credentials, fetchImpl) {
    await generateToken(credentials, fetchImpl);
  },

  validate(guest) {
    try {
      return { ok: true, record: guestToRecord(guest) };
    } catch (err) {
      return { ok: false, errors: err.errors || [String(err.message || err)] };
    }
  },

  async submit(credentials, guests, mode, fetchImpl) {
    const results = guests.map(g => ({ id: g.id, ...this.validate(g) }));
    const valid = results.filter(r => r.ok);
    if (valid.length) {
      const { token } = await generateToken(credentials, fetchImpl);
      const portal = await submitRecords({ user: credentials.user, token, records: valid.map(r => r.record), mode }, fetchImpl);
      if (!portal.general.ok) {
        throw new Error(`Alloggiati ${mode} failed: ${portal.general.description} ${portal.general.detail}`.trim());
      }
      valid.forEach((r, i) => {
        const row = portal.rows[i];
        if (!row || !row.ok) {
          r.ok = false;
          r.errors = [row ? `${row.description} ${row.detail}`.trim() : 'no result from portal for this row'];
        }
      });
    }
    return { ok: results.every(r => r.ok), results: results.map(({ record, ...r }) => r) };
  },
};

const czechia = {
  id: 'cz-ubyport',
  country: 'CZ',
  name: 'Ubyport (Policie ČR) — beta',
  portalUrl: 'https://ubyport.pcr.cz',
  // Only foreigners are reported; Czech guests are fine without it.
  guestFields: ['visa', 'homeAddress'],
  credentialFields: [
    { key: 'user', label: 'Uživatel (web service)', help: 'The web-service account the police gives you for Ubyport (ask at reguby@pcr.cz with your IDUB and the short name of the property). It is not the same as the login to the Ubyport website.' },
    { key: 'password', label: 'Heslo', secret: true },
    { key: 'idub', label: 'IDUB (identifikační číslo ubytovatele)' },
    { key: 'mark', label: 'Zkratka ubytovacího zařízení' },
    { key: 'name', label: 'Název ubytovatele' },
    { key: 'contact', label: 'Kontakt (e-mail nebo telefon)' },
    { key: 'district', label: 'Okres' },
    { key: 'town', label: 'Obec' },
    { key: 'townPart', label: 'Část obce', optional: true },
    { key: 'street', label: 'Ulice', optional: true },
    { key: 'houseNumber', label: 'Číslo popisné' },
    { key: 'streetNumber', label: 'Číslo orientační', optional: true },
    { key: 'postcode', label: 'PSČ' },
  ],

  async checkCredentials(credentials, opts) {
    await uby.testDostupnosti(credentials, opts);
  },

  validate(guest) {
    if (uby.isCzech(guest)) return { ok: true, record: null };
    try {
      return { ok: true, record: uby.guestToRecord(guest) };
    } catch (err) {
      return { ok: false, errors: err.errors || [String(err.message || err)] };
    }
  },

  // 'test' checks everything here and signs in to Ubyport (nothing is sent);
  // 'send' reports the foreign guests. Czech guests pass without a report.
  async submit(credentials, guests, mode, opts) {
    const results = guests.map(g => ({ id: g.id, ...this.validate(g) }));
    const toSend = results.filter(r => r.ok && r.record);
    if (!toSend.length) return { ok: results.every(r => r.ok), results: results.map(({ record, ...r }) => r) };
    const staty = await uby.ciselnik(credentials, 'Staty', opts);
    for (const r of toSend) {
      r.record.cNati = uby.policeCountry(r.record.nationality, staty);
      if (!r.record.cNati) { r.ok = false; r.errors = [`nationality ${r.record.nationality} is not in the Ubyport list`]; }
    }
    const ready = toSend.filter(r => r.ok);
    if (mode === 'send' && ready.length) {
      const answer = await uby.submitUbyport(credentials, ready.map(r => r.record), opts);
      const codes = [...answer.header, ...answer.perGuest.flat()];
      const texts = codes.length ? Object.fromEntries((await uby.ciselnik(credentials, 'Chyby', opts).catch(() => [])).map(c => [c.kod2, c.cz || c.en])) : {};
      const describe = list => list.map(c => (texts[c] ? `${c}: ${texts[c]}` : `error ${c}`));
      if (answer.header.length) throw new Error(`Ubyport refused the property details — ${describe(answer.header).join('; ')} (check Settings)`);
      ready.forEach((r, i) => {
        const errs = answer.perGuest[i] || [];
        if (errs.length) { r.ok = false; r.errors = describe(errs); }
      });
    }
    return { ok: results.every(r => r.ok), results: results.map(({ record, ...r }) => r) };
  },
};

const france = {
  id: 'fr-fiche',
  country: 'FR',
  name: 'Fiche individuelle de police — beta',
  portalUrl: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070158/LEGISCTA000042803266/',
  guestFields: ['birthPlace', 'homeAddress', 'phone', 'email'],
  // Nothing is sent: the fiches are kept six months and printed for the police on request.
  keepsFiches: fiche.KEEP_DAYS,
  credentialFields: [
    { key: 'establishment', label: "Nom de l'établissement" },
    { key: 'address', label: 'Adresse', optional: true },
  ],

  async checkCredentials(credentials) {
    if (!credentials.establishment) throw new Error("fill in the name of the establishment");
  },

  validate(guest) {
    if (fiche.isFrench(guest)) return { ok: true, record: null };
    try {
      return { ok: true, record: fiche.guestToFiche(guest) };
    } catch (err) {
      return { ok: false, errors: err.errors || [String(err.message || err)] };
    }
  },

  // 'send' files the fiches (kept by HostelFlow); French guests need none.
  async submit(credentials, guests, mode) {
    const results = guests.map(g => ({ id: g.id, ...this.validate(g) }));
    return {
      ok: results.every(r => r.ok),
      results: results.map(({ record, ...r }) => (mode === 'send' && r.ok && record ? { ...r, keep: { ...record, etablissement: credentials.establishment, adresse: credentials.address || '' } } : r)),
    };
  },
};

export const REGISTRATION_MODULES = { [italy.id]: italy, [czechia.id]: czechia, [france.id]: france };

export function getRegistrationModule(id) {
  const m = REGISTRATION_MODULES[id];
  if (!m) throw new Error(`unknown registration module "${id}"`);
  return m;
}
