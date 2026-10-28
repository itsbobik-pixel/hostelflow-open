// Per-property police credentials, encrypted at rest with AES-256-GCM.
//
// Key: the CREDENTIALS_KEY Worker secret, 32 random bytes in base64.
// Stored value: "v1.<iv b64>.<ciphertext b64>". The property id is bound in
// as additional data, so a ciphertext copied onto another property's row
// won't decrypt there.

import { HttpError } from './http.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// CREDENTIALS_KEY as bytes; a missing or wrong-sized key stops everything here.
function rawKey(env) {
  let raw;
  try { raw = env.CREDENTIALS_KEY ? unb64(env.CREDENTIALS_KEY) : null; } catch { raw = null; }
  if (!raw || raw.length !== 32) throw new HttpError(500, 'credential storage is not configured');
  return raw;
}

// Imported keys, kept per secret (the same Worker serves many requests;
// sending 100 guests would otherwise import the key 100 times).
const keys = new Map();
function cachedKey(env, kind, make) {
  const id = `${kind}:${env.CREDENTIALS_KEY}`;
  if (!keys.has(id)) keys.set(id, make(rawKey(env)).catch(err => { keys.delete(id); throw err; }));
  return keys.get(id);
}

function importKey(env) {
  return cachedKey(env, 'aes', raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
}

// HMAC-SHA256 of text with CREDENTIALS_KEY (the fingerprints below).
async function hmac(env, text) {
  const key = await cachedKey(env, 'hmac', raw => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  return crypto.subtle.sign('HMAC', key, enc.encode(text));
}

// Keyed fingerprint of a document number (HMAC-SHA256 with CREDENTIALS_KEY),
// so registered guests can be matched without storing the number. A plain
// hash wouldn't do: document numbers are short enough to brute-force.
export async function docFingerprint(env, propertyId, docNumber) {
  const doc = String(docNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!doc) return null;
  return b64(await hmac(env, `doc:${propertyId}:${doc}`));
}

// A keyed fingerprint of a police login (system + user name), the same at every
// property: two properties with the same one would register guests twice.
export async function loginFingerprint(env, system, user) {
  const name = String(user || '').trim().toLowerCase();
  if (!name) return null;
  return b64(await hmac(env, `login:${system}:${name}`));
}

// A keyed fingerprint of one field as read on a document (the shadow-model
// comparison): equal readings give equal prints, and nothing can be read back.
export async function fieldPrint(env, propertyId, field, value) {
  const norm = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  return b64(await hmac(env, `field:${propertyId}:${field}:${norm}`)).slice(0, 22);
}

export async function encryptCredentials(env, propertyId, credentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(propertyId) },
    await importKey(env), enc.encode(JSON.stringify(credentials)),
  );
  return `v1.${b64(iv)}.${b64(ct)}`;
}

// Returns {} when nothing is stored yet.
export async function decryptCredentials(env, propertyId, stored) {
  if (!stored) return {};
  const [version, iv, ct] = stored.split('.');
  if (version !== 'v1' || !iv || !ct) throw new Error('unknown credential format');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(propertyId) },
    await importKey(env), unb64(ct),
  );
  return JSON.parse(dec.decode(plain));
}
