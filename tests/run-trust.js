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

  const tsa = await require('./tsa-fixture.js')(dir);
  const url = tsa.url;
  let mode;
  const setMode = m => tsa.setMode(m);
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

  setMode('other');
  await T.requestTimestamp(url, digest).then(() => check('stamp of a different digest is refused', false), e => check('stamp of a different digest is refused', /different fingerprint|request number/.test(e.message), e.message));
  setMode('down');
  await T.requestTimestamp(url, digest).then(() => check('server error is reported', false), e => check('server error is reported plainly', /503/.test(e.message), e.message));
  setMode('junk');
  await T.requestTimestamp(url, digest).then(() => check('junk answer is reported', false), e => check('junk answer is reported plainly', /valid time-stamp response/.test(e.message), e.message));
  await T.requestTimestamp('ftp://x', digest).then(() => check('bad address rejected', false), e => check('bad address rejected', /http/.test(e.message)));
  tsa.close();
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
