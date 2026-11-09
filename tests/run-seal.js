// Sealed packages with signature + trusted timestamp: build, unzip, and check every claim with sha256sum and openssl.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
require('../extension/zip.js');
const E = require('../extension/evidence.js');
const T = require('../extension/trust.js');
global.KNEvidence = E; global.KOTrust = T;
const S = require('../extension/seal.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const dir = fs.mkdtempSync(path.join(process.env.SCRATCH || os.tmpdir(), 'seal-'));
const ssl = (args, cwd) => spawnSync('openssl', args, { cwd, encoding: 'utf8' });

async function unpack(res, name) {
  const zip = await S.zipEntries('Pkg', res.entries, new Date('2026-11-09T10:00:00Z'));
  const zp = path.join(dir, name + '.zip'), out = path.join(dir, name);
  fs.writeFileSync(zp, Buffer.from(await zip.arrayBuffer()));
  fs.mkdirSync(out);
  execFileSync('unzip', ['-q', zp, '-d', out]);
  return path.join(out, 'Pkg');
}

(async () => {
  const tsa = await require('./tsa-fixture.js')(fs.mkdtempSync(path.join(dir, 'tsa-')));
  const files = [
    { name: 'screenshot.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]), description: 'Screenshot' },
    { name: 'headers.json', data: '{"server":"x"}\n', description: 'Response headers' }
  ];
  const info = { toolVersion: '1.7.0', case: 'Case 7', capturedBy: 'Examiner', capturedAt: new Date('2026-11-09T10:00:00Z'), url: 'https://example.com/', title: 'Example', userAgent: 'UA', highlights: 0, examinerNote: '',
    extra: { archives: [{ service: 'Wayback Machine', url: 'https://web.archive.org/web/2026/https://example.com/', at: '2026-11-09T10:00:01Z' }] } };

  // plain: exactly the old behaviour
  const plain = await S.build({ files, info });
  check('no signing/timestamp: no extra files, original three limits', !plain.entries.some(e => /sig|tsr|tsq|pem/.test(e.name)) && JSON.parse(plain.entries.find(e => e.name === 'manifest.json').data).limitations.length === 3 && !('integrity_requested' in JSON.parse(plain.entries.find(e => e.name === 'manifest.json').data)));
  const pdir = await unpack(plain, 'plain');
  check('plain package passes sha256sum -c', spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: pdir }).status === 0);

  // full: signed + timestamped
  const key = await T.generateSigningKey();
  const statuses = [];
  const full = await S.build({ files, info, signing: key, tsaUrl: tsa.url, onStatus: t => statuses.push(t) });
  check('full package: signature and timestamp files present, no warnings', ['manifest.sig', 'signer-public-key.pem', 'timestamp.tsr', 'timestamp.tsq'].every(n => full.entries.some(e => e.name === n)) && full.warnings.length === 0 && statuses.length === 2, JSON.stringify(full.warnings));
  const fdir = await unpack(full, 'full');
  check('sha256sum -c passes (includes signature and timestamp files)', spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: fdir }).status === 0);
  const v1 = ssl(['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'manifest.json'], fdir);
  check('the documented openssl command verifies the signature', /Verified OK/.test(v1.stdout), v1.stdout + v1.stderr);
  const v2 = ssl(['ts', '-verify', '-data', 'manifest.json', '-in', 'timestamp.tsr', '-CAfile', tsa.caFile], fdir);
  check('the documented openssl command verifies the timestamp', /Verification: OK/.test(v2.stdout + v2.stderr), v2.stdout + v2.stderr);
  const cust = fs.readFileSync(path.join(fdir, 'chain-of-custody.md'), 'utf8');
  const m = JSON.parse(fs.readFileSync(path.join(fdir, 'manifest.json'), 'utf8'));
  check('custody record: fingerprint, authority time, both commands, archive copies', cust.includes(full.plan.keyFingerprint) && cust.includes(full.plan.timestamp.genTime) && cust.includes('openssl ts -verify') && cust.includes('openssl dgst -sha256 -verify') && cust.includes('web.archive.org'));
  check('manifest (written before signing) keeps the conservative limits and records what was requested; the custody record carries the real outcome',
    m.limitations.length === 3 && /not digitally signed/.test(m.limitations[1]) && m.integrity_requested.signature === true && m.integrity_requested.timestamp === tsa.url && m.extra.archives.length === 1 &&
    cust.includes('timestamp.tsr') && /does not say who/.test(cust) && !/not digitally signed/.test(cust.split('## Limits of this record')[1]));
  fs.writeFileSync(path.join(fdir, 'manifest.json'), fs.readFileSync(path.join(fdir, 'manifest.json'), 'utf8').replace('Case 7', 'Case 8'));
  check('editing the manifest breaks sha256sum, the signature and the timestamp',
    spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: fdir }).status !== 0 &&
    ssl(['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'manifest.json'], fdir).status !== 0 &&
    ssl(['ts', '-verify', '-data', 'manifest.json', '-in', 'timestamp.tsr', '-CAfile', tsa.caFile], fdir).status !== 0);

  // timestamp authority down: sealed anyway, said plainly
  tsa.setMode('down');
  const down = await S.build({ files, info, signing: key, tsaUrl: tsa.url });
  const dcust = down.entries.find(e => e.name === 'chain-of-custody.md').data;
  check('authority unreachable: package still built, signed, and the record says the timestamp failed', down.warnings.length === 1 && !down.entries.some(e => e.name === 'timestamp.tsr') && down.entries.some(e => e.name === 'manifest.sig') && /requested but could not be obtained/.test(dcust) && /503/.test(dcust) && down.plan.requested.timestamp === tsa.url);
  tsa.close();

  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll seal tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
