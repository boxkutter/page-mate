// Trust add-ons: signature + RFC 3161 timestamp, checked against real openssl, including a local time-stamp authority.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { execFileSync, spawnSync } = require('child_process');
const T = require('../extension/trust.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const dir = fs.mkdtempSync(path.join(process.env.SCRATCH || os.tmpdir(), 'trust-'));
const sh = (args, opts = {}) => spawnSync('openssl', args, { cwd: dir, encoding: 'utf8', ...opts });

(async () => {
  const manifest = JSON.stringify({ format: 'kokoro-evidence', url: 'https://example.com/' }, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifest);
  const digest = await T.sha256Hex(manifest);

  // ---- query bytes equal openssl's own
  const ref = sh(['ts', '-query', '-digest', digest, '-sha256', '-cert', '-no_nonce', '-out', 'ref.tsq']);
  const ours = T.timestampQuery(digest, { nonce: null, certReq: true });
  check('timestamp query is byte-identical to `openssl ts -query` (no nonce)', ref.status === 0 && Buffer.compare(Buffer.from(ours), fs.readFileSync(path.join(dir, 'ref.tsq'))) === 0, ref.stderr);
  const withNonce = T.timestampQuery(digest, { nonce: T.randomNonce() });
  fs.writeFileSync(path.join(dir, 'ours.tsq'), withNonce);
  const shown = sh(['ts', '-query', '-in', 'ours.tsq', '-text']);
  check('openssl parses our query with nonce, digest and cert request', shown.status === 0 && /Message data:/.test(shown.stdout) && /Certificate required: yes/.test(shown.stdout) && /Nonce: 0x/.test(shown.stdout), shown.stdout + shown.stderr);
  check('bad digest rejected', (() => { try { T.timestampQuery('abc'); return false; } catch (_) { return true; } })());

  // ---- local time-stamp authority built with openssl
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s);
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Test CA', '-days', '2']);
  w('tsa.ext', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\n');
  sh(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'tsa.key', '-out', 'tsa.csr', '-subj', '/CN=Test TSA']);
  sh(['x509', '-req', '-in', 'tsa.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'tsa.crt', '-days', '2', '-extfile', 'tsa.ext']);
  w('tsaserial', '01\n');
  w('tsa.cnf', `[ tsa ]\ndefault_tsa = t\n[ t ]\ndir = ${dir}\nserial = ${dir}/tsaserial\ncrypto_device = builtin\nsigner_cert = ${dir}/tsa.crt\ncerts = ${dir}/tsa.crt\nsigner_key = ${dir}/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\nother_policies = 1.2.3.4.5.6\ndigests = sha256\naccuracy = secs:1\nordering = yes\ntsa_name = yes\ness_cert_id_chain = no\ness_cert_id_alg = sha256\n`);
  let mode = 'good';
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (mode === 'down') { res.statusCode = 503; res.end('no'); return; }
      if (mode === 'junk') { res.end('hello'); return; }
      fs.writeFileSync(path.join(dir, 'req.tsq'), mode === 'other' ? fs.readFileSync(path.join(dir, 'ref.tsq')) : body);
      const r = sh(['ts', '-reply', '-config', 'tsa.cnf', '-queryfile', 'req.tsq', '-out', 'resp.tsr']);
      if (r.status !== 0) { res.statusCode = 500; res.end(r.stderr); return; }
      res.setHeader('Content-Type', 'application/timestamp-reply');
      res.end(fs.readFileSync(path.join(dir, 'resp.tsr')));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/tsr';

  const before = Date.now();
  const got = await T.requestTimestamp(url, digest);
  check('request to a TSA: granted, imprint matches, nonce echoed', got.info.granted && got.info.digestMatches === true && got.info.nonceMatches === true && got.info.hasCerts, JSON.stringify(got.info));
  check('genTime is the authority’s time (UTC) and sensible', Math.abs(Date.parse(got.info.genTime) - before) < 60_000 && /Z$/.test(got.info.genTime), got.info.genTime);
  fs.writeFileSync(path.join(dir, 'timestamp.tsr'), got.tsr);
  fs.writeFileSync(path.join(dir, 'timestamp.tsq'), got.tsq);
  const v = sh(['ts', '-verify', '-data', 'manifest.json', '-in', 'timestamp.tsr', '-CAfile', 'ca.crt']);
  check('`openssl ts -verify` accepts the timestamp for manifest.json', v.status === 0 && /Verification: OK/.test(v.stdout + v.stderr), v.stdout + v.stderr);
  const vq = sh(['ts', '-verify', '-queryfile', 'timestamp.tsq', '-in', 'timestamp.tsr', '-CAfile', 'ca.crt']);
  check('…and with the saved request file', vq.status === 0, vq.stderr);
  fs.writeFileSync(path.join(dir, 'tampered.json'), manifest.replace('example', 'examplf'));
  const vt = sh(['ts', '-verify', '-data', 'tampered.json', '-in', 'timestamp.tsr', '-CAfile', 'ca.crt']);
  check('a changed manifest fails verification', vt.status !== 0);

  mode = 'other';
  await T.requestTimestamp(url, digest).then(() => check('stamp of a different digest is refused', false), e => check('stamp of a different digest is refused', /different fingerprint|request number/.test(e.message), e.message));
  mode = 'down';
  await T.requestTimestamp(url, digest).then(() => check('server error is reported', false), e => check('server error is reported plainly', /503/.test(e.message), e.message));
  mode = 'junk';
  await T.requestTimestamp(url, digest).then(() => check('junk answer is reported', false), e => check('junk answer is reported plainly', /valid time-stamp response/.test(e.message), e.message));
  await T.requestTimestamp('ftp://x', digest).then(() => check('bad address rejected', false), e => check('bad address rejected', /http/.test(e.message)));
  server.close();
  check('truncated or hostile responses do not throw anything but Error', [Buffer.alloc(0), Buffer.from([0x30]), Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]), Buffer.from([0x30, 0x03, 0x30, 0x01, 0x00])].every(b => { try { T.parseTimestampResponse(b); return false; } catch (e) { return e instanceof Error; } }));

  // ---- signing
  const key = await T.generateSigningKey();
  const info = await T.publicKeyInfo(key.publicJwk);
  fs.writeFileSync(path.join(dir, 'signer-public-key.pem'), info.pem);
  const sig = await T.sign(key.privateJwk, manifest);
  fs.writeFileSync(path.join(dir, 'manifest.sig'), sig);
  const vs = sh(['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'manifest.json']);
  check('`openssl dgst -verify` accepts the signature', vs.status === 0 && /Verified OK/.test(vs.stdout), vs.stdout + vs.stderr);
  const vs2 = sh(['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'tampered.json']);
  check('…and rejects a changed manifest', vs2.status !== 0);
  const other = await T.generateSigningKey();
  fs.writeFileSync(path.join(dir, 'other.pem'), (await T.publicKeyInfo(other.publicJwk)).pem);
  check('…and a different key', sh(['dgst', '-sha256', '-verify', 'other.pem', '-signature', 'manifest.sig', 'manifest.json']).status !== 0);
  const fp = sh(['pkey', '-pubin', '-in', 'signer-public-key.pem', '-outform', 'DER']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-in', path.join(dir, 'signer-public-key.pem'), '-outform', 'DER']);
  check('key fingerprint = SHA-256 of the public key DER', info.fingerprint === require('crypto').createHash('sha256').update(der).digest('hex') && fp.status === 0);
  // signatures with short r or s (leading zero bytes) must still be valid DER; run many
  let bad = 0;
  for (let i = 0; i < 60; i++) { const s = await T.sign(key.privateJwk, 'm' + i); fs.writeFileSync(path.join(dir, 's.bin'), s); fs.writeFileSync(path.join(dir, 'm.bin'), 'm' + i); if (sh(['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 's.bin', 'm.bin']).status !== 0) bad++; }
  check('60 signatures all verify (DER integer encoding is right)', bad === 0, String(bad));

  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll trust tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
