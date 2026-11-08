// Runs the real extractor (extract.js) against the fixture page in headless Chromium.
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const { start } = require('./fixture-site.js');
const CHROME = require('./chrome');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

(async () => {
  const site = await start();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(site.base + '/article', { waitUntil: 'networkidle0' });
  await page.addScriptTag({ path: path.join(__dirname, '../extension/extract.js') });
  const result = await page.evaluate(() => window.__krExtract.run({ scope: 'page' }));
  fs.writeFileSync(path.join(__dirname, 'out/extracted-model.json'), JSON.stringify(result, null, 2));
  const blocks = result.model.blocks;
  const flat = JSON.stringify(blocks);
  const text = s => flat.includes(s);

  check('title taken from <title>', result.model.title === 'Week 3: Modal Interchange – Harmony II');
  check('duplicate h1 (same as title) dropped', !(blocks[0].t === 'h' && blocks[0].l === 1));
  check('main content kept', text('borrowing chords') && text('Inner paragraph in a div') && text('Final paragraph'));
  check('loose text in a div kept as a paragraph', text('Loose text directly inside a div'));
  check('site header / sidebar / footer dropped', !text('Example Online') && !text('Sidebar link') && !text('Footer links'));
  check('cookie banner dropped', !text('cookies'));
  check('display:none text dropped', !text('Hidden text'));
  check('screen-reader-only text dropped', !text('Screen reader only'));
  check('bold + italic + link runs', flat.includes('"x":"borrowing chords","b":1') && flat.includes('"i":1') && flat.includes('"a":"' + site.base + '/notes?a=1&b=2"'));
  const list = blocks.find(b => b.t === 'list');
  check('bullet list with nested ordered list (start=3)', list && !list.ordered && list.items.length === 2 && list.items[1].some(b => b.t === 'list' && b.ordered && b.start === 3 && b.items.length === 2));
  check('blockquote', blocks.some(b => b.t === 'quote'));
  const code = blocks.find(b => b.t === 'code');
  check('code block keeps newlines + language', code && code.text.includes('\n  indented line') && code.lang === 'text');
  const imgs = blocks.filter(b => b.t === 'img');
  check('main image with absolute src + alt + size', imgs.some(i => i.src === site.base + '/img/chart.png' && i.alt === 'Chord chart' && i.w === 80));
  check('lazy-loaded image resolved from data-src', imgs.some(i => i.src === site.base + '/img/lazy.png'));
  check('tiny 16px icon not exported as an image', !imgs.some(i => i.src.includes('icon.png')));
  check('figcaption kept as caption', blocks.some(b => b.t === 'p' && b.cap && b.r[0].x.includes('Figure 1')));
  const table = blocks.find(b => b.t === 'table');
  check('table: header row and <br> inside a cell kept', table && table.rows[0].every(c => c.h) && table.rows[1][1].r.some(r => r.br));
  check('table colspan', table && table.rows[2][0].cs === 2);
  const videos = blocks.filter(b => b.t === 'video');
  check('<video> with direct src + poster + label', videos.some(v => v.src === site.base + '/protected/lesson3.mp4' && v.poster === site.base + '/img/poster.png' && v.title === 'Lesson 3 lecture'));
  check('blob: video marked as streamed with no address', videos.some(v => !v.src && v.stream));
  check('same-site iframe content included in place', videos.some(v => v.src === site.base + '/media/lesson3.mp4') || text('lesson3.mp4'));
  const kv = videos.find(v => v.kaltura);
  check('Kaltura click-to-start button becomes a video block (entry + partner + poster)', kv && kv.kaltura.entry === '1_0lb94emr' && kv.kaltura.pid === '2588802' && kv.poster.includes('/thumbnail/entry_id/1_0lb94emr'), JSON.stringify(kv && kv.kaltura));
  check('Kaltura button is not ALSO emitted as a plain image', !imgs.some(i => i.src.includes('kaltura.com')));
  check('image inside an image button is kept (lightbox thumbnails)', imgs.some(i => i.alt === 'Lightbox chart'));
  check('ordinary buttons ("Submit answer") are still left out', !text('Submit answer') && !text('Click to Start'));
  check('scroll-reveal image (visibility:hidden until scrolled) is kept', imgs.some(i => i.alt === 'Scroll-revealed picture'));
  check('scroll-reveal text is kept', text('still waiting to be scrolled'));
  check('truly hidden text is still dropped', !text('Hidden text must not'));
  check('non-ASCII text intact', text('日本語') && text('Ω') && text('♯'));
  check('stats count images and videos', result.stats.images >= 4 && result.stats.videos >= 3 && result.stats.pageImages >= 5, JSON.stringify(result.stats));

  // selection scope
  await page.evaluate(() => { const p = document.querySelector('#content p'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  const probe = await page.evaluate(() => window.__krExtract.probe());
  check('probe reports selection length', probe.selectionChars > 100);
  const sel = await page.evaluate(() => window.__krExtract.run({ scope: 'selection' }));
  check('selection export contains only the selection', sel.scope === 'selection' && sel.model.blocks.length === 1 && !JSON.stringify(sel.model).includes('Final paragraph'));
  check('selection keeps inline formatting + link', JSON.stringify(sel.model.blocks).includes('"b":1') && JSON.stringify(sel.model.blocks).includes('/notes?'));

  // video scan
  const scan = await page.evaluate(() => window.__krExtract.scanVideos());
  check('scanVideos reports the Kaltura entry', scan.kaltura.length === 1 && scan.kaltura[0].entry === '1_0lb94emr' && scan.kaltura[0].pid === '2588802');
  check('scanVideos finds both <video> elements + the iframe', scan.videos.filter(v => !v.audio).length === 2 && scan.frames.length === 1, `${scan.videos.length} videos, ${scan.frames.length} frames`);
  check('scan: direct source listed, blob flagged', scan.videos.filter(v => !v.audio)[0].sources[0].src.endsWith('/protected/lesson3.mp4') && scan.videos.filter(v => !v.audio)[1].blob === true);
  const imgScan = await page.evaluate(() => window.__krExtract.scanImages());
  const byUrl = u => imgScan.images.find(i => i.url.endsWith(u));
  check('scanImages: lightbox thumbnail carries its full-size link', byUrl('/img/thumb-chart.png') && byUrl('/img/thumb-chart.png').full.endsWith('/img/full-chart.png') && byUrl('/img/thumb-chart.png').alt === 'Lightbox thumbnail');
  check('scanImages: largest <picture>/srcset candidate found', !!byUrl('/img/big.png'));
  check('scanImages: CSS background image found', byUrl('/img/bg-hero.png') && byUrl('/img/bg-hero.png').kind === 'bg');
  check('scanImages: og:image found', byUrl('/img/og.png') && byUrl('/img/og.png').kind === 'meta');
  check('scanImages: lazy-loaded image found by its real address', !!byUrl('/img/lazy.png'));
  check('scanImages: images get locate ids', imgScan.images.filter(i => i.kind === 'img').every(i => i.id));
  check('scanVideos: <audio> element + audio file link found', scan.videos.some(v => v.audio && v.sources[0].src.endsWith('lecture.mp3')) && scan.audioLinks.some(l => l.url.endsWith('/media/podcast.m4a') && /podcast/i.test(l.text)));
  const located = await page.evaluate(id => window.__krExtract.locate(id), scan.videos.find(v => !v.audio).id);
  check('locate highlights an element', located === true);

  await browser.close(); site.server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
