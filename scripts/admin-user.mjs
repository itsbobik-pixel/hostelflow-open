// Creates (or resets the password of) an admin-centre account — admin.hostelflow.it.
// The password is typed here, on your own computer, and never shown or sent
// anywhere: only its PBKDF2 hash goes into the database (same hashing as the app).
//
//   node scripts/admin-user.mjs            → live database
//   node scripts/admin-user.mjs --staging  → staging (admin-staging.hostelflow.it)
//   node scripts/admin-user.mjs --local    → local development
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { hashPassword } from '../src/auth.js';

const target = process.argv.includes('--staging') ? ['hostelflow-staging', '--remote', '--env', 'staging']
  : process.argv.includes('--local') ? ['hostelflow', '--local'] : ['hostelflow', '--remote'];

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else rl.output.write(s.replace(/[^\r\n]/g, '•')); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

const sql = v => `'${String(v).replace(/'/g, "''")}'`;

const email = (await ask('E-mail for the admin centre: ')).toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('That is not an e-mail address.'); process.exit(1); }
const name = await ask('Your name (optional): ');
const password = await ask('Password (at least 12 characters): ', true);
if (password.length < 12) { console.error('Use at least 12 characters.'); process.exit(1); }
if (await ask('Password again: ', true) !== password) { console.error('The two passwords differ.'); process.exit(1); }

const hash = await hashPassword(password);
const now = Date.now();
const id = crypto.randomUUID();
const statement = `INSERT INTO admin_users (id, email, name, password_hash, role, created_at) VALUES (${sql(id)}, ${sql(email)}, ${sql(name || null)}, ${sql(hash)}, 'admin', ${now})
  ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, name = COALESCE(excluded.name, admin_users.name);
DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admin_users WHERE email = ${sql(email)});`;

const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', ...target.slice(0, 1), ...target.slice(1), '--command', statement],
  { stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
if (r.status !== 0) { console.error('Saving failed (is wrangler signed in? node node_modules/wrangler/bin/wrangler.js login).'); process.exit(1); }
const where = target[0] === 'hostelflow-staging' ? 'https://admin-staging.hostelflow.it' : target.includes('--local') ? 'http://localhost:8787/admin' : 'https://admin.hostelflow.it';
console.log(`Done: ${email} can sign in at ${where}`);
