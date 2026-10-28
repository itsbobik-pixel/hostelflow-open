// NTLM sign-in for Ubyport (the Czech police web service sits behind IIS with
// Windows NTLM). Web Crypto has neither MD4 nor MD5, so both are here, with
// HMAC-MD5 and the NTLMv2 messages (MS-NLMP). NTLM signs in a connection, not
// a request: the three steps must run over one TCP connection (see http.js).

const enc = new TextEncoder();
const utf16 = s => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[i * 2] = c & 0xff; b[i * 2 + 1] = c >> 8; } return b; };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const rotl = (x, n) => (x << n) | (x >>> (32 - n));

// Padding shared by MD4 and MD5: 0x80, zeros, the bit length (little endian).
function words(bytes) {
  const n = ((bytes.length + 8) >> 6) + 1;
  const w = new Uint32Array(n * 16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  w[n * 16 - 2] = (bytes.length * 8) >>> 0;
  w[n * 16 - 1] = Math.floor(bytes.length / 0x20000000);
  return w;
}
function out(state) {
  const b = new Uint8Array(16);
  state.forEach((v, i) => { for (let j = 0; j < 4; j++) b[i * 4 + j] = (v >>> (j * 8)) & 0xff; });
  return b;
}

export function md4(bytes) {
  const x = words(bytes);
  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const F = (x, y, z) => (x & y) | (~x & z);
  const G = (x, y, z) => (x & y) | (x & z) | (y & z);
  const H = (x, y, z) => x ^ y ^ z;
  for (let i = 0; i < x.length; i += 16) {
    const [aa, bb, cc, dd] = [a, b, c, d];
    const r1 = (a, b, c, d, k, s) => rotl((a + F(b, c, d) + x[i + k]) | 0, s);
    const r2 = (a, b, c, d, k, s) => rotl((a + G(b, c, d) + x[i + k] + 0x5a827999) | 0, s);
    const r3 = (a, b, c, d, k, s) => rotl((a + H(b, c, d) + x[i + k] + 0x6ed9eba1) | 0, s);
    for (const k of [0, 4, 8, 12]) { a = r1(a, b, c, d, k, 3); d = r1(d, a, b, c, k + 1, 7); c = r1(c, d, a, b, k + 2, 11); b = r1(b, c, d, a, k + 3, 19); }
    for (const k of [0, 1, 2, 3]) { a = r2(a, b, c, d, k, 3); d = r2(d, a, b, c, k + 4, 5); c = r2(c, d, a, b, k + 8, 9); b = r2(b, c, d, a, k + 12, 13); }
    for (const k of [0, 2, 1, 3]) { a = r3(a, b, c, d, k, 3); d = r3(d, a, b, c, k + 8, 9); c = r3(c, d, a, b, k + 4, 11); b = r3(b, c, d, a, k + 12, 15); }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  return out([a, b, c, d]);
}

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
export function md5(bytes) {
  const x = words(bytes);
  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let i = 0; i < x.length; i += 16) {
    const [aa, bb, cc, dd] = [a, b, c, d];
    for (let j = 0; j < 64; j++) {
      const r = j >> 4;
      const f = r === 0 ? (b & c) | (~b & d) : r === 1 ? (d & b) | (~d & c) : r === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = r === 0 ? j : r === 1 ? (5 * j + 1) % 16 : r === 2 ? (3 * j + 5) % 16 : (7 * j) % 16;
      const t = d; d = c; c = b;
      b = (b + rotl((a + f + MD5_K[j] + x[i + g]) | 0, MD5_S[r * 4 + (j % 4)])) | 0;
      a = t;
    }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  return out([a, b, c, d]);
}

export function hmacMd5(key, data) {
  if (key.length > 64) key = md5(key);
  const k = new Uint8Array(64); k.set(key);
  const ipad = k.map(v => v ^ 0x36);
  const opad = k.map(v => v ^ 0x5c);
  return md5(concat(opad, md5(concat(ipad, data))));
}

const NEGOTIATE_FLAGS = 0x00000001 /* unicode */ | 0x00000200 /* NTLM */ | 0x00008000 /* always sign */
  | 0x00080000 /* extended session security */ | 0x00000004 /* request target */ | 0x20000000 /* 128 */ | 0xa0000000 /* 56 + 128 */;
const SIG = enc.encode('NTLMSSP\0');
const u16 = n => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const u32 = n => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// Step 1: "I'd like to sign in."
export function negotiateMessage() {
  return b64(concat(SIG, u32(1), u32(NEGOTIATE_FLAGS), new Uint8Array(16)));
}

// Step 2 comes from the server: its challenge and the target info it wants echoed.
export function parseChallenge(header) {
  const m = /NTLM\s+([A-Za-z0-9+/=]+)/.exec(header || '');
  if (!m) throw new Error('the server did not answer the NTLM sign-in');
  const b = unb64(m[1]);
  const dv = new DataView(b.buffer);
  if (dv.getUint32(8, true) !== 2) throw new Error('unexpected NTLM message from the server');
  const flags = dv.getUint32(20, true);
  const challenge = b.slice(24, 32);
  const tLen = dv.getUint16(40, true);
  const tOff = dv.getUint32(44, true);
  return { flags, challenge, targetInfo: b.slice(tOff, tOff + tLen) };
}

// Windows time: 100 ns since 1601, little endian.
function fileTime(ms) {
  const t = BigInt(ms) * 10000n + 116444736000000000n;
  return Uint8Array.from({ length: 8 }, (_, i) => Number((t >> BigInt(i * 8)) & 0xffn));
}

export function ntowfv2(user, domain, password) {
  return hmacMd5(md4(utf16(password)), utf16(user.toUpperCase() + domain));
}

// The NTLMv2 answer to the server's challenge (MS-NLMP 3.3.2).
export function ntlmv2Response({ user, domain, password, challenge, targetInfo, clientChallenge, time }) {
  const key = ntowfv2(user, domain, password);
  const blob = concat(new Uint8Array([1, 1, 0, 0]), new Uint8Array(4), time, clientChallenge, new Uint8Array(4), targetInfo, new Uint8Array(4));
  const proof = hmacMd5(key, concat(challenge, blob));
  return { nt: concat(proof, blob), lm: concat(hmacMd5(key, concat(challenge, clientChallenge)), clientChallenge), proof };
}

// Step 3: the signed answer. A user written DOMAIN\name or name@domain keeps its domain.
export function authenticateMessage(credentials, challengeHeader, { now = Date.now(), clientChallenge = crypto.getRandomValues(new Uint8Array(8)) } = {}) {
  const { challenge, targetInfo, flags } = parseChallenge(challengeHeader);
  let user = credentials.user;
  let domain = credentials.domain || '';
  if (user.includes('\\')) [domain, user] = user.split('\\');
  else if (user.includes('@') && !domain) [user, domain] = user.split('@');
  const { nt, lm } = ntlmv2Response({ user, domain, password: credentials.password, challenge, targetInfo, clientChallenge, time: fileTime(now) });
  const fields = [lm, nt, utf16(domain), utf16(user), utf16('HOSTELFLOW'), new Uint8Array(0)];
  let offset = 64;
  const headers = fields.map(f => { const h = concat(u16(f.length), u16(f.length), u32(offset)); offset += f.length; return h; });
  const header = concat(SIG, u32(3), ...headers, u32(flags & NEGOTIATE_FLAGS | 0x00000001));
  return b64(concat(header, ...fields));
}
