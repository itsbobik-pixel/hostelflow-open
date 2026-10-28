import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md4, md5, hmacMd5, ntowfv2, ntlmv2Response, negotiateMessage, parseChallenge } from '../src/registration/cz/ntlm.js';
import { guestToRecord, zapisEnvelope, parseZapis, parseCiselnik, policeCountry } from '../src/registration/cz/ubyport.js';
import { REGISTRATION_MODULES } from '../src/registration/index.js';

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const bytes = s => new TextEncoder().encode(s);
const fromHex = h => Uint8Array.from(h.match(/../g), x => parseInt(x, 16));

test('NTLM: MD4, MD5 and HMAC-MD5 match their RFC test vectors; NTLMv2 matches MS-NLMP 4.2.4', () => {
  assert.equal(hex(md4(bytes('abc'))), 'a448017aaf21d8525fc10ae87aa6729d');
  assert.equal(hex(md4(bytes(''))), '31d6cfe0d16ae931b73c59d7e0c089c0');
  assert.equal(hex(md5(bytes('abc'))), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(hex(md5(bytes('1234567890'.repeat(8)))), '57edf4a22be3c955ac49da2e2107b67a');
  assert.equal(hex(hmacMd5(new Uint8Array(16).fill(0x0b), bytes('Hi There'))), '9294727a3638bb1c13f48ef8158bfc9d');
  assert.equal(hex(ntowfv2('User', 'Domain', 'Password')), '0c868a403bfd7a93a3001ef22ef02e3f');
  const r = ntlmv2Response({
    user: 'User', domain: 'Domain', password: 'Password', challenge: fromHex('0123456789abcdef'),
    targetInfo: fromHex('02000c0044006f006d00610069006e0001000c0053006500720076006500720000000000'),
    clientChallenge: fromHex('aaaaaaaaaaaaaaaa'), time: new Uint8Array(8),
  });
  assert.equal(hex(r.proof), '68cd0ab851e51c96aabc927bebef6a1c');
  assert.equal(hex(r.lm), '86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa');
});

const guest = {
  id: 'g1',
  fields: { surname: "O'Neil-Smith", given: 'Anna Marie', dob: '05.03.1990', nationality: 'DEU', docNumber: 'c01x 00t47', arrival: '12.10.2026', nights: '2', visa: '', homeAddress: 'Berlin, Germany' },
};

test('Ubyport: a guest becomes a record of the data contract; mistakes are listed', () => {
  const r = guestToRecord(guest);
  assert.deepEqual(r, {
    cDate: '05031990', cDocN: 'C01X00T47', cFirstN: 'Anna Marie', cFrom: '2026-10-12T14:00:00', nationality: 'DEU',
    cNote: '', cPurp: 99, cResi: 'Berlin, Germany', cSurN: "O'Neil-Smith", cUntil: '2026-10-14T10:00:00', cVisN: '',
  });
  assert.throws(() => guestToRecord({ fields: { surname: 'Smith2', dob: '1990-03-05', docNumber: 'ab', arrival: '12.10.2026' } }), err => {
    assert.deepEqual(err.errors, ['surname: only letters, apostrophe and hyphen', 'given names are missing', 'date of birth must be DD.MM.YYYY', 'nationality is missing', 'document number must have 4 to 30 characters']);
    return true;
  });
});

test('Ubyport: the envelope keeps the members in order and escapes text; the answer is read', () => {
  const record = { ...guestToRecord(guest), cNati: 'D' };
  const x = zapisEnvelope({ idub: '100227887600', mark: 'CZGFW', name: 'U Dubu & Co', contact: 'a@b.cz', district: 'Praha', town: 'Praha', street: 'Lennonova', houseNumber: '123', postcode: '14200' }, [record]);
  assert.match(x, /<d4p1:cDate>05031990<\/d4p1:cDate><d4p1:cDocN>C01X00T47<\/d4p1:cDocN><d4p1:cFirstN>Anna Marie<\/d4p1:cFirstN><d4p1:cFrom>/);
  assert.match(x, /<d4p1:cNati>D<\/d4p1:cNati><d4p1:cNote i:nil="true"\/><d4p1:cPlac i:nil="true"\/><d4p1:cPurp>99<\/d4p1:cPurp>/);
  assert.match(x, /<d4p1:cSurN>O&apos;Neil-Smith<\/d4p1:cSurN>/);
  assert.match(x, /<\/d4p1:Ubytovani><d4p1:VracetPDF>false<\/d4p1:VracetPDF><d4p1:uCont>a@b.cz<\/d4p1:uCont><d4p1:uHomN>123<\/d4p1:uHomN><d4p1:uIdub>100227887600<\/d4p1:uIdub>/);
  assert.match(x, /<d4p1:uName>U Dubu &amp; Co<\/d4p1:uName><d4p1:uOb>Praha<\/d4p1:uOb><d4p1:uObCa i:nil="true"\/>/);
  assert.match(x, /<AutentificationCode>X<\/AutentificationCode><Seznam /);

  // The example answer from the technical description (5.1.1).
  const answer = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header /><s:Body><ZapisUbytovaneResponse xmlns="http://UBY.pcr.cz/WS_UBY"><ZapisUbytovaneResult xmlns:a="http://schemas.datacontract.org/2004/07/WS_UBY" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><a:ChybyHlavicky>5;6;7;</a:ChybyHlavicky><a:ChybyZaznamu xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><b:string>;112;106;</b:string></a:ChybyZaznamu></ZapisUbytovaneResult></ZapisUbytovaneResponse></s:Body></s:Envelope>';
  assert.deepEqual(parseZapis(answer), { header: ['5', '6', '7'], perGuest: [['112', '106']], stamp: '' });
  assert.throws(() => parseZapis('<s:Fault><faultcode>s:x</faultcode><faultstring xml:lang="cs-CZ">Server was unable to process request.</faultstring></s:Fault>'), /Ubyport: Server was unable/);
  const staty = parseCiselnik('<a:CiselnikType><a:Id>1</a:Id><a:Kod2>DE</a:Kod2><a:Kod3>D</a:Kod3><a:TextCZ>Německo</a:TextCZ><a:TextENG>GERMANY</a:TextENG></a:CiselnikType><a:CiselnikType><a:Kod2>AF</a:Kod2><a:Kod3>AFG</a:Kod3><a:TextCZ>Afghánistán</a:TextCZ><a:TextENG>AFGHANISTAN</a:TextENG></a:CiselnikType>');
  assert.equal(policeCountry('AFG', staty), 'AFG');
  assert.equal(policeCountry('DEU', staty, 'Germany'), 'D');
  assert.equal(policeCountry('XYZ', staty), '');
});

// A pretend Ubyport over a pretend TLS socket: it asks for NTLM, checks that
// the answer is a type 3 message on the same connection, then answers SOAP.
function fakeUbyport(answer) {
  const seen = [];
  const connect = () => {
    let push;
    const readable = new ReadableStream({ start(c) { push = c; } });
    let buf = '';
    const writable = new WritableStream({
      write(chunk) {
        buf += new TextDecoder().decode(chunk);
        for (;;) {
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) return;
          const head = buf.slice(0, end);
          const len = Number((/Content-Length: (\d+)/i.exec(head) || [])[1] || 0);
          if (buf.length < end + 4 + len) return;
          const body = buf.slice(end + 4, end + 4 + len);
          buf = buf.slice(end + 4 + len);
          const auth = (/Authorization: NTLM (\S+)/.exec(head) || [])[1];
          const type = auth ? Uint8Array.from(atob(auth), c => c.charCodeAt(0))[8] : 0;
          seen.push({ type, action: (/SOAPAction: "([^"]+)"/.exec(head) || [])[1], body });
          const send = s => push.enqueue(new TextEncoder().encode(s));
          if (type === 1) {
            // A type 2 message: challenge 0123456789abcdef, a little target info.
            const ti = fromHex('02000c0044006f006d00610069006e0000000000');
            const m = new Uint8Array(48 + ti.length);
            m.set(bytes('NTLMSSP\0'));
            const dv = new DataView(m.buffer);
            dv.setUint32(8, 2, true); dv.setUint32(20, 0x00088205, true);
            m.set(fromHex('0123456789abcdef'), 24);
            dv.setUint16(40, ti.length, true); dv.setUint16(42, ti.length, true); dv.setUint32(44, 48, true);
            m.set(ti, 48);
            send(`HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: NTLM ${btoa(String.fromCharCode(...m))}\r\nContent-Length: 0\r\n\r\n`);
          } else if (type === 3) {
            const out = answer(seen.at(-1));
            send(`HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\nTransfer-Encoding: chunked\r\n\r\n${new TextEncoder().encode(out).length.toString(16)}\r\n${out}\r\n0\r\n\r\n`);
          } else {
            send('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: NTLM\r\nContent-Length: 0\r\n\r\n');
          }
        }
      },
    });
    return { readable, writable, close() {} };
  };
  return { connect, seen };
}

test('Ubyport module: a test run signs in and checks; sending reports foreigners, not Czech guests, and explains refusals', async () => {
  const cz = REGISTRATION_MODULES['cz-ubyport'];
  const creds = { user: 'uby\\host', password: 'secret', idub: '125', mark: 'HF', name: 'Hostel', contact: 'a@b.cz', district: 'Praha', town: 'Praha', houseNumber: '1', postcode: '11000' };
  const staty = '<a:CiselnikType><a:Kod2>DE</a:Kod2><a:Kod3>D</a:Kod3><a:TextCZ>Německo</a:TextCZ><a:TextENG>GERMANY</a:TextENG></a:CiselnikType><a:CiselnikType><a:Kod2>GB</a:Kod2><a:Kod3>GBR</a:Kod3><a:TextCZ>Británie</a:TextCZ><a:TextENG>UNITED KINGDOM</a:TextENG></a:CiselnikType>';
  const czech = { id: 'g2', fields: { ...guest.fields, nationality: 'CZE' } };
  const brit = { id: 'g3', fields: { ...guest.fields, nationality: 'GBR', docNumber: '123456789' } };
  const server = fakeUbyport(req => {
    if (/DejMiCiselnik/.test(req.action)) return /Chyby/.test(req.body) ? '<a:CiselnikType><a:Kod2>106</a:Kod2><a:TextCZ>Chybné číslo dokladu</a:TextCZ></a:CiselnikType>' : staty;
    if (/TestDostupnosti/.test(req.action)) return '<TestDostupnostiResult>true</TestDostupnostiResult>';
    return '<a:ChybyHlavicky></a:ChybyHlavicky><a:ChybyZaznamu><b:string></b:string><b:string>;106;</b:string></a:ChybyZaznamu>';
  });
  const opts = { connect: server.connect, url: 'https://ubyport.example/ws_uby/ws_uby.svc' };

  await cz.checkCredentials(creds, opts);
  assert.deepEqual(server.seen.map(s => s.type), [1, 3], 'NTLM negotiate, then the signed request on the same connection');

  const t = await cz.submit(creds, [guest, czech], 'test', opts);
  assert.equal(t.ok, true);
  assert.ok(!server.seen.some(s => /ZapisUbytovane/.test(s.action)), 'a test sends nothing');

  const r = await cz.submit(creds, [guest, czech, brit], 'send', opts);
  const zapis = server.seen.find(s => /ZapisUbytovane/.test(s.action) && s.type === 3);
  assert.match(zapis.body, /<d4p1:cNati>D<\/d4p1:cNati>/);
  assert.match(zapis.body, /<d4p1:cNati>GBR<\/d4p1:cNati>/);
  assert.equal((zapis.body.match(/<d4p1:Ubytovany>/g) || []).length, 2, 'the Czech guest is not reported');
  assert.deepEqual(r.results, [
    { id: 'g1', ok: true },
    { id: 'g2', ok: true },
    { id: 'g3', ok: false, errors: ['106: Chybné číslo dokladu'] },
  ]);
  assert.equal(negotiateMessage().length > 10, true);
  assert.throws(() => parseChallenge('Negotiate'), /did not answer the NTLM sign-in/);
});
