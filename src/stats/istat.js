// ISTAT daily guest movement (model C59): for one day, per place of
// residence, how many guests were there the night before, arrived, left and
// stayed that night. Italian residents count per province, everyone else per
// country — that's how ISTAT and the regional systems (Liguria: RiMovCli)
// want it. Built only from guests registered through HostelFlow.

import { resolveState, resolveComune, ITALIA } from '../registration/it/alloggiati.js';
import { STATI } from '../registration/it/alloggiati-tables.js';
import { PROVINCES } from './it-provinces.js';

const DAY = 86400000;

// "DD.MM.YYYY" (or D/M/YYYY, YYYY-MM-DD) -> UTC midnight ms, or null.
export function parseDay(s) {
  const v = String(s || '').trim();
  let m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  let d, mo, y;
  if (m) [, d, mo, y] = m;
  else if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, y, mo, d] = m;
  else return null;
  const t = Date.UTC(+y, +mo - 1, +d);
  const check = new Date(t);
  return check.getUTCDate() === +d && check.getUTCMonth() === +mo - 1 ? t : null;
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Where the guest lives, as the C59 form wants it: residents of Italy by
// province ("La Spezia"), everyone else by country ("Germania").
// Residence defaults to nationality when staff didn't say otherwise, and an
// Italian resident's province to the province of birth: Alloggiati never asks
// where a guest lives, and the C/59 has no "unknown" province (Bob, 23. 10.:
// better counted there than left out). Filled in, it wins.
export function residenceOf(fields) {
  const code = resolveState(fields.residenceCountry || fields.nationality);
  if (!code) return { key: '?', label: 'Unknown', italy: false };
  if (code === ITALIA) {
    // Often only the comune was typed: its province will do (Costello 23. 10.).
    const fromComune = (place, p) => { const c = place && resolveComune(place, p); return c ? c.prov : ''; };
    const up = v => String(v || '').trim().toUpperCase();
    const prov = up(fields.residenceProvince) || fromComune(fields.residencePlace)
      || up(fields.birthProvince) || fromComune(fields.birthPlace);
    const name = PROVINCES[prov];
    return { key: `IT-${name ? prov : '?'}`, label: name ? `${name} (${prov})` : 'province?', italy: true };
  }
  return { key: code, label: titleCase(STATI[code]), italy: false };
}

// Was the guest in the house at some point of that day (arrived, stayed or left)?
export function touchesDay(fields, day) {
  const arrival = parseDay(fields.arrival);
  const nights = parseInt(fields.nights || '1', 10);
  if (arrival === null || !(nights >= 1)) return false;
  return arrival <= day && arrival + nights * DAY >= day;
}

// guests: [{ fields }] (registered ones). day: UTC midnight ms.
export function dailyMovement(guests, day) {
  const rows = new Map();
  const problems = [];
  for (const g of guests) {
    const arrival = parseDay(g.fields.arrival);
    const nights = parseInt(g.fields.nights || '1', 10);
    if (arrival === null || !(nights >= 1)) continue;
    const departure = arrival + nights * DAY;
    if (arrival > day || departure < day) continue; // not there that day at all
    const res = residenceOf(g.fields);
    if (res.key === '?') problems.push('a guest with unknown residence');
    if (res.key === 'IT-?') problems.push('an Italian resident without a valid province');
    if (!rows.has(res.key)) rows.set(res.key, { key: res.key, place: res.label, italy: res.italy, previousNight: 0, arrived: 0, departed: 0, presentTonight: 0 });
    const r = rows.get(res.key);
    // Always holds: presentTonight = previousNight + arrived - departed.
    if (arrival < day && departure >= day) r.previousNight++;
    if (arrival === day) r.arrived++;
    if (departure === day) r.departed++;
    if (departure > day) r.presentTonight++;
  }
  const list = [...rows.values()]
    .filter(r => r.previousNight || r.arrived || r.departed || r.presentTonight)
    .sort((a, b) => (b.italy - a.italy) || a.place.localeCompare(b.place));
  const totals = list.reduce((t, r) => {
    for (const k of ['previousNight', 'arrived', 'departed', 'presentTonight']) t[k] += r[k];
    return t;
  }, { previousNight: 0, arrived: 0, departed: 0, presentTonight: 0 });
  return { rows: list, totals, problems: [...new Set(problems)] };
}

// The simple report in Settings: for each day from..to (UTC midnights), how
// many guests of each nationality arrived and how many left.
export function nationalityReport(guests, from, to) {
  const days = [];
  for (let day = from; day <= to; day += DAY) days.push({ day, arrived: new Map(), departed: new Map() });
  const add = (map, nat) => map.set(nat, (map.get(nat) || 0) + 1);
  for (const g of guests) {
    const arrival = parseDay(g.fields.arrival);
    const nights = parseInt(g.fields.nights || '1', 10);
    if (arrival === null || !(nights >= 1)) continue;
    const code = resolveState(g.fields.nationality);
    const nat = code ? titleCase(STATI[code]) : 'Unknown';
    const a = days[(arrival - from) / DAY];
    if (a) add(a.arrived, nat);
    const d = days[(arrival + nights * DAY - from) / DAY];
    if (d) add(d.departed, nat);
  }
  const sorted = m => [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([nationality, n]) => ({ nationality, n }));
  return days.map(d => ({
    date: new Date(d.day).toISOString().slice(0, 10),
    arrived: sorted(d.arrived),
    departed: sorted(d.departed),
  }));
}
