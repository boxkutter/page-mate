// Unit tests for the media metadata reader: EXIF/GPS/XMP in JPEG, PNG, WebP, and MP4 atoms. Fixtures are built here.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const M = require('../extension/meta-core.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const tmp = fs.mkdtempSync(path.join(process.env.SCRATCH || os.tmpdir(), 'meta-'));

const { tiff, withExif: withExifRaw, SAMPLE } = require('./exif-fixture.js');
const { ifd0, exif, gps } = SAMPLE;

const base = path.join(tmp, 'base.jpg');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x48', '-frames:v', '1', base]);
const jpg = fs.readFileSync(base);
const withExif = (t, xmp) => withExifRaw(jpg, t, xmp);

for (const le of [true, false]) {
  const r = M.describe(withExif(tiff(le, ifd0, exif, gps)));
  const get = n => (r.fields.find(f => f.name === n) || {}).value;
  check((le ? 'little' : 'big') + '-endian JPEG: camera, software, time', r.format === 'JPEG' && get('Make') === 'ACME' && get('Model') === 'Phone 9 Pro' && get('Software').startsWith('Adobe Photoshop') && get('DateTime') === '2024:05:06 12:00:00', JSON.stringify(r.fields.slice(0, 6)));
  check((le ? 'little' : 'big') + '-endian JPEG: exposure formatted', get('ExposureTime') === '1/250 s' && get('FNumber') === 'f/1.8' && get('ISO') === '200' && get('Orientation').startsWith('Rotated 90° CW'));
  check((le ? 'little' : 'big') + '-endian JPEG: GPS decoded with hemisphere signs', r.gps && Math.abs(r.gps.lat - 48.858333) < 1e-5 && Math.abs(r.gps.lon + 2.294444) < 1e-5 && r.gps.alt === 35, JSON.stringify(r.gps));
  check((le ? 'little' : 'big') + '-endian JPEG: size from the image itself', r.size && r.size.width === 64 && r.size.height === 48);
}
{
  const r = M.describe(withExif(tiff(true, ifd0, exif, gps)));
  const msgs = r.notes.map(n => n.text).join('\n');
  check('notes: location, serial number, editor and “taken ≠ modified”, and the caution', /records a location/.test(msgs) && /serial number/.test(msgs) && /editor or generator/.test(msgs) && /differs from the “modified”/.test(msgs) && /not as proof/.test(msgs));
}
{
  const comIdx = jpg.indexOf(Buffer.from([0xff, 0xfe]));
  const bare = comIdx > 0 ? Buffer.concat([jpg.subarray(0, comIdx), jpg.subarray(comIdx + 2 + jpg.readUInt16BE(comIdx + 2))]) : jpg;
  const r = M.describe(bare);
  check('JPEG without metadata: says absence proves nothing', r.format === 'JPEG' && !r.gps && r.notes.some(n => /No metadata found/.test(n.text) && /says nothing/.test(n.text)));
  const x = M.describe(withExif(tiff(true, [[0x010f, 2, 'ACME']], null, null), '<x:xmpmeta><rdf:Description xmp:CreatorTool="Stable Diffusion 1.5" xmp:CreateDate="2024-01-02T03:04:05"/></x:xmpmeta>'));
  check('XMP: creator tool + date read, generator flagged', x.fields.some(f => f.name === 'CreatorTool' && /Stable Diffusion/.test(f.value)) && x.notes.some(n => n.level === 'warn'));
}

// ---- hostile / truncated input must not throw or hang
const bad = [Buffer.alloc(0), Buffer.from([0xff, 0xd8, 0xff]), jpg.subarray(0, 30), Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0, 0]), Buffer.from('II*\0\xff\xff\xff\x7f', 'latin1')]), Buffer.alloc(100, 0x41)];
check('truncated or hostile files do not throw', bad.every(b => { try { return Array.isArray(M.describe(b).fields); } catch (_) { return false; } }));
const loop = Buffer.concat([Buffer.from('II*\0\x08\0\0\0', 'latin1'), Buffer.from([1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0])]);
check('self-referencing EXIF pointer terminates', (() => { try { M.parseTiff(loop); return true; } catch (_) { return false; } })());

// ---- PNG with text chunks and eXIf
function crcTable() { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CT = crcTable();
const crc = b => { let c = 0xffffffff; for (const x of b) c = CT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, body) { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(type, 4, 'latin1'); body.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + body.length)), 8 + body.length); return b; }
{
  const pngPath = path.join(tmp, 'base.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=32x16', '-frames:v', '1', pngPath]);
  const png = fs.readFileSync(pngPath);
  const ihdrEnd = 8 + 25;
  const extra = Buffer.concat([chunk('tEXt', Buffer.from('parameters\0a cat, Steps: 20, Sampler: Euler a', 'latin1')), chunk('eXIf', tiff(false, [[0x010f, 2, 'PNGCAM']], null, gps)), chunk('tIME', Buffer.from([0x07, 0xe8, 5, 6, 7, 8, 9]))]);
  const r = M.describe(Buffer.concat([png.subarray(0, ihdrEnd), extra, png.subarray(ihdrEnd)]));
  check('PNG: size, text chunk, embedded EXIF + GPS, last-modified', r.format === 'PNG' && r.size.width === 32 && r.fields.some(f => f.name === 'parameters' && /Steps: 20/.test(f.value)) && r.fields.some(f => f.name === 'Make' && f.value === 'PNGCAM') && r.gps && r.fields.some(f => f.name === 'LastModified' && f.value === '2024-05-06T07:08:09Z'), JSON.stringify(r.fields.map(f => f.name)));
}

// ---- WebP with EXIF
{
  const webpPath = path.join(tmp, 'base.webp');
  let ok = true;
  try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=40x30', '-frames:v', '1', webpPath]); } catch (_) { ok = false; }
  if (ok) {
    const w = fs.readFileSync(webpPath);
    const ex = tiff(true, [[0x010f, 2, 'WEBCAM']], null, null);
    const chunkBuf = Buffer.concat([Buffer.from('EXIF'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(ex.length); return b; })(), ex, ex.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    const all = Buffer.concat([w, chunkBuf]);
    all.writeUInt32LE(all.length - 8, 4);
    const r = M.describe(all);
    check('WebP: EXIF chunk read', r.format === 'WebP' && r.fields.some(f => f.name === 'Make' && f.value === 'WEBCAM'), JSON.stringify(r.fields.map(f => f.name)));
  } else check('WebP: skipped (ffmpeg has no webp encoder)', true);
}

// ---- MP4 with creation time, location and title made by ffmpeg
{
  const mp = path.join(tmp, 'v.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-metadata', 'creation_time=2023-07-04T15:16:17Z', '-metadata', 'title=Test clip', '-metadata', 'location=+37.7749-122.4194/', '-movflags', 'use_metadata_tags', mp]);
  const r = M.describe(fs.readFileSync(mp));
  const get = n => (r.fields.find(f => f.name === n) || {}).value;
  check('MP4: created time, duration, dimensions, codecs', r.format === 'MP4/MOV' && get('Created') === '2023-07-04T15:16:17Z' && r.size && r.size.width === 160 && r.size.height === 120 && /^avc1/.test(get('VideoCodec')) && get('AudioCodec') === 'mp4a' && Math.abs(r.duration - 1) < 0.3, JSON.stringify(r.fields));
  check('MP4: title tag and location (ISO 6709) -> GPS', get('Title') === 'Test clip' && r.gps && Math.abs(r.gps.lat - 37.7749) < 1e-6 && Math.abs(r.gps.lon + 122.4194) < 1e-6, JSON.stringify(r.gps));
  const plain = path.join(tmp, 'p.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5:duration=1', '-c:v', 'libx264', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', plain]);
  const p = M.describe(fs.readFileSync(plain));
  check('MP4 without tags still parses and keeps the caution', p.format === 'MP4/MOV' && p.size && p.size.width === 64 && p.notes.some(n => /not as proof/.test(n.text)));
}

check('sniff()', M.sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])) === 'jpeg' && M.sniff(Buffer.from('GIF89a....')) === 'gif' && M.sniff(Buffer.from('hello world, not an image')) === 'unknown');
console.log(failed ? '\n' + failed + ' FAILED' : '\nAll meta tests passed');
process.exit(failed ? 1 : 0);
