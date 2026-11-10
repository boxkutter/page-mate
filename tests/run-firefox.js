// The Firefox build, in real Firefox: it installs, the event page runs, the toolbox opens, the reader plays audio through the
// background page and keeps playing past Firefox's idle timeout, Save page reads a page, a screenshot is taken, and the evidence
// snapshot (Firefox has no MHTML capture) is safe and complete.
//
// Needs Firefox 128+ (set FIREFOX=/path/to/firefox if it isn't found). Extension pages can only be driven with
// MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1, which this sets for the test browser only. As in the Chromium tests, a COPY of the build is made
// with all-sites access granted, because a permission prompt can't be clicked headlessly.
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { build } = require('../scripts/build.js');
const { start } = require('./fixture-site.js');
const FIREFOX = require('./firefox');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const UUID = '11111111-2222-4333-8444-555555555555';
const GECKO_ID = 'pagemate@boxkutter.github.io';
const IDLE_MS = 12000;   // Firefox's real limit is 30s; shortened so the test can show the audio frame outlives it

(async () => {
  // ----- the package itself
  const built = build('firefox');
  const m = built.manifest;
  check('Firefox manifest: event page scripts, no service worker', m.background.scripts && m.background.scripts[m.background.scripts.length - 1] === 'background.js' && !m.background.service_worker);
  check('Firefox manifest: lists the helper files background.js would importScripts', ['common.js', 'osint-core.js', 'shot-core.js', 'shot-store.js', 'notes-core.js', 'shot-notes.js'].every(f => m.background.scripts.includes(f)));
  check('Firefox manifest: gecko id and minimum version', m.browser_specific_settings.gecko.id === GECKO_ID && parseFloat(m.browser_specific_settings.gecko.strict_min_version) >= 128);
  check('Firefox manifest: no Chromium-only permissions', !m.permissions.includes('offscreen') && !(m.optional_permissions || []).includes('pageCapture') && !m.minimum_chrome_version);
  const chromium = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json')));
  check('Chromium manifest is untouched (service worker, offscreen)', chromium.background.service_worker === 'background.js' && chromium.permissions.includes('offscreen'));

  const tmp = fs.mkdtempSync(path.join(process.env.SCRATCH || os.tmpdir(), 'pm-ff-'));
  const ext = path.join(tmp, 'ext');
  fs.cpSync(built.dir, ext, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.host_permissions = ['<all_urls>'];
  delete mf.optional_host_permissions;
  mf.permissions.push('downloads', 'tabs');
  mf.web_accessible_resources = [{ resources: ['*'], matches: ['<all_urls>'] }];   // lets the test open the extension's pages (BiDi can't navigate to them directly)
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

  // ----- a stand-in Kokoro server: every request gets ~20 seconds of speech
  const mp3 = fs.readFileSync(path.join(__dirname, 'hls-fixture/lecture.mp3'));
  const speech = Buffer.concat([mp3, mp3, mp3, mp3]);
  let speechRequests = 0;
  const kokoro = http.createServer((req, res) => {
    req.resume();
    if (req.method === 'POST') speechRequests++;
    res.writeHead(200, { 'content-type': req.method === 'POST' ? 'audio/mpeg' : 'application/json' });
    res.end(req.method === 'POST' ? speech : '{}');
  });
  await new Promise(r => kokoro.listen(0, '127.0.0.1', r));
  const kbase = 'http://127.0.0.1:' + kokoro.address().port;
  const site = await start();

  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: FIREFOX, headless: true, env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: { 'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: UUID }), 'extensions.background.idle.timeout': IDLE_MS }
  });
  const X = `moz-extension://${UUID}/`;
  const errors = [];
  try {
    check('Firefox installs the add-on', (await browser.installExtension(ext)) === GECKO_ID);

    const ext0 = await browser.newPage();
    await ext0.goto(site.base + '/article');
    await ext0.evaluate(u => { location.href = u; }, X + 'options.html');
    await waitFor(async () => (await ext0.title()).includes('PageMate'));
    check('settings page opens and knows it is Firefox', await ext0.evaluate(() => KR_FIREFOX === true));

    const page = await browser.newPage();
    page.on('pageerror', e => errors.push('page: ' + e.message));
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(site.base + '/article');
    await sleep(500);
    const tabId = await ext0.evaluate(async b => (await chrome.tabs.query({})).find(t => (t.url || '').startsWith(b)).id, site.base);
    // The background is an event page: its functions can be called from an extension page, as the Chromium tests do through the worker.
    const bg = (fn, ...args) => ext0.evaluate(`(async () => { const bg = chrome.extension.getBackgroundPage(); const tab = await chrome.tabs.get(${tabId}); return (${fn.toString()})(bg, tab, ...${JSON.stringify(args)}); })()`);
    check('the background event page is running', await ext0.evaluate(() => !!chrome.extension.getBackgroundPage()));
    check('background answers messages (from a tab page)', (await ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'ko-dock-commands' }))).commands.some(c => c.name === 'read-page'));
    const sc = await ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'ko-open-shortcuts' }));
    check('"set shortcuts" opens the shortcuts settings or explains where they are', sc && (sc.ok === true || /Add-ons Manager/.test(sc.error || '')), JSON.stringify(sc));

    // ----- right-click menus: one bad context makes Firefox reject the entry (and the install handler stops), so register each kind used
    const bgSource = fs.readFileSync(path.join(ext, 'background.js'), 'utf8');
    const used = [...new Set([...bgSource.matchAll(/contexts: \[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])))];
    const menuErrors = await ext0.evaluate(async list => {
      const bad = [];
      for (const c of list) { try { await new Promise((res, rej) => chrome.contextMenus.create({ id: 'probe-' + c, title: 'probe', contexts: [c] }, () => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res())); } catch (e) { bad.push(c + ': ' + e.message); } }
      return bad;
    }, used);
    check('every right-click menu context PageMate uses is accepted by Firefox', used.length >= 6 && menuErrors.length === 0, used.join(',') + ' ' + menuErrors.join(' | '));

    // ----- the toolbox
    await bg((b, tab) => b.toggleDock(tab));
    const tiles = await waitFor(() => page.evaluate(() => { const h = document.getElementById('ko-dock-host'); return h ? [...h.shadowRoot.querySelectorAll('.tile')].map(t => t.dataset.tile) : null; }));
    check('the floating toolbox opens in the page with every tool', tiles && ['read', 'notes', 'savePage', 'saveVideo', 'saveAudio', 'saveImages', 'shot', 'record', 'investigate', 'lookup', 'archive', 'share'].every(t => tiles.includes(t)), JSON.stringify(tiles));

    // ----- reading aloud: the audio plays in a frame inside the background page
    await ext0.evaluate(b => chrome.storage.sync.set({ serverUrl: b }), kbase);
    const started = await ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'kr-start', session: 'ff1', chunks: ['First sentence to read.', 'Second sentence to read.'], startIndex: 0 }));
    check('reading starts (audio frame created in the background page)', started && started.ok === true, JSON.stringify(started));
    check('the page asked the speech server for audio', !!(await waitFor(() => speechRequests >= 1, 8000)), 'requests: ' + speechRequests);
    const status = () => ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'kr-control', action: 'status', session: 'ff1' }));
    let st = await status();
    check('audio is playing the first chunk', st && st.ok && st.index === 0 && !st.paused && !st.finished, JSON.stringify(st));
    const pausedOk = await ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'kr-control', action: 'pause', session: 'ff1' }));
    st = await status();
    check('pause works', pausedOk && pausedOk.ok && st.paused === true, JSON.stringify(st));
    await ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'kr-control', action: 'resume', session: 'ff1' }));
    // No messages for longer than the idle limit: the audio frame's keep-alive must stop Firefox unloading the background page.
    await sleep(IDLE_MS + 4000);
    st = await status();
    check('audio keeps playing past the idle timeout (background page not unloaded)', st && st.ok === true && st.index === 0 && st.paused === false, JSON.stringify(st));
    await ext0.evaluate(() => chrome.runtime.sendMessage({ type: 'kr-control', action: 'stop', session: 'ff1' }));
    await sleep(600);
    st = await status();
    check('stopping ends the session and removes the audio frame', st && st.ok === false, JSON.stringify(st));

    // ----- Save page
    const save = await browser.newPage();
    save.on('pageerror', e => errors.push('save: ' + e.message));
    await save.goto(site.base + '/article');
    await save.evaluate(u => { location.href = u; }, X + 'save.html?tab=' + tabId);
    const painted = await waitFor(() => save.evaluate(() => !!document.querySelector('.kr-doc .kr-title')), 20000);
    const prev = painted && await save.evaluate(() => ({ title: document.querySelector('.kr-title').textContent, h2: [...document.querySelectorAll('.kr-doc h2')].map(h => h.textContent), text: document.querySelector('#paper').innerText }));
    check('Save page previews the page (title, headings)', prev && prev.title.includes('Modal Interchange') && prev.h2.includes('Chords to know'), prev && prev.title);
    check('Save page leaves site chrome out', prev && !/Footer links|Sidebar link|Hidden text/.test(prev.text));
    const hasMhtmlOption = await save.evaluate(() => typeof chrome.pageCapture);
    check('this browser has no pageCapture (so the HTML snapshot path is the one in use)', hasMhtmlOption === 'undefined', hasMhtmlOption);

    // ----- evidence snapshot (no MHTML in Firefox)
    const snap = await save.evaluate(async id => (await chrome.scripting.executeScript({ target: { tabId: id }, func: KOPage.snapshotHtml }))[0].result, tabId);
    check('evidence snapshot is a complete HTML document of the page', /^<!doctype html>/i.test(snap) && snap.includes('Modal Interchange') && snap.includes('Chords to know'));
    check('evidence snapshot switches off scripts and keeps links pointing at the original site', /Content-Security-Policy[^>]*script-src 'none'/i.test(snap) && /<base href="http:\/\/127\.0\.0\.1:\d+\//.test(snap));
    check('evidence snapshot records where and when it was taken', /Captured by PageMate from http:\/\/127\.0\.0\.1:\d+\/article at \d{4}-\d\d-\d\dT/.test(snap));
    // the live page itself must be untouched by taking it
    check('taking the snapshot did not change the live page', await page.evaluate(() => !document.querySelector('meta[http-equiv="Content-Security-Policy"]') && !document.querySelector('head > base')));

    // ----- screenshot
    const shot = await bg(async (b, tab) => { const r = await b.captureTab(tab.windowId); return { w: r.width, h: r.height }; });
    check('the visible part of the tab can be captured', shot && shot.w > 100 && shot.h > 100, JSON.stringify(shot));

    // ----- the recorder page can see the screen-capture API
    const rec = await browser.newPage();
    await rec.goto(site.base + '/article');
    await rec.evaluate(u => { location.href = u; }, X + 'record.html');
    await waitFor(() => rec.evaluate(() => !!document.getElementById('start')), 10000);
    check('the Record page loads and sees getDisplayMedia + MediaRecorder', await rec.evaluate(() => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder && !document.getElementById('start').disabled)));

    const real = errors.filter(e => !/ERR_NAME_NOT_RESOLVED|NS_ERROR_UNKNOWN_HOST/.test(e));
    check('no uncaught errors on the pages', real.length === 0, real.join(' | '));
  } catch (e) {
    check('test ran to the end', false, e && e.stack || String(e));
  } finally {
    try { await browser.close(); } catch (_) {}
    kokoro.close();
    if (site.server && site.server.close) site.server.close();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
