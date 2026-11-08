const fs = require('fs');
const path = require('path');
const R = '../extension/';
require(R + 'zip.js');
const { toDocx } = require(R + 'docx.js');
const { toMarkdown } = require(R + 'markdown.js');
const { model, images } = require('./fixture.js');
(async () => {
  const out = path.join(__dirname, 'out');
  const blob = await toDocx(model, { images, meta: true, videos: 'links', savedAt: new Date('2026-11-08T12:00:00Z') });
  fs.writeFileSync(path.join(out, 'sample.docx'), Buffer.from(await blob.arrayBuffer()));
  const md = toMarkdown(model, { images, videos: 'links', savedAt: new Date('2026-11-08T12:00:00Z') });
  fs.writeFileSync(path.join(out, 'sample.md'), md.markdown);
  const md2 = toMarkdown(model, { images: new Map(), linkImages: true, videos: 'none', savedAt: new Date('2026-11-08T12:00:00Z') });
  fs.writeFileSync(path.join(out, 'sample-links.md'), md2.markdown);
  const zip = await globalThis.KRZip.createZip([{ name: 'a/sample.md', data: md.markdown }, ...md.files]);
  fs.writeFileSync(path.join(out, 'bundle.zip'), Buffer.from(await zip.arrayBuffer()));
  console.log('docx bytes', blob.size, '| md files', md.files.map(f => f.name));
})();
