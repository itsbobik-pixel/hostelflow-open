// France: the "fiche individuelle de police" (CESEDA articles R814-1 to
// R814-3). Every foreign guest fills in and signs one on arrival; the
// establishment keeps it for six months and hands it to the police or the
// gendarmerie only when they ask. Nothing is sent anywhere — HostelFlow keeps
// the fiches (encrypted) and prints them on request, then deletes them.

import { toIso3 } from '../it/alloggiati.js';

export const KEEP_DAYS = 183; // six months

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
function parseDay(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  return d.getUTCDate() === +m[1] ? d : null;
}
const frDay = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

export const isFrench = guest => toIso3((guest.fields || guest).nationality) === 'FRA';

// A foreign guest's fields -> the fiche, or throws { errors }.
export function guestToFiche(guest) {
  const f = guest.fields || guest;
  const errors = [];
  const surname = clean(f.surname);
  const given = clean(f.given);
  if (!surname) errors.push('surname is missing');
  if (!given) errors.push('given names are missing');
  const dob = parseDay(f.dob);
  if (!dob) errors.push('date of birth must be DD.MM.YYYY');
  const birthPlace = clean(f.birthPlace);
  if (!birthPlace) errors.push('place of birth is missing');
  const nationality = toIso3(f.nationality);
  if (!nationality) errors.push('nationality is missing');
  const home = clean(f.homeAddress);
  if (!home) errors.push('home address is missing');
  const email = clean(f.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('e-mail is not valid');
  const arrival = parseDay(f.arrival);
  if (!arrival) errors.push('arrival date must be DD.MM.YYYY');
  const nights = Number(f.nights || 1);
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) errors.push('nights must be a whole number');
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { errors });
  return {
    nom: surname.toUpperCase(),
    prenoms: given,
    naissance: frDay(dob),
    lieuNaissance: birthPlace,
    nationalite: nationality,
    domicile: home,
    telephone: clean(f.phone),
    email,
    arrivee: frDay(arrival),
    depart: frDay(new Date(arrival.getTime() + nights * 86400000)),
    document: [clean(f.docType), clean(f.docNumber)].filter(Boolean).join(' '),
  };
}
