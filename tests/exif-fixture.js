// Builds tiny EXIF/TIFF blocks and splices them into JPEGs, for tests.
const fs = require('fs');

function tiff(le, ifd0, exif, gps) {
  const parts = [];            // [{off, bytes}]
  let size = 8;
  const w16 = (b, o, v) => { if (le) { b[o] = v & 255; b[o + 1] = v >> 8; } else { b[o] = v >> 8; b[o + 1] = v & 255; } };
  const w32 = (b, o, v) => { if (le) { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >>> 24) & 255; } else { b[o] = (v >>> 24) & 255; b[o + 1] = (v >> 16) & 255; b[o + 2] = (v >> 8) & 255; b[o + 3] = v & 255; } };
  const alloc = n => { const off = size; size += n + (n & 1); return off; };
  const data = [];
  // entry: [tag, type, values]; type 2 ascii (string), 3 short, 4 long, 5 rational ([[n,d],...]), 7 undefined (Buffer)
  function build(entries, extra = {}) {
    const n = entries.length + Object.keys(extra).length;
    const base = alloc(2 + n * 12 + 4);
    const buf = Buffer.alloc(2 + n * 12 + 4);
    w16(buf, 0, n);
    let i = 0;
    const all = [...entries.map(e => ({ tag: e[0], type: e[1], vals: e[2] })), ...Object.entries(extra).map(([tag, ptr]) => ({ tag: +tag, type: 4, ptr }))];
    all.sort((a, b) => a.tag - b.tag);
    for (const e of all) {
      const o = 2 + i++ * 12;
      w16(buf, o, e.tag); w16(buf, o + 2, e.type);
      if (e.ptr != null) { w32(buf, o + 4, 1); w32(buf, o + 8, e.ptr()); continue; }
      let payload;
      if (e.type === 2) payload = Buffer.from(e.vals + '\0', 'latin1');
      else if (e.type === 3) { payload = Buffer.alloc(e.vals.length * 2); e.vals.forEach((v, k) => w16(payload, k * 2, v)); }
      else if (e.type === 4) { payload = Buffer.alloc(e.vals.length * 4); e.vals.forEach((v, k) => w32(payload, k * 4, v)); }
      else if (e.type === 5) { payload = Buffer.alloc(e.vals.length * 8); e.vals.forEach(([nn, dd], k) => { w32(payload, k * 8, nn); w32(payload, k * 8 + 4, dd); }); }
      else payload = e.vals;
      const count = e.type === 2 ? payload.length : e.type === 3 ? payload.length / 2 : e.type === 4 ? payload.length / 4 : e.type === 5 ? payload.length / 8 : payload.length;
      w32(buf, o + 4, count);
      if (payload.length <= 4) payload.copy(buf, o + 8);
      else { const off = alloc(payload.length); data.push({ off, bytes: payload }); w32(buf, o + 8, off); }
    }
    parts.push({ off: base, bytes: buf });
    return base;
  }
  const gpsOff = gps ? build(gps) : 0;
  const exifOff = exif ? build(exif) : 0;
  const ifd0Off = build(ifd0, { ...(exif ? { 0x8769: () => exifOff } : {}), ...(gps ? { 0x8825: () => gpsOff } : {}) });
  const out = Buffer.alloc(size);
  out.write(le ? 'II' : 'MM', 0, 'latin1'); w16(out, 2, 42); w32(out, 4, ifd0Off);
  for (const p of [...parts, ...data]) p.bytes.copy(out, p.off);
  return out;
}


function withExif(jpg, tiffBuf, xmp) {
  const seg = (marker, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = marker; b.writeUInt16BE(body.length + 2, 2); body.copy(b, 4); return b; };
  const segs = [seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBuf]))];
  if (xmp) segs.push(seg(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xmp)])));
  return Buffer.concat([jpg.subarray(0, 2), ...segs, jpg.subarray(2)]);
}
const SAMPLE = {
  ifd0: [[0x010f, 2, 'ACME'], [0x0110, 2, 'Phone 9 Pro'], [0x0112, 3, [6]], [0x0131, 2, 'Adobe Photoshop 25.0'], [0x0132, 2, '2024:05:06 12:00:00']],
  exif: [[0x829a, 5, [[1, 250]]], [0x829d, 5, [[18, 10]]], [0x8827, 3, [200]], [0x9003, 2, '2024:05:01 09:30:00'], [0xa431, 2, 'SN-12345'], [0xa434, 2, 'ACME 24mm']],
  gps: [[1, 2, 'N'], [2, 5, [[48, 1], [51, 1], [30, 1]]], [3, 2, 'W'], [4, 5, [[2, 1], [17, 1], [40, 1]]], [5, 3, [0]], [6, 5, [[350, 10]]]]
};
module.exports = { tiff, withExif, SAMPLE };
