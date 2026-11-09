// Reads the metadata inside image and video files (EXIF / GPS / XMP in JPEG, PNG, WebP; MP4/MOV atoms).
// Pure and local: bytes in, facts out. Nothing is uploaded, and nothing is guessed:
// a missing field means "not in this file", which proves nothing (most platforms strip metadata on upload).
(function (root) {
  const dv = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii = (u8, s, e) => { let o = ''; for (let i = s; i < e && i < u8.length; i++) o += String.fromCharCode(u8[i]); return o; };
  const utf8 = (u8, s, e) => { try { return new TextDecoder('utf-8', { fatal: false }).decode(u8.subarray(s, e)); } catch (_) { return ascii(u8, s, e); } };
  const clean = s => String(s).replace(/\0+$/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();

  // ---------- EXIF (TIFF structure) ----------

  const TAGS = {
    ifd0: { 0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x011a: 'XResolution', 0x011b: 'YResolution', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright', 0x013c: 'HostComputer' },
    exif: { 0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram', 0x8827: 'ISO', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'CreateDate', 0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9012: 'OffsetTimeDigitized', 0x9201: 'ShutterSpeed', 0x9204: 'ExposureBias', 0x9207: 'MeteringMode', 0x9209: 'Flash', 0x920a: 'FocalLength', 0x9286: 'UserComment', 0x9290: 'SubSecTime', 0xa002: 'PixelWidth', 0xa003: 'PixelHeight', 0xa401: 'CustomRendered', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa405: 'FocalLengthIn35mm', 0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber', 0xa432: 'LensInfo', 0xa433: 'LensMake', 0xa434: 'LensModel', 0xa435: 'LensSerialNumber' },
    gps: { 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude', 0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef', 0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp', 0x000b: 'GPSDOP', 0x000c: 'GPSSpeedRef', 0x000d: 'GPSSpeed', 0x0010: 'GPSImgDirectionRef', 0x0011: 'GPSImgDirection', 0x001d: 'GPSDateStamp', 0x001b: 'GPSProcessingMethod' }
  };
  const ORIENT = { 1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored vertically', 5: 'Mirrored, rotated 90° CCW', 6: 'Rotated 90° CW', 7: 'Mirrored, rotated 90° CW', 8: 'Rotated 90° CCW' };
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function readIfd(u8, tiff, offset, le, names, out, depth = 0) {
    const v = dv(u8);
    if (offset < 0 || tiff + offset + 2 > u8.length || depth > 4) return { next: 0, pointers: {} };
    const count = v.getUint16(tiff + offset, le);
    const pointers = {};
    for (let i = 0; i < Math.min(count, 500); i++) {
      const e = tiff + offset + 2 + i * 12;
      if (e + 12 > u8.length) break;
      const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), n = v.getUint32(e + 4, le);
      const size = (SIZES[type] || 1) * n;
      let vo = size <= 4 ? e + 8 : tiff + v.getUint32(e + 8, le);
      if (vo < 0 || vo + size > u8.length || n > 1_000_000) continue;
      if (tag === 0x8769 || tag === 0x8825 || tag === 0xa005) { pointers[tag] = v.getUint32(e + 8, le); continue; }
      const name = names[tag];
      if (!name) continue;
      let val;
      switch (type) {
        case 2: val = clean(ascii(u8, vo, vo + n)); break;
        case 1: case 7:
          if (tag === 0x9286) { val = clean((ascii(u8, vo, vo + 8).match(/^(ASCII|UNICODE|JIS)/) ? utf8(u8, vo + 8, vo + n) : utf8(u8, vo, vo + n))); }
          else if (tag === 0x9000) val = ascii(u8, vo, vo + n);
          else val = n === 1 ? u8[vo] : Array.from(u8.subarray(vo, vo + Math.min(n, 16)));
          break;
        case 3: { const a = []; for (let k = 0; k < Math.min(n, 16); k++) a.push(v.getUint16(vo + k * 2, le)); val = n === 1 ? a[0] : a; break; }
        case 4: { const a = []; for (let k = 0; k < Math.min(n, 16); k++) a.push(v.getUint32(vo + k * 4, le)); val = n === 1 ? a[0] : a; break; }
        case 9: { const a = []; for (let k = 0; k < Math.min(n, 16); k++) a.push(v.getInt32(vo + k * 4, le)); val = n === 1 ? a[0] : a; break; }
        case 5: case 10: {
          const a = [];
          for (let k = 0; k < Math.min(n, 16); k++) {
            const num = type === 5 ? v.getUint32(vo + k * 8, le) : v.getInt32(vo + k * 8, le), den = type === 5 ? v.getUint32(vo + k * 8 + 4, le) : v.getInt32(vo + k * 8 + 4, le);
            a.push(den ? num / den : 0);
          }
          val = n === 1 ? a[0] : a; break;
        }
        default: continue;
      }
      out[name] = val;
    }
    const nextOff = tiff + offset + 2 + count * 12;
    return { next: nextOff + 4 <= u8.length ? v.getUint32(nextOff, le) : 0, pointers };
  }

  // tiffBytes: the TIFF block (starts with II or MM)
  function parseTiff(tiffBytes) {
    const u8 = tiffBytes;
    if (u8.length < 8) return null;
    const le = ascii(u8, 0, 2) === 'II';
    if (!le && ascii(u8, 0, 2) !== 'MM') return null;
    const v = dv(u8);
    if (v.getUint16(2, le) !== 42) return null;
    const res = { ifd0: {}, exif: {}, gps: {}, hasThumbnail: false };
    const first = readIfd(u8, 0, v.getUint32(4, le), le, TAGS.ifd0, res.ifd0);
    if (first.next) res.hasThumbnail = true;
    if (first.pointers[0x8769]) {
      const ex = readIfd(u8, 0, first.pointers[0x8769], le, TAGS.exif, res.exif);
      void ex;
    }
    if (first.pointers[0x8825]) readIfd(u8, 0, first.pointers[0x8825], le, TAGS.gps, res.gps);
    return res;
  }

  const dms = (arr, ref) => {
    if (!Array.isArray(arr) || arr.length < 3) return null;
    let d = arr[0] + arr[1] / 60 + arr[2] / 3600;
    if (/^[SW]/i.test(ref || '')) d = -d;
    return Math.round(d * 1e6) / 1e6;
  };

  function gpsFrom(g) {
    const lat = dms(g.GPSLatitude, g.GPSLatitudeRef), lon = dms(g.GPSLongitude, g.GPSLongitudeRef);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const r = { lat, lon };
    if (typeof g.GPSAltitude === 'number') r.alt = Math.round(g.GPSAltitude * 10) / 10 * (g.GPSAltitudeRef === 1 ? -1 : 1);
    if (typeof g.GPSImgDirection === 'number') r.direction = Math.round(g.GPSImgDirection * 10) / 10;
    if (g.GPSDateStamp) r.date = g.GPSDateStamp + (Array.isArray(g.GPSTimeStamp) ? ' ' + g.GPSTimeStamp.map(n => String(Math.round(n)).padStart(2, '0')).join(':') + ' UTC' : '');
    return r;
  }

  function fmtVal(name, v) {
    if (name === 'Orientation') return ORIENT[v] ? ORIENT[v] + ' (' + v + ')' : String(v);
    if (name === 'ExposureTime' && typeof v === 'number') return v >= 1 ? v + ' s' : '1/' + Math.round(1 / v) + ' s';
    if (name === 'FNumber' && typeof v === 'number') return 'f/' + Math.round(v * 10) / 10;
    if (name === 'FocalLength' && typeof v === 'number') return Math.round(v * 10) / 10 + ' mm';
    if ((name === 'GPSLatitude' || name === 'GPSLongitude') && Array.isArray(v)) return v.map(n => Math.round(n * 1000) / 1000).join('° ').replace('° ', '° ') + '′';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'number' && !Number.isInteger(v)) return String(Math.round(v * 1000) / 1000);
    return String(v);
  }

  function exifFields(t) {
    const rows = [];
    const push = (group, obj) => { for (const k of Object.keys(obj)) if (obj[k] !== '' && obj[k] != null) rows.push({ group, name: k, value: fmtVal(k, obj[k]) }); };
    push('Camera and image', t.ifd0);
    push('Exposure', t.exif);
    push('Location (GPS)', t.gps);
    return rows;
  }

  // ---------- XMP ----------

  const XMP_TAGS = ['CreatorTool', 'CreateDate', 'ModifyDate', 'MetadataDate', 'DocumentID', 'InstanceID', 'OriginalDocumentID', 'History', 'Creator', 'Rights', 'Title', 'Description', 'Make', 'Model', 'Lens', 'GPSLatitude', 'GPSLongitude', 'DateCreated', 'Software', 'Credit', 'Source', 'City', 'Country', 'Marker'];
  function xmpFields(text) {
    const rows = [];
    for (const t of XMP_TAGS) {
      const attr = new RegExp('(?:\\w+:)?' + t + '="([^"]{1,300})"', 'i').exec(text);
      const el = new RegExp('<(?:\\w+:)' + t + '[^>]*>\\s*(?:<rdf:(?:Alt|Seq|Bag)>\\s*<rdf:li[^>]*>)?([^<]{1,300})', 'i').exec(text);
      const val = (attr && attr[1]) || (el && el[1]);
      if (val && val.trim()) rows.push({ group: 'XMP', name: t, value: val.trim() });
    }
    if (/stEvt:action/.test(text)) {
      const acts = [...text.matchAll(/stEvt:action="([^"]+)"/g)].map(m => m[1]);
      const sw = [...text.matchAll(/stEvt:softwareAgent="([^"]+)"/g)].map(m => m[1]);
      if (acts.length) rows.push({ group: 'XMP', name: 'EditHistory', value: acts.join(' → ') + (sw.length ? ' (' + [...new Set(sw)].join(', ') + ')' : '') });
    }
    return rows;
  }

  // ---------- containers ----------

  function parseJpeg(u8) {
    const v = dv(u8);
    const out = { format: 'JPEG', fields: [], gps: null, tiff: null, flags: {}, size: null };
    let p = 2;
    while (p + 4 <= u8.length) {
      if (u8[p] !== 0xff) { p++; continue; }
      const marker = u8[p + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += marker === 0xff ? 1 : 2; continue; }
      const len = v.getUint16(p + 2);
      const body = p + 4, end = p + 2 + len;
      if (len < 2 || end > u8.length) break;
      if (marker === 0xe1 && ascii(u8, body, body + 6) === 'Exif\0\0') {
        if (!out.tiff) out.tiff = parseTiff(u8.subarray(body + 6, end));
      } else if (marker === 0xe1 && ascii(u8, body, body + 29).startsWith('http://ns.adobe.com/xap/1.0/')) {
        out.xmp = (out.xmp || '') + utf8(u8, body + 29, end);
      } else if (marker === 0xe0 && ascii(u8, body, body + 4) === 'JFIF') {
        out.flags.jfif = true;
      } else if (marker === 0xfe) {
        out.fields.push({ group: 'File', name: 'Comment', value: clean(utf8(u8, body, end)) });
      } else if (marker === 0xed && ascii(u8, body, body + 13) === 'Photoshop 3.0') {
        out.flags.photoshop = true;
      } else if (marker === 0xe2 && ascii(u8, body, body + 11) === 'ICC_PROFILE') {
        out.flags.icc = true;
      } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && !out.size) {
        out.size = { height: v.getUint16(body + 1), width: v.getUint16(body + 3) };
      }
      p = end;
    }
    return out;
  }

  function parsePng(u8) {
    const v = dv(u8);
    const out = { format: 'PNG', fields: [], gps: null, tiff: null, flags: {}, size: null };
    let p = 8;
    while (p + 12 <= u8.length) {
      const len = v.getUint32(p), type = ascii(u8, p + 4, p + 8), body = p + 8;
      if (body + len > u8.length) break;
      if (type === 'IHDR') out.size = { width: v.getUint32(body), height: v.getUint32(body + 4) };
      else if (type === 'tEXt') { const z = u8.indexOf(0, body); if (z > 0 && z < body + len) out.fields.push({ group: 'PNG text', name: ascii(u8, body, z), value: clean(ascii(u8, z + 1, body + len)).slice(0, 500) }); }
      else if (type === 'iTXt') {
        const z = u8.indexOf(0, body);
        if (z > 0 && z < body + len) {
          const key = ascii(u8, body, z), compressed = u8[z + 1];
          if (key === 'XML:com.adobe.xmp' && !compressed) { let q = z + 3; for (let n = 0; n < 2 && q < body + len; n++) q = u8.indexOf(0, q) + 1; out.xmp = utf8(u8, q, body + len); }
          else if (!compressed) { let q = z + 3; for (let n = 0; n < 2 && q < body + len; n++) q = u8.indexOf(0, q) + 1; out.fields.push({ group: 'PNG text', name: key, value: clean(utf8(u8, q, body + len)).slice(0, 500) }); }
        }
      } else if (type === 'zTXt') { const z = u8.indexOf(0, body); if (z > 0) out.fields.push({ group: 'PNG text', name: ascii(u8, body, z), value: '(compressed text; not shown)' }); }
      else if (type === 'eXIf') out.tiff = parseTiff(u8.subarray(body, body + len));
      else if (type === 'tIME' && len === 7) out.fields.push({ group: 'File', name: 'LastModified', value: v.getUint16(body) + '-' + String(u8[body + 2]).padStart(2, '0') + '-' + String(u8[body + 3]).padStart(2, '0') + 'T' + String(u8[body + 4]).padStart(2, '0') + ':' + String(u8[body + 5]).padStart(2, '0') + ':' + String(u8[body + 6]).padStart(2, '0') + 'Z' });
      else if (type === 'IDAT') { /* image data begins; keep scanning for trailing chunks */ }
      p = body + len + 4;
    }
    return out;
  }

  function parseWebp(u8) {
    const v = dv(u8);
    const out = { format: 'WebP', fields: [], gps: null, tiff: null, flags: {}, size: null };
    let p = 12;
    while (p + 8 <= u8.length) {
      const type = ascii(u8, p, p + 4), len = v.getUint32(p + 4, true), body = p + 8;
      if (body + len > u8.length) break;
      if (type === 'EXIF') { const o = ascii(u8, body, body + 6) === 'Exif\0\0' ? 6 : 0; out.tiff = parseTiff(u8.subarray(body + o, body + len)); }
      else if (type === 'XMP ') out.xmp = utf8(u8, body, body + len);
      else if (type === 'VP8X') out.size = { width: 1 + (u8[body + 4] | (u8[body + 5] << 8) | (u8[body + 6] << 16)), height: 1 + (u8[body + 7] | (u8[body + 8] << 8) | (u8[body + 9] << 16)) };
      p = body + len + (len & 1);
    }
    return out;
  }

  // ---------- MP4 / MOV ----------

  const MAC_EPOCH = Date.UTC(1904, 0, 1);
  const isoFromMac = secs => (secs > 0 && secs < 4e9 ? new Date(MAC_EPOCH + secs * 1000).toISOString().replace('.000Z', 'Z') : '');

  function boxes(u8, start, end, cb) {
    const v = dv(u8);
    let p = start;
    while (p + 8 <= end) {
      let size = v.getUint32(p), type = ascii(u8, p + 4, p + 8), head = 8;
      if (size === 1 && p + 16 <= end) { size = Number(v.getBigUint64(p + 8)); head = 16; }
      else if (size === 0) size = end - p;
      if (size < head || p + size > end) break;
      if (cb(type, p + head, p + size, p) === false) return;
      p += size;
    }
  }

  function parseIso6709(s) {
    const m = /^([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(s || '');
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
    const r = { lat, lon };
    if (m[3]) r.alt = parseFloat(m[3]);
    return r;
  }

  function parseMp4(u8) {
    const v = dv(u8);
    const out = { format: 'MP4/MOV', fields: [], gps: null, tiff: null, flags: {}, size: null, tracks: [] };
    const add = (group, name, value) => { if (value !== '' && value != null) out.fields.push({ group, name, value: String(value) }); };
    boxes(u8, 0, u8.length, (type, s, e) => {
      if (type === 'ftyp') { add('File', 'Brand', ascii(u8, s, s + 4).trim()); return; }
      if (type !== 'moov') return;
      boxes(u8, s, e, (t2, s2, e2) => {
        if (t2 === 'mvhd') {
          const ver = u8[s2];
          const created = ver === 1 ? Number(v.getBigUint64(s2 + 4)) : v.getUint32(s2 + 4);
          const modified = ver === 1 ? Number(v.getBigUint64(s2 + 12)) : v.getUint32(s2 + 8);
          const scale = v.getUint32(s2 + (ver === 1 ? 20 : 12));
          const dur = ver === 1 ? Number(v.getBigUint64(s2 + 24)) : v.getUint32(s2 + 16);
          add('Time', 'Created', isoFromMac(created));
          add('Time', 'Modified', isoFromMac(modified));
          if (scale) { out.duration = dur / scale; add('File', 'Duration', Math.round(dur / scale * 100) / 100 + ' s'); }
          if (!created && !modified) out.flags.zeroDates = true;
        } else if (t2 === 'trak') {
          const tr = {};
          boxes(u8, s2, e2, (t3, s3, e3) => {
            if (t3 === 'tkhd') {
              const ver = u8[s3], o = s3 + (ver === 1 ? 88 : 76);
              if (o + 8 <= u8.length) { const w = v.getUint32(o) / 65536, h = v.getUint32(o + 4) / 65536; if (w && h) tr.size = { width: Math.round(w), height: Math.round(h) }; }
            } else if (t3 === 'mdia') {
              boxes(u8, s3, e3, (t4, s4, e4) => {
                if (t4 === 'hdlr') tr.kind = ascii(u8, s4 + 8, s4 + 12);
                else if (t4 === 'minf') boxes(u8, s4, e4, (t5, s5, e5) => { if (t5 === 'stbl') boxes(u8, s5, e5, (t6, s6) => { if (t6 === 'stsd') tr.codec = ascii(u8, s6 + 12, s6 + 16); }); });
              });
            }
          });
          out.tracks.push(tr);
        } else if (t2 === 'udta') {
          boxes(u8, s2, e2, (t3, s3, e3) => {
            if (t3 === '\xa9xyz') { const len = v.getUint16(s3); const loc = ascii(u8, s3 + 4, s3 + 4 + len); const g = parseIso6709(loc); if (g) out.gps = g; add('Location', 'Location (ISO 6709)', loc); }
            else if (t3 === 'meta') parseIlst(u8, s3 + 4, e3, add, g => { if (!out.gps) out.gps = g; });
            else if (/^\xa9/.test(t3)) { const name = { '\xa9nam': 'Title', '\xa9too': 'Encoder', '\xa9day': 'Date', '\xa9cmt': 'Comment', '\xa9mak': 'Make', '\xa9mod': 'Model', '\xa9swr': 'Software' }[t3]; if (name) { const len = v.getUint16(s3); add('Tags', name, clean(utf8(u8, s3 + 4, s3 + 4 + len))); } }
          });
        } else if (t2 === 'meta') parseIlst(u8, s2 + 4, e2, add, g => { if (!out.gps) out.gps = g; });
      });
      return false;
    });
    const vt = out.tracks.find(t => t.kind === 'vide');
    if (vt) { if (vt.size) out.size = vt.size; if (vt.codec) add('File', 'VideoCodec', vt.codec); }
    const at = out.tracks.find(t => t.kind === 'soun');
    if (at && at.codec) add('File', 'AudioCodec', at.codec);
    return out;
  }

  const ILST_NAMES = { '\xa9nam': 'Title', '\xa9too': 'Encoder', '\xa9day': 'Date', '\xa9cmt': 'Comment', '\xa9xyz': 'Location', '\xa9mak': 'Make', '\xa9mod': 'Model', '\xa9swr': 'Software', '\xa9ART': 'Artist', '\xa9alb': 'Album' };
  const KEY_NAMES = { 'com.apple.quicktime.location.iso6709': 'Location', 'location': 'Location', 'title': 'Title', 'com.apple.quicktime.make': 'Make', 'com.apple.quicktime.model': 'Model', 'com.apple.quicktime.software': 'Software', 'com.apple.quicktime.creationdate': 'CreationDate', 'creation_time': 'CreationTime', 'encoder': 'Encoder', 'comment': 'Comment', 'artist': 'Artist', 'com.android.version': 'AndroidVersion', 'com.android.manufacturer': 'Make', 'com.android.model': 'Model' };

  // Reads a "meta" box: iTunes-style (ilst keyed by four-letter codes) or QuickTime-style (a "keys" list plus ilst keyed by index).
  function parseIlst(u8, s, e, add, setGps) {
    const v = dv(u8);
    const start = s;
    const keys = [];
    boxes(u8, start, e, (t, s2, e2) => {
      if (t === 'keys') {
        const n = v.getUint32(s2 + 4);
        let p = s2 + 8;
        for (let i = 0; i < Math.min(n, 200) && p + 8 <= e2; i++) { const size = v.getUint32(p); keys.push(ascii(u8, p + 8, p + size)); p += Math.max(size, 8); }
      }
    });
    boxes(u8, start, e, (t, s2, e2) => {
      if (t !== 'ilst') return;
      boxes(u8, s2, e2, (key, s3, e3, p3) => {
        let name = ILST_NAMES[key];
        let rawKey = '';
        if (!name && keys.length) { const idx = v.getUint32(p3 + 4); rawKey = keys[idx - 1] || ''; name = KEY_NAMES[rawKey.toLowerCase()] || (rawKey ? rawKey.replace(/^com\.apple\.quicktime\./, '') : ''); }
        boxes(u8, s3, e3, (t4, s4, e4) => {
          if (t4 !== 'data') return;
          const text = clean(utf8(u8, s4 + 8, e4));
          if (!name || !text) return;
          add('Tags', name, text);
          if (name === 'Location') { const g = parseIso6709(text); if (g) setGps(g); }
        });
      });
      return false;
    });
  }

  // ---------- front door ----------

  function sniff(u8) {
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpeg';
    if (u8.length >= 8 && u8[0] === 0x89 && ascii(u8, 1, 4) === 'PNG') return 'png';
    if (u8.length >= 12 && ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 12) === 'WEBP') return 'webp';
    if (u8.length >= 12 && ascii(u8, 4, 8) === 'ftyp') return 'mp4';
    if (u8.length >= 8 && (ascii(u8, 4, 8) === 'moov' || ascii(u8, 4, 8) === 'mdat' || ascii(u8, 4, 8) === 'free')) return 'mp4';
    if (u8.length >= 6 && /^GIF8[79]a/.test(ascii(u8, 0, 6))) return 'gif';
    return 'unknown';
  }

  const EDITORS = /photoshop|lightroom|gimp|affinity|pixelmator|canva|snapseed|paint\.net|picsart|facetune|capture one|luminar|darktable|fotor|stable diffusion|midjourney|dall[-· ]?e|firefly|comfyui|automatic1111|novelai|ai[- ]generated|generative/i;

  // bytes: Uint8Array. -> { format, size, fields: [{group,name,value}], gps, notes: [{level, text}], sniffed }
  function describe(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const kind = sniff(u8);
    let r;
    try {
      r = kind === 'jpeg' ? parseJpeg(u8) : kind === 'png' ? parsePng(u8) : kind === 'webp' ? parseWebp(u8) : kind === 'mp4' ? parseMp4(u8) : { format: kind === 'gif' ? 'GIF' : 'Unknown', fields: [], gps: null, tiff: null, flags: {}, size: null };
    } catch (e) {
      return { format: kind, size: null, fields: [], gps: null, notes: [{ level: 'warn', text: 'The file’s metadata could not be read completely (' + e.message + ').' }], sniffed: kind };
    }
    const fields = [];
    if (r.size) fields.push({ group: 'File', name: 'Dimensions', value: r.size.width + ' × ' + r.size.height });
    fields.push({ group: 'File', name: 'Format', value: r.format });
    fields.push({ group: 'File', name: 'Size', value: u8.length + ' bytes' });
    if (r.tiff) {
      fields.push(...exifFields(r.tiff));
      const g = gpsFrom(r.tiff.gps);
      if (g) r.gps = g;
    }
    if (r.xmp) fields.push(...xmpFields(r.xmp));
    fields.push(...r.fields);
    if (r.gps) fields.push({ group: 'Location (GPS)', name: 'Position', value: r.gps.lat + ', ' + r.gps.lon + (r.gps.alt != null ? '  (altitude ' + r.gps.alt + ' m)' : '') });

    const notes = [];
    const get = n => (fields.find(f => f.name === n) || {}).value;
    if (r.gps) notes.push({ level: 'info', text: 'This file records a location: ' + r.gps.lat + ', ' + r.gps.lon + '. If you share the original, you share the location.' });
    if (get('BodySerialNumber') || get('LensSerialNumber')) notes.push({ level: 'info', text: 'It contains a camera or lens serial number, which can link photos to one device.' });
    if (get('CameraOwnerName')) notes.push({ level: 'info', text: 'It contains a camera owner name.' });
    const sw = [get('Software'), get('CreatorTool'), get('EditHistory'), get('Encoder'), get('Comment'), get('parameters'), get('Source')].filter(Boolean).join(' ');
    if (EDITORS.test(sw)) notes.push({ level: 'warn', text: 'The software/tool field mentions an editor or generator (“' + sw.slice(0, 80) + '”). That shows the file passed through it; it doesn’t say what was changed.' });
    if (r.flags && r.flags.photoshop) notes.push({ level: 'info', text: 'Contains Photoshop resource data.' });
    if (r.tiff && r.tiff.hasThumbnail) notes.push({ level: 'info', text: 'Has an embedded thumbnail; a thumbnail that differs from the main picture can reveal an earlier version.' });
    const taken = get('DateTimeOriginal'), changed = get('DateTime') || get('ModifyDate');
    if (taken && changed && taken !== changed) notes.push({ level: 'info', text: 'The “taken” time (' + taken + ') differs from the “modified” time (' + changed + ').' });
    if (r.flags && r.flags.zeroDates) notes.push({ level: 'info', text: 'The video’s creation date is empty (zero), as many apps and platforms write it.' });
    const meaningful = fields.filter(f => !['Dimensions', 'Format', 'Size'].includes(f.name));
    if (!meaningful.length) notes.push({ level: 'info', text: 'No metadata found. Most social networks, messengers and image hosts strip it on upload, so its absence says nothing about whether the file was altered.' });
    notes.push({ level: 'info', text: 'Metadata is easy to edit or fake. Treat it as a lead to check, not as proof.' });
    return { format: r.format, size: r.size, duration: r.duration, fields, gps: r.gps || null, notes, sniffed: kind };
  }

  const api = { describe, sniff, parseTiff, parseIso6709 };
  root.KMeta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
