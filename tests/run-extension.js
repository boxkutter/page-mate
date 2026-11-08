// Loads the real extension in Chromium and drives the Save page against the fixture site.
// (A permission prompt can't be clicked headlessly, so a COPY of the extension is made with the
//  optional permissions granted in its manifest. All shipped code runs unchanged.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { start } = require('./fixture-site.js');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
const SRC = path.join(__dirname, '../extension');
const EXT = path.join(SP, 'ext-test');
const DL = path.join(SP, 'downloads');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const listFiles = d => { const out = []; const walk = p => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, f.name); f.isDirectory() ? walk(fp) : out.push(fp); } }; if (fs.existsSync(d)) walk(d); return out; };

(async () => {
  // fresh copies (no rm: use unique dirs per run)
  const run = Date.now();
  const ext = EXT + '-' + run, dl = DL + '-' + run;
  fs.cpSync(SRC, ext, { recursive: true });
  fs.mkdirSync(dl, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.permissions.push('downloads');
  mf.host_permissions = ['http://*/*', 'https://*/*'];
  delete mf.optional_permissions; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

  const site = await start();
  // Point the profile's download folder at `dl` (the way a real user's settings do) so that
  // chrome.downloads honours the file names / sub-folders the extension asks for.
  const profile = path.join(SP, 'profile-' + run);
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
    download: { default_directory: dl, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: dl }
  }));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile,
    args: ['--no-sandbox', '--host-resolver-rules=MAP *.kaltura.com ~NOTFOUND', '--disable-extensions-except=' + ext, '--load-extension=' + ext],
    ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext]
  });

  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const worker = await sw.worker();
  console.log('extension id', extId);

  const article = await browser.newPage();
  await article.setViewport({ width: 1200, height: 900 });
  await article.goto(site.base + '/article', { waitUntil: 'networkidle0' });
  await sleep(1500);
  const tabId = await worker.evaluate(async base => (await chrome.tabs.query({ url: base + '/*' }))[0].id, site.base);

  // ----- network sniffer
  const sniffed = await waitFor(async () => { const r = await worker.evaluate(async () => (await chrome.storage.session.get('krMedia')).krMedia || {}); return r[tabId] && r[tabId].length ? r[tabId] : null; });
  check('background noticed streams for the tab', !!sniffed, sniffed ? sniffed.map(e => e.kind + ':' + new URL(e.url).pathname).join(', ') : '');
  check('HLS playlist recorded as hls', sniffed && sniffed.some(e => e.kind === 'hls' && e.url.endsWith('/plain/index.m3u8')));
  check('mp4 recorded as file with size, segments (.ts) not recorded', sniffed && sniffed.some(e => e.kind === 'file' && e.size > 150000) && !sniffed.some(e => e.url.endsWith('.ts')));

  // ----- Save page: document
  const save = await browser.newPage();
  await save.setViewport({ width: 1300, height: 1000 });
  const errors = [];
  save.on('pageerror', e => errors.push(e.message));
  save.on('response', r => { if (r.status() === 403) console.log('   403 from', r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), '| referer sent:', r.request().headers()['referer'] || '(none)', '| at', new Date().toISOString().slice(17, 23)); });
  save.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await save.goto(`chrome-extension://${extId}/save.html?tab=${tabId}`);
  await save.waitForSelector('.kr-doc', { timeout: 20000 });
  await waitFor(async () => (await save.$eval('#docStatus', e => e.textContent)).includes('images'), 20000);
  const status = await save.$eval('#docStatus', e => e.textContent);
  console.log('   status:', status);
  const prev = await save.evaluate(() => ({
    title: document.querySelector('.kr-title').textContent,
    h2: [...document.querySelectorAll('.kr-doc h2')].map(h => h.textContent),
    imgs: [...document.querySelectorAll('#paper img')].map(i => ({ ok: i.complete && i.naturalWidth > 0, alt: i.alt })),
    missing: [...document.querySelectorAll('.kr-missing')].map(m => m.textContent),
    links: [...document.querySelectorAll('#paper a')].map(a => a.href),
    text: document.querySelector('#paper').innerText
  }));
  check('preview shows the page title', prev.title.includes('Modal Interchange'));
  check('preview headings', prev.h2.includes('Chords to know') && prev.h2.includes('Watch'));
  check('images fetched and displayed (chart, lazy, hotlink-protected, poster)', prev.imgs.length >= 4 && prev.imgs.every(i => i.ok), JSON.stringify(prev.imgs.map(i => i.alt + ':' + i.ok)));
  check('hotlink-protected image loaded via Referer rule', prev.imgs.some(i => i.alt === 'Hotlink protected' && i.ok));
  check('no "image not available" placeholders (except the blocked Kaltura poster)', prev.missing.length <= 1 && prev.missing.every(m => /Watch/.test(m)), prev.missing.join('; '));
  check('site chrome / hidden text not in preview', !/Footer links|Sidebar link|cookies|Hidden text/.test(prev.text));
  const realErrors = () => errors.filter(e => !/ERR_NAME_NOT_RESOLVED/.test(e));
  check('no page errors on the Save page', realErrors().length === 0, realErrors().join(' | '));
  const hotlogs = site.log.filter(l => l.path === '/protected/hotlink.png');
  console.log('   hotlink requests (referer):', hotlogs.map(l => l.referer || '(none)').join(', '));

  // --- DOCX
  await save.click('input[name="format"][value="docx"]');
  await sleep(300);
  await save.click('#download');
  await sleep(2500);
  console.log('   docx status after click:', JSON.stringify(await save.$eval('#docStatus', e => e.textContent + ' | class=' + e.className)), '| button disabled:', await save.$eval('#download', b => b.disabled));
  const docx = await waitFor(() => listFiles(dl).find(f => f.endsWith('.docx') && !f.endsWith('.crdownload')), 15000);
  check('DOCX downloaded', !!docx, docx && path.basename(docx));
  if (docx) {
    const names = execFileSync('unzip', ['-Z1', docx]).toString().split('\n');
    check('DOCX contains embedded images', names.filter(n => n.startsWith('word/media/')).length >= 4, names.filter(n => n.startsWith('word/media/')).length + ' media files');
    const xml = execFileSync('unzip', ['-p', docx, 'word/document.xml']).toString();
    check('DOCX has the content', xml.includes('borrowing chords') && xml.includes('日本語') && xml.includes('<w:tbl>') && !xml.includes('Footer links'));
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dl, docx], { stdio: 'ignore', timeout: 120000 });
    const pdf = listFiles(dl).find(f => f.endsWith('.pdf'));
    check('DOCX opens in LibreOffice (converted to PDF)', !!pdf);
  }

  // --- Markdown zip
  await save.click('input[name="format"][value="md"]');
  await sleep(300);
  await save.click('#download');
  const zip = await waitFor(() => listFiles(dl).find(f => f.endsWith('.zip')), 15000);
  check('Markdown + images .zip downloaded', !!zip, zip && path.basename(zip));
  if (zip) {
    const names = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter(Boolean);
    const mdName = names.find(n => n.endsWith('.md'));
    const md = execFileSync('unzip', ['-p', zip, mdName]).toString();
    check('zip has .md + images folder', !!mdName && names.filter(n => n.includes('/images/')).length >= 4, names.join(', '));
    check('markdown formatting', md.includes('**borrowing chords**') && md.includes('## Chords to know') && md.includes('| Chord | Function |') && md.includes('![Chord chart](<images/'));
    check('markdown video link + poster', md.includes('[▶ Lesson 3 lecture]'));
  }

  // --- PDF (print path)
  await save.click('input[name="format"][value="pdf"]');
  await sleep(300);
  await save.evaluate(() => { window.print = () => { window.__printed = true; window.__printRootHas = !!document.querySelector('#printRoot .kr-doc'); window.__printTitle = document.title; }; });
  await save.click('#download');
  await waitFor(() => save.evaluate(() => window.__printed), 5000);
  const printed = await save.evaluate(() => ({ p: window.__printed, has: window.__printRootHas, title: window.__printTitle }));
  check('PDF button prepares print layout + sets file name', printed.p && printed.has && printed.title.includes('Modal Interchange'), printed.title);
  await save.evaluate(() => { const r = document.getElementById('printRoot'); r.replaceChildren(document.querySelector('#paper .kr-doc').cloneNode(true)); });
  const pdfPath = path.join(dl, 'print-test.pdf');
  await save.emulateMediaType('print');
  await save.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
  check('PDF has only the document (app UI hidden)', txt.includes('borrowing chords') && !txt.includes('Whole page') && !txt.includes('Save as PDF'));
  check('PDF keeps non-Latin text', txt.includes('日本語') && txt.includes('♯'));
  const info = execFileSync('pdfinfo', [pdfPath]).toString();
  check('PDF page size is Letter', /612 x 792/.test(info), (info.match(/Page size:.*/) || [''])[0]);
  execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', pdfPath, path.join(__dirname, 'out/pdf-page')]);
  await save.emulateMediaType('screen');

  // --- Videos
  await save.click('#tab-video');
  const rowsReady = await waitFor(async () => (await save.$$('#vlist .vrow')).length >= 2, 20000);
  const rows = await save.$$eval('#vlist .vrow', rs => rs.map(r => ({ name: r.querySelector('input[type=text]').value, meta: r.querySelector('.vmeta').textContent, hasLocate: !r.querySelector('.vbtns button:nth-of-type(3)').hidden, text: r.innerText })));
  console.log('   rows:', rows.map(r => r.meta.replace(/\s+/g, ' ')).join(' || '));
  const kalturaRow = rows.find(r => /Stream \(HLS\)/.test(r.meta) && /cdnapisec\.kaltura\.com/.test(r.meta));
  check('Kaltura entry listed as a downloadable stream before anything is played', !!kalturaRow, kalturaRow && kalturaRow.meta);
  const kNote = await waitFor(async () => { const t = await save.evaluate(() => [...document.querySelectorAll('#vlist .vrow')].map(r => r.querySelector('.vnote').textContent).find(t => /Kaltura/.test(t))); return t; }, 15000);
  check('video list shows direct file, stream, deduped', !!rowsReady && rows.some(r => /Video file/.test(r.meta)) && rows.some(r => /HLS/.test(r.meta)) && rows.length <= 5, rows.length + ' rows');
  const vidStatus = await save.$eval('#vidStatus', e => e.textContent);
  console.log('   video status:', vidStatus);

  // Download the Referer-protected mp4 (element with src=/protected/lesson3.mp4)
  const idxFile = await save.evaluate(() => [...document.querySelectorAll('#vlist .vrow')].findIndex(r => r.querySelector('.vmeta').textContent.includes('127.0.0.1') && r.innerText.includes('Video file') && r.querySelector('input[type=text]').value.includes('Lesson')));
  console.log('   file row index', idxFile);
  const before = site.log.length;
  await save.evaluate(i => document.querySelectorAll('#vlist .vrow')[i].querySelector('.vbtns button').click(), Math.max(0, idxFile));
  const mp4 = await waitFor(() => listFiles(dl).find(f => f.endsWith('.mp4') && fs.statSync(f).size > 100000), 25000);
  check('video file downloaded', !!mp4, mp4 && path.relative(dl, mp4));
  if (mp4) {
    const dur = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', mp4])).format.duration;
    check('downloaded video is complete and plays', Math.abs(dur - 12) < 0.5, dur + 's');
    check('saved inside the chosen sub-folder', path.relative(dl, mp4).startsWith('PageMate Archive'), path.relative(dl, mp4));
  }
  const prot = site.log.slice(before).filter(l => l.path === '/protected/lesson3.mp4');
  console.log('   protected mp4 requests:', prot.map(l => `ref=${l.referer || '(none)'}`).join(', '));
  check('download request carried a Referer (not blocked with 403)', prot.some(l => l.referer.startsWith('http://127.0.0.1')));

  // Download the HLS stream: converted to MP4 automatically
  const idxHls = await save.evaluate(() => [...document.querySelectorAll('#vlist .vrow')].findIndex(r => r.querySelector('.vmeta').textContent.includes('HLS') && !r.querySelector('.vmeta').textContent.includes('kaltura')));
  await save.evaluate(i => document.querySelectorAll('#vlist .vrow')[i].querySelector('.vbtns button').click(), idxHls);
  const hlsMp4 = await waitFor(() => listFiles(dl).find(f => f.endsWith('.mp4') && path.basename(f).startsWith('Week 3')), 30000);
  check('HLS stream saved as .mp4 (auto-converted)', !!hlsMp4, hlsMp4 && path.relative(dl, hlsMp4));
  check('no leftover .ts when conversion succeeds', !listFiles(dl).some(f => f.endsWith('.ts')));
  if (hlsMp4) {
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name', '-of', 'json', hlsMp4]));
    check('converted HLS plays full length (h264 + aac kept)', Math.abs(info.format.duration - 12) < 0.6 && info.streams.map(x => x.codec_name).sort().join() === 'aac,h264', info.format.duration + 's');
  }
  const note = await save.evaluate(i => document.querySelectorAll('#vlist .vrow')[i].querySelector('.vnote').textContent, idxHls);
  console.log('   hls note:', note.slice(0, 160));
  check('no page errors during video flow', realErrors().length === 0, realErrors().join(' | '));

  // --- Images tab
  await save.click('#tab-image');
  const tilesReady = await waitFor(async () => (await save.$$('.itile')).length >= 7, 20000);
  await sleep(2500); // thumbnails load lazily
  await save.select('#imgMin', '0');
  await sleep(300);
  const tileInfo = await save.$$eval('.itile', ts => ts.map(t => ({ name: t.querySelector('.imeta').innerText.replace(/\n/g, ' | '), hidden: t.hidden, loaded: !!t.querySelector('img') })));
  console.log('   image tiles:', tileInfo.length, 'shown:', tileInfo.filter(t => !t.hidden).length);
  check('Images tab lists page images incl. lightbox, background, og:image', !!tilesReady && tileInfo.some(t => /Lightbox thumbnail/.test(t.name) && /full size available/.test(t.name)) && tileInfo.some(t => /background/.test(t.name)) && tileInfo.some(t => /preview image|Page preview/.test(t.name)), tileInfo.map(t => t.name.slice(0, 40)).join(' || ').slice(0, 300));
  check('thumbnails load (through the extension, incl. hotlink-protected)', tileInfo.filter(t => t.loaded).length >= tileInfo.length - 2, tileInfo.filter(t => t.loaded).length + ' of ' + tileInfo.length);
  const shownBefore = tileInfo.filter(t => !t.hidden).length;
  await save.select('#imgMin', '300');
  await sleep(300);
  const afterFilter = await save.$$eval('.itile', ts => ts.filter(t => !t.hidden).length);
  check('size filter hides small images', afterFilter < shownBefore, shownBefore + ' -> ' + afterFilter);
  await save.select('#imgMin', '0');
  await save.type('#imgFilter', 'thumbnail');
  await sleep(300);
  const textShown = await save.$$eval('.itile', ts => ts.filter(t => !t.hidden).length);
  check('text filter narrows to matching images', textShown === 1, String(textShown));
  await save.select('#imgPack', 'files');
  await save.evaluate(() => document.querySelector('.itile:not([hidden]) .ithumb').click());
  await save.click('#imgSave');
  const lightbox = await waitFor(() => listFiles(dl).find(f => /Lightbox thumbnail\.png$/.test(f)), 20000);
  check('selected image saved as a real .png in the archive folder', !!lightbox, lightbox && path.relative(dl, lightbox));
  if (lightbox) {
    const b = fs.readFileSync(lightbox);
    check('the FULL-SIZE file was saved, not the thumbnail', b.readUInt32BE(16) === 300 && b.readUInt32BE(20) === 150, b.readUInt32BE(16) + 'x' + b.readUInt32BE(20));
  }
  await save.$eval('#imgFilter', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await save.select('#imgMin', '0');
  await sleep(300);
  await save.click('#imgNone');
  await save.click('#imgAll');
  await save.select('#imgPack', 'zip');
  await save.click('#imgSave');
  const imgZip = await waitFor(() => listFiles(dl).find(f => /images\.zip$/.test(f)), 20000);
  check('"Select all" + .zip produces an images zip', !!imgZip, imgZip && path.basename(imgZip));
  if (imgZip) {
    const names = execFileSync('unzip', ['-Z1', imgZip]).toString().split('\n').filter(Boolean);
    execFileSync('unzip', ['-tq', imgZip]);
    check('zip holds the images with proper extensions', names.length >= 3 && names.every(n => /\.(png|jpg|gif|webp|svg)$/.test(n)), names.length + ' files');
  }
  check('Images tab: no page errors', realErrors().length === 0, realErrors().join(' | '));

  // --- Audio tab
  const clickRow = (metaRe, nameRe) => save.evaluate((m, n) => {
    const rows = [...document.querySelectorAll('#alist .vrow')];
    const r = rows.find(x => new RegExp(m).test(x.querySelector('.vmeta').textContent) && new RegExp(n).test(x.querySelector('input[type=text]').value));
    if (!r) return false;
    r.querySelector('.vbtns button').click();
    return true;
  }, metaRe.source, nameRe.source);
  await save.click('#tab-audio');
  await waitFor(async () => (await save.$$('#alist .vrow')).length >= 4, 20000);
  const arows = await save.$$eval('#alist .vrow', rs => rs.map(r => ({ name: r.querySelector('input[type=text]').value, meta: r.querySelector('.vmeta').textContent, btn: r.querySelector('.vbtns button').textContent })));
  console.log('   audio rows:', arows.map(r => r.btn + ' <- ' + r.meta.slice(0, 28)).join(' || '));
  check('Audio tab lists the <audio> element and the linked .m4a', arows.filter(r => /Audio file/.test(r.meta)).length >= 2, arows.filter(r => /Audio file/.test(r.meta)).length + ' audio files');
  check('every video is offered as "Save sound only"', arows.filter(r => /sound only/.test(r.btn)).length >= 2);
  check('MP3 row clicked', await clickRow(/Audio file/, /Lecture audio/));
  const mp3 = await waitFor(() => listFiles(dl).find(f => /\.mp3$/.test(f)), 20000);
  check('audio file downloaded (.mp3)', !!mp3, mp3 && path.relative(dl, mp3));
  if (mp3) check('mp3 plays (~5 s)', Math.abs(+JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', mp3])).format.duration - 5) < 0.5);
  check('video-file row clicked', await clickRow(/Video → sound only/, /Lesson/));
  const m4a = await waitFor(() => listFiles(dl).find(f => /Lesson 3 lecture\.m4a$/.test(f)), 30000);
  if (!m4a) console.log('   row notes:', JSON.stringify(await save.$$eval('#alist .vnote', ns => ns.map(n => n.textContent.slice(0, 160)))));
  check('"Save sound only" on a video file produces .m4a', !!m4a, m4a && path.relative(dl, m4a));
  if (m4a) {
    const st = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', m4a]));
    check('.m4a is audio only (AAC, ~12 s)', st.streams.length === 1 && st.streams[0].codec_type === 'audio' && st.streams[0].codec_name === 'aac' && Math.abs(st.format.duration - 12) < 0.6, JSON.stringify(st.streams) + ' ' + st.format.duration);
  }
  check('HLS row clicked', await clickRow(/Video stream → sound only(?!.*kaltura)/, /Week 3/));
  const hlsAudio = await waitFor(() => listFiles(dl).find(f => /Week 3 Modal Interchange – Harmony II\.m4a$/.test(f)), 40000);
  check('"Save sound only" on an HLS stream produces .m4a', !!hlsAudio, hlsAudio && path.relative(dl, hlsAudio));
  check('Audio tab: no page errors', realErrors().length === 0, realErrors().join(' | '));

  // --- Web page with playable videos (folder)
  await save.click('#tab-doc');
  await save.click('input[name="format"][value="html"]');
  await sleep(300);
  await save.select('#optPackage', 'folder');
  const reqBefore = site.log.length;
  await save.click('#download');
  await waitFor(async () => /Saved to/.test(await save.$eval('#docStatus', e => e.textContent)), 60000);
  const htmlStatus = await save.$eval('#docStatus', e => e.textContent);
  console.log('   html status:', htmlStatus.slice(0, 260));
  const indexFile = await waitFor(() => listFiles(dl).find(f => f.endsWith('(web page ' + '') || (f.endsWith('/index.html') && f.includes('web page'))), 15000);
  check('web page folder written with index.html', !!indexFile, indexFile && path.relative(dl, indexFile));
  if (indexFile) {
    const folder = path.dirname(indexFile);
    const files = listFiles(folder).map(f => path.relative(folder, f));
    check('folder has images/ and videos/ (mp4)', files.some(f => f.startsWith('images/')) && files.filter(f => f.startsWith('videos/') && f.endsWith('.mp4')).length >= 1, files.join(', '));
    const html = fs.readFileSync(indexFile, 'utf8');
    check('page has a Content-Security-Policy and no scripts', html.includes('Content-Security-Policy') && !/<script/i.test(html));
    check('page uses relative paths only', !/(src|poster)="https?:/i.test(html));
    const page = await browser.newPage();
    const external = [];
    page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto('file://' + indexFile, { waitUntil: 'load' });
    await sleep(1500);
    const rep = await page.evaluate(async () => {
      const vids = [...document.querySelectorAll('video')];
      await Promise.all(vids.map(v => v.readyState >= 1 ? 0 : new Promise(r => { v.addEventListener('loadedmetadata', r, { once: true }); v.addEventListener('error', r, { once: true }); setTimeout(r, 6000); })));
      return { videos: vids.map(v => ({ dur: v.duration, err: v.error && v.error.code, w: v.videoWidth, src: v.currentSrc.split('/').slice(-2).join('/') })),
        imgs: [...document.images].map(i => i.complete && i.naturalWidth > 0), title: document.title, links: [...document.querySelectorAll('.kr-video-line a')].length };
    });
    console.log('   opened from file://:', JSON.stringify(rep.videos));
    check('videos play inside the saved page (metadata loads, ~12s, no error)', rep.videos.length >= 1 && rep.videos.every(v => Math.abs(v.dur - 12) < 0.6 && !v.err && v.w > 0));
    check('every image in the saved page loads', rep.imgs.length >= 4 && rep.imgs.every(Boolean));
    check('saved page makes no network requests', external.length === 0, external.join(', '));
    await page.screenshot({ path: path.join(__dirname, 'out/webpage.png'), fullPage: false });
    await page.close();
  }
  
  // --- Web page as .zip
  await save.select('#optPackage', 'zip');
  await save.click('#download');
  const wz = await waitFor(() => listFiles(dl).find(f => f.endsWith('.zip') && !f.includes('Kokoro') && fs.statSync(f).size > 100000), 60000);
  check('web page .zip written', !!wz, wz && path.basename(wz));
  if (wz) {
    const names = execFileSync('unzip', ['-Z1', wz]).toString().split('\n').filter(Boolean);
    check('zip has index.html + videos + images', names.some(n => n.endsWith('/index.html')) && names.some(n => n.includes('/videos/') && n.endsWith('.mp4')) && names.some(n => n.includes('/images/')), names.length + ' entries');
    execFileSync('unzip', ['-tq', wz]);
    check('zip is intact', true);
  }

  // --- Convert existing .ts files
  const tsFile = path.join(__dirname, 'out', 'hls-plain.ts');
  const before2 = listFiles(dl).length;
  const picker = await save.$('#convertPicker');
  await picker.uploadFile(tsFile);
  const conv = await waitFor(() => listFiles(dl).find(f => path.basename(f) === 'hls-plain.mp4'), 20000);
  check('"Convert .ts files I already have" produces an .mp4 in the archive folder', !!conv, conv && path.relative(dl, conv));
  console.log('   status:', await save.$eval('#vidStatus', e => e.textContent));

  // --- Player buttons (content script UI lives in a CLOSED shadow root; CDP can still reach it)
  // The extension only knows about Save tabs it opened itself, so close the one this test opened by hand.
  for (const p of await browser.pages()) if (p.url().includes('save.html')) await p.close();
  await sleep(300);
  await article.bringToFront();
  await worker.evaluate(async id => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }); await chrome.tabs.sendMessage(id, { type: 'kr-toggle', mode: 'page' }); }, tabId);
  await sleep(800);
  const cdp = await article.createCDPSession();
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const find = (n, cls) => { if (n.attributes) { const i = n.attributes.indexOf('class'); if (i >= 0 && n.attributes[i + 1].split(' ').includes(cls)) return n; } for (const c of [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]) { const r = find(c, cls); if (r) return r; } return null; };
  const docBtn = find(root, 'savedoc'), vidBtn = find(root, 'savevid');
  check('player shows "Save page" and "Video" buttons', !!docBtn && !!vidBtn);
  const click = async node => {
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const x = (model.content[0] + model.content[4]) / 2, y = (model.content[1] + model.content[5]) / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const saveUrls = async () => (await browser.pages()).map(p => p.url()).filter(u => u.includes('save.html'));
  await click(vidBtn);
  const vu = await waitFor(async () => { const u = await saveUrls(); return u.length === 1 && u[0].includes('view=video') ? u : null; }, 8000);
  check('"Video" button opens the Save page on the Video tab (reusing the open Save tab)', !!vu, vu && vu[0].replace(/chrome-extension:\/\/[a-z]+\//, ''));
  await click(docBtn);
  const du = await waitFor(async () => { const u = await saveUrls(); return u.length === 1 && u[0].includes('view=document') ? u : null; }, 8000);
  check('"Save page" button opens the Document tab', !!du, du && du[0].replace(/chrome-extension:\/\/[a-z]+\//, ''));

  // leftover DNR rules are cleaned when the page closes
  for (const p of await browser.pages()) if (p.url().includes('save.html')) await p.close();
  await sleep(500);
  const rules = await worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
  check('temporary header rules removed when the Save page closes', rules === 0, rules + ' left');

  await browser.close(); site.server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
