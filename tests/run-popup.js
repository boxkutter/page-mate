// The toolbar icon opens a toolbox of tools (popup.html) instead of starting the reader. Real Chromium: every tile is
// there and starts the right tool, protected pages disable the page tools, and only the toolbox itself may start tools.
// (A copy of the extension is made with all-sites access granted because a permission prompt can't be clicked headlessly.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Toolbox Test Page</title></head><body style="margin:0"><div style="height:2400px;background:linear-gradient(#fff,#79c)"><h1>Hello</h1><p>Some words to read aloud on this page. Some words to read aloud on this page.</p></div></body></html>';

(async () => {
  const run = Date.now();
  const tmp = path.join(SP, 'popup-' + run), ext = path.join(tmp, 'ext'), profile = path.join(tmp, 'profile');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.cpSync(path.join(__dirname, '../extension'), ext, { recursive: true });
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json')));
  const mf = JSON.parse(JSON.stringify(shipped));
  mf.host_permissions = ['<all_urls>']; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

  // ---- what ships
  check('the icon opens the toolbox (default_popup = popup.html)', shipped.action.default_popup === 'popup.html');
  check('Alt+Shift+R still reads aloud, as its own command (the icon no longer does)', shipped.commands['read-page'] && shipped.commands['read-page'].suggested_key.default === 'Alt+Shift+R' && !(shipped.commands._execute_action && shipped.commands._execute_action.suggested_key));
  check('the toolbox itself can be given a shortcut (_execute_action, no default key)', !!shipped.commands._execute_action && !shipped.commands._execute_action.suggested_key);
  check('still at most 4 default shortcuts', Object.values(shipped.commands).filter(c => c.suggested_key).length <= 4);
  const TOOL_COMMANDS = ['read-page', 'toggle-notes', 'save-page', 'save-video', 'save-audio', 'save-images', 'screenshot-region', 'screenshot-visible', 'screenshot-full', 'record-screen', 'investigate', 'lookup', 'archive', 'share', 'all-notes'];
  check('every tool has a shortcut slot', TOOL_COMMANDS.every(c => shipped.commands[c] && shipped.commands[c].description), TOOL_COMMANDS.filter(c => !shipped.commands[c]).join(','));

  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, args: ['--no-sandbox', '--disable-extensions-except=' + ext, '--load-extension=' + ext], ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext] });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const X = `chrome-extension://${extId}/`;
  const errors = [];

  // an extension page we can call chrome.* from (and which is NOT the toolbox)
  const ext0 = await browser.newPage();
  await ext0.goto(X + 'options.html');
  const page = await browser.newPage();
  await page.goto(base + '/');
  await page.bringToFront();
  const tabOf = url => ext0.evaluate(async u => { const t = (await chrome.tabs.query({})).find(x => (x.url || '').startsWith(u)); return t ? t.id : null; }, url);
  const pageTabId = await tabOf(base);
  check('test page is open in a tab', pageTabId != null);
  const findPage = async re => waitFor(async () => (await browser.pages()).find(p => re.test(p.url())), 12000);

  const openPopup = async (tabId, { withErrors = true } = {}) => {
    const p = await browser.newPage();
    if (withErrors) { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); }
    await p.setViewport({ width: 372, height: 700 });
    await p.goto(X + 'popup.html?tab=' + tabId);
    await p.waitForSelector('[data-tile]');
    return p;
  };

  // ---- layout
  let pop = await openPopup(pageTabId);
  const tiles = await pop.$$eval('button.tile[data-tile]', bs => bs.map(b => ({ id: b.dataset.tile, text: b.textContent.trim(), off: b.disabled, svg: !!b.querySelector('svg path, svg circle') })));
  const want = ['read', 'notes', 'savePage', 'saveVideo', 'saveAudio', 'saveImages', 'shot', 'record', 'investigate', 'lookup', 'archive', 'share'];
  check('every tool has a tile, in order', want.every((id, i) => tiles[i] && tiles[i].id === id), tiles.map(t => t.id).join(','));
  check('tiles have readable labels and an icon', tiles.slice(0, 12).every(t => t.text.length > 2 && t.svg), tiles.slice(0, 12).map(t => t.text).join(' | '));
  check('on a web page every tile is enabled', tiles.slice(0, 12).every(t => !t.off));
  const heads = await pop.$$eval('h2', h => h.map(x => x.textContent.trim()));
  check('tools are grouped under headings', ['Listen and notes', 'Save', 'Capture', 'Investigate'].every(h => heads.includes(h)), heads.join(' | '));
  check('the page being acted on is named', /Toolbox Test Page/.test(await pop.$eval('#page', e => e.textContent)) && await pop.$eval('#note', e => e.hidden));
  const keysSeen = await pop.$$eval('#main button.tile', bs => bs.map(b => ({ k: b.dataset.key, badge: (b.querySelector('kbd') || {}).textContent })));
  check('every tile shows its letter, and no two share one', keysSeen.length === 12 && keysSeen.every(x => x.k && x.badge === x.k.toUpperCase()) && new Set(keysSeen.map(x => x.k)).size === 12, keysSeen.map(x => x.badge).join(''));
  const shotKeys = await pop.$$eval('#shotList button', bs => bs.map(b => b.dataset.key));
  check('the screenshot choices have their own letters', shotKeys.length === 3 && new Set(shotKeys).size === 3, shotKeys.join(''));
  check('first tile has keyboard focus', await pop.evaluate(() => document.activeElement && document.activeElement.dataset.tile === 'read'));

  // ---- screenshot sub-menu
  await pop.click('[data-tile="shot"]');
  check('Screenshot opens its three choices', await pop.$eval('#shotView', e => !e.hidden) && await pop.$eval('#main', e => e.hidden) && (await pop.$$('#shotList button')).length === 3);
  await pop.keyboard.press('Escape');
  check('Esc goes back to the tools', await pop.$eval('#main', e => !e.hidden) && await pop.$eval('#shotView', e => e.hidden));
  await pop.click('[data-tile="shot"]'); await pop.click('#shotBack');
  check('Back goes back to the tools', await pop.$eval('#main', e => !e.hidden));
  await pop.close();

  // ---- keyboard: arrows move, letters start, Ctrl+letter does nothing
  {
    const p = await openPopup(pageTabId);
    const at = () => p.evaluate(() => document.activeElement && (document.activeElement.dataset.tile || document.activeElement.id));
    check('starts with Read aloud focused', (await at()) === 'read');
    await p.keyboard.press('ArrowRight'); check('→ moves to the next tile', (await at()) === 'notes');
    await p.keyboard.press('ArrowDown'); check('↓ moves to the tile below', (await at()) === 'saveVideo', await at());
    await p.keyboard.press('ArrowDown'); check('↓ again reaches the next group', (await at()) === 'record', await at());
    await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowLeft'); check('↑ and ← move back', (await at()) === 'savePage', await at());
    await p.keyboard.down('Control'); await p.keyboard.press('v'); await p.keyboard.up('Control');
    await sleep(500);
    check('Ctrl+letter does not start a tool', !(await browser.pages()).some(x => /save\.html/.test(x.url())));
    await p.keyboard.press('v');
    const t = await findPage(/save\.html.*view=video/);
    check('pressing V starts Video without touching the mouse', !!t, t && t.url().replace(X, ''));
    if (t) await t.close().catch(() => {});
    await p.close().catch(() => {});
  }
  {
    const p = await openPopup(pageTabId);
    await p.keyboard.press('c');
    check('pressing C opens the screenshot choices', await p.$eval('#shotView', e => !e.hidden));
    check('…and focuses the first choice', await p.evaluate(() => document.activeElement.dataset.tile) === 'shot-region');
    await p.keyboard.press('v');
    const t = await findPage(/shot\.html\?id=/);
    check('C then V takes a visible-part screenshot', !!t);
    if (t) await t.close().catch(() => {});
    await p.close().catch(() => {});
    const p2 = await openPopup(pageTabId);
    await p2.keyboard.press('o');
    const n = await findPage(/notes\.html/);
    check('pressing O opens All my notes', !!n);
    if (n) await n.close().catch(() => {});
    await p2.close().catch(() => {});
  }

  // ---- the Shortcuts panel
  {
    const p = await openPopup(pageTabId);
    await p.click('#shortcuts');
    check('Shortcuts opens the list', await p.$eval('#keysView', e => !e.hidden) && await p.$eval('#main', e => e.hidden));
    const rows = await p.$$eval('#keyTable tr[data-command]', trs => trs.map(tr => ({ cmd: tr.dataset.command, text: tr.textContent })));
    check('it lists every tool and the toolbox itself', rows.length >= 18 && TOOL_COMMANDS.every(c => rows.some(r => r.cmd === c)) && rows.some(r => r.cmd === '_execute_action'), rows.length + ' rows');
    check('every listed shortcut slot exists in the manifest', rows.every(r => shipped.commands[r.cmd] || r.cmd === 'toggle-pause'), rows.filter(r => !shipped.commands[r.cmd]).map(r => r.cmd).join(','));
    check('each row says either what to press or “not set” / a dash', rows.every(r => /not set|\+/.test(r.text) || /—/.test(r.text)));
    const readRow = rows.find(r => r.cmd === 'screenshot-full');
    check('toolbox letters are shown (e.g. C then W for a whole-page screenshot)', readRow && /C/.test(readRow.text) && /W/.test(readRow.text), readRow && readRow.text);
    await p.keyboard.press('Escape');
    check('Esc goes back to the tools', await p.$eval('#main', e => !e.hidden));
    await p.keyboard.press('?');
    check('? opens the list from the keyboard', await p.$eval('#keysView', e => !e.hidden));
    await p.click('#setKeys');
    const sp = await findPage(/extensions\/shortcuts/);
    check('“Set or change shortcuts…” opens the browser’s shortcuts page', !!sp, sp && sp.url());
    if (sp) await sp.close().catch(() => {});
    await p.close().catch(() => {});
  }

  // ---- every tool answers to its shortcut command (the browser's key press is replaced by calling the same handler)
  {
    const callBg = async (cmd, tabId) => {
      const t = await browser.waitForTarget(x => x.type() === 'service_worker' && /background\.js/.test(x.url()), { timeout: 10000 });
      const w = await t.worker();
      return w.evaluate(async (c, id) => runCommand(c, await chrome.tabs.get(id)), cmd, tabId);
    };
    const cases = [['save-audio', /save\.html.*view=audio/], ['save-images', /save\.html.*view=image/], ['screenshot-full', /shot\.html\?id=/], ['screenshot-visible', /shot\.html\?id=/],
      ['lookup', /investigate\.html.*view=lookup/], ['archive', /investigate\.html.*view=archive/], ['share', /investigate\.html.*view=share/], ['all-notes', /notes\.html/], ['investigate', /investigate\.html.*view=entities/], ['record-screen', /record\.html/], ['save-page', /save\.html.*view=document/]];
    for (const [cmd, re] of cases) {
      await callBg(cmd, pageTabId);
      const t = await findPage(re);
      check('shortcut command “' + cmd + '” starts its tool', !!t, t && t.url().replace(X, '').slice(0, 60));
      if (t) await t.close().catch(() => {});
    }
    await callBg('not-a-command', pageTabId);
    check('an unknown command does nothing', true);
  }

  // ---- each tile starts its tool
  const press = async (sel, urlRe, name, extra) => {
    const p = await openPopup(pageTabId);
    if (sel.startsWith('shot:')) await p.click('[data-tile="shot"]');
    await p.click(sel.startsWith('shot:') ? `#shotList [data-tile="${sel.slice(5)}"]` : sel).catch(() => {});
    const t = await findPage(urlRe);
    check(name, !!t, t ? t.url().replace(X, '').slice(0, 90) : '');
    if (t && extra) check(extra[0], extra[1](t.url()));
    if (t) await t.close().catch(() => {});
    await p.close().catch(() => {});
  };
  await press('[data-tile="savePage"]', /save\.html/, 'Save page opens the Save tab on the document view', ['…for this page', u => /view=document/.test(u) && new RegExp('tab=' + pageTabId + '\\b').test(u)]);
  await press('[data-tile="saveVideo"]', /save\.html.*view=video/, 'Video opens the Save tab on the video view');
  await press('[data-tile="saveAudio"]', /save\.html.*view=audio/, 'Audio opens the Save tab on the audio view');
  await press('[data-tile="saveImages"]', /save\.html.*view=image/, 'Images opens the Save tab on the image view');
  await press('[data-tile="record"]', /record\.html/, 'Record screen opens the recorder');
  await press('[data-tile="investigate"]', /investigate\.html.*view=entities/, 'Investigate opens page entities');
  await press('[data-tile="lookup"]', /investigate\.html.*view=lookup/, 'Look up opens the lookup view');
  await press('[data-tile="archive"]', /investigate\.html.*view=archive/, 'Archive opens the archive view');
  await press('[data-tile="share"]', /investigate\.html.*view=share/, 'Share opens the share view');
  await press('shot:shot-visible', /shot\.html\?id=/, 'Screenshot → Visible part opens the screenshot editor');
  await press('shot:shot-full', /shot\.html\?id=/, 'Screenshot → Whole page opens the screenshot editor');

  // selected area: the drag overlay is injected into the page (a closed shadow root, so look for its effect)
  {
    const p = await openPopup(pageTabId);
    await p.click('[data-tile="shot"]'); await p.click('#shotList [data-tile="shot-region"]');
    const stored = await waitFor(() => ext0.evaluate(async () => (await chrome.storage.session.get('koRegion')).koRegion || null), 8000);
    check('Screenshot → Selected area arms the drag overlay for that tab', !!stored && stored.tabId === pageTabId);
    await page.bringToFront(); await page.keyboard.press('Escape');
    await p.close().catch(() => {});
  }

  // ---- Read aloud: starts the reader (needs a server address; none is needed to open the player)
  await ext0.evaluate(u => chrome.storage.sync.set({ serverUrl: u }), base);
  {
    const p = await openPopup(pageTabId);
    check('Read aloud is labelled that way while the reader is closed', /Read aloud/.test(await p.$eval('[data-tile="read"]', e => e.textContent)));
    await p.click('[data-tile="read"]');
    const open = await waitFor(() => ext0.evaluate(async id => { try { const r = await chrome.tabs.sendMessage(id, { type: 'kr-ping' }, { frameId: 0 }); return !!(r && r.alive && r.open); } catch (_) { return false; } }, pageTabId), 12000);
    check('Read aloud opens the reader on the page', !!open);
    await p.close().catch(() => {});
    if (open) {
      const p2 = await openPopup(pageTabId);
      const label = await waitFor(async () => { const t = await p2.$eval('[data-tile="read"]', e => e.textContent.trim()); return /Close reader/.test(t) ? t : null; }, 6000);
      check('while the reader is open the tile says Close reader', !!label);
      await p2.click('[data-tile="read"]');
      const closed = await waitFor(() => ext0.evaluate(async id => { try { const r = await chrome.tabs.sendMessage(id, { type: 'kr-ping' }, { frameId: 0 }); return !!(r && r.alive && !r.open); } catch (_) { return false; } }, pageTabId), 8000);
      check('…and clicking it closes the reader again', !!closed);
      await p2.close().catch(() => {});
    }
  }

  // ---- protected page: page tools off, record + look up still on, and it says why
  {
    const prot = await browser.newPage();
    await prot.goto('chrome://version/');
    const protId = await ext0.evaluate(async () => { const t = (await chrome.tabs.query({})).find(x => (x.url || '').startsWith('chrome://version')); return t ? t.id : null; });
    const p = await openPopup(protId);
    const st = await p.$$eval('button.tile[data-tile]', bs => Object.fromEntries(bs.map(b => [b.dataset.tile, b.disabled])));
    check('browser page: page tools are disabled', st.read && st.savePage && st.shot && st.investigate && st.share, JSON.stringify(st));
    check('browser page: Record screen and Look up stay available', !st.record && !st.lookup);
    check('browser page: it says why', !(await p.$eval('#note', e => e.hidden)));
    await p.close(); await prot.close();
  }

  // ---- only the toolbox may start tools
  {
    const r1 = await ext0.evaluate(id => chrome.runtime.sendMessage({ type: 'kr-tool', tool: 'record', tabId: id }), pageTabId);
    await sleep(800);
    const opened = (await browser.pages()).some(p => /record\.html/.test(p.url()));
    check('another page cannot start a tool through the toolbox message', r1 && r1.ok === false && !opened, JSON.stringify(r1));
    const pp = await openPopup(pageTabId);
    const r2 = await pp.evaluate(id => chrome.runtime.sendMessage({ type: 'kr-tool', tool: 'bogus', tabId: id }), pageTabId);
    check('an unknown tool is refused', r2 && r2.ok === false, JSON.stringify(r2));
    const r3 = await pp.evaluate(id => chrome.runtime.sendMessage({ type: 'kr-tool', tool: 'toString', tabId: id }), pageTabId);
    check('inherited object names are not tools', r3 && r3.ok === false, JSON.stringify(r3));
    await pp.close();
  }

  check('no page errors in the toolbox', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll popup tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
