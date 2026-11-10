#!/usr/bin/env node
// Builds PageMate for each browser family from the one source tree in extension/.
//
//   node scripts/build.js            -> everything
//   node scripts/build.js firefox    -> just one target (chromium | firefox)
//
// Output (dist/ is git-ignored):
//   dist/chromium/                       unpacked, for Chrome, Edge, Brave, Opera, Vivaldi...
//   dist/firefox/                        unpacked, for Firefox (about:debugging -> Load Temporary Add-on)
//   dist/pagemate-<version>-chromium.zip
//   dist/pagemate-<version>-firefox.zip
//
// No dependencies, and no zip / python / bash needed, so it runs the same on Linux, macOS and Windows.
// The zips are reproducible: the same source gives byte-identical files (fixed timestamps, sorted entries).
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

// Permanent once published on addons.mozilla.org: changing it later makes Firefox treat the add-on as a different one.
const GECKO_ID = 'pagemate@boxkutter.github.io';
const GECKO_MIN = '128.0';   // MV3 optional host permissions, storage.session and scripting all exist from here

// ---------- manifests ----------

function backgroundScripts() {
  // Chromium loads the helper files with importScripts() at the top of background.js. Firefox runs the background as an
  // ordinary page, so the same files are listed in the manifest instead, in the same order, ahead of background.js.
  const src = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
  const m = /^(?:if \([^)]*\) )?importScripts\(([^)]*)\);/m.exec(src);
  if (!m) throw new Error('background.js must have a top-level importScripts(...) line');
  const files = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  for (const f of files) if (!fs.existsSync(path.join(SRC, f))) throw new Error('background.js imports a missing file: ' + f);
  return [...files, 'background.js'];
}

function chromiumManifest(m) {
  return m;   // the source manifest is the Chromium one
}

function firefoxManifest(m) {
  const f = JSON.parse(JSON.stringify(m));
  f.background = { scripts: backgroundScripts() };              // an event page, not a service worker
  delete f.minimum_chrome_version;
  f.permissions = f.permissions.filter(p => p !== 'offscreen'); // Firefox's background page has a DOM: audio plays there
  f.optional_permissions = (f.optional_permissions || []).filter(p => p !== 'pageCapture'); // no MHTML capture in Firefox
  f.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN,
      // Nothing is sent to the developer; page text goes only to the server the user types in.
      data_collection_permissions: { required: ['none'] }
    }
  };
  return f;
}

const TARGETS = {
  chromium: { manifest: chromiumManifest, note: 'Chrome, Edge, Brave, Opera, Vivaldi and other Chromium browsers' },
  firefox: { manifest: firefoxManifest, note: 'Firefox' }
};

// ---------- files ----------

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

// ---------- zip (store/deflate, fixed timestamps) ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {   // entries: [{ name, data: Buffer }]
  const DOS_TIME = 0, DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;   // 2024-01-01 00:00
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt16LE(DOS_TIME, 12); cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(0o100644 << 16 >>> 0, 38); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

// ---------- build ----------

function build(target) {
  const spec = TARGETS[target];
  const manifest = spec.manifest(JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')));
  const out = path.join(DIST, target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const entries = [];
  for (const rel of listFiles(SRC)) {
    const data = rel === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : fs.readFileSync(path.join(SRC, rel));
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), data);
    entries.push({ name: rel, data });
  }
  const file = path.join(DIST, `pagemate-${manifest.version}-${target}.zip`);
  fs.writeFileSync(file, zip(entries));
  console.log(`Built ${path.relative(ROOT, file)}  (${spec.note})`);
  return { dir: out, file, manifest };
}

function main() {
  const want = process.argv.slice(2);
  for (const w of want) if (!TARGETS[w]) { console.error('Unknown target "' + w + '". Choose from: ' + Object.keys(TARGETS).join(', ')); process.exit(2); }
  // Syntax-check every script first (a broken file should stop the build, not ship).
  for (const f of listFiles(SRC).filter(f => f.endsWith('.js') && !f.startsWith('vendor/'))) {
    try { execFileSync(process.execPath, ['--check', path.join(SRC, f)], { stdio: 'pipe' }); }
    catch (e) { console.error('Syntax error in extension/' + f + '\n' + String(e.stderr || e.message)); process.exit(1); }
  }
  fs.mkdirSync(DIST, { recursive: true });
  for (const t of want.length ? want : Object.keys(TARGETS)) build(t);
}

if (require.main === module) main();
module.exports = { build, firefoxManifest, backgroundScripts, zip, TARGETS };
