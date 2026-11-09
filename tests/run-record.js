// Screen recorder in real Chromium: record this very tab (picker auto-accepted), pause/resume, stop, seal, verify.
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const listFiles = d => { const out = []; const walk = p => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, f.name); f.isDirectory() ? walk(fp) : out.push(fp); } }; if (fs.existsSync(d)) walk(d); return out; };

(async () => {
  const run = Date.now();
  const tmp = path.join(SP, 'rec-' + run), ext = path.join(tmp, 'ext'), dl = path.join(tmp, 'dl'), profile = path.join(tmp, 'profile');
  fs.mkdirSync(dl, { recursive: true }); fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.cpSync(path.join(__dirname, '../extension'), ext, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.host_permissions = ['<all_urls>']; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: dl, prompt_for_download: false }, savefile: { default_directory: dl } }));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    args: ['--no-sandbox', '--auto-accept-this-tab-capture', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-extensions-except=' + ext, '--load-extension=' + ext],
    ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext]
  });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto(`chrome-extension://${extId}/record.html`);
  await page.waitForSelector('#start');
  check('recorder page loads with Start enabled', await page.$eval('#start', b => !b.disabled));

  await page.$eval('#countdown', e => { e.checked = false; }); await page.$eval('#sysAudio', e => { e.checked = false; });
  await page.click('#start');
  const live = await waitFor(() => page.$eval('#live', e => !e.hidden).catch(() => false), 15000);
  check('recording starts (live view shown)', !!live, await page.$eval('#status', e => e.textContent));
  if (live) {
    await sleep(1800);
    await page.click('#pause');
    check('pause: button says Resume and the dot stops blinking', (await page.$eval('#pause', e => e.textContent)) === 'Resume' && await page.$eval('#dot', e => e.classList.contains('paused')));
    await sleep(1500);
    await page.click('#pause');
    await sleep(1200);
    await page.click('#stop');
    const done = await waitFor(() => page.$eval('#done', e => !e.hidden).catch(() => false), 15000);
    check('stopping shows the finished recording with a player', !!done && await page.$eval('#player', v => !!v.src));
    await waitFor(() => page.$eval('#info', e => e.textContent.includes('SHA-256') && /[0-9a-f]{64}/.test(e.textContent)), 10000);
    const info = await page.$eval('#info', e => e.innerText);
    console.log('   ' + info.replace(/\n/g, ' | ').replace(/\t/g, ' '));
    check('info: pause left out of the length (about 3s of ~4.5s), a size and a SHA-256', /Length\s+0:0[2-4]/.test(info) && /1 pause/.test(info) && /[0-9a-f]{64}/.test(info), info.slice(0, 120));

    // closing the tab with an unsaved recording asks first; once saved it doesn't
    const asks = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
    check('unsaved recording: closing the tab asks first', await asks());

    // save
    await page.click('#save');
    const saved = await waitFor(() => listFiles(dl).find(f => /^Recording - .*\.(webm|mp4)$/.test(path.basename(f))), 10000);
    check('Save writes the video to Downloads', !!saved && fs.statSync(saved).size > 1000, saved && path.basename(saved));
    check('saved recording: closing the tab no longer asks', !(await asks()));
    if (saved) {
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', saved], { encoding: 'utf8' });
      check('the saved file is a real, decodable video (ffprobe)', probe.status === 0 && /\d+,\d+/.test(probe.stdout.replace(/\n/g, ',')), probe.stdout.trim() + probe.stderr.slice(0, 100));
      const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', saved, '-f', 'null', '-'], { encoding: 'utf8' });
      check('every frame decodes without errors', dec.status === 0 && dec.stderr.trim() === '', dec.stderr.slice(0, 160));
      const sha = require('crypto').createHash('sha256').update(fs.readFileSync(saved)).digest('hex');
      check('the SHA-256 shown equals the saved file’s', (await page.$eval('#info', e => e.textContent)).includes(sha));
    }

    // seal: signed
    await page.type('#case', 'Case 9'); await page.type('#by', 'Tester');
    await page.$eval('#sign', e => { if (!e.checked) e.click(); }); await page.$eval('#stamp', e => { if (e.checked) e.click(); });
    await page.click('#seal');
    const sealed = await waitFor(async () => { const t = await page.$eval('#sealStatus', e => e.textContent); return /Sealed|Couldn/.test(t) ? t : null; }, 40000);
    check('seal: reports success', /^Sealed and saved/.test(sealed || ''), sealed);
    const zip = await waitFor(() => listFiles(dl).find(f => /Evidence recording.*\.zip$/.test(f)), 15000);
    check('seal: a .zip landed in Downloads', !!zip);
    if (zip) {
      const out = path.join(tmp, 'unz'); fs.mkdirSync(out);
      execFileSync('unzip', ['-q', zip, '-d', out]);
      const dir = path.join(out, fs.readdirSync(out)[0]);
      const names = fs.readdirSync(dir);
      check('package: recording, recording-info.json, manifest, signature, custody', names.some(n => /^Recording - .*\.(webm|mp4)$/.test(n)) && ['recording-info.json', 'manifest.json', 'manifest.sig', 'signer-public-key.pem', 'chain-of-custody.md', 'SHA256SUMS'].every(n => names.includes(n)), names.join(', '));
      check('package: sha256sum -c passes', spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: dir }).status === 0);
      const v = spawnSync('openssl', ['dgst', '-sha256', '-verify', 'signer-public-key.pem', '-signature', 'manifest.sig', 'manifest.json'], { cwd: dir, encoding: 'utf8' });
      check('package: signature verifies with openssl', /Verified OK/.test(v.stdout), v.stdout + v.stderr);
      const ri = JSON.parse(fs.readFileSync(path.join(dir, 'recording-info.json'), 'utf8'));
      check('recording-info: times, 1 pause, source kind, no sound, hash of the recording', ri.pauses === 1 && ri.recorded_seconds > 2 && ri.recorded_seconds < 5 && ri.source.kind && ri.audio.screen_or_tab_sound === false && /^[0-9a-f]{64}$/.test(ri.sha256_of_recording), JSON.stringify({ s: ri.recorded_seconds, k: ri.source.kind }));
    }
    // record again resets the page
    await page.click('#again');
    check('Record again returns to the start', await page.$eval('#idle', e => !e.hidden));
  }

  // a second take works after "Record again"
  await page.$eval('#countdown', e => { e.checked = false; });
  await page.click('#start');
  await waitFor(() => page.$eval('#live', e => !e.hidden).catch(() => false), 15000);
  await sleep(1200);
  await page.click('#stop');
  check('a second recording completes', !!(await waitFor(() => page.$eval('#done', e => !e.hidden).catch(() => false), 15000)));

  // sharing stopped from the browser's own bar during the countdown: back to the start, nothing recorded
  await page.click('#again');
  await page.evaluate(() => { const g = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getDisplayMedia = async o => (window.__ds = await g(o)); });
  await page.$eval('#countdown', e => { if (!e.checked) e.click(); });
  await page.click('#start');
  const counting = await waitFor(() => page.$eval('#counting', e => !e.hidden).catch(() => false), 15000);
  check('countdown is shown', !!counting);
  await page.evaluate(() => window.__ds.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await sleep(300);
  check('sharing stopped during the countdown: back to the start with an explanation, no recording', await page.$eval('#idle', e => !e.hidden) && /nothing was recorded/.test(await page.$eval('#status', e => e.textContent)));
  await sleep(3500);
  check('and no recording starts afterwards', await page.$eval('#idle', e => !e.hidden) && await page.$eval('#live', e => e.hidden));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll record tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
