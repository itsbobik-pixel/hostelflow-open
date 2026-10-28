// Ubyport (Policie ČR, služba cizinecké policie): foreign guests reported by
// the accommodation provider within three working days. SOAP web service
// WS_UBY behind Windows NTLM; data types and examples from "Technický popis
// webové služby Ubyport" (příloha č. 5 provozního řádu, 19. 6. 2019).
// Czech citizens are not reported.

import { ntlmPost } from './http.js';
import { toIso3, englishNamesOf } from '../it/alloggiati.js';

export const UBY_URL = 'https://ubyport.pcr.cz/ws_uby/ws_uby.svc';
const NS = 'http://UBY.pcr.cz/WS_UBY';
const ACTION = method => `${NS}/IWS_UBY/${method}`;
const AUTH_CODE = 'X'; // "AutentificationCode" is reserved: unused, but must not be empty

export const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const letters = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const NAME_OK = /^[\p{L}' -]+$/u;

// DD.MM.YYYY -> Date at noon (no time zone surprises), or null.
function parseDay(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  return d.getUTCDate() === +m[1] ? d : null;
}
const isoDay = d => d.toISOString().slice(0, 10);

export const isCzech = guest => toIso3((guest.fields || guest).nationality) === 'CZE';

// A guest's form fields -> the Ubytovany record (WS_UBY data contract), or
// throws { errors }. nationality is the ISO alpha-3 code here; the police
// code (Kod3 of the Staty list) is looked up when sending.
export function guestToRecord(guest) {
  const f = guest.fields || guest;
  const errors = [];
  const surname = letters(f.surname);
  const given = letters(f.given);
  if (!surname) errors.push('surname is missing');
  else if (!NAME_OK.test(surname)) errors.push('surname: only letters, apostrophe and hyphen');
  if (!given) errors.push('given names are missing');
  else if (!NAME_OK.test(given)) errors.push('given names: only letters, apostrophe and hyphen');
  const dob = parseDay(f.dob);
  if (!dob) errors.push('date of birth must be DD.MM.YYYY');
  const nationality = toIso3(f.nationality);
  if (!nationality) errors.push('nationality is missing');
  const doc = String(f.docNumber || '').replace(/\s+/g, '').toUpperCase();
  if (doc.length < 4 || doc.length > 30) errors.push('document number must have 4 to 30 characters');
  const arrival = parseDay(f.arrival);
  if (!arrival) errors.push('arrival date must be DD.MM.YYYY');
  const nights = Number(f.nights || 1);
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) errors.push('nights must be a whole number');
  const visa = String(f.visa || '').trim();
  if (visa.length > 15) errors.push('visa number: at most 15 characters');
  const home = String(f.homeAddress || '').trim();
  if (home.length > 128) errors.push('home address: at most 128 characters');
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { errors });

  const until = new Date(arrival.getTime() + nights * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return {
    cDate: `${pad(dob.getUTCDate())}${pad(dob.getUTCMonth() + 1)}${dob.getUTCFullYear()}`,
    cDocN: doc,
    cFirstN: given,
    cFrom: `${isoDay(arrival)}T14:00:00`,
    nationality,
    cNote: '',
    cPurp: Number(f.purpose) || 99,
    cResi: home,
    cSurN: surname,
    cUntil: `${isoDay(until)}T10:00:00`,
    cVisN: visa,
  };
}

// The provider and the property, from Settings (credentialFields in index.js).
export const PROVIDER_FIELDS = [
  ['uIdub', 'idub'], ['uMark', 'mark'], ['uName', 'name'], ['uCont', 'contact'], ['uOkr', 'district'],
  ['uOb', 'town'], ['uObCa', 'townPart'], ['uStr', 'street'], ['uHomN', 'houseNumber'], ['uOriN', 'streetNumber'], ['uPsc', 'postcode'],
];

// The data contract serializer wants the members in ordinal order.
const el = (name, value) => (value === null || value === undefined || value === ''
  ? `<d4p1:${name} i:nil="true"/>`
  : `<d4p1:${name}>${xml(value)}</d4p1:${name}>`);

export function zapisEnvelope(credentials, records) {
  const guests = records.map(r => `<d4p1:Ubytovany>${[
    el('cDate', r.cDate), el('cDocN', r.cDocN), el('cFirstN', r.cFirstN), el('cFrom', r.cFrom),
    el('cNati', r.cNati), el('cNote', r.cNote), el('cPlac', null), el('cPurp', r.cPurp), el('cResi', r.cResi),
    el('cSpz', null), el('cSurN', r.cSurN), el('cUntil', r.cUntil), el('cVisN', r.cVisN),
  ].join('')}</d4p1:Ubytovany>`).join('');
  const provider = Object.fromEntries(PROVIDER_FIELDS.map(([k, key]) => [k, String(credentials[key] || '').trim()]));
  const body = [
    `<d4p1:Ubytovani>${guests}</d4p1:Ubytovani>`, el('VracetPDF', 'false'),
    el('uCont', provider.uCont), el('uHomN', provider.uHomN), el('uIdub', provider.uIdub), el('uMark', provider.uMark),
    el('uName', provider.uName), el('uOb', provider.uOb), el('uObCa', provider.uObCa), el('uOkr', provider.uOkr),
    el('uOriN', provider.uOriN), el('uPsc', provider.uPsc), el('uStr', provider.uStr),
  ].join('');
  return envelope('ZapisUbytovane', `<AutentificationCode>${AUTH_CODE}</AutentificationCode><Seznam xmlns:d4p1="http://schemas.datacontract.org/2004/07/WS_UBY" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${body}</Seznam>`);
}

const envelope = (method, inner) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method} xmlns="${NS}">${inner}</${method}></s:Body></s:Envelope>`;

const tag = (x, name) => { const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(x); return m ? m[1] : ''; };
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function fault(x) {
  const f = tag(x, 'faultstring');
  return f ? new Error(`Ubyport: ${unxml(f).slice(0, 300)}`) : null;
}

// ZapisUbytovane's answer: errors of the header (provider) and per guest.
export function parseZapis(x) {
  const f = fault(x);
  if (f) throw f;
  const codes = s => unxml(s).split(';').map(c => c.trim()).filter(Boolean);
  const header = codes(tag(x, 'ChybyHlavicky'));
  const perGuest = [...tag(x, 'ChybyZaznamu').matchAll(/<(?:\w+:)?string>([\s\S]*?)<\/(?:\w+:)?string>|<(?:\w+:)?string\s*\/>/g)].map(m => codes(m[1] || ''));
  return { header, perGuest, stamp: unxml(tag(x, 'PseudoRazitko')) };
}

export function parseCiselnik(x) {
  const f = fault(x);
  if (f) throw f;
  return [...x.matchAll(/<(?:\w+:)?CiselnikType>([\s\S]*?)<\/(?:\w+:)?CiselnikType>/g)].map(m => ({
    kod2: unxml(tag(m[1], 'Kod2')), kod3: unxml(tag(m[1], 'Kod3')), cz: unxml(tag(m[1], 'TextCZ')), en: unxml(tag(m[1], 'TextENG')),
  }));
}

// One SOAP call, signed in with the property's Ubyport account.
async function call(credentials, method, inner, opts = {}) {
  const url = opts.url || UBY_URL;
  const res = await ntlmPost(url, { user: credentials.user, password: credentials.password }, { body: method === 'ZapisUbytovane' ? inner : envelope(method, inner), soapAction: ACTION(method) }, opts);
  if (res.status >= 500 && !/Fault/.test(res.body)) throw new Error(`Ubyport is not answering (HTTP ${res.status})`);
  return res.body;
}

export async function testDostupnosti(credentials, opts) {
  const x = await call(credentials, 'TestDostupnosti', `<AutentificationCode>${AUTH_CODE}</AutentificationCode>`, opts);
  const f = fault(x);
  if (f) throw f;
  if (tag(x, 'TestDostupnostiResult').trim().toLowerCase() !== 'true') throw new Error('Ubyport says the service is not available right now');
}

export async function ciselnik(credentials, which, opts) {
  return parseCiselnik(await call(credentials, 'DejMiCiselnik', `<AutentificationCode>${AUTH_CODE}</AutentificationCode><CoChci>${which}</CoChci>`, opts));
}

// Our ISO alpha-3 -> the police list's Kod3 (most are the same; the rest by name).
export function policeCountry(iso3, staty, englishName) {
  const byKod3 = staty.find(s => s.kod3 === iso3);
  if (byKod3) return byKod3.kod3;
  const names = [englishName, ...englishNamesOf(iso3)].filter(Boolean).map(n => String(n).toUpperCase());
  const byName = staty.find(s => names.includes(s.en.toUpperCase()));
  return byName ? byName.kod3 : '';
}

export async function submitUbyport(credentials, records, opts) {
  return parseZapis(await call(credentials, 'ZapisUbytovane', zapisEnvelope(credentials, records), opts));
}
