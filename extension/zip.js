// Minimal ZIP writer (no dependencies). Used for .docx files and for
// Markdown + images bundles. Entries are deflated when the browser can do it
// (CompressionStream) and the data is worth compressing; otherwise stored.
(function (root) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crcUpdate(c, u8) {
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return c;
  }
  function crc32(u8) { return (crcUpdate(0xffffffff, u8) ^ 0xffffffff) >>> 0; }

  // Checksum of a Blob without loading it into memory all at once.
  async function crc32Blob(blob) {
    let c = 0xffffffff;
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      c = crcUpdate(c, value);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();

  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (_) {
      return null;
    }
  }

  function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  // Images and other already-compressed formats gain nothing from deflate.
  const INCOMPRESSIBLE = /\.(png|jpe?g|gif|webp|avif|mp4|m4v|webm|zip|docx|mp3|m4a)$/i;

  // entries: [{ name, data: string | Uint8Array }]  ->  Blob
  async function createZip(entries, { date = new Date() } = {}) {
    const { time, date: dosDate } = dosDateTime(date);
    const parts = [];
    const central = [];
    let offset = 0;
    const seen = new Set();

    for (const e of entries) {
      if (seen.has(e.name)) throw new Error('Duplicate zip entry ' + e.name);
      seen.add(e.name);
      const nameBytes = enc.encode(e.name);
      const isBlob = typeof Blob !== 'undefined' && e.data instanceof Blob;
      const data = isBlob ? e.data : (typeof e.data === 'string' ? enc.encode(e.data) : e.data);
      const size = isBlob ? data.size : data.length;
      const crc = isBlob ? await crc32Blob(data) : crc32(data);
      let method = 0;
      let body = data;
      // Blobs (videos, big images) are stored as they are: never compressed, never copied.
      if (!isBlob && size > 64 && !INCOMPRESSIBLE.test(e.name)) {
        const packed = await deflateRaw(data);
        if (packed && packed.length < data.length) { method = 8; body = packed; }
      }
      const bodySize = isBlob ? body.size : body.length;
      if (bodySize > 0xfffffffe || offset > 0xfffffffe) throw new Error('Archive too large for this simple zip writer.');

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bodySize, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, body);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, method, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, bodySize, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);

      offset += 30 + nameBytes.length + bodySize;
    }

    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    if (entries.length > 0xfffe) throw new Error('Too many files for this simple zip writer.');
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  const api = { createZip, crc32 };
  root.KRZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
