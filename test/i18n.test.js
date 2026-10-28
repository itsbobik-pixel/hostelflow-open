import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The dictionaries are plain scripts (const IT/ES/FR = {...}); read them as such.
const read = p => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const dict = (file, name) => {
  const src = read(file);
  const start = src.indexOf(`const ${name} = {`);
  const end = src.indexOf('\n};', start) + 3;
  return new Function(src.slice(start, end).replace(`const ${name} =`, 'return'))();
};
const placeholders = s => (s.match(/\{\w+\}/g) || []).sort().join(',');

test('Spanish and French have every text Italian has, with the same {placeholders}', () => {
  const IT = dict('i18n.js', 'IT');
  for (const [file, name] of [['i18n-es.js', 'ES'], ['i18n-fr.js', 'FR']]) {
    const D = dict(file, name);
    const missing = Object.keys(IT).filter(k => !(k in D));
    assert.deepEqual(missing, [], `${name} is missing texts`);
    for (const k of Object.keys(D)) assert.equal(placeholders(D[k]), placeholders(k), `${name}: ${k}`);
  }
  const index = read('index.html');
  assert.ok(index.indexOf('/i18n-es.js') < index.indexOf('/i18n.js') && index.indexOf('/i18n-fr.js') < index.indexOf('/i18n.js'), 'loaded before i18n.js');
});
