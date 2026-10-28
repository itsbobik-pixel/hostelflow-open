// Alloggiati Web (Polizia di Stato) — record building + SOAP client.
//
// Record layout ("tracciato record", MANUALEALBERGHI.pdf ch. 12 and the web
// service manual ch. 4): one guest = one line of exactly 168 characters,
// fixed-width fields, space padded:
//
//   from  len  field
//     0    2   tipo alloggiato (16 ospite singolo, 17 capo famiglia, 18 capo gruppo, 19 familiare, 20 membro gruppo)
//     2   10   data arrivo gg/mm/aaaa (today or yesterday)
//    12    2   giorni di permanenza (1-30)
//    14   50   cognome
//    64   30   nome
//    94    1   sesso (1 = M, 2 = F)
//    95   10   data nascita gg/mm/aaaa
//   105    9   comune nascita   (only if born in Italy, else blank)
//   114    2   provincia nascita (only if born in Italy, else blank)
//   116    9   stato nascita
//   125    9   cittadinanza
//   134    5   tipo documento    \
//   139   20   numero documento   } blank for 19/20 (family/group members)
//   159    9   luogo rilascio    /  (comune code if issued in Italy, else stato code)
//
// Lines are joined with CR+LF, none after the last one. The web service takes
// each line as its own <string>, so joining only matters for file export.

import { STATI, COMUNI, DOCUMENTI } from './alloggiati-tables.js';

export const RECORD_LENGTH = 168;
export const ITALIA = '100000100';

// ISO 3166-1 alpha-3 (what passports/MRZ and OCR give us) -> Alloggiati state
// name. Names must match alloggiati-tables.js exactly (a test checks this).
// Countries missing from the Alloggiati table (e.g. Jersey, Gibraltar, Aruba)
// are intentionally absent: staff must pick the state by hand.
const ISO3_TO_STATO = {
  AFG: 'AFGHANISTAN', ALB: 'ALBANIA', DZA: 'ALGERIA', AND: 'ANDORRA', AGO: 'ANGOLA',
  AIA: 'ANGUILLA (ISOLA)', ATG: 'ANTIGUA E BARBUDA', SAU: 'ARABIA SAUDITA', ARG: 'ARGENTINA',
  ARM: 'ARMENIA', AUS: 'AUSTRALIA', AUT: 'AUSTRIA', AZE: 'AZERBAIGIAN', BHS: 'BAHAMAS',
  BHR: 'BAHREIN', BGD: 'BANGLADESH', BRB: 'BARBADOS', BEL: 'BELGIO', BLZ: 'BELIZE',
  BEN: 'BENIN', BMU: 'BERMUDE', BTN: 'BHUTAN', BLR: 'BIELORUSSIA', BOL: 'BOLIVIA',
  BIH: 'BOSNIA ED ERZEGOVINA', BWA: 'BOTSWANA', BRA: 'BRASILE', BRN: 'BRUNEI DARUSSALAM',
  BGR: 'BULGARIA', BFA: 'BURKINA FASO', BDI: 'BURUNDI', KHM: 'CAMBOGIA', CMR: 'CAMERUN',
  CAN: 'CANADA', CPV: 'CAPO VERDE', CYM: 'CAYMAN (ISOLE)', CXR: 'CHRISTMAS', TCD: 'CIAD',
  CHL: 'CILE', CHN: 'CINA', CYP: 'CIPRO', CCK: 'COCOS', COL: 'COLOMBIA', COM: 'COMORE',
  COG: 'CONGO', PRK: 'COREA DEL NORD', KOR: 'COREA DEL SUD', CIV: "COSTA D'AVORIO",
  CRI: 'COSTA RICA', HRV: 'CROAZIA', CUB: 'CUBA', DNK: 'DANIMARCA', DMA: 'DOMINICA',
  ECU: 'ECUADOR', EGY: 'EGITTO', SLV: 'EL SALVADOR', ARE: 'EMIRATI ARABI UNITI',
  ERI: 'ERITREA', EST: 'ESTONIA', ETH: 'ETIOPIA', FRO: 'FAER OER', RUS: 'FEDERAZIONE RUSSA',
  FJI: 'FIGI', PHL: 'FILIPPINE', FIN: 'FINLANDIA', FRA: 'FRANCIA', GAB: 'GABON',
  GMB: 'GAMBIA', GEO: 'GEORGIA', SGS: 'GEORGIA SUD E ISOLE SANDWICH AUSTRALI',
  DEU: 'GERMANIA', D: 'GERMANIA', GHA: 'GHANA', JAM: 'GIAMAICA', JPN: 'GIAPPONE',
  DJI: 'GIBUTI', JOR: 'GIORDANIA', GRC: 'GRECIA', GRD: 'GRENADA', GRL: 'GROENLANDIA',
  GLP: 'GUADALUPA', GUM: 'GUAM', GTM: 'GUATEMALA', GUF: 'GUAYANA FRANCESE', GGY: 'GUERNSEY',
  GIN: 'GUINEA', GNB: 'GUINEA BISSAU', GNQ: 'GUINEA EQUATORIALE', GUY: 'GUYANA',
  HTI: 'HAITI', HND: 'HONDURAS', HKG: 'HONG KONG', IND: 'INDIA', IDN: 'INDONESIA',
  IRN: 'IRAN', IRQ: 'IRAQ', IRL: 'IRLANDA', ISL: 'ISLANDA', VIR: 'ISOLE VERGINI',
  ISR: 'ISRAELE', ITA: 'ITALIA', KAZ: 'KAZAKISTAN', KEN: 'KENYA', KGZ: 'KIRGHIZISTAN',
  KIR: 'KIRIBATI', XKX: 'KOSOVO', RKS: 'KOSOVO', KWT: 'KUWAIT', REU: 'LA REUNION',
  LAO: 'LAOS', LSO: 'LESOTHO', LVA: 'LETTONIA', LBN: 'LIBANO', LBR: 'LIBERIA', LBY: 'LIBIA',
  LIE: 'LIECHTENSTEIN', LTU: 'LITUANIA', LUX: 'LUSSEMBURGO', MAC: 'MACAO',
  MKD: 'MACEDONIA DEL NORD', MDG: 'MADAGASCAR', MWI: 'MALAWI', MYS: 'MALAYSIA',
  MDV: 'MALDIVE', MLI: 'MALI', MLT: 'MALTA', FLK: 'MALVINE', IMN: 'MAN', MAR: 'MAROCCO',
  MHL: 'MARSHALL', MTQ: 'MARTINICA', MRT: 'MAURITANIA', MUS: 'MAURIZIO', MYT: 'MAYOTTE',
  MEX: 'MESSICO', FSM: 'MICRONESIA STATI FEDERALI', MDA: 'MOLDAVIA', MCO: 'MONACO',
  MNG: 'MONGOLIA', MNE: 'MONTENEGRO', MSR: 'MONTSERRAT', MOZ: 'MOZAMBICO',
  MMR: 'MYANMAR-BIRMANIA', NAM: 'NAMIBIA', NRU: 'NAURU', NPL: 'NEPAL', NIC: 'NICARAGUA',
  NER: 'NIGER', NGA: 'NIGERIA', NFK: 'NORFOLK', NOR: 'NORVEGIA', NCL: 'NUOVA CALEDONIA',
  NZL: 'NUOVA ZELANDA', OMN: 'OMAN', NLD: 'PAESI BASSI', PAK: 'PAKISTAN',
  PLW: 'PALAU REPUBBLICA', PSE: 'PALESTINA', PAN: 'PANAMA', PNG: 'PAPUASIA-N.GUINEA',
  PRY: 'PARAGUAY', PER: "PERU'", PCN: 'PITCAIRN', PYF: 'POLINESIA', POL: 'POLONIA',
  PRT: 'PORTOGALLO', PRI: 'PUERTO RICO', QAT: 'QATAR', GBR: 'REGNO UNITO',
  CZE: 'REPUBBLICA CECA', CAF: 'REPUBBLICA CENTRAFRICANA',
  COD: 'REPUBBLICA DEMOCRATICA DEL CONGO', DOM: 'REPUBBLICA DOMINICANA',
  SVK: 'REPUBBLICA SLOVACCA', ROU: 'ROMANIA', RWA: 'RUANDA', KNA: 'S. CHRISTOPHER E NEVIS',
  ESH: 'SAHARA SPAGNOLO', LCA: 'SAINT LUCIA', SPM: 'SAINT PIERRE ET MIQUELON',
  VCT: 'SAINT VINCENT E GRENADINE', SLB: 'SALOMONE', WSM: 'SAMOA', ASM: 'SAMOA AMERICANE',
  SMR: 'SAN MARINO', SHN: 'SANT ELENA', STP: "SAO TOME' E PRINCIPE", SEN: 'SENEGAL',
  SRB: 'SERBIA', SYC: 'SEYCHELLES', SLE: 'SIERRA LEONE', SGP: 'SINGAPORE', SYR: 'SIRIA',
  SVN: 'SLOVENIA', SOM: 'SOMALIA', ESP: 'SPAGNA', LKA: 'SRI LANKA (CEYLON)',
  USA: "STATI UNITI D'AMERICA", VAT: "STATO DELLA CITTA' DEL VATICANO", SSD: 'SUD SUDAN',
  ZAF: 'SUDAFRICA', SDN: 'SUDAN', SUR: 'SURINAME', SWE: 'SVEZIA', CHE: 'SVIZZERA',
  SWZ: 'SWAZILAND', TJK: 'TAGIKISTAN', TWN: 'TAIWAN', TZA: 'TANZANIA', THA: 'THAILANDIA',
  TLS: 'TIMOR', TGO: 'TOGO', TKL: 'TOKELAU', TON: 'TONGA', TTO: 'TRINIDAD E TOBAGO',
  TUN: 'TUNISIA', TUR: 'TURCHIA', TKM: 'TURKMENISTAN', TCA: 'TURKS', TUV: 'TUVALU',
  UKR: 'UCRAINA', UGA: 'UGANDA', HUN: 'UNGHERIA', URY: 'URUGUAY', UZB: 'UZBEKISTAN',
  VUT: 'VANUATU', VEN: 'VENEZUELA', VGB: 'VERGINI BRITANNICHE (ISOLE)', VNM: 'VIETNAM',
  WLF: 'WALLIS', YEM: 'YEMEN', ZMB: 'ZAMBIA', ZWE: 'ZIMBABWE',
  XXA: 'APOLIDE', XXB: 'APOLIDE', // stateless (MRZ codes)
};

// English country names / demonyms staff (or older OCR results) may type.
const ENGLISH_TO_ISO3 = {
  'czechia': 'CZE', 'czech republic': 'CZE', 'czech': 'CZE', 'slovakia': 'SVK', 'slovak': 'SVK',
  'germany': 'DEU', 'german': 'DEU', 'austria': 'AUT', 'austrian': 'AUT', 'italy': 'ITA',
  'italian': 'ITA', 'france': 'FRA', 'french': 'FRA', 'spain': 'ESP', 'spanish': 'ESP',
  'united kingdom': 'GBR', 'uk': 'GBR', 'great britain': 'GBR', 'british': 'GBR',
  'england': 'GBR', 'scotland': 'GBR', 'wales': 'GBR', 'northern ireland': 'GBR',
  'usa': 'USA', 'us': 'USA', 'united states': 'USA', 'united states of america': 'USA',
  'american': 'USA', 'poland': 'POL', 'polish': 'POL', 'netherlands': 'NLD', 'holland': 'NLD',
  'dutch': 'NLD', 'belgium': 'BEL', 'belgian': 'BEL', 'switzerland': 'CHE', 'swiss': 'CHE',
  'portugal': 'PRT', 'portuguese': 'PRT', 'ireland': 'IRL', 'irish': 'IRL', 'sweden': 'SWE',
  'swedish': 'SWE', 'norway': 'NOR', 'norwegian': 'NOR', 'denmark': 'DNK', 'danish': 'DNK',
  'finland': 'FIN', 'finnish': 'FIN', 'hungary': 'HUN', 'hungarian': 'HUN', 'romania': 'ROU',
  'romanian': 'ROU', 'bulgaria': 'BGR', 'bulgarian': 'BGR', 'croatia': 'HRV', 'croatian': 'HRV',
  'slovenia': 'SVN', 'slovenian': 'SVN', 'greece': 'GRC', 'greek': 'GRC', 'canada': 'CAN',
  'canadian': 'CAN', 'australia': 'AUS', 'australian': 'AUS', 'new zealand': 'NZL',
  'brazil': 'BRA', 'brazilian': 'BRA', 'argentina': 'ARG', 'argentinian': 'ARG',
  'argentine': 'ARG', 'chile': 'CHL', 'chilean': 'CHL', 'colombia': 'COL', 'colombian': 'COL',
  'mexico': 'MEX', 'mexican': 'MEX', 'peru': 'PER', 'japan': 'JPN', 'japanese': 'JPN',
  'south korea': 'KOR', 'korea': 'KOR', 'korean': 'KOR', 'china': 'CHN', 'chinese': 'CHN',
  'taiwan': 'TWN', 'india': 'IND', 'indian': 'IND', 'russia': 'RUS', 'russian': 'RUS',
  'ukraine': 'UKR', 'ukrainian': 'UKR', 'turkey': 'TUR', 'turkiye': 'TUR', 'turkish': 'TUR',
  'israel': 'ISR', 'israeli': 'ISR', 'estonia': 'EST', 'latvia': 'LVA', 'lithuania': 'LTU',
  'luxembourg': 'LUX', 'malta': 'MLT', 'cyprus': 'CYP', 'iceland': 'ISL', 'serbia': 'SRB',
  'albania': 'ALB', 'morocco': 'MAR', 'egypt': 'EGY', 'south africa': 'ZAF',
  'singapore': 'SGP', 'philippines': 'PHL', 'thailand': 'THA', 'vietnam': 'VNM',
  'indonesia': 'IDN', 'malaysia': 'MYS', 'hong kong': 'HKG', 'belarus': 'BLR',
  'moldova': 'MDA', 'georgia': 'GEO', 'north macedonia': 'MKD', 'macedonia': 'MKD',
  'bosnia and herzegovina': 'BIH', 'montenegro': 'MNE', 'kosovo': 'XKX',
  'san marino': 'SMR', 'monaco': 'MCO', 'liechtenstein': 'LIE', 'andorra': 'AND',
};

// Our doc types (from OCR) -> Alloggiati codes. Foreign ID cards go in as
// IDENT; Italian electronic ID (CIE) is IDELE.
const DOC_TYPE_TO_CODE = {
  passport: 'PASOR',
  id_card: 'IDENT',
  electronic_id: 'IDELE',
  driving_licence: 'PATEN',
};

function stateCodeByName(name) {
  for (const [code, n] of Object.entries(STATI)) if (n === name) return code;
  return '';
}

function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

// An ISO 3166 alpha-3 code from a code or an English name/demonym ('' if unknown).
// Other countries' modules use it too.
export function toIso3(value) {
  const v = normalize(value);
  if (!v) return '';
  if (/^[A-Z]{3}$/.test(v) && ISO3_TO_STATO[v]) return v;
  return ENGLISH_TO_ISO3[v.toLowerCase().replace(/[^a-z ]/g, '').trim()] || (/^[A-Z]{3}$/.test(v) ? v : '');
}

// English names we know for an ISO alpha-3 code (for other countries' code lists).
export function englishNamesOf(iso3) {
  return Object.keys(ENGLISH_TO_ISO3).filter(k => ENGLISH_TO_ISO3[k] === iso3);
}

// Accepts a 9-digit Alloggiati code, an ISO3 code, the Italian table name, or
// a common English name / demonym. Returns the 9-digit code or ''.
export function resolveState(value) {
  const v = normalize(value);
  if (!v) return '';
  if (/^\d{9}$/.test(v)) return STATI[v] ? v : '';
  if (ISO3_TO_STATO[v]) return stateCodeByName(ISO3_TO_STATO[v]);
  const byName = stateCodeByName(v);
  if (byName) return byName;
  const iso = ENGLISH_TO_ISO3[v.toLowerCase().replace(/[^a-z ]/g, '').trim()];
  return iso ? stateCodeByName(ISO3_TO_STATO[iso]) : '';
}

// Letters only: documents print "AGLIÈ", "SANT’OLCESE", "S. GIOVANNI" while
// the official table says "AGLIE'", "SANT'OLCESE", "SAN GIOVANNI"-style
// spellings — compare without accents, apostrophes, hyphens, dots, spaces.
const letters = s => normalize(s).replace(/[^A-Z]/g, '');
let comuneIndex;
function comunesByKey() {
  if (!comuneIndex) {
    comuneIndex = new Map();
    for (const [k, code] of Object.entries(COMUNI)) {
      const [name, prov] = k.split('|');
      const key = letters(name);
      if (!comuneIndex.has(key)) comuneIndex.set(key, []);
      comuneIndex.get(key).push({ code, prov });
    }
  }
  return comuneIndex;
}

// Italian comune by name (+ optional province sigla). Returns {code, prov} or null.
// Without a province, only an unambiguous name matches. "GENOVA (GE)" works too.
export function resolveComune(name, prov) {
  let n = normalize(name);
  if (!n) return null;
  let p = normalize(prov);
  const inline = n.match(/^(.*?)\s*\(([A-Z]{2})\)$/);
  if (inline) {
    n = inline[1];
    p = p || inline[2];
  }
  if (/^\d{9}$/.test(n)) {
    const key = Object.keys(COMUNI).find(k => COMUNI[k] === n);
    return key ? { code: n, prov: key.split('|')[1] } : null;
  }
  const hits = comunesByKey().get(letters(n)) || [];
  if (p) return hits.find(h => h.prov === p) || null;
  return hits.length === 1 ? hits[0] : null;
}

// A country named in a place as printed abroad: "BUENOS AIRES (ARG)",
// "BUENOS AIRES ARGENTINA", "ARGENTINA", "MENDOZA, ARGENTINA". '' if none.
export function stateInPlace(place) {
  const v = normalize(place);
  if (!v) return '';
  const tries = [];
  const paren = v.match(/\(([^)]+)\)\s*$/);
  if (paren) tries.push(paren[1]);
  const afterComma = v.split(',').pop();
  if (afterComma !== v) tries.push(afterComma);
  const words = v.replace(/[()]/g, ' ').trim().split(/\s+/);
  for (let n = Math.min(3, words.length); n >= 1; n--) tries.push(words.slice(-n).join(' '));
  for (const t of tries) {
    const code = resolveState(t.trim());
    if (code) return code;
  }
  return '';
}

export function resolveDocType(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'PASOR'; // hostel default: nearly everyone shows a passport
  if (DOC_TYPE_TO_CODE[raw.toLowerCase()]) return DOC_TYPE_TO_CODE[raw.toLowerCase()];
  const up = raw.toUpperCase();
  return DOCUMENTI[up] ? up : '';
}

// AlloggiatiWeb rejects diacritics and punctuation in names ("Ördög" ->
// "ORDOG", "SMITH/JONES" -> "SMITH JONES", "O'BRIEN" -> "O BRIEN"). The
// Chrome extension thought hyphens were fine; at the desk they got rejected
// (2026-09-28), so "JEAN-PIERRE" -> "JEAN PIERRE" too. Only A-Z and spaces.
export function cleanName(s) {
  return normalize(s)
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "DD.MM.YYYY", "DD/MM/YYYY", "D.M.YYYY" or "YYYY-MM-DD" -> "DD/MM/YYYY" or ''.
export function toItalianDate(s) {
  const v = String(s || '').trim();
  let d, m, y;
  let match = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) [, d, m, y] = match;
  else if ((match = v.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, y, m, d] = match;
  else return '';
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return '';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// Today's date in Italy as DD/MM/YYYY (the Worker runs in UTC; near midnight
// UTC and Rome are on different days). offsetDays moves by calendar days, not
// by 24 hours: the days the clocks change have 23 or 25.
export function todayInItaly(now = new Date(), offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = t => Number(parts.find(p => p.type === t).value);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offsetDays));
  const two = n => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Birth country (Alloggiati code): its own field; else the country in the
// birth place (Italian documents print "BUENOS AIRES (ARG)" for Italians born
// abroad); else, unless the place is an Italian comune, the citizenship.
// '' when unknown. The police record and Ross1000 both use this.
export function birthStateOf(f) {
  const ownBirth = f.birthCountry || f.birthCountryCode;
  if (ownBirth) return resolveState(f.birthCountryCode || f.birthCountry);
  const placeState = f.birthPlace && !resolveComune(f.birthPlace, f.birthProvince) ? stateInPlace(f.birthPlace) : '';
  return placeState || resolveState(f.nationalityCode || f.nationality);
}

function pad(value, len) {
  const s = String(value == null ? '' : value);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

// Builds one 168-char record from a guest as stored by the Check-in tab
// ({id, fields:{...}}) or from the bare fields object. Throws an Error listing
// every problem found, so staff can fix them all in one go.
//
// Fields used:
//   surname, given, sex (M/F), dob (DD.MM.YYYY), docNumber, docType
//   nationality / nationalityCode        -> cittadinanza
//   birthCountry / birthCountryCode      -> stato nascita (else the country in birthPlace, else cittadinanza)
//   birthPlace, birthProvince            -> comune nascita (required if born in Italy)
//   country / countryCode                -> issuing state of the document
//   issuePlace, issueProvince            -> comune rilascio (required if issued in Italy;
//                                           a country = an Italian consulate abroad)
//   arrival (DD.MM.YYYY, default today in Italy), nights (1-30, default 1)
//   guestType (16-20, default 16 ospite singolo)
export function guestToRecord(guest, { now = new Date() } = {}) {
  const f = (guest && guest.fields) || guest || {};
  const errors = [];

  const type = String(f.guestType || '16');
  if (!['16', '17', '18', '19', '20'].includes(type)) errors.push('guest type must be 16-20');
  const isMember = type === '19' || type === '20';

  const arrival = f.arrival ? toItalianDate(f.arrival) : todayInItaly(now);
  if (!arrival) errors.push('arrival date is not a valid date');
  else if (arrival !== todayInItaly(now) && arrival !== todayInItaly(now, -1)) {
    errors.push('arrival was more than a day ago — Alloggiati Web only accepts today or yesterday; fix the date if it is wrong');
  }

  const nights = f.nights === undefined || f.nights === '' ? 1 : Number(f.nights);
  if (!Number.isInteger(nights) || nights < 1 || nights > 30) errors.push('nights must be between 1 and 30');

  const surname = cleanName(f.surname);
  const given = cleanName(f.given);
  if (!surname) errors.push('surname missing');
  if (!given) errors.push('given name missing');
  if (surname.length > 50) errors.push('surname longer than 50 characters');
  if (given.length > 30) errors.push('given name longer than 30 characters');

  const sex = String(f.sex || '').trim().toUpperCase();
  const sexCode = sex === 'M' ? '1' : sex === 'F' ? '2' : '';
  if (!sexCode) errors.push('sex must be M or F');

  const dob = toItalianDate(f.dob);
  if (!dob) errors.push('date of birth missing or invalid');

  const citizenship = resolveState(f.nationalityCode || f.nationality);
  if (!citizenship) errors.push(`unknown nationality "${f.nationality || f.nationalityCode || ''}"`);

  const ownBirth = f.birthCountry || f.birthCountryCode;
  const birthState = birthStateOf(f);
  // Without its own value it defaults to citizenship, already reported above.
  if (!birthState && (citizenship || f.birthCountry || f.birthCountryCode)) {
    errors.push(`unknown birth country "${f.birthCountry || f.birthCountryCode || ''}"`);
  }

  let birthComune = '', birthProv = '';
  if (birthState === ITALIA) {
    const c = resolveComune(f.birthPlace, f.birthProvince);
    if (!c) {
      errors.push(f.birthPlace && !ownBirth
        ? `"${f.birthPlace}" is not an Italian comune — if the guest was born abroad, fill in "Born in (country)"`
        : 'born in Italy: birth comune missing, unknown or ambiguous (add the province)');
    }
    else { birthComune = c.code; birthProv = c.prov; }
  }

  let docType = '', docNumber = '', issuePlace = '';
  if (!isMember) {
    docType = resolveDocType(f.docType);
    if (!docType) errors.push(`unknown document type "${f.docType}"`);
    docNumber = String(f.docNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!docNumber) errors.push('document number missing');
    if (docNumber.length > 20) errors.push('document number longer than 20 characters');
    const issueState = resolveState(f.countryCode || f.country) || (!f.country && !f.countryCode ? citizenship : '');
    if (!issueState) {
      if (citizenship || f.country || f.countryCode) errors.push(`unknown issuing country "${f.country || f.countryCode || ''}"`);
    }
    else if (issueState === ITALIA) {
      // An Italian document issued by a consulate or embassy abroad: the
      // place of issue is that country.
      const c = resolveComune(f.issuePlace, f.issueProvince);
      const abroad = !c && stateInPlace(f.issuePlace);
      if (c) issuePlace = c.code;
      else if (abroad && abroad !== ITALIA) issuePlace = abroad;
      else errors.push('document issued in Italy: issuing comune missing, unknown or ambiguous (issued by a consulate abroad? put the country in "Issued in")');
    } else issuePlace = issueState;
  }

  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.errors = errors;
    throw err;
  }

  const record =
    pad(type, 2) +
    pad(arrival, 10) +
    String(nights).padStart(2, '0') +
    pad(surname, 50) +
    pad(given, 30) +
    sexCode +
    pad(dob, 10) +
    pad(birthComune, 9) +
    pad(birthProv, 2) +
    pad(birthState, 9) +
    pad(citizenship, 9) +
    pad(docType, 5) +
    pad(docNumber, 20) +
    pad(issuePlace, 9);

  if (record.length !== RECORD_LENGTH) throw new Error(`internal: record is ${record.length} chars`);
  return record;
}

// ===== SOAP client =====
// Endpoint and SOAP 1.1 shape per the web service manual / WSDL
// (https://alloggiatiweb.poliziadistato.it/service/service.asmx?wsdl).

const ENDPOINT = 'https://alloggiatiweb.poliziadistato.it/service/Service.asmx';
const NS = 'AlloggiatiService';

export function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function xmlUnescape(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
// Tags come back unprefixed in the default namespace; tolerate a prefix anyway.
function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? xmlUnescape(m[1]) : null;
}
function tags(xml, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(m[1]);
  return out;
}

async function soap(action, inner, fetchImpl = fetch) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>${inner}</soap:Body>
</soap:Envelope>`;
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/${action}"` },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    const fault = tag(text, 'faultstring');
    throw new Error(`Alloggiati ${action} HTTP ${res.status}${fault ? ': ' + fault : ''}`);
  }
  return text;
}

function esito(block) {
  return {
    ok: (tag(block, 'esito') || '').trim() === 'true',
    code: (tag(block, 'ErroreCod') || '').trim(),
    description: (tag(block, 'ErroreDes') || '').trim(),
    detail: (tag(block, 'ErroreDettaglio') || '').trim(),
  };
}

export async function generateToken({ user, password, wskey }, fetchImpl) {
  const inner = `<GenerateToken xmlns="${NS}"><Utente>${xmlEscape(user)}</Utente><Password>${xmlEscape(password)}</Password><WsKey>${xmlEscape(wskey)}</WsKey></GenerateToken>`;
  const xml = await soap('GenerateToken', inner, fetchImpl);
  const result = esito(tag(xml, 'result') || '');
  const token = (tag(xml, 'token') || '').trim();
  if (!result.ok || !token) {
    throw Object.assign(new Error(`GenerateToken failed: ${result.description || ''} ${result.detail || ''}`.trim()), { code: 'login' });
  }
  return { token, expires: tag(xml, 'expires') };
}

// mode 'test' only validates; 'send' validates and registers the valid lines.
// Returns {ok, general:{...}, valid, rows:[{ok, code, description, detail}]}.
export async function submitRecords({ user, token, records, mode }, fetchImpl) {
  const action = mode === 'send' ? 'Send' : 'Test';
  const list = records.map(r => `<string>${xmlEscape(r)}</string>`).join('');
  const inner = `<${action} xmlns="${NS}"><Utente>${xmlEscape(user)}</Utente><token>${xmlEscape(token)}</token><ElencoSchedine>${list}</ElencoSchedine></${action}>`;
  const xml = await soap(action, inner, fetchImpl);
  const general = esito(tag(xml, `${action}Result`) || '');
  const dettaglio = tag(xml, 'Dettaglio') || '';
  const rows = tags(dettaglio, 'EsitoOperazioneServizio').map(esito);
  const valid = parseInt(tag(xml, 'SchedineValide') || '0', 10);
  return { ok: general.ok && rows.length === records.length && rows.every(r => r.ok), general, valid, rows };
}
