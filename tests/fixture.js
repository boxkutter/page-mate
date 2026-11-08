// A model that exercises every block type, with a tiny generated PNG for images.
const zlib = require('zlib');
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const t = x => ({ x });
const model = {
  title: 'Harmony II: Week 3 – Modal Interchange ♯♭',
  url: 'https://example.edu/courses/12/pages/week-3?x=1&y=2',
  blocks: [
    { t: 'h', l: 1, r: [t('Modal interchange')] },
    { t: 'p', r: [t('Borrowing chords from the '), { x: 'parallel minor', b: 1 }, t(' adds colour. See '), { x: 'the lesson notes', a: 'https://example.edu/notes?a=1&b=2' }, t(' and *literal* stars, _underscores_, [brackets] & <tags>.')] },
    { t: 'h', l: 2, r: [t('Chords (♭VII, iv)')] },
    { t: 'list', ordered: false, start: 1, items: [
      [{ t: 'p', r: [t('Bullet one with '), { x: 'code', c: 1 }] }],
      [{ t: 'p', r: [t('Bullet two')] }, { t: 'list', ordered: true, start: 3, items: [[{ t: 'p', r: [t('Nested third')] }], [{ t: 'p', r: [t('Nested fourth')] }]] }]
    ] },
    { t: 'list', ordered: true, start: 1, items: [[{ t: 'p', r: [t('First')] }], [{ t: 'p', r: [t('Second')] }]] },
    { t: 'quote', b: [{ t: 'p', r: [{ x: 'A quoted remark.', i: 1 }] }] },
    { t: 'code', text: 'Cmaj7 | Fm7 | Bb7 |\n  tab\there', lang: 'text' },
    { t: 'img', src: 'https://example.edu/img/a.png', alt: 'Chord chart', w: 400, h: 200 },
    { t: 'p', r: [{ x: 'Figure 1: chart', i: 1 }], cap: true },
    { t: 'video', src: 'https://example.edu/media/lesson3.mp4', poster: 'https://example.edu/img/poster.png', title: 'Lesson 3 lecture' },
    { t: 'video', src: '', poster: '', title: 'Weekly chat (streamed)', stream: true },
    { t: 'table', rows: [
      [{ h: true, r: [t('Chord')], cs: 1 }, { h: true, r: [t('Function | note')], cs: 1 }],
      [{ h: false, r: [t('bVII')], cs: 1 }, { h: false, r: [t('Subtonic'), { br: 1 }, t('second line')], cs: 1 }]
    ] },
    { t: 'hr' },
    { t: 'p', r: [t('Ends here — 日本語 and Ω.')] }
  ]
};
const images = new Map([
  ['https://example.edu/img/a.png', { bytes: png(40, 20, [200, 40, 40]), mime: 'image/png', w: 400, h: 200, name: 'img-001.png' }],
  ['https://example.edu/img/poster.png', { bytes: png(32, 18, [40, 40, 200]), mime: 'image/png', w: 320, h: 180, name: 'img-002.png' }]
]);
module.exports = { model, images };
