// Minimal Cloudflare D1 stand-in on top of node:sqlite, with the real
// migrations applied — so tests run the same SQL as production.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  async first(col) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    const plain = { ...row };
    return col ? plain[col] : plain;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params).map(r => ({ ...r })) };
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    // D1 runs a batch as one transaction.
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
