// Capture & seal records: build a real package, verify it with the system's sha256sum, then tamper with it.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
require('../extension/zip.js');
const E = require('../extension/evidence.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

(async () => {
  check('sha256 of a known string', await E.sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  check('sha256 of a Blob and bytes agree', await E.sha256Hex(new Blob(['abc'])) === await E.sha256Hex(new TextEncoder().encode('abc')));

  const capturedAt = new Date('2026-11-08T20:15:30.123Z');
  const info = { toolVersion: '1.6.0', case: 'Acme v. Doe | exhibit 4', capturedBy: 'J. Examiner', capturedAt, url: 'https://example.com/post?id=7', title: 'A "quoted" | title', userAgent: 'TestBrowser/1.0', highlights: 2, examinerNote: 'Captured from public page.' };
  const files = [
    { name: 'capture.mhtml', data: new Blob(['MIME-Version: 1.0\r\n\r\nfake mhtml body ' + 'x'.repeat(5000)]), description: 'Page capture (MHTML)' },
    { name: 'page-text.txt', data: 'Readable text of the page.\nSecond line.\n', description: 'Readable text' },
    { name: 'notes.md', data: '# notes\n', description: 'Notes' }
  ];
  const described = await E.describeFiles(files);
  const manifest = E.buildManifest(info, described);
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  const manifestHash = await E.sha256Hex(manifestJson);
  const all = [...described, { name: 'manifest.json', size: manifestJson.length, sha256: manifestHash, description: 'Manifest' }];
  const sums = E.sumsFile(all);
  const custody = E.custodyMarkdown(info, described, manifestHash);

  check('manifest records time (UTC, ms), case, url, hashes', manifest.captured_at_utc === '2026-11-08T20:15:30.123Z' && manifest.case.startsWith('Acme') && manifest.files.length === 3 && manifest.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
  check('manifest states its limits', manifest.limitations.length === 3 && /clock/.test(manifest.limitations[0]) && /not digitally signed/.test(manifest.limitations[1]));
  check('custody record: table cells with | " are escaped, hashes shown, how-to-verify present', custody.includes('Acme v. Doe \\| exhibit 4') && custody.includes(described[0].sha256) && custody.includes('sha256sum -c SHA256SUMS') && custody.includes('**SHA-256 of manifest.json: `' + manifestHash + '`**'));
  check('custody record includes the examiner note and the limits', custody.includes('Captured from public page.') && custody.includes('not digitally signed'));
  check('utcStamp is filename-safe', E.utcStamp(capturedAt) === '20261108T201530Z');

  // ---- build the zip the way the Save page does, unzip, verify with the real tool
  const zip = await KRZip.createZip([...files.map(f => ({ name: f.name, data: f.data })), { name: 'manifest.json', data: manifestJson }, { name: 'SHA256SUMS', data: sums }, { name: 'chain-of-custody.md', data: custody }]);
  const dir = fs.mkdtempSync(path.join(process.env.SCRATCH || os.tmpdir(), 'seal-'));
  const zipPath = path.join(dir, 'pkg.zip');
  fs.writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
  const out = path.join(dir, 'unzipped');
  fs.mkdirSync(out);
  execFileSync('unzip', ['-q', zipPath, '-d', out]);
  const ok = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: out, encoding: 'utf8' });
  check('`sha256sum -c SHA256SUMS` passes on the unzipped package', ok.status === 0 && /capture\.mhtml: OK/.test(ok.stdout) && /manifest\.json: OK/.test(ok.stdout), ok.stdout.replace(/\n/g, ' | '));
  check('manifest.json in the package hashes to the value shown in the custody record', await E.sha256Hex(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) === manifestHash);

  // tamper with one byte of the capture
  const cap = path.join(out, 'capture.mhtml');
  const b = fs.readFileSync(cap); b[40] = b[40] ^ 1; fs.writeFileSync(cap, b);
  const bad = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: out, encoding: 'utf8' });
  check('a single changed byte makes verification FAIL', bad.status !== 0 && /capture\.mhtml: FAILED/.test(bad.stdout), bad.stdout.replace(/\n/g, ' | '));

  // log
  const row = E.logRow(info, manifestHash, 'pkg.zip');
  const csv = E.logCsv([row, { ...row, title: 'has "quotes", and commas' }]);
  check('capture log CSV is well-formed (quotes doubled)', csv.split('\n')[0] === 'captured_at_utc,case,url,title,manifest_sha256,package' && csv.includes('"has ""quotes"", and commas"') && csv.trim().split('\n').length === 3);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
