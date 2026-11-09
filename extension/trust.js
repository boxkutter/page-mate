// Trust add-ons for sealed captures:
//
//   1. A signature over manifest.json with a key that stays in this browser (ECDSA P-256, SHA-256).
//      It shows the package came from the holder of that key. It is not tied to a person unless you tie it to one.
//   2. An RFC 3161 trusted timestamp from a Time-Stamp Authority you choose. Only the SHA-256 of manifest.json is sent.
//      It shows the manifest existed at that time according to the authority, which fixes the "computer clock" limit.
//
// Both can be checked with plain `openssl`; the commands are written into every package that uses them.
// DER is hand-rolled (it is a small, fixed subset) so there is nothing to vendor.
(function (root) {
  const subtle = (root.crypto || require('crypto').webcrypto).subtle;
  const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
  const unhex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
  const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return (root.btoa || (x => Buffer.from(x, 'latin1').toString('base64')))(s); };

  // ---------- DER ----------

  function derLen(n) {
    if (n < 0x80) return Uint8Array.of(n);
    const bytes = [];
    for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 255);
    return Uint8Array.of(0x80 | bytes.length, ...bytes);
  }
  const tlv = (tag, ...content) => { const body = concat(...content); return concat(Uint8Array.of(tag), derLen(body.length), body); };
  const derUint = u8 => { let i = 0; while (i < u8.length - 1 && u8[i] === 0) i++; const t = u8.subarray(i); return tlv(0x02, t[0] & 0x80 ? concat(Uint8Array.of(0), t) : t); };

  // Reads one TLV at `off`. -> { tag, start (of content), end, next }
  function readTlv(u8, off) {
    if (off + 2 > u8.length) throw new Error('DER: truncated');
    const tag = u8[off];
    let len = u8[off + 1], p = off + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n === 0 || n > 4 || p + n > u8.length) throw new Error('DER: bad length');
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + u8[p++];
    }
    if (p + len > u8.length) throw new Error('DER: truncated');
    return { tag, start: p, end: p + len, next: p + len };
  }
  function children(u8, node) {
    const out = [];
    for (let p = node.start; p < node.end;) { const c = readTlv(u8, p); out.push(c); p = c.next; }
    return out;
  }
  const oidBytes = u8 => { const parts = []; let v = 0; for (let i = 0; i < u8.length; i++) { v = v * 128 + (u8[i] & 0x7f); if (!(u8[i] & 0x80)) { if (!parts.length) parts.push(Math.min(2, Math.floor(v / 40)), v - 40 * Math.min(2, Math.floor(v / 40))); else parts.push(v); v = 0; } } return parts.join('.'); };

  // ---------- RFC 3161 ----------

  const SHA256_ALG = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00);

  // digestHex: 64 hex chars (SHA-256). nonce: Uint8Array (up to 8 bytes) or null. -> DER bytes of a TimeStampReq
  function timestampQuery(digestHex, { nonce = null, certReq = true } = {}) {
    if (!/^[0-9a-f]{64}$/i.test(digestHex)) throw new Error('Expected a SHA-256 digest (64 hex characters).');
    return tlv(0x30,
      Uint8Array.of(0x02, 0x01, 0x01),
      tlv(0x30, SHA256_ALG, tlv(0x04, unhex(digestHex.toLowerCase()))),
      nonce ? derUint(nonce) : new Uint8Array(0),
      certReq ? Uint8Array.of(0x01, 0x01, 0xff) : new Uint8Array(0));
  }

  const STATUS = { 0: 'granted', 1: 'granted with modifications', 2: 'rejected', 3: 'waiting', 4: 'revocation warning', 5: 'revocation notification' };

  // Reads a TimeStampResp. Checks it is well formed and says what we asked for; it does NOT verify the TSA's signature or
  // certificate chain (use `openssl ts -verify`, shown in chain-of-custody.md).
  // -> { granted, status, statusText, genTime, policy, serial, digestMatches, nonceMatches, hasCerts }
  function parseTimestampResponse(bytes, { digestHex = null, nonce = null } = {}) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const top = readTlv(u8, 0);
    if (top.tag !== 0x30) throw new Error('Not a time-stamp response.');
    const [statusInfo, token] = children(u8, top);
    if (!statusInfo || statusInfo.tag !== 0x30) throw new Error('Time-stamp response has no status.');
    const sc = children(u8, statusInfo);
    const statusNode = sc[0];
    let status = 0;
    for (let i = statusNode.start; i < statusNode.end; i++) status = status * 256 + u8[i];
    const messages = sc.slice(1).filter(c => c.tag === 0x30).flatMap(c => children(u8, c)).map(c => new TextDecoder().decode(u8.subarray(c.start, c.end)));
    const res = { granted: status === 0 || status === 1, status, statusText: STATUS[status] || ('status ' + status), message: messages.join('; '), genTime: '', policy: '', serial: '', digestMatches: null, nonceMatches: null, hasCerts: false };
    if (!res.granted) return res;
    if (!token || token.tag !== 0x30) throw new Error('Granted response has no time-stamp token.');
    // ContentInfo { OID, [0] { SignedData { version, digestAlgs, encapContentInfo { OID, [0] { OCTET STRING { TSTInfo }}}, [0] certs?, signerInfos }}}
    const ci = children(u8, token);
    const sd = children(u8, children(u8, ci[1])[0]);
    const encap = sd[2];
    const ec = children(u8, encap);
    const tstOctets = children(u8, ec[1])[0];
    const tstInfo = readTlv(u8, tstOctets.start);
    const t = children(u8, tstInfo);
    // version, policy, messageImprint, serial, genTime, ...
    res.policy = oidBytes(u8.subarray(t[1].start, t[1].end));
    const imprint = children(u8, t[2]);
    const hashed = u8.subarray(imprint[1].start, imprint[1].end);
    const algOid = oidBytes(u8.subarray(children(u8, imprint[0])[0].start, children(u8, imprint[0])[0].end));
    res.digestMatches = digestHex ? (algOid === '2.16.840.1.101.3.4.2.1' && hex(hashed) === digestHex.toLowerCase()) : null;
    res.serial = hex(u8.subarray(t[3].start, t[3].end));
    const gt = new TextDecoder().decode(u8.subarray(t[4].start, t[4].end));
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(gt);
    res.genTime = m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + (m[7] ? m[7].slice(0, 4) : '') + 'Z' : gt;
    const nonceNode = t.slice(5).find(c => c.tag === 0x02);
    if (nonce) {
      const want = hex(nonce).replace(/^(00)+/, '');
      const got = nonceNode ? hex(u8.subarray(nonceNode.start, nonceNode.end)).replace(/^(00)+/, '') : '';
      res.nonceMatches = want === got;
    }
    res.hasCerts = sd.some(c => c.tag === 0xa0);
    return res;
  }

  function randomNonce() { const n = new Uint8Array(8); (root.crypto || require('crypto').webcrypto).getRandomValues(n); n[0] &= 0x7f; if (!n[0]) n[0] = 1; return n; }

  const TSA_PRESETS = [
    { id: 'freetsa', name: 'FreeTSA.org (free)', url: 'https://freetsa.org/tsr' },
    { id: 'digicert', name: 'DigiCert', url: 'https://timestamp.digicert.com' },
    { id: 'sectigo', name: 'Sectigo', url: 'https://timestamp.sectigo.com' }
  ];

  // Sends only the digest. -> { tsq, tsr, info }  (throws with a readable message)
  async function requestTimestamp(tsaUrl, digestHex, { fetchImpl = root.fetch && root.fetch.bind(root), timeoutMs = 20000 } = {}) {
    if (!/^https?:\/\//i.test(tsaUrl || '')) throw new Error('The timestamp server address must start with http:// or https://');
    const nonce = randomNonce();
    const tsq = timestampQuery(digestHex, { nonce, certReq: true });
    let res;
    try {
      res = await fetchImpl(tsaUrl, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply' }, body: tsq, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new Error('Couldn’t reach the timestamp server (' + (e && e.message || e) + ').');
    }
    if (!res.ok) throw new Error('The timestamp server answered ' + res.status + '.');
    const tsr = new Uint8Array(await res.arrayBuffer());
    let info;
    try { info = parseTimestampResponse(tsr, { digestHex, nonce }); } catch (e) { throw new Error('The timestamp server’s answer wasn’t a valid time-stamp response (' + e.message + ').'); }
    if (!info.granted) throw new Error('The timestamp server refused: ' + info.statusText + (info.message ? ' (' + info.message + ')' : '') + '.');
    if (info.digestMatches === false) throw new Error('The timestamp server stamped a different fingerprint than the one we sent.');
    if (info.nonceMatches === false) throw new Error('The timestamp server’s answer didn’t echo our request number (possible replay).');
    return { tsq, tsr, info };
  }

  // ---------- signing ----------

  async function sha256Hex(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return hex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
  }

  async function generateSigningKey() {
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return { created: new Date().toISOString(), privateJwk: await subtle.exportKey('jwk', pair.privateKey), publicJwk: await subtle.exportKey('jwk', pair.publicKey) };
  }

  async function publicKeyInfo(publicJwk) {
    const key = await subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const spki = new Uint8Array(await subtle.exportKey('spki', key));
    const lines = b64(spki).match(/.{1,64}/g).join('\n');
    return { pem: '-----BEGIN PUBLIC KEY-----\n' + lines + '\n-----END PUBLIC KEY-----\n', fingerprint: await sha256Hex(spki) };
  }

  // WebCrypto gives r||s; openssl wants DER.
  function p1363ToDer(sig) {
    const h = sig.length / 2;
    return tlv(0x30, derUint(sig.subarray(0, h)), derUint(sig.subarray(h)));
  }

  // -> DER signature (verify with: openssl dgst -sha256 -verify signer-public-key.pem -signature manifest.sig manifest.json)
  async function sign(privateJwk, data) {
    const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return p1363ToDer(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes)));
  }

  const api = { timestampQuery, parseTimestampResponse, requestTimestamp, TSA_PRESETS, randomNonce, generateSigningKey, publicKeyInfo, sign, sha256Hex, p1363ToDer, readTlv, hex, unhex };
  root.KOTrust = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
