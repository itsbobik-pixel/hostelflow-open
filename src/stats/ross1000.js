// Ross1000: the regional tourism statistics system (ISTAT data) used by
// Liguria, Veneto, Lombardia and others. One <movimento> per day: whether the
// place was open, rooms and beds, the guests who arrived and who left.
// "Tracciato record di integrazione dati (XML) — Istruzioni per le software
// house", versione 3, 18/03/2026; web service inviaMovimentazione (SOAP,
// HTTP Basic) at <base>/ws/checkinV2.

import { resolveState, resolveComune, birthStateOf, ITALIA, xmlEscape as xml } from '../registration/it/alloggiati.js';
import { parseDay } from './istat.js';

const DAY = 86400000;
export const PRODUCT = 'HostelFlow';

// The regions' web services (from the specification's list of end points).
export const REGIONS = {
  liguria: { name: 'Liguria', url: 'https://turismows.regione.liguria.it/ws/checkinV2' },
  veneto: { name: 'Veneto', url: 'https://flussituristici.regione.veneto.it/ws/checkinV2' },
  lombardia: { name: 'Lombardia', url: 'https://www.flussituristici.servizirl.it/Turismo5/app/ws/checkinV2' },
  piemonte: { name: 'Piemonte', url: 'https://piemontedatiturismo.regione.piemonte.it/ws/checkinV2' },
  emilia: { name: 'Emilia-Romagna', url: 'https://datiturismo.regione.emilia-romagna.it/ws/checkinV2' },
  toscana: { name: 'Firenze, Pistoia, Prato', url: 'https://toscanaturismo.ross1000.it/turismo5-web/ws/checkinV2' },
  marche: { name: 'Marche', url: 'https://istrice-ross1000.turismo.marche.it/ws/checkinV2' },
  abruzzo: { name: 'Abruzzo', url: 'https://app.regione.abruzzo.it/Turismo5/ws/checkinV2' },
  lazio: { name: 'Lazio', url: 'https://lazioturismo.ross1000.it/ws/checkinV2' },
  sardegna: { name: 'Sardegna', url: 'https://sardegnaturismo.ross1000.it/ws/checkinV2' },
  calabria: { name: 'Calabria', url: 'https://sirdat.regione.calabria.it/ws/checkinV2' },
  molise: { name: 'Molise', url: 'https://moliseturismo.ross1000.it/ws/checkinV2' },
};

const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const el = (name, value) => `<${name}>${xml(value)}</${name}>`;

// A guest's stable id for Ross1000 (max 20 characters, the same on every send).
export const idswh = id => String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

// The arrival record, or { errors }. Codes are Alloggiati Web's (states, comuni, types).
export function arrivalOf(guest, byId) {
  const f = guest.fields;
  const errors = [];
  const type = ['16', '17', '18', '19', '20'].includes(f.guestType) ? f.guestType : '16';
  const sex = f.sex === 'F' ? 'F' : f.sex === 'M' ? 'M' : '';
  if (!sex) errors.push('sex');
  const dob = parseDay(f.dob);
  if (dob === null) errors.push('date of birth');
  const citizenship = resolveState(f.nationality);
  if (!citizenship) errors.push('nationality');
  const residence = resolveState(f.residenceCountry || f.nationality);
  if (!residence) errors.push('country of residence');
  let place = '';
  if (residence === ITALIA) {
    const c = resolveComune(f.residencePlace, f.residenceProvince);
    if (!c) errors.push('comune of residence');
    else place = c.code;
  } else place = String(f.residencePlace || '').trim().slice(0, 30);
  // As the police got it: an Italian born in "BUENOS AIRES (ARG)" was born in Argentina.
  const birthState = birthStateOf(f);
  let birthComune = '';
  if (birthState === ITALIA) {
    const c = resolveComune(f.birthPlace, f.birthProvince);
    if (c) birthComune = c.code;
  }
  const leader = ['19', '20'].includes(type) && f.groupLeader && byId.get(f.groupLeader) ? idswh(f.groupLeader) : '';
  if (['19', '20'].includes(type) && !leader) errors.push('head of family or group');
  if (errors.length) return { errors };
  return {
    xml: `<arrivo>${[
      el('idswh', idswh(guest.id)), el('tipoalloggiato', type), el('idcapo', leader), el('sesso', sex),
      el('cittadinanza', citizenship), el('statoresidenza', residence), el('luogoresidenza', place),
      el('datanascita', ymd(dob)), el('statonascita', birthState), el('comunenascita', birthComune),
      el('tipoturismo', 'NON SPECIFICATO'), el('mezzotrasporto', 'NON SPECIFICATO'),
      el('canaleprenotazione', ''), el('titolostudio', ''), el('professione', ''), el('esenzioneimposta', ''),
    ].join('')}</arrivo>`,
  };
}

// The days from..to (UTC midnights) as <movimento> elements, with the guests
// registered through HostelFlow. rooms/beds: what the place has; a room counts
// as occupied while guests are in — estimated from the beds per room.
export function movimenti(guests, from, to, { codice, rooms, beds }) {
  const byId = new Map(guests.map(g => [g.id, g]));
  const days = [];
  const problems = [];
  const perRoom = rooms > 0 && beds > 0 ? beds / rooms : 1;
  for (let day = from; day <= to; day += DAY) {
    const arrivals = [];
    const departures = [];
    let tonight = 0;
    for (const g of guests) {
      const arrival = parseDay(g.fields.arrival);
      const nights = parseInt(g.fields.nights || '1', 10);
      if (arrival === null || !(nights >= 1)) continue;
      const departure = arrival + nights * DAY;
      if (arrival <= day && departure > day) tonight++;
      if (arrival === day) {
        const a = arrivalOf(g, byId);
        if (a.errors) problems.push({ id: g.id, day: ymd(day), missing: a.errors });
        else arrivals.push(a.xml);
      }
      // A departure only for a guest whose arrival could go in: the region
      // refuses one it has no arrival for.
      if (departure === day) {
        const a = arrivalOf(g, byId);
        if (a.errors) { problems.push({ id: g.id, day: ymd(day), missing: a.errors }); continue; }
        departures.push(`<partenza>${el('idswh', idswh(g.id))}${el('tipoalloggiato', ['16', '17', '18', '19', '20'].includes(g.fields.guestType) ? g.fields.guestType : '16')}${el('arrivo', ymd(arrival))}</partenza>`);
      }
    }
    const occupied = Math.min(rooms, Math.ceil(tonight / perRoom));
    days.push(`<movimento>${el('data', ymd(day))}<struttura>${el('apertura', 'SI')}${el('camereoccupate', occupied)}${el('cameredisponibili', rooms)}${el('lettidisponibili', beds)}</struttura>`
      + (arrivals.length ? `<arrivi>${arrivals.join('')}</arrivi>` : '')
      + (departures.length ? `<partenze>${departures.join('')}</partenze>` : '')
      + '</movimento>');
  }
  return { inner: `${el('codice', codice)}${el('prodotto', PRODUCT)}${days.join('')}`, problems };
}

export const fileXml = inner => `<?xml version="1.0" encoding="UTF-8"?>\n<movimenti>${inner}</movimenti>\n`;

export const soapEnvelope = inner => '<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>'
  + `<ns2:inviaMovimentazione xmlns:ns2="http://checkin.ws.service.turismo5.gies.it/"><movimentazione>${inner}</movimentazione></ns2:inviaMovimentazione></S:Body></S:Envelope>`;

// The answer: per guest (idswh) whether it was taken, and why not.
export function parseAnswer(x) {
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(x);
  if (fault) throw new Error(`Ross1000: ${fault[1].slice(0, 300)}`);
  const results = [...x.matchAll(/<(?:\w+:)?(?:arrivo|partenza)>\s*<idswh>([^<]*)<\/idswh>\s*<successo>([^<]*)<\/successo>(?:\s*<errore>([^<]*)<\/errore>)?/g)]
    .map(m => ({ idswh: m[1], ok: m[2] === 'true', error: m[3] || '' }));
  return { results };
}

export async function send({ region, user, password }, inner, fetchImpl = fetch) {
  const r = REGIONS[region];
  if (!r) throw new Error('choose the region');
  const res = await fetchImpl(r.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', Authorization: `Basic ${btoa(`${user}:${password}`)}` },
    body: soapEnvelope(inner),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error('Ross1000 refused the user name or password');
  if (!res.ok && !/Fault/.test(text)) throw new Error(`Ross1000 is not answering (HTTP ${res.status})`);
  return parseAnswer(text);
}
