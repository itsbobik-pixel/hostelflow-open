// Sign in with Google (OpenID Connect, the code flow with PKCE): a redirect
// to Google and back, no Google script in the page (the CSP stays strict).
// Google vouches for the e-mail; an account with that e-mail is signed in,
// someone new picks a property name first (src/api.js, googleFinish).
// Needs GOOGLE_CLIENT_ID (wrangler.toml) and the secret GOOGLE_CLIENT_SECRET;
// without them the button stays hidden. The redirect address of each site
// (…/api/auth/google/callback) must be listed in the Google Cloud client.

import { HttpError } from './http.js';
import { b64url, readCookie } from './auth.js';

const STATE_COOKIE = 'hf_google';
const NEW_COOKIE = 'hf_google_new';
const STATE_MS = 10 * 60 * 1000;
const NEW_MS = 30 * 60 * 1000;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const enc = new TextEncoder();

// The old *.workers.dev address isn't registered with Google: no button there.
export const googleEnabled = (env, request) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) && !new URL(request.url).hostname.endsWith('.workers.dev');

const callbackUrl = request => `${new URL(request.url).origin}/api/auth/google/callback`;

function cookie(name, value, maxAgeS) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAgeS}`;
}

// Short signed notes kept in a cookie (the state of one trip to Google, and
// who Google said someone new is): nothing to store, nothing to clean up.
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode(`hostelflow-google:${env.GOOGLE_CLIENT_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function seal(env, data) {
  const body = b64url(enc.encode(JSON.stringify(data)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
  return `${body}.${sig}`;
}
function unb64url(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function unseal(env, value) {
  const [body, sig] = String(value || '').split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(sig), enc.encode(body)))) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

// GET /api/auth/google/start → off to Google's account chooser.
export async function googleStart(env, request) {
  if (!googleEnabled(env, request)) throw new HttpError(404, 'not found');
  const state = random();
  const nonce = random();
  const verifier = random();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(request),
    response_type: 'code',
    scope: 'openid email profile',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account', // a shared reception computer: always ask which account
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': cookie(STATE_COOKIE, await seal(env, { state, nonce, verifier, exp: Date.now() + STATE_MS }), STATE_MS / 1000),
      'Cache-Control': 'no-store',
    },
  });
}

// Back from Google: who it is, as { email, name }. Throws HttpError with a
// short code the app shows as a sentence (#google-error=<code>).
export async function googleIdentity(env, request) {
  if (!googleEnabled(env, request)) throw new HttpError(404, 'off');
  const params = new URL(request.url).searchParams;
  if (params.get('error')) throw new HttpError(400, 'cancelled'); // "Cancel" on Google's page
  const saved = await unseal(env, readCookie(request, STATE_COOKIE));
  if (!saved || !params.get('state') || params.get('state') !== saved.state || !params.get('code')) throw new HttpError(400, 'expired');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.get('code'),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(request),
      grant_type: 'authorization_code',
      code_verifier: saved.verifier,
    }),
  });
  if (!res.ok) throw new HttpError(502, 'google');
  const { id_token: idToken } = await res.json();
  // Straight from Google over HTTPS, so the token's signature needn't be
  // checked (OpenID Connect Core 3.1.3.7); its claims still are.
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(unb64url(String(idToken).split('.')[1])));
  } catch {
    throw new HttpError(502, 'google');
  }
  const okIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!okIssuer || claims.aud !== env.GOOGLE_CLIENT_ID || claims.nonce !== saved.nonce || !(claims.exp * 1000 > Date.now())) {
    throw new HttpError(502, 'google');
  }
  if (!claims.email || claims.email_verified !== true) throw new HttpError(400, 'unverified');
  return {
    email: String(claims.email).trim().toLowerCase(),
    name: String(claims.name || claims.given_name || '').trim().slice(0, 100),
  };
}

export const clearStateCookie = () => cookie(STATE_COOKIE, '', 0);

// Someone new: who Google said they are, until they pick a property name.
export async function newcomerCookie(env, who) {
  return cookie(NEW_COOKIE, await seal(env, { ...who, exp: Date.now() + NEW_MS }), NEW_MS / 1000);
}
export const readNewcomer = (env, request) => unseal(env, readCookie(request, NEW_COOKIE));
export const clearNewcomerCookie = () => cookie(NEW_COOKIE, '', 0);
