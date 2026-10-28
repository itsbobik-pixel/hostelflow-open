import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyMovement, nationalityReport, parseDay, residenceOf } from '../src/stats/istat.js';

const day = parseDay('10.09.2026');
const g = (arrival, nights, fields = {}) => ({ fields: { nationality: 'CZE', arrival, nights: String(nights), ...fields } });

test('previous night, arrivals, departures and tonight add up', () => {
  const r = dailyMovement([
    g('08.09.2026', 3),              // there last night and tonight
    g('09.09.2026', 1),              // there last night, leaves today
    g('10.09.2026', 2),              // arrives today
    g('10.09.2026', 1, { nationality: 'DEU' }),
    g('05.09.2026', 2),              // long gone
    g('11.09.2026', 1),              // not yet
  ], day);
  assert.deepEqual(r.totals, { previousNight: 2, arrived: 2, departed: 1, presentTonight: 3 });
  const cz = r.rows.find(x => x.place === 'Repubblica Ceca');
  assert.deepEqual([cz.previousNight, cz.arrived, cz.departed, cz.presentTonight], [2, 1, 1, 2]);
  assert.equal(r.rows.find(x => x.place === 'Germania').arrived, 1);
  for (const x of r.rows) assert.equal(x.presentTonight, x.previousNight + x.arrived - x.departed);
});

test('residence: defaults to nationality, Italians by province', () => {
  assert.equal(residenceOf({ nationality: 'Czechia' }).label, 'Repubblica Ceca');
  assert.equal(residenceOf({ nationality: 'CZE', residenceCountry: 'ITA', residenceProvince: 'sp' }).label, 'La Spezia (SP)');
  assert.equal(residenceOf({ nationality: 'ITA', residenceCountry: 'Germany' }).label, 'Germania');
  // No province of residence: the province of birth; a filled-in one wins; born abroad stays unknown.
  assert.equal(residenceOf({ nationality: 'ITA', birthProvince: 'GE' }).label, 'Genova (GE)');
  assert.equal(residenceOf({ nationality: 'ITA', birthProvince: 'GE', residenceProvince: 'SP' }).label, 'La Spezia (SP)');
  assert.equal(residenceOf({ nationality: 'ITA', birthProvince: 'EE' }).key, 'IT-?');
  // Only the comune typed (of residence, else of birth): its province.
  assert.equal(residenceOf({ nationality: 'ITA', birthPlace: 'Genova' }).label, 'Genova (GE)');
  assert.equal(residenceOf({ nationality: 'ITA', birthPlace: 'Genova', residencePlace: 'La Spezia' }).label, 'La Spezia (SP)');
  const r = dailyMovement([g('10.09.2026', 1, { nationality: 'ITA' })], day);
  assert.deepEqual(r.problems, ['an Italian resident without a valid province']);
  assert.equal(r.rows[0].place, 'province?');
});

test('Italian provinces come first, then countries alphabetically', () => {
  const r = dailyMovement([
    g('10.09.2026', 1, { nationality: 'FRA' }),
    g('10.09.2026', 1, { nationality: 'ITA', residenceProvince: 'GE' }),
    g('10.09.2026', 1, { nationality: 'AUT' }),
  ], day);
  assert.deepEqual(r.rows.map(x => x.place), ['Genova (GE)', 'Austria', 'Francia']);
});

test('nationality report: arrivals and departures per day, by nationality', () => {
  const from = parseDay('2026-09-10');
  const days = nationalityReport([
    { fields: { arrival: '10.09.2026', nights: '2', nationality: 'GERMANIA' } },
    { fields: { arrival: '10.09.2026', nights: '1', nationality: 'GERMANIA' } },
    { fields: { arrival: '11.09.2026', nights: '5', nationality: 'ITALIA' } },
    { fields: { arrival: '01.09.2026', nights: '9', nationality: 'FRANCIA' } }, // left on the 10th
  ], from, parseDay('2026-09-12'));
  assert.deepEqual(days.map(d => d.date), ['2026-09-10', '2026-09-11', '2026-09-12']);
  assert.deepEqual(days[0].arrived, [{ nationality: 'Germania', n: 2 }]);
  assert.deepEqual(days[0].departed, [{ nationality: 'Francia', n: 1 }]);
  assert.deepEqual(days[1].arrived, [{ nationality: 'Italia', n: 1 }]);
  assert.deepEqual(days[1].departed, [{ nationality: 'Germania', n: 1 }]);
  assert.deepEqual(days[2].departed, [{ nationality: 'Germania', n: 1 }]);
});
