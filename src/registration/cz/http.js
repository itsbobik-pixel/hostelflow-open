// A small HTTP/1.1 client over one TLS connection, for Ubyport's NTLM sign-in:
// NTLM signs in the connection, so the challenge and the request that answers
// it must travel over the same socket — fetch() can't promise that.
// connect is cloudflare:sockets' connect (tests pass their own).

import { negotiateMessage, authenticateMessage } from './ntlm.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const TIMEOUT_MS = 30000;

async function openSocket(host, connect) {
  if (!connect) ({ connect } = await import('cloudflare:sockets'));
  const socket = connect({ hostname: host, port: 443 }, { secureTransport: 'on', allowHalfOpen: false });
  return socket;
}

// Reads one HTTP response (Content-Length or chunked) from the stream.
async function readResponse(reader, state) {
  const find = (buf, seq) => {
    outer: for (let i = 0; i <= buf.length - seq.length; i++) {
      for (let j = 0; j < seq.length; j++) if (buf[i + j] !== seq[j]) continue outer;
      return i;
    }
    return -1;
  };
  const more = async () => {
    const { value, done } = await reader.read();
    if (done) throw new Error('the police server closed the connection');
    const b = new Uint8Array(state.buf.length + value.length);
    b.set(state.buf);
    b.set(value, state.buf.length);
    state.buf = b;
  };
  let end;
  while ((end = find(state.buf, [13, 10, 13, 10])) < 0) await more();
  const head = dec.decode(state.buf.slice(0, end)).split('\r\n');
  state.buf = state.buf.slice(end + 4);
  const status = Number((head[0].match(/^HTTP\/1\.[01] (\d{3})/) || [])[1]);
  const headers = {};
  for (const line of head.slice(1)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    headers[k] = headers[k] ? `${headers[k]}, ${line.slice(i + 1).trim()}` : line.slice(i + 1).trim();
  }
  let body;
  if (/chunked/i.test(headers['transfer-encoding'] || '')) {
    const parts = [];
    for (;;) {
      let lineEnd;
      while ((lineEnd = find(state.buf, [13, 10])) < 0) await more();
      const size = parseInt(dec.decode(state.buf.slice(0, lineEnd)), 16);
      state.buf = state.buf.slice(lineEnd + 2);
      if (!size) {
        while (find(state.buf, [13, 10]) < 0) await more();
        state.buf = state.buf.slice(find(state.buf, [13, 10]) + 2);
        break;
      }
      while (state.buf.length < size + 2) await more();
      parts.push(state.buf.slice(0, size));
      state.buf = state.buf.slice(size + 2);
    }
    body = dec.decode(parts.reduce((a, p) => { const b = new Uint8Array(a.length + p.length); b.set(a); b.set(p, a.length); return b; }, new Uint8Array(0)));
  } else {
    const len = Number(headers['content-length'] || 0);
    while (state.buf.length < len) await more();
    body = dec.decode(state.buf.slice(0, len));
    state.buf = state.buf.slice(len);
  }
  return { status, headers, body };
}

// POST a SOAP request to url, signing in with NTLM on the way.
// Returns { status, body }. A 401 after the sign-in means a wrong user or password.
export async function ntlmPost(url, { user, password, domain }, { body, soapAction }, { connect, now } = {}) {
  const u = new URL(url);
  const socket = await openSocket(u.hostname, connect);
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const state = { buf: new Uint8Array(0) };
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the police server did not answer in time')), TIMEOUT_MS); });
  const send = (auth, payload) => writer.write(enc.encode(
    `POST ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: keep-alive\r\n`
    + `Content-Type: text/xml; charset=utf-8\r\nSOAPAction: "${soapAction}"\r\n`
    + `Authorization: NTLM ${auth}\r\nContent-Length: ${enc.encode(payload).length}\r\n\r\n${payload}`,
  ));
  try {
    return await Promise.race([timeout, (async () => {
      await send(negotiateMessage(), '');
      const challenge = await readResponse(reader, state);
      const header = challenge.headers['www-authenticate'] || '';
      if (challenge.status !== 401 || !/NTLM\s+\S/.test(header)) {
        throw new Error(`the police server did not offer the sign-in (HTTP ${challenge.status})`);
      }
      await send(authenticateMessage({ user, password, domain }, header, now ? { now } : {}), body);
      const res = await readResponse(reader, state);
      if (res.status === 401) throw new Error('Ubyport refused the user name or password');
      return { status: res.status, body: res.body };
    })()]);
  } finally {
    clearTimeout(timer);
    try { await writer.close(); } catch { /* already closed */ }
    try { socket.close(); } catch { /* already closed */ }
  }
}
