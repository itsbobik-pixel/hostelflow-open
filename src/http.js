export class HttpError extends Error {
  // code: a fixed word the page can act on (e.g. 'unconfirmed'), besides the message.
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// State-changing requests must send JSON. A cross-site HTML form can't set
// this content type without a CORS preflight (which we never allow), so this
// doubles as CSRF protection together with the SameSite session cookie.
// A JSON text column: its value, or null when empty or unreadable.
export function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'expected application/json');
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

export function requireString(body, key, { min = 1, max = 200, label = key } = {}) {
  const v = typeof body[key] === 'string' ? body[key].trim() : '';
  if (v.length < min) throw new HttpError(400, min > 1 ? `${label} must have at least ${min} characters` : `${label} is required`);
  if (v.length > max) throw new HttpError(400, `${label} is too long`);
  return v;
}

export function requireEmail(body, key = 'email') {
  const v = requireString(body, key, { max: 254, label: 'e-mail' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'e-mail is not valid');
  return v;
}

// Passwords are not trimmed: spaces are allowed and significant.
export function requirePassword(body, key = 'password') {
  const v = typeof body[key] === 'string' ? body[key] : '';
  if (v.length < 8) throw new HttpError(400, 'password must have at least 8 characters');
  if (v.length > 200) throw new HttpError(400, 'password is too long');
  return v;
}
