// The scan bench (/ocr-compare): sample documents (EU PRADO specimens and the
// like — never real guests) read by the main model and the cheaper one side by
// side; the readings are kept, and the person marks which was right. Only for
// the e-mails in env.OCR_BENCH_USERS. The photo itself is never stored.
import { HttpError, json, readJson } from './http.js';
import { requireUser } from './auth.js';
import { provenAddress } from './admin.js';
import { readDocument, OCR_MODEL, OCR_PRICE } from './ocr.js';

export const BENCH_FIELDS = ['surname', 'given', 'sex', 'dob', 'nationality', 'docType', 'docNumber', 'country', 'expiry', 'birthPlace'];
const SHADOW_PRICE = { input: 0.1, output: 0.5 }; // Claude Haiku 5.5, $ per million tokens
const VERDICTS = ['main', 'shadow', 'both', 'neither'];

export const benchAllowed = (env, email) =>
  String(env.OCR_BENCH_USERS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(String(email || '').toLowerCase());

async function benchUser(env, request) {
  const user = await requireUser(env.DB, request);
  if (!benchAllowed(env, user.email) || !(await provenAddress(env, user.id))) throw new HttpError(403, 'the scan bench is not open for this account');
  return user;
}

function parseImage(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'the photo must be a JPEG, PNG or WebP');
  if (m[2].length > 7_000_000) throw new HttpError(413, 'photo is too large');
  return { mediaType: m[1], data: m[2] };
}

const cost = (usage, price) => ((usage.input_tokens || 0) * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
async function timed(read) {
  const started = Date.now();
  try {
    const r = await read();
    const usage = r.usage || {};
    return { fields: r.fields || {}, notes: r.notes || '', ms: Date.now() - started, usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 } };
  } catch (err) {
    return { error: String(err.message || err).slice(0, 300), ms: Date.now() - started, fields: {}, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

const view = row => {
  const main = JSON.parse(row.main), shadow = JSON.parse(row.shadow);
  main.cost = cost(main.usage, OCR_PRICE);
  shadow.cost = cost(shadow.usage, SHADOW_PRICE);
  return { id: row.id, label: row.label, createdAt: row.created_at, models: JSON.parse(row.models), main, shadow, verdict: JSON.parse(row.verdict || '{}') };
};

// Body: { image: dataURL, label? }
export async function benchScan(env, request) {
  const user = await benchUser(env, request);
  const body = await readJson(request);
  const image = parseImage(body.image);
  const shadowModel = env.OCR_SHADOW_MODEL || 'claude-haiku-5-5';
  const read = env.benchRead || ((model) => readDocument(env, image, undefined, model)); // env.benchRead: test stand-in
  const [main, shadow] = await Promise.all([timed(() => read(OCR_MODEL)), timed(() => read(shadowModel))]);
  // Fields both read the same are marked right for both from the start.
  const norm = v => String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const verdict = {};
  for (const k of BENCH_FIELDS) if (!main.error && !shadow.error && norm(main.fields[k]) === norm(shadow.fields[k])) verdict[k] = 'same';
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO ocr_bench (id, user_id, created_at, label, models, main, shadow, verdict) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, Date.now(), String(body.label || '').slice(0, 120), JSON.stringify({ main: OCR_MODEL, shadow: shadowModel }),
      JSON.stringify(main), JSON.stringify(shadow), JSON.stringify(verdict)).run();
  return json(view(await env.DB.prepare('SELECT * FROM ocr_bench WHERE id = ?').bind(id).first()), 201);
}

export async function benchList(env, request) {
  const user = await benchUser(env, request);
  const { results } = await env.DB.prepare('SELECT * FROM ocr_bench WHERE user_id = ? ORDER BY created_at DESC LIMIT 300').bind(user.id).all();
  return json({ fields: BENCH_FIELDS, rows: results.map(view) });
}

// Body: { field, verdict: 'main' | 'shadow' | 'both' | 'neither' | null }
export async function benchJudge(env, request, id) {
  const user = await benchUser(env, request);
  const body = await readJson(request);
  if (!BENCH_FIELDS.includes(body.field)) throw new HttpError(400, 'unknown field');
  if (body.verdict !== null && !VERDICTS.includes(body.verdict)) throw new HttpError(400, 'unknown verdict');
  const row = await env.DB.prepare('SELECT * FROM ocr_bench WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) throw new HttpError(404, 'not found');
  const verdict = JSON.parse(row.verdict || '{}');
  if (body.verdict === null) delete verdict[body.field]; else verdict[body.field] = body.verdict;
  await env.DB.prepare('UPDATE ocr_bench SET verdict = ? WHERE id = ?').bind(JSON.stringify(verdict), id).run();
  return json({ verdict });
}

export async function benchDelete(env, request, id) {
  const user = await benchUser(env, request);
  await env.DB.prepare('DELETE FROM ocr_bench WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return json({ ok: true });
}
