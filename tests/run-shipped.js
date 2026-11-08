// Loads the SHIPPED extension (unmodified manifest) and checks wiring: manifest validity, optional
// permissions, opening the Save page (and reusing it), and the player's new buttons.
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./fixture-site.js');
const CHROME = require('./chrome');
const EXT = path.join(__dirname, '../extension');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(120); } };

(async () => {
  const site = await start();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-extensions-except=' + EXT, '--load-extension=' + EXT], ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [EXT] });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const worker = await sw.worker();
  const extId = new URL(sw.url()).host;

  const m = await worker.evaluate(() => chrome.runtime.getManifest());
  check('shipped manifest loads (v' + m.version + ')', m.version === '1.6.0' && m.manifest_version === 3);
  check('downloads + all-sites are OPTIONAL (no new install warnings)', m.optional_permissions.includes('downloads') && m.optional_host_permissions.includes('https://*/*') && !m.permissions.includes('downloads') && !m.host_permissions);
  check('shortcuts registered', !!m.commands['save-page'] && !!m.commands['save-video'] && Object.values(m.commands).filter(c => c.suggested_key).length <= 4 && !!m.commands['toggle-notes'] && !!m.commands['highlight-selection'], Object.values(m.commands).filter(c => c.suggested_key).length + ' with default keys (max 4), ' + Object.keys(m.commands).length + ' total');
  const granted = await worker.evaluate(() => chrome.permissions.contains({ permissions: ['downloads'] }));
  check('downloads NOT granted until the user allows it', granted === false);

  const page = await browser.newPage();
  await page.goto(site.base + '/article', { waitUntil: 'networkidle0' });
  await page.bringToFront();
  const tab = await worker.evaluate(async () => { const t = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]; return { id: t.id, index: t.index }; });

  // openSave (what the menus / shortcuts call). Tabs are listed through the browser, because without the
  // "tabs" permission the extension itself can't read any tab's address.
  const saveTabs = async () => (await browser.pages()).map(p => p.url()).filter(u => u.includes('save.html'));
  await worker.evaluate(t => openSave(t, { view: 'video', frameId: 3, srcUrl: 'https://x.test/a.mp4' }), tab);
  let urls = await waitFor(async () => { const u = await saveTabs(); return u.length ? u : null; });
  check('openSave opens the Save page for that tab, video view', urls && urls.length === 1 && urls[0].includes('tab=' + tab.id) && urls[0].includes('view=video') && urls[0].includes('frame=3') && urls[0].includes('src='), urls && urls[0].replace(/chrome-extension:\/\/[a-z]+\//, ''));
  await worker.evaluate(t => openSave(t, { view: 'document', scope: 'selection' }), tab);
  await sleep(1000);
  urls = await saveTabs();
  check('a second request reuses the same tab (no duplicates)', urls.length === 1 && urls[0].includes('view=document') && urls[0].includes('scope=selection'), urls.length + ' Save tab(s)');
  // closing the Save tab forgets it, so the next request opens a fresh one
  const st = (await browser.pages()).find(p => p.url().includes('save.html'));
  await st.close(); await sleep(500);
  await worker.evaluate(t => openSave(t, { view: 'video' }), tab);
  urls = await waitFor(async () => { const u = await saveTabs(); return u.length ? u : null; });
  check('after closing it, a new request opens a new Save tab', urls && urls.length === 1 && urls[0].includes('view=video'));

  // Without permission the Save page must explain itself instead of failing silently.
  const save = (await browser.pages()).find(p => p.url().includes('save.html'));
  await sleep(1500);
  const ui = await save.evaluate(() => ({ banner: document.getElementById('access').classList.contains('show'), grant: document.getElementById('grant').textContent, paper: document.getElementById('paper').innerText.slice(0, 200) }));
  check('Save page shows the permission banner when it has none', ui.banner && ui.grant === 'Allow');
  check('and says why the page can\'t be read (not a blank/broken preview)', /allow access|can.t read that page/i.test(ui.paper), JSON.stringify(ui.paper));

  await browser.close(); site.server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
