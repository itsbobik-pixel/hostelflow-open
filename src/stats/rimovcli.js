// RiMovCli (Regione Liguria, ISTAT model C/59): one XML file per day with the
// guests per place of residence — arrived, left, present that night. Italian
// residents by ISTAT province code, everyone else by the country codes of
// ISTAT circolare n. 5 (27. 2. 2012). Schema and tables: docs/istat/rimovcli/.

import { ITALIA, resolveState } from '../registration/it/alloggiati.js';
import { PROVINCES } from './it-provinces.js';
import { dailyMovement, residenceOf, touchesDay, parseDay } from './istat.js';
import { PRODUCT } from './ross1000.js';

const DAY = 86400000;
export const NS = 'http://www.regione.liguria.it/turismo/rimovcli';

// Province sigla -> ISTAT code (docs/istat/rimovcli/province-istat.tsv).
// SU (Sud Sardegna, 2016) isn't in the region's table: ISTAT's current code.
export const PROVINCE_CODES = {
  TO: '001', VC: '002', NO: '003', CN: '004', AT: '005', AL: '006', AO: '007', IM: '008', SV: '009',
  GE: '010', SP: '011', VA: '012', CO: '013', SO: '014', MI: '015', BG: '016', BS: '017', PV: '018',
  CR: '019', MN: '020', BZ: '021', TN: '022', VR: '023', VI: '024', BL: '025', TV: '026', VE: '027',
  PD: '028', RO: '029', UD: '030', GO: '031', TS: '032', PC: '033', PR: '034', RE: '035', MO: '036',
  BO: '037', FE: '038', RA: '039', FC: '040', PU: '041', AN: '042', MC: '043', AP: '044', MS: '045',
  LU: '046', PT: '047', FI: '048', LI: '049', PI: '050', AR: '051', SI: '052', GR: '053', PG: '054',
  TR: '055', VT: '056', RI: '057', RM: '058', LT: '059', FR: '060', CE: '061', BN: '062', NA: '063',
  AV: '064', SA: '065', AQ: '066', TE: '067', PE: '068', CH: '069', CB: '070', FG: '071', BA: '072',
  TA: '073', BR: '074', LE: '075', PZ: '076', MT: '077', CS: '078', CZ: '079', RC: '080', TP: '081',
  PA: '082', ME: '083', AG: '084', CL: '085', EN: '086', CT: '087', RG: '088', SR: '089', SS: '090',
  NU: '091', CA: '092', PN: '093', IS: '094', OR: '095', BI: '096', LC: '097', LO: '098', RN: '099',
  PO: '100', KR: '101', VV: '102', VB: '103', OT: '104', OG: '105', VS: '106', CI: '107', MB: '108',
  FM: '109', BT: '110', SU: '111',
};

// Alloggiati Web state code (last digits) -> the circolare's country code.
// Countries the circolare names on their own:
const NAMED = {
  203: '038', 206: '017', 250: '092', 212: '008', 214: '032', 215: '001', 216: '004', 220: '009',
  221: '007', 223: '024', 226: '018', 231: '028', 232: '003', 233: '060', 234: '010', 219: '006',
  257: '061', 245: '075', 255: '063', 251: '091', 239: '011', 240: '030', 241: '036', 225: '036',
  351: '052', 244: '064', 209: '068', 235: '066', 247: '053', 315: '600', 249: '055', 248: '054',
  227: '046', 243: '072',
  509: '404', 536: '400', 527: '412', 619: '484', 605: '508', 602: '528',
  314: '720', 326: '732', 320: '728', 330: '664', 334: '624',
  419: '220', 454: '388', 701: '800', 719: '804',
  // Overseas France counts as France (the circolare's note).
  759: '001', 761: '001', 765: '001', 773: '001', 774: '001',
  999: '777', // stateless: not specified
};
// The groups ("altri paesi …") where the Alloggiati numbering (2xx Europe,
// 3xx Asia, 4xx Africa, 5xx–6xx America, 7xx Oceania and scattered
// territories) doesn't say it.
const GROUPS = {
  100: [997, 1000, 1001, 1002, 755, 769],                   // other Europe
  410: [739, 758, 796],                                     // other North America
  530: [733, 742, 764, 768, 777, 790, 797, 810, 812],       // other Central and South America
  750: [302, 358, 359, 304, 322, 360, 327, 332, 333, 335, 337, 343, 345, 348, 354], // West Asia
  760: [767, 805],                                          // other Asia
  230: [431, 460, 401, 436],                                // Mediterranean Africa
  300: [998, 795, 799],                                     // other Africa
};
const BY_STATE = new Map();
for (const [code, states] of Object.entries(GROUPS)) for (const s of states) BY_STATE.set(s, code);
for (const [s, code] of Object.entries(NAMED)) BY_STATE.set(+s, code);
// The 1100000xx codes Alloggiati added later.
const LATER = { 110000001: '750', 110000003: '760', 110000005: '720', 110000014: '100', 110000022: '530' };

// Alloggiati state code -> RiMovCli country code, or '' (Italy, unknown).
export function countryCode(stato) {
  const s = String(stato || '');
  if (!/^\d{9}$/.test(s) || s === ITALIA) return '';
  if (LATER[s]) return LATER[s];
  if (!s.startsWith('100000') && !s.startsWith('100001')) return '';
  const n = +s.slice(6) + (s.startsWith('100001') ? 1000 : 0);
  if (BY_STATE.has(n)) return BY_STATE.get(n);
  if (n >= 200 && n < 300) return '100';
  if (n >= 300 && n < 400) return '760';
  if (n >= 400 && n < 500) return '300';
  if (n >= 500 && n < 700) return '530';
  if (n >= 700 && n < 900) return '810';
  return '';
}

const attr = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const iso = ms => new Date(ms).toISOString().slice(0, 10);

export const fileName = (idstruttura, day) => `${String(idstruttura).replace(/[^\w.-]/g, '_')}_${iso(day).replace(/-/g, '')}.xml`;

// One day's file. guests: [{ fields }] (registered ones). rooms/beds: what
// the place has (sent every day: the region keeps the month's last).
// Guests whose residence has no code are left out and reported.
export function dayFile(guests, day, { idstruttura, rooms, beds, start }) {
  const { rows } = dailyMovement(guests, day);
  const lines = new Map();
  const problems = [];
  for (const r of rows) {
    let nazione = 'e', residenza = '';
    if (r.italy) {
      nazione = 'i';
      residenza = PROVINCE_CODES[r.key.slice(3)] || '';
    } else residenza = countryCode(r.key);
    if (!residenza) {
      problems.push({ date: iso(day), place: r.place, guests: r.previousNight + r.arrived });
      continue;
    }
    const k = nazione + residenza;
    if (!lines.has(k)) lines.set(k, { nazione, residenza, arrivati: 0, partiti: 0, presenti: 0 });
    const l = lines.get(k);
    l.arrivati += r.arrived;
    l.partiti += r.departed;
    l.presenti += r.presentTonight;
  }
  if (start && day === parseDay(start.date) + DAY) balance(lines, start.present);
  const sorted = [...lines.values()].sort((a, b) => (b.nazione === 'i') - (a.nazione === 'i') || a.residenza.localeCompare(b.residenza));
  const mensile = rooms || beds
    ? `\t<mensile${rooms ? ` numcameredisp="${rooms}"` : ''}${beds ? ` numlettidisp="${beds}"` : ''} softwaregestionale="${PRODUCT}"/>\n`
    : `\t<mensile softwaregestionale="${PRODUCT}"/>\n`;
  const giornaliero = sorted.length
    ? `\t<giornaliero>\n${sorted.map(l => `\t\t<rigac59 nazione="${l.nazione}" residenza="${l.residenza}" arrivati="${l.arrivati}" partiti="${l.partiti}" presenti="${l.presenti}"/>\n`).join('')}\t</giornaliero>\n`
    : '\t<giornaliero/>\n';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<rm:c59 xmlns:rm="${NS}" idstruttura="${attr(idstruttura)}" data="${iso(day)}">\n${mensile}${giornaliero}</rm:c59>\n`;
  return { name: fileName(idstruttura, day), xml, problems };
}

// The days from..to (UTC midnights), a file each.
export function files(guests, from, to, settings) {
  const out = [];
  for (let day = from; day <= to; day += DAY) out.push(dayFile(guests, day, settings));
  return { files: out.map(({ name, xml }) => ({ name, text: xml })), problems: out.flatMap(f => f.problems) };
}

// The guests of these days who are left out, each once (dayFile counts them
// per day): an Italian resident without a province — there is no "unknown"
// province in the C/59 — or a country with no code. Alloggiati never asks
// where a guest lives, so these pass the police and show up only here.
export function uncoded(guests, from, to) {
  return guests.filter(g => {
    let there = false;
    for (let day = from; day <= to && !there; day += DAY) there = touchesDay(g.fields, day);
    if (!there) return false;
    const r = residenceOf(g.fields);
    return r.italy ? !PROVINCE_CODES[r.key.slice(3)] : !countryCode(r.key);
  });
}

// RiMovCli wants the region's own code for the property (Costello: 123456789),
// not the CITR on the portal's page — with the CITR every file is refused
// ("non contiene il codice struttura corretto", Costello 23. 10. 2026).
export const looksLikeCitr = v => /^\d{6}-[A-Z]{2}-\d{4}$/i.test(String(v).trim());
export const CITR_NOT_C59 = "that is the CITR — RiMovCli wants the region's code for the property (numbers only, from the region's e-mail)";

// ----- The starting point: the last day already on the portal -----
// The portal refuses a day whose "present" numbers don't follow from the day
// before. A property moving to HostelFlow has that day from elsewhere (another
// program, typed in by hand) with guests HostelFlow never saw, so the owner
// copies the portal's table of that day ("Austria 2"…) into Settings. The first
// file then starts from it: what HostelFlow knows is there tonight stays, everyone
// else on the portal leaves that day, and anyone HostelFlow has who wasn't on the
// portal arrives that day (Costello, 23. 10. 2026).
function balance(lines, present) {
  for (const k of Object.keys(present)) {
    if (!lines.has(k)) lines.set(k, { nazione: k[0], residenza: k.slice(1), arrivati: 0, partiti: 0, presenti: 0 });
  }
  for (const [k, l] of lines) {
    const before = present[k] || 0;
    const left = before + l.arrivati - l.presenti;
    if (left >= 0) l.partiti = left;
    else { l.arrivati -= left; l.partiti = 0; }
    // Someone who only left, but wasn't on the portal: nothing to say.
    if (!l.arrivati && !l.partiti && !l.presenti) lines.delete(k);
  }
}

// One place as the portal writes it (a country, an Italian province by name or
// by its two letters) -> 'e004' / 'i011', or ''.
function placeKey(name) {
  const up = String(name).trim().toUpperCase();
  const sigla = PROVINCE_CODES[up] ? up : Object.keys(PROVINCES).find(p => PROVINCES[p].toUpperCase() === up);
  if (sigla && PROVINCE_CODES[sigla]) return 'i' + PROVINCE_CODES[sigla];
  const code = countryCode(resolveState(name));
  return code ? 'e' + code : '';
}

// "Austria 2" per line (as copied from the portal's "Presenti" column) ->
// { present: { e038: 2, … }, bad: [lines it couldn't read] }.
export function parseStart(text) {
  const present = {};
  const bad = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[\s:=]+(\d{1,4})$/);
    const k = m && placeKey(m[1]);
    if (!k) { bad.push(line); continue; }
    present[k] = (present[k] || 0) + Number(m[2]);
  }
  return { present, bad };
}
