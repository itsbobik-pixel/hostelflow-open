// A test file for Regione Liguria (RiMovCli, C/59) with made-up guests:
//   node scripts/rimovcli-sample.mjs [CITR] [from YYYY-MM-DD] [to] [rooms] [beds]
// Writes <CITR>_<YYYYMMDD>.xml per day to docs/istat/rimovcli/test/.
// The real files come from the app: Settings → Statistics → RiMovCli.

import { mkdirSync, writeFileSync } from 'node:fs';
import { files } from '../src/stats/rimovcli.js';
import { parseDay } from '../src/stats/istat.js';

const [citr = '000000-OS-0000', from = '2026-10-14', to = '2026-10-15', rooms, beds] = process.argv.slice(2);
const g = (arrival, nights, nationality, more = {}) => ({ fields: { arrival, nights: String(nights), nationality, ...more } });
const guests = [
  g('12.10.2026', 3, 'DEU'), g('12.10.2026', 3, 'DEU'),                     // leave on the 15th
  g('13.10.2026', 2, 'FRA'),                                                // leaves on the 15th
  g('13.10.2026', 4, 'USA'), g('13.10.2026', 4, 'USA'),
  g('14.10.2026', 1, 'ITA', { residenceProvince: 'MI' }),                   // one night
  g('14.10.2026', 3, 'ITA', { residenceProvince: 'SP' }),
  g('14.10.2026', 2, 'GBR'),
  g('14.10.2026', 2, 'AUS'),
  g('15.10.2026', 2, 'ITA', { residenceProvince: 'GE' }), g('15.10.2026', 2, 'ITA', { residenceProvince: 'GE' }),
  g('15.10.2026', 1, 'ITA', { residenceProvince: 'RM' }),
  g('15.10.2026', 3, 'NLD'),
  g('15.10.2026', 2, 'SRB'), g('15.10.2026', 2, 'ALB'),                     // both "other Europe" (100)
  g('15.10.2026', 1, 'CZE', { residenceCountry: 'ITA', residenceProvince: 'SP' }), // a foreigner living in Italy
  g('15.10.2026', 2, 'ARG'),
  g('15.10.2026', 2, 'JPN'),
];

const out = files(guests, parseDay(from), parseDay(to), { idstruttura: citr, rooms: Number(rooms) || 0, beds: Number(beds) || 0 });
const dir = new URL('../docs/istat/rimovcli/test/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const f of out.files) {
  writeFileSync(new URL(f.name, dir), f.text);
  console.log(f.name);
}
if (out.problems.length) console.log('left out:', out.problems);
