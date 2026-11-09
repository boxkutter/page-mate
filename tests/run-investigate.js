// Drives the real extension in Chromium: Investigate tabs, screenshots (full-page stitching), and sealed packages
// verified with sha256sum and openssl. (A copy of the extension is made with the optional permissions granted,
// because a permission prompt can't be clicked headlessly; all shipped code runs unchanged.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { execFileSync, spawnSync } = require('child_process');
const CHROME = require('./chrome');
const { tiff, withExif, SAMPLE } = require('./exif-fixture.js');
const SP = process.env.SCRATCH || os.tmpdir();
const SRC = path.join(__dirname, '../extension');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const listFiles = d => { const out = []; const walk = p => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, f.name); f.isDirectory() ? walk(fp) : out.push(fp); } }; if (fs.existsSync(d)) walk(d); return out; };

// ---- the page under investigation: tall, coloured by 500px bands, with a fixed header and lots to find
const COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085'];
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Osint Test Page</title>
<meta name="generator" content="WordPress 6.5"><meta name="description" content="A page for tests"><meta property="og:title" content="OG Title">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345"></script>
<script>window.dataLayer=[];gtag('config','UA-1234567-1');</script>
<style>body{margin:0;font:16px system-ui}.band{height:500px;color:#fff;font-size:28px;padding:80px 20px 0;box-sizing:border-box}#hdr{position:fixed;top:0;left:0;right:0;height:40px;background:#000;color:#fff;z-index:9}.hid{display:none}</style></head>
<body><div id="hdr">FIXED HEADER</div>
${COLORS.map((c, i) => `<div class="band" style="background:${c}">Band ${i + 1}${i === 0 ? `<p style="font-size:15px">Contact Jane at jane.doe@example.org or +44 20 7946 0958. Server 203.0.113.7. Follow @janedoe. CVE-2021-44228. Mirror hxxps://bad[.]example[.]net/x. <a href="mailto:press@corp.example.com">press</a> <a href="https://github.com/x/y">repo</a></p><img id="ex" src="/exif.jpg" width="64" height="48" alt="exif">` : ''}</div>`).join('')}
<div class="hid">Secret hidden words about wombats</div><!-- remember to remove staging key -->
</body></html>`;

(async () => {
  const run = Date.now();
  const ext = path.join(SP, 'ext-inv-' + run), dl = path.join(SP, 'dl-inv-' + run), tmp = path.join(SP, 'inv-' + run);
  fs.cpSync(SRC, ext, { recursive: true });
  fs.mkdirSync(dl, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.permissions.push('downloads', 'pageCapture', 'tabs');
  mf.host_permissions = ['<all_urls>'];
  delete mf.optional_permissions; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

  const base0 = path.join(tmp, 'b.jpg');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x48', '-frames:v', '1', base0]);
  const exifJpg = withExif(fs.readFileSync(base0), tiff(true, SAMPLE.ifd0, SAMPLE.exif, SAMPLE.gps));

  const server = http.createServer((req, res) => {
    if (req.url === '/exif.jpg') { res.setHeader('Content-Type', 'image/jpeg'); res.end(exifJpg); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Server', 'nginx/1.25'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Set-Cookie', 'sid=TOPSECRET; HttpOnly');
    res.end(PAGE);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const tsa = await require('./tsa-fixture.js')(fs.mkdtempSync(path.join(tmp, 'tsa-')));

  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: dl, prompt_for_download: false, directory_upgrade: true }, savefile: { default_directory: dl } }));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, args: ['--no-sandbox', '--disable-extensions-except=' + ext, '--load-extension=' + ext], ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext] });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  let worker = await sw.worker();
  // The browser stops an idle service worker and starts it again on the next event. When that happens mid-test,
  // wake it with a message from an extension page and attach to the new instance.
  let waker = null;
  const rewake = async () => {
    if (!waker) { waker = await browser.newPage(); await waker.goto(`chrome-extension://${extId}/options.html`); }
    await waker.evaluate(() => chrome.runtime.sendMessage({ type: 'noop-wake' }).catch(() => {}));
    for (let i = 0; i < 20; i++) {
      const t = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes('background.js'));
      if (t) { try { worker = await t.worker(); await worker.evaluate(() => 1); return; } catch (_) {} }
      await sleep(300);
    }
  };
  const W = {
    async evaluate(fn, ...args) {
      for (let i = 0; i < 4; i++) {
        try { return await worker.evaluate(fn, ...args); } catch (e) {
          if (!/No SW|Execution context|Target closed|detached/.test(String(e.message))) throw e;
          await rewake();
        }
      }
      return worker.evaluate(fn, ...args);
    }
  };
  const errors = [];
  const watch = (page, label) => { page.on('pageerror', e => errors.push(label + ': ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(label + ': ' + m.text()); }); };

  const article = await browser.newPage();
  await article.setViewport({ width: 1000, height: 700 });
  await article.goto(base + '/', { waitUntil: 'networkidle0' });
  await sleep(500);
  const tabId = await W.evaluate(async b => (await chrome.tabs.query({ url: b + '/*' }))[0].id, base);
  const inv = view => `chrome-extension://${extId}/investigate.html?tab=${tabId}&view=${view}`;

  // ----- response headers noted (memory), cookie value removed
  const rec = await waitFor(async () => { const r = await W.evaluate(async id => (await chrome.storage.session.get('koHeaders')).koHeaders?.[id] || null, tabId); return r; });
  check('background noted the page’s response headers, IP and status', rec && rec.status === 200 && rec.ip && rec.headers.server === 'nginx/1.25', JSON.stringify(rec && { s: rec.status, ip: rec.ip }));
  check('no cookie value in the noted headers (the browser may not even expose Set-Cookie)', rec && !JSON.stringify(rec).includes('TOPSECRET'));

  // ----- Page entities
  const p1 = await browser.newPage(); watch(p1, 'entities');
  await p1.goto(inv('entities'));
  await p1.waitForFunction(() => document.querySelectorAll('#enList .ent').length > 5, { timeout: 15000 });
  const ent = await p1.evaluate(() => [...document.querySelectorAll('#enList .card')].map(c => ({ h: c.querySelector('h2').textContent, v: [...c.querySelectorAll('.ent code')].map(x => x.textContent) })));
  const has = (re, v) => ent.some(c => re.test(c.h) && c.v.some(x => x === v || (v instanceof RegExp && v.test(x))));
  check('entities: emails (text and mailto), phone, IP, handle, CVE', has(/Email/, 'jane.doe@example.org') && has(/Email/, 'press@corp.example.com') && has(/Phone/, /7946/) && has(/IPv4/, '203.0.113.7') && has(/Handles/, '@janedoe') && has(/CVE/, 'CVE-2021-44228'), JSON.stringify(ent.map(c => c.h)));
  check('entities: defanged URL is read as a real link; hidden text and analytics ids are covered', has(/Links/, 'https://bad.example.net/x') && has(/Analytics/, 'UA-1234567-1') && has(/Analytics/, 'G-ABCDE12345') && has(/Domains/, 'github.com'));
  await p1.type('#enFilter', 'corp.example');
  const filtered = await p1.$$eval('#enList .ent code', els => els.map(e => e.textContent));
  check('entities: filter narrows the list', filtered.length >= 1 && filtered.every(v => v.includes('corp.example')), JSON.stringify(filtered));
  await p1.click('#enList .ent button.ghost');           // "Look up"
  await p1.waitForFunction(() => !document.getElementById('panel-lookup').hidden && document.getElementById('luInput').value, { timeout: 5000 });
  check('“Look up” on an entity opens the Look up tab with it', (await p1.$eval('#luInput', e => e.value)).includes('corp.example'));

  // ----- Look up
  const p2 = await browser.newPage(); watch(p2, 'lookup');
  await p2.goto(`chrome-extension://${extId}/investigate.html?view=lookup&q=${encodeURIComponent('hxxps://evil[.]example[.]com/a')}`);
  await p2.waitForSelector('#luResults a.pill', { timeout: 10000 });
  const hrefs = await p2.$$eval('#luResults a.pill', as => as.map(a => ({ t: a.textContent, h: a.href, rel: a.rel, target: a.target })));
  check('lookup: defanged url → VirusTotal and the domain’s crt.sh/RDAP links', hrefs.some(a => a.h === 'https://www.virustotal.com/gui/search/' + encodeURIComponent('https://evil.example.com/a')) && hrefs.some(a => a.h === 'https://crt.sh/?q=evil.example.com') && hrefs.some(a => a.h.startsWith('https://rdap.org/domain/evil.example.com')), hrefs.length + ' links');
  check('lookup links open in a new tab with noopener', hrefs.every(a => a.target === '_blank' && /noopener/.test(a.rel)));
  await p2.click('#luDefang');
  check('lookup: Defang button', (await p2.$eval('#luInput', e => e.value)) === 'hxxps://evil[.]example[.]com/a');
  await p2.$eval('#luInput', e => { e.value = '48.8584, 2.2945'; e.dispatchEvent(new Event('input')); });
  check('lookup: coordinates → map links', (await p2.$$eval('#luResults a.pill', as => as.map(a => a.href))).some(h => h.includes('openstreetmap.org') && h.includes('mlat=48.8584')));

  // ----- Site profile
  const p3 = await browser.newPage(); watch(p3, 'site');
  await p3.goto(inv('site'));
  await p3.waitForFunction(() => document.getElementById('stStatus').textContent === 'Done.', { timeout: 15000 });
  const site = await p3.evaluate(() => document.getElementById('stOut').innerText);
  check('site profile: technologies from headers + meta, security headers, analytics ids, hidden text and comments', /nginx/.test(site) && /WordPress/.test(site) && /X-Content-Type-Options/.test(site) && /missing/.test(site) && /present/.test(site) && /G-ABCDE12345/.test(site) && /wombats/.test(site) && /staging key/.test(site), site.slice(0, 200));
  check('site profile: googletagmanager flagged as tracker', /tracker/.test(site) && /googletagmanager\.com/.test(site));
  check('site profile never shows the cookie value', !site.includes('TOPSECRET'));

  // ----- Media: EXIF
  const p4 = await browser.newPage(); watch(p4, 'media');
  await p4.goto(inv('media'));
  await p4.waitForSelector('#mdGrid .itile', { timeout: 15000 });
  await p4.evaluate(() => [...document.querySelectorAll('#mdGrid button')].find(b => b.textContent === 'Metadata').click());
  await p4.waitForFunction(() => document.getElementById('mdResult').innerText.includes('ACME'), { timeout: 15000 });
  const md = await p4.evaluate(() => document.getElementById('mdResult').innerText);
  check('media: EXIF read from a page image (camera, software, serial, GPS, notes)', /Phone 9 Pro/.test(md) && /Photoshop/.test(md) && /SN-12345/.test(md) && /48\.858333/.test(md) && /records a location/.test(md) && /not as proof/.test(md));
  check('media: SHA-256 shown and equals the file’s', md.includes(require('crypto').createHash('sha256').update(exifJpg).digest('hex')));
  check('media: reverse-image links for a web image, Google Maps for the GPS', (await p4.$$eval('#mdResult a.pill', as => as.map(a => a.href))).some(h => h.startsWith('https://tineye.com/search?url=')) && (await p4.$$eval('#mdResult a.pill', as => as.map(a => a.href))).some(h => h.includes('google.com/maps?q=48.858333')));

  // ----- Search + Share
  const p5 = await browser.newPage(); watch(p5, 'search');
  await p5.goto(inv('search'));
  await p5.type('#dkExact', 'john smith'); await p5.type('#dkSite', 'example.com'); await p5.type('#dkType', 'pdf');
  check('search operators built', (await p5.$eval('#dkOut', e => e.value)) === '"john smith" site:example.com filetype:pdf' && (await p5.$$eval('#dkEngines a', as => as.length)) === 5);
  const p6 = await browser.newPage(); watch(p6, 'share');
  await p6.goto(`chrome-extension://${extId}/investigate.html?view=share&tab=${tabId}&quote=hello`);
  await p6.waitForFunction(() => document.getElementById('shUrl').value, { timeout: 10000 });
  await p6.$eval('#shUrl', e => { e.value = 'https://news.example/story?id=7&utm_source=x&fbclid=abc'; e.dispatchEvent(new Event('input')); });
  const shareHrefs = await p6.$$eval('#shChannels a', as => as.map(a => a.href));
  check('share: tracking codes stripped, X/Bluesky/Reddit/email links built', shareHrefs.some(h => h.startsWith('https://x.com/intent/post') && h.includes(encodeURIComponent('https://news.example/story?id=7')) && !h.includes('fbclid')) && shareHrefs.some(h => h.startsWith('https://bsky.app/intent/compose')) && shareHrefs.some(h => h.startsWith('mailto:')));
  await p6.$eval('#shUrl', e => { e.value = 'https://files.example/a?X-Amz-Signature=abc'; e.dispatchEvent(new Event('input')); });
  check('share: warns about a private signed link', (await p6.$eval('#shWarn', e => e.innerText)).includes('token or signature'));

  // ----- Trail
  const p7 = await browser.newPage(); watch(p7, 'trail');
  await p7.goto(inv('trail'));
  await p7.type('#trCase', 'Case 42'); await p7.click('#trOn');
  await sleep(500);
  const cfg = await W.evaluate(async () => (await chrome.storage.local.get('ko:trail'))['ko:trail']);
  check('trail: switched on for a case', cfg && cfg.on === true && cfg.case === 'Case 42');
  const t2 = await browser.newPage();
  await t2.goto(base + '/?trail=1', { waitUntil: 'networkidle0' });
  const trailLog = await waitFor(async () => { const l = await W.evaluate(async () => (await chrome.storage.local.get('ko:trailLog'))['ko:trailLog'] || []); return l.some(r => r.url.endsWith('?trail=1')) ? l : null; }, 8000);
  check('trail: a page loaded while on is logged with case and time', !!trailLog && trailLog.some(r => r.case === 'Case 42' && r.url.endsWith('?trail=1') && /Z$/.test(r.at)));
  await W.evaluate(() => chrome.storage.local.set({ 'ko:trail': { on: false, case: '' } }));
  await t2.close();

  // A screenshot now shows up as a card in the floating toolbox; "Edit…" on that card opens the editor. Do the same here.
  const editLatestShot = async () => {
    const sid = await waitFor(() => W.evaluate(async () => Object.keys((await chrome.storage.session.get('koDockShots')).koDockShots || {}).pop()), 40000);
    if (sid) await W.evaluate(async (tid, id) => openShotEditor(await chrome.tabs.get(tid), id), tabId, sid);
  };

  // ----- Screenshot: dragged area
  await article.bringToFront();
  await article.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
  await sleep(300);
  await W.evaluate(async id => { const t = await chrome.tabs.get(id); await startShot(t, 'region'); }, tabId);
  await article.waitForFunction(() => !!window.__koSelect, { timeout: 5000 }).catch(() => {});
  await article.mouse.move(100, 120); await article.mouse.down(); await article.mouse.move(400, 320, { steps: 5 }); await article.mouse.up();
  await editLatestShot();
  const regionPage = await waitFor(async () => (await browser.pages()).find(p => p.url().includes('shot.html')), 20000);
  check('region screenshot: viewer opens after a drag', !!regionPage);
  if (regionPage) {
    await regionPage.waitForFunction(() => document.getElementById('cv').width > 100, { timeout: 15000 });
    const dim = await regionPage.evaluate(() => ({ w: document.getElementById('cv').width, h: document.getElementById('cv').height, mode: document.getElementById('meta').innerText }));
    check('region screenshot: exactly the dragged size (300×200) and says “Selected area”', dim.w === 300 && dim.h === 200 && /Selected area/.test(dim.mode), dim.w + 'x' + dim.h);
    check('region screenshot: the selection overlay removed itself', await article.evaluate(() => !window.__koSelect));
    await regionPage.close();
  }

  // ----- Screenshot: whole page, stitched
  await article.bringToFront();
  await article.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
  await sleep(300);
  const startErr = await W.evaluate(async id => { const t = await chrome.tabs.get(id); try { await startShot(t, 'full', { throwErrors: true }); return ''; } catch (e) { return String(e && e.message || e); } }, tabId);
  check('screenshot: capture ran without error', !startErr, startErr);
  await editLatestShot();
  const shotPage = await waitFor(async () => (await browser.pages()).find(p => p.url().includes('shot.html')), 40000);
  check('screenshot: viewer opens', !!shotPage);
  if (shotPage) {
    watch(shotPage, 'shot');
    await shotPage.waitForFunction(() => document.getElementById('cv').width > 100 && document.getElementById('meta').innerText.includes('SHA-256'), { timeout: 20000 });
    const info = await shotPage.evaluate(() => {
      const cv = document.getElementById('cv'), g = cv.getContext('2d');
      const px = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      return { w: cv.width, h: cv.height, px1: px(300, 300), px2: px(300, 800), px3: px(300, 1300), px4: px(300, 1800), px5: px(300, 2300), px6: px(300, 2800), hdrTop: px(300, 20), hdrAgain: px(300, 1020), meta: document.getElementById('meta').innerText };
    });
    const rgb = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 6);
    check('screenshot: height is the whole page (3000px), width the viewport', info.w === 1000 && info.h === 3000, info.w + 'x' + info.h);
    check('screenshot: every 500px band is in the right place (no gaps, repeats or seams)', COLORS.every((c, i) => near([info.px1, info.px2, info.px3, info.px4, info.px5, info.px6][i], rgb(c))), JSON.stringify([info.px1, info.px2, info.px3]));
    check('screenshot: the fixed header appears once, at the top only', near(info.hdrTop, [0, 0, 0]) && !near(info.hdrAgain, [0, 0, 0]));
    check('screenshot: the page is restored (scroll position, hidden elements)', await article.evaluate(() => window.scrollY === 0 && !document.querySelector('[data-ko-hidden]') && !document.getElementById('__ko_shot_style')));
    check('screenshot: viewer shows time, size, SHA-256', /SHA-256/.test(info.meta) && /3000 px/.test(info.meta));

    // annotate: a redact box over band 1; marks are drawn, undo works
    await shotPage.select('#zoom', '1');
    const box = await (await shotPage.$('#cv')).boundingBox();
    await shotPage.click('button[data-tool="redact"]');
    await shotPage.mouse.move(box.x + 100, box.y + 100); await shotPage.mouse.down(); await shotPage.mouse.move(box.x + 300, box.y + 200, { steps: 4 }); await shotPage.mouse.up();
    const black = await shotPage.evaluate(() => [...document.getElementById('cv').getContext('2d').getImageData(150, 150, 1, 1).data.slice(0, 3)]);
    check('editor: Redact covers the area with solid black', black.every(v => v === 0) && !(await shotPage.$eval('#undo', b => b.disabled)));
    await shotPage.click('#undo');
    check('editor: Undo removes it', (await shotPage.evaluate(() => [...document.getElementById('cv').getContext('2d').getImageData(150, 150, 1, 1).data.slice(0, 3)])).some(v => v > 20));
    await shotPage.click('button[data-tool="redact"]');
    await shotPage.mouse.move(box.x + 100, box.y + 100); await shotPage.mouse.down(); await shotPage.mouse.move(box.x + 300, box.y + 200, { steps: 4 }); await shotPage.mouse.up();

    // seal it: signed + trusted timestamp from the local authority
    await shotPage.type('#case', 'Case 42'); await shotPage.type('#by', 'Tester'); for (const sel of ['#sign', '#stamp']) await shotPage.$eval(sel, e => { if (!e.checked) e.click(); });
    await shotPage.select('#tsa', ''); await shotPage.type('#tsaCustom', tsa.url);
    await shotPage.click('#seal');
    const sealed = await waitFor(async () => { const t = await shotPage.$eval('#sealStatus', e => e.textContent); return /Sealed|Couldn/.test(t) ? t : null; }, 40000);
    check('screenshot seal: reports success without warnings', /^Sealed and saved/.test(sealed || ''), sealed);
    const zip = await waitFor(async () => listFiles(dl).find(f => /Evidence screenshot.*\.zip$/.test(f)), 15000);
    check('screenshot seal: a .zip landed in Downloads', !!zip);
    if (zip) await verifyPackage(zip, ['screenshot-original.png', 'screenshot-marked.png', 'capture-info.json', 'manifest.sig', 'timestamp.tsr'], 'screenshot');
  }

  // ----- Sealed page capture with everything on
  const save = await browser.newPage(); watch(save, 'save');
  await save.goto(`chrome-extension://${extId}/save.html?tab=${tabId}`);
  await save.waitForSelector('#tab-capture', { timeout: 15000 });
  await save.click('#tab-capture');
  await save.waitForSelector('#capSign', { visible: true, timeout: 10000 });
  await sleep(600);
  await save.type('#capCase', 'Case 42');
  for (const sel of ['#capSign', '#capStamp']) await save.$eval(sel, e => { if (!e.checked) e.click(); });   // the choice is remembered from the screenshot seal
  await save.select('#capTsa', ''); await save.type('#capTsaCustom', tsa.url);
  await save.click('#capGo');
  const capText = await waitFor(async () => { const t = await save.$eval('#capStatus', e => e.textContent); return /^Sealed|^Couldn/.test(t) ? t : null; }, 60000);
  check('page capture: sealed, signed and trusted-timestamped', /^Sealed/.test(capText || '') && /signed/.test(capText) && /trusted time/.test(capText), capText);
  const capZip = await waitFor(async () => listFiles(dl).find(f => /Evidence – .*\.zip$/.test(f)), 15000);
  const dls = await W.evaluate(async () => (await chrome.downloads.search({})).map(d => ({ f: d.filename, s: d.state, e: d.error, u: d.url.slice(0, 40) })));
  check('page capture: package saved', !!capZip, JSON.stringify(dls) + ' | ' + listFiles(dl).map(f => path.relative(dl, f)).join(' | '));
  if (capZip) await verifyPackage(capZip, ['capture.mhtml', 'page-text.txt', 'page-details.json', 'headers.json', 'entities.csv', 'screenshot.png', 'manifest.sig', 'timestamp.tsr', 'signer-public-key.pem'], 'page');

  async function verifyPackage(zipPath, mustHave, label) {
    const out = path.join(tmp, 'unz-' + label);
    fs.mkdirSync(out, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', out]);
    const dir = path.join(out, fs.readdirSync(out)[0]);
    const names = fs.readdirSync(dir);
    check(label + ' package has: ' + mustHave.join(', '), mustHave.every(n => names.includes(n)), names.join(', '));
    check(label + ' package: sha256sum -c passes', spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: dir }).status === 0);
    const v = spawnSync('openssl', ['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'manifest.json'], { cwd: dir, encoding: 'utf8' });
    check(label + ' package: signature verifies with openssl', /Verified OK/.test(v.stdout), v.stdout + v.stderr);
    const t = spawnSync('openssl', ['ts', '-verify', '-data', 'manifest.json', '-in', 'timestamp.tsr', '-CAfile', tsa.caFile], { cwd: dir, encoding: 'utf8' });
    check(label + ' package: timestamp verifies with openssl', /Verification: OK/.test(t.stdout + t.stderr), t.stdout + t.stderr);
    if (label === 'page') {
      const hd = JSON.parse(fs.readFileSync(path.join(dir, 'headers.json'), 'utf8'));
      const det = JSON.parse(fs.readFileSync(path.join(dir, 'page-details.json'), 'utf8'));
      check('page package: headers have the server and no cookie value', hd.headers.server === 'nginx/1.25' && !JSON.stringify(hd).includes('TOPSECRET'));
      check('page package: details list technologies, hidden text and comments', det.technologies.some(x => x.name === 'nginx') && det.hidden_text.some(x => /wombats/.test(x.text)) && det.html_comments.some(x => /staging key/.test(x)));
      check('page package: entities.csv has the emails', /jane\.doe@example\.org/.test(fs.readFileSync(path.join(dir, 'entities.csv'), 'utf8')));
      const png = fs.readFileSync(path.join(dir, 'screenshot.png'));
      check('page package: screenshot.png is a PNG of the whole page', png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(20) >= 2999, 'height ' + png.readUInt32BE(20));
    }
  }

  check('no page errors in any Investigate / screenshot page', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close(); server.close(); tsa.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll investigate tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
