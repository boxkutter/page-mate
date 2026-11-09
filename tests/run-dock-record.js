// The screen recorder inside the floating toolbox, in real Chromium: choosing Record replaces the tool icons with recorder
// controls, Back / Esc returns to the icons, and a real recording is made (the picker is auto-accepted with the test flags),
// paused, stopped, saved, sealed (signed, with a relayed trusted timestamp) and verified with ffprobe / sha256sum / openssl.
// (A copy of the extension is made with all-sites access granted because a permission prompt can't be clicked headlessly.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { execFileSync, spawnSync } = require('child_process');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const listFiles = d => { const out = []; const walk = p => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, f.name); f.isDirectory() ? walk(fp) : out.push(fp); } }; if (fs.existsSync(d)) walk(d); return out; };

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Recorder Test Page</title></head><body style="margin:0;font:18px system-ui"><div style="height:1500px;background:linear-gradient(#fff,#c97);padding:20px"><h1>Hello</h1><p>Something to record.</p></div></body></html>';

(async () => {
  const run = Date.now();
  const tmp = path.join(SP, 'dockrec-' + run), ext = path.join(tmp, 'ext'), dl = path.join(tmp, 'dl'), profile = path.join(tmp, 'profile');
  fs.mkdirSync(dl, { recursive: true }); fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.cpSync(path.join(__dirname, '../extension'), ext, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.host_permissions = ['<all_urls>']; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: dl, prompt_for_download: false }, savefile: { default_directory: dl } }));
  const tsa = await require('./tsa-fixture.js')(fs.mkdtempSync(path.join(tmp, 'tsa-')));

  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    args: ['--no-sandbox', '--auto-accept-this-tab-capture', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-extensions-except=' + ext, '--load-extension=' + ext],
    ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext]
  });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const X = `chrome-extension://${new URL(sw.url()).host}/`;
  const errors = [];
  const ext0 = await browser.newPage();
  await ext0.goto(X + 'options.html');
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('page: ' + e.message));
  await page.setViewport({ width: 1000, height: 700 });
  await page.goto(base + '/');
  await page.bringToFront();
  const tabId = await ext0.evaluate(async u => (await chrome.tabs.query({})).find(t => (t.url || '').startsWith(u)).id, base);
  await ext0.evaluate(u => chrome.storage.sync.set({ tsaUrl: u }), tsa.url);

  const callBg = async (fnSrc, ...args) => {
    const t = await browser.waitForTarget(x => x.type() === 'service_worker' && /background\.js/.test(x.url()), { timeout: 10000 });
    return (await t.worker()).evaluate(fnSrc, ...args);
  };
  const state = () => page.evaluate(() => {
    const h = document.getElementById('ko-dock-host'); if (!h) return null;
    const r = h.shadowRoot, vis = e => !!e && !e.hidden;
    return { open: !r.querySelector('.dock').hidden, grid: vis(r.querySelector('.grid')), rec: vis(r.querySelector('.recpane')), text: r.querySelector('.recpane').textContent.replace(/\s+/g, ' ').trim(), focus: r.activeElement && (r.activeElement.dataset.tile || r.activeElement.textContent.trim().slice(0, 20)) };
  });
  const btn = async label => { for (const h of await page.$$('pierce/.recpane .btn')) if ((await h.evaluate(e => e.textContent.replace(/[A-Z]$/, '').trim())) === label) return h; return null; };
  const recText = async () => (await state()).text;
  const popups = () => ext0.evaluate(async () => (await chrome.windows.getAll({ populate: true })).filter(w => w.type === 'popup').map(w => (w.tabs || []).map(t => t.url).join(' ')));
  const press = k => page.keyboard.press(k);

  // ============ switching to the recorder and back ============
  await callBg(async id => toggleDock(await chrome.tabs.get(id)), tabId);
  await waitFor(async () => (await state()) && (await state()).open, 8000);
  let s = await state();
  check('the toolbox shows its tool icons', s.open && s.grid && !s.rec, JSON.stringify({ open: s.open, grid: s.grid, rec: s.rec }));
  await press('e');
  s = await state();
  check('choosing Record replaces the tool icons with the recorder', s.rec && !s.grid, JSON.stringify({ grid: s.grid, rec: s.rec }));
  check('…it offers the options and a Start button', /Record screen/.test(s.text) && /Microphone/.test(s.text) && /Start recording/.test(s.text) && /countdown/.test(s.text), s.text.replace(/\n/g, ' | ').slice(0, 120));
  check('…Start has the keyboard focus', s.focus === 'Start recording' || /Start/.test(s.focus || ''), s.focus);
  const small = await page.evaluate(() => { const r = document.getElementById('ko-dock-host').shadowRoot.querySelector('.dock').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  check('the box stays small while recording options are shown', small.w <= 270 && small.h < 360, JSON.stringify(small));
  check('no recorder window or tab was opened', !(await popups()).some(u => /record\.html/.test(u)));
  await press('Escape');
  s = await state();
  check('Esc goes back to the tool icons', s.grid && !s.rec);
  await press('e');
  await page.click('pierce/[data-act="close"]');
  await page.bringToFront();
  s = await state();
  check('× hides the box (even with the recorder showing)', !s.open);
  await callBg(async id => toggleDock(await chrome.tabs.get(id)), tabId);
  await waitFor(async () => (await state()).open, 5000);
  s = await state();
  check('…the recorder is still there when the box is shown again', s.rec && !s.grid);
  await page.click('pierce/.recpane .ph .ib');
  s = await state();
  check('the back arrow returns to the tool icons', s.grid && !s.rec);
  await page.click('pierce/[data-tile="record"]');
  s = await state();
  check('clicking the Record icon opens it too', s.rec && !s.grid);

  // ============ options, then a real recording ============
  const boxes = async () => page.$$eval('pierce/.recpane input[type=checkbox]', is => is.map(i => i.checked));
  let cb = await boxes();
  check('options default to: screen sound on, microphone off, countdown on', cb[0] === true && cb[1] === false && cb[2] === true, JSON.stringify(cb));
  const checks = await page.$$('pierce/.recpane input[type=checkbox]');
  await checks[0].click(); await checks[2].click();                 // no screen sound, no countdown (keeps the test quick)
  cb = await boxes();
  check('options can be changed (and are remembered)', cb[0] === false && cb[2] === false && !!(await ext0.evaluate(async () => (await chrome.storage.local.get('ko:recOpts'))['ko:recOpts'])));
  await (await btn('Start recording')).click();
  const live = await waitFor(async () => /Recording/.test(await recText()) && /Stop/.test(await recText()), 15000);
  check('Start asks the browser to share and begins recording (controls replace the options)', !!live, (await recText()).replace(/\n/g, ' | ').slice(0, 100));
  const live2 = await state();
  check('the tool icons stay hidden while recording', !live2.grid && live2.rec);
  await sleep(1500);
  const t1 = (await recText()).match(/(\d+:\d\d)/);
  check('a running clock and size are shown', !!t1 && /so far/.test(await recText()), t1 && t1[1]);
  // the icons' letters must not fire while recording (V would open Video downloads, O All my notes)
  await page.bringToFront();
  await press('v'); await press('o'); await sleep(900);
  check('tool letters do nothing during a recording', !(await popups()).some(u => /save\.html|notes\.html/.test(u)) && /Recording/.test(await recText()));
  const asked = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  check('leaving the page while recording asks first', asked);
  await (await btn('Pause')).click();
  check('Pause shows Paused and offers Resume', /Paused/.test(await recText()) && !!(await btn('Resume')));
  await sleep(1200);
  await (await btn('Resume')).click();
  await sleep(1200);
  await (await btn('Stop')).click();
  const done = await waitFor(async () => /Recording done/.test(await recText()), 20000);
  check('Stop shows the finished recording', !!done);
  await waitFor(async () => /SHA-256: [0-9a-f]{16}/.test(await recText()), 10000);
  const dtxt = await recText();
  console.log('   ' + dtxt.replace(/\n/g, ' | '));
  check('summary: length, size, dimensions, type, fingerprint', /\d+:\d\d/.test(dtxt) && /(KB|MB)/.test(dtxt) && /\d+×\d+/.test(dtxt) && /WEBM/.test(dtxt) && /SHA-256: [0-9a-f]{16}/.test(dtxt));
  check('offers Save, Seal…, Discard and Record again', !!(await btn('Save')) && !!(await btn('Seal…')) && !!(await btn('Discard')) && !!(await btn('Record again')));

  // ---- save
  await (await btn('Save')).click();
  const saved = await waitFor(() => listFiles(dl).find(f => /^Recording - .*\.webm$/.test(path.basename(f))), 10000);
  check('Save writes the video to Downloads', !!saved && fs.statSync(saved).size > 1000, saved && path.basename(saved));
  if (saved) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', saved], { encoding: 'utf8' });
    check('the saved file is a real, decodable video (ffprobe)', probe.status === 0 && /\d+,\d+/.test(probe.stdout.replace(/\n/g, ',')), probe.stdout.trim());
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', saved, '-f', 'null', '-'], { encoding: 'utf8' });
    // (a browser-made WebM with a pause in it can trigger ffmpeg's harmless "non monotonically increasing dts" muxer warning; any other message is a failure)
    const decErr = dec.stderr.split('\n').filter(l => l.trim() && !/non monotonically increasing dts/.test(l)).join('\n');
    check('every frame decodes without errors', dec.status === 0 && decErr === '', decErr.slice(0, 120));
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(saved)).digest('hex');
    check('the fingerprint shown matches the saved file’s SHA-256', (await recText()).includes('SHA-256: ' + sha.slice(0, 16)));
  }
  check('saved recording: leaving the page no longer asks', !(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))));

  // ---- seal: signed + relayed trusted timestamp
  await (await btn('Seal…')).click();
  check('Seal… shows a small form in the box', /Seal as evidence/.test(await recText()) && !!(await page.$('pierce/.recpane input[placeholder^="Case"]')));
  await page.type('pierce/.recpane input[placeholder^="Case"]', 'Case 77'); await page.type('pierce/.recpane input[placeholder="Captured by"]', 'Tester');
  const sealBoxes = await page.$$('pierce/.recpane input[type=checkbox]');
  if (!(await sealBoxes[0].evaluate(e => e.checked))) await sealBoxes[0].click();
  if (!(await sealBoxes[1].evaluate(e => e.checked))) await sealBoxes[1].click();
  await (await btn('Seal and save .zip')).click();
  const sealed = await waitFor(async () => { const t = await recText(); return /Sealed and saved|Couldn/.test(t) ? t : null; }, 40000);
  check('sealing reports success', /Sealed and saved/.test(sealed || ''), (sealed || '').replace(/\n/g, ' | ').slice(-160));
  const zip = await waitFor(() => listFiles(dl).find(f => /Evidence recording.*\.zip$/.test(f)), 15000);
  check('a sealed .zip landed in Downloads', !!zip);
  if (zip) {
    const out = path.join(tmp, 'unz'); fs.mkdirSync(out);
    execFileSync('unzip', ['-q', zip, '-d', out]);
    const dir = path.join(out, fs.readdirSync(out)[0]);
    const names = fs.readdirSync(dir);
    check('package: recording, info, manifest, signature, timestamp, custody', names.some(n => /^Recording - .*\.webm$/.test(n)) && ['recording-info.json', 'manifest.json', 'manifest.sig', 'signer-public-key.pem', 'timestamp.tsr', 'chain-of-custody.md', 'SHA256SUMS'].every(n => names.includes(n)), names.join(', '));
    check('package: sha256sum -c passes', spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: dir }).status === 0);
    const v = spawnSync('openssl', ['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'manifest.json'], { cwd: dir, encoding: 'utf8' });
    check('package: signature verifies with openssl', /Verified OK/.test(v.stdout), v.stdout + v.stderr);
    const t = spawnSync('openssl', ['ts', '-verify', '-data', 'manifest.json', '-in', 'timestamp.tsr', '-CAfile', tsa.caFile], { cwd: dir, encoding: 'utf8' });
    check('package: the trusted timestamp (asked for through the extension) verifies with openssl', /Verification: OK/.test(t.stdout + t.stderr), (t.stdout + t.stderr).trim().slice(0, 100));
    const ri = JSON.parse(fs.readFileSync(path.join(dir, 'recording-info.json'), 'utf8'));
    check('recording-info: times, source kind, no sound, hash of the recording', ri.recorded_seconds > 1 && ri.source.kind && ri.audio.screen_or_tab_sound === false && /^[0-9a-f]{64}$/.test(ri.sha256_of_recording), JSON.stringify({ s: ri.recorded_seconds, k: ri.source.kind }));
    const mani = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    check('manifest: case and name recorded, kind is screen recording', mani.case === 'Case 77' && mani.captured_by === 'Tester' && (mani.extra || {}).kind === 'screen recording', JSON.stringify({ c: mani.case, b: mani.captured_by }));
  }
  // an unreachable timestamp server is reported, not hidden
  tsa.setMode('down');
  await page.bringToFront();
  const again = await btn('Seal and save .zip');
  if (again) { await again.click(); const warn = await waitFor(async () => /No trusted timestamp|Couldn/.test(await recText()), 30000); check('a timestamp server that is down is reported', !!warn, (await recText()).replace(/\n/g, ' | ').slice(-140)); }
  tsa.setMode('good');

  // ---- leaving
  await page.click('pierce/.recpane .ph .ib');
  s = await state();
  check('after saving, the back arrow goes straight back to the tool icons', s.grid && !s.rec);

  // ============ throw-away and unsaved confirmation ============
  await page.click('pierce/[data-tile="record"]');
  await (await btn('Start recording')).click();
  await waitFor(async () => /Stop/.test(await recText()), 15000);
  await sleep(1200);
  await (await btn('Stop')).click();
  await waitFor(async () => /Recording done/.test(await recText()), 20000);
  check('unsaved recording: leaving the page asks first', await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))));
  await page.click('pierce/.recpane .ph .ib');
  check('the back arrow asks before throwing an unsaved recording away', /Throw it away/.test(await recText()) && !!(await btn('Keep it')));
  await (await btn('Keep it')).click();
  check('Keep it returns to the summary', /Recording done/.test(await recText()));
  await page.click('pierce/.recpane .ph .ib');
  await (await btn('Throw away')).click();
  s = await state();
  check('Throw away goes back to the idle recorder', /Start recording/.test(s.text) || s.grid);
  await press('Escape'); s = await state();
  check('Esc then returns to the tool icons', s.grid && !s.rec);

  // ============ other ways in ============
  await callBg(async id => runCommand('record-screen', await chrome.tabs.get(id)), tabId);
  await sleep(800);
  s = await state();
  check('the “Record screen” shortcut shows the recorder in the box', s.rec && !s.grid && !(await popups()).some(u => /record\.html/.test(u)));
  await press('Escape');

  const prot = await browser.newPage(); await prot.goto('chrome://version/'); await prot.bringToFront();
  const protId = await ext0.evaluate(async () => (await chrome.tabs.query({ active: true, windowType: 'normal' }))[0].id);
  await callBg(async id => runTool('record', await chrome.tabs.get(id)), protId);
  check('on a browser page (no box possible) the recorder window opens instead', !!(await waitFor(async () => (await popups()).find(u => /record\.html/.test(u)), 12000)));
  await prot.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close(); tsa.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll dock-recorder tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
