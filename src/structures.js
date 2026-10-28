// Structures: one property that the authorities count as two (or more) — e.g.
// a room on another floor registered on its own, with its own Alloggiati Web
// account and its own ISTAT codes. The property's own columns are the first,
// "main" structure (so a property with one structure works exactly as
// before); the others live in the structures table. Each guest records which
// one they stay in (guests.structure_id, NULL = main): their police
// registration goes to that structure's account and they count only in its
// statistics.

import { HttpError } from './http.js';

export const MAIN = 'main';
// A second connection is enough for now (Costello); the table allows more.
export const MAX_EXTRA = 1;

// The others' encrypted settings are bound to the structure too, so one
// structure's stored login can't be passed off as another's.
export const structureAad = (propertyId, structureId) => `${propertyId}/${structureId}`;

export async function extraStructures(db, propertyId) {
  const { results } = await db.prepare(
    'SELECT * FROM structures WHERE property_id = ? ORDER BY created_at',
  ).bind(propertyId).all();
  return results;
}

// One structure of this property: null for the main one, else its row (404
// when it isn't this property's).
export async function loadStructure(db, propertyId, id) {
  if (id === undefined || id === null || id === '' || id === MAIN) return null;
  if (typeof id !== 'string') throw new HttpError(400, 'unknown structure');
  const row = await db.prepare('SELECT * FROM structures WHERE id = ? AND property_id = ?').bind(id, propertyId).first();
  if (!row) throw new HttpError(404, 'unknown structure');
  return row;
}

// For the app: [] with one structure (nothing to choose), else every one with its name.
export function structureList(property, extra) {
  if (!extra.length) return [];
  return [{ id: MAIN, name: property.structure_name || 'Main' }, ...extra.map(s => ({ id: s.id, name: s.name }))];
}

// Guests of one structure, as a WHERE part (alias g optional).
export function structureWhere(structure, column = 'structure_id') {
  return structure ? { sql: `${column} = ?`, args: [structure.id] } : { sql: `${column} IS NULL`, args: [] };
}

export function checkStructureName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new HttpError(400, 'give the structure a name');
  if (name.length > 40) throw new HttpError(400, 'the structure name is too long');
  return name;
}
