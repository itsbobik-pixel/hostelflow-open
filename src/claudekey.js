// Settings → Check-in scan: a property can paste its own Anthropic API
// key (platform.claude.com → API keys). Document scans and Flowy then run on
// its own Claude credit, which it tops up itself at Anthropic — HostelFlow pays
// nothing for that property and doesn't limit its scans.
//
// A property without its own key uses the server's ANTHROPIC_API_KEY, if the
// server has one; a server without one (self-hosted) needs every property's own.

import Anthropic from '@anthropic-ai/sdk';
import { HttpError, json, readJson } from './http.js';
import { requireUser, requireRole } from './auth.js';
import { encryptCredentials, decryptCredentials } from './secrets.js';

// Sealed to the property and to Claude, like the Cloudbeds key.
const aad = propertyId => `claude:${propertyId}`;

// What the owner reads in Settings when Claude turned the key down.
export const KEY_REFUSED = 'Claude did not accept this API key';
export const CREDIT_EMPTY = 'Your Claude credit has run out. Top it up at platform.claude.com';

// Does Anthropic take this key? Listing the models costs nothing.
async function checkKey(env, apiKey) {
  if (env.checkClaudeKey) return env.checkClaudeKey(apiKey); // test stand-in
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(502, 'Claude could not be reached — try again in a moment');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(400, KEY_REFUSED);
  if (!res.ok) throw new HttpError(502, 'Claude could not be reached — try again in a moment');
}

async function ownerContext(env, request, propertyId) {
  const user = await requireUser(env.DB, request);
  await requireRole(env.DB, user.id, propertyId, ['owner']);
}

async function status(env, propertyId) {
  const p = await env.DB.prepare('SELECT claude_credentials, claude_last_error FROM properties WHERE id = ?').bind(propertyId).first();
  let hint = null;
  if (p.claude_credentials) {
    try { hint = (await decryptCredentials(env, aad(propertyId), p.claude_credentials)).apiKey.slice(-4); } catch { /* shown without */ }
  }
  return {
    connected: !!p.claude_credentials,
    hint, // the key's last 4 characters, to tell which one it is
    lastError: p.claude_last_error,
    // Without its own key the property scans on HostelFlow's (when there is one).
    serverKey: !!env.ANTHROPIC_API_KEY,
  };
}

// What scans cost on a Claude account, in micro-dollars (Settings → Check-in
// scan): this month's scans and their cost, and a scan's average over the last
// 30 days — this property's own when it scanned enough, else everyone's (only
// totals, nothing about anyone's guests).
const ENOUGH = 5;
async function scanCost(db, propertyId, now = Date.now()) {
  const month = new Date(now).toISOString().slice(0, 7);
  const since = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  const m = await db.prepare('SELECT scans, cost_micro FROM usage_monthly WHERE property_id = ? AND month = ?').bind(propertyId, month).first();
  const own = await db.prepare('SELECT SUM(scans) AS s, SUM(cost_micro) AS c FROM usage_daily WHERE property_id = ? AND day >= ?').bind(propertyId, since).first();
  const all = own.s >= ENOUGH ? own
    : await db.prepare('SELECT SUM(scans) AS s, SUM(cost_micro) AS c FROM usage_daily WHERE day >= ?').bind(since).first();
  return {
    monthScans: (m && m.scans) || 0,
    monthMicro: (m && m.cost_micro) || 0,
    perScanMicro: all.s ? Math.round(all.c / all.s) : null,
  };
}

export async function claudeStatus(env, request, propertyId) {
  await ownerContext(env, request, propertyId);
  return json({ ...(await status(env, propertyId)), cost: await scanCost(env.DB, propertyId) });
}

// Body: { apiKey }. A key Anthropic turns down is never saved.
export async function saveClaudeKey(env, request, propertyId) {
  await ownerContext(env, request, propertyId);
  const body = await readJson(request);
  const apiKey = String(body.apiKey || '').trim();
  if (!/^sk-ant-[\w-]{20,300}$/.test(apiKey)) throw new HttpError(400, 'Paste the API key from platform.claude.com (it starts with sk-ant-)');
  await checkKey(env, apiKey);
  const sealed = await encryptCredentials(env, aad(propertyId), { apiKey });
  await env.DB.prepare('UPDATE properties SET claude_credentials = ?, claude_last_error = NULL WHERE id = ?').bind(sealed, propertyId).run();
  return json(await status(env, propertyId));
}

// Disconnect: the key is deleted.
export async function deleteClaudeKey(env, request, propertyId) {
  await ownerContext(env, request, propertyId);
  await env.DB.prepare('UPDATE properties SET claude_credentials = NULL, claude_last_error = NULL WHERE id = ?').bind(propertyId).run();
  return json(await status(env, propertyId));
}

// The env to call Claude with for this property: with its own key when it has
// one (own: true). The bindings stay reachable through the prototype. On its
// own credit the property doesn't pay for the extra comparison readings
// (OCR_SHADOW_*): the second model then only fills in what the first left empty.
export async function claudeEnv(env, property) {
  if (!property.claude_credentials) return { env, own: false };
  const { apiKey } = await decryptCredentials(env, aad(property.id), property.claude_credentials);
  const own = Object.create(env);
  Object.assign(own, { ANTHROPIC_API_KEY: apiKey, OCR_SHADOW_RATE: '0', OCR_SHADOW_MODEL: '' });
  return { env: own, own: true };
}

// A problem with the key itself (not with one photo): every call fails until
// the owner fixes it. Returns the text for the owner, or null.
export function keyProblem(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return KEY_REFUSED;
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) return CREDIT_EMPTY;
  if (err instanceof Anthropic.BadRequestError && /api key|workspace/i.test(err.message)) return KEY_REFUSED;
  return null;
}

// Remembered for Settings → Check-in scan; cleared by the next call that works.
export async function noteKeyProblem(env, propertyId, problem) {
  await env.DB.prepare('UPDATE properties SET claude_last_error = ? WHERE id = ? AND claude_last_error IS NOT ?')
    .bind(problem, propertyId, problem).run();
}
