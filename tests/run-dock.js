// The floating toolbox in real Chromium: it opens from the icon, can be dragged and remembers where it is, stays open, works from
// the keyboard, runs Screenshot / Look up / Archive / Share / Shortcuts inside itself, opens the other tools in small windows
// (not tabs), hides while a screenshot is taken, and falls back to a small window on browser pages.
// (A copy of the extension is made with all-sites access granted because a permission prompt can't be clicked headlessly.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Dock Test Page</title></head><body style="margin:0;font:18px system-ui"><div style="height:1500px;background:linear-gradient(#fff,#79c);padding:20px"><h1>Hello</h1><p id="p1">The quick brown fox jumps over the lazy dog, again and again.</p></div></body></html>';

(async () => {
  const run = Date.now();
  const tmp = path.join(SP, 'dock-' + run), ext = path.join(tmp, 'ext'), profile = path.join(tmp, 'profile');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.cpSync(path.join(__dirname, '../extension'), ext, { recursive: true });
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json')));
  const mf = JSON.parse(JSON.stringify(shipped));
  mf.host_permissions = ['<all_urls>']; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

  check('the icon no longer opens a popup page (default_popup is gone)', !shipped.action.default_popup);
  check('the fallback toolbox page still ships', fs.existsSync(path.join(__dirname, '../extension/popup.html')));

  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, args: ['--no-sandbox', '--disable-extensions-except=' + ext, '--load-extension=' + ext], ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext] });
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

  const callBg = async (fnSrc, ...args) => {
    const t = await browser.waitForTarget(x => x.type() === 'service_worker' && /background\.js/.test(x.url()), { timeout: 10000 });
    return (await t.worker()).evaluate(fnSrc, ...args);
  };
  const clickIcon = (id = tabId) => callBg(async i => toggleDock(await chrome.tabs.get(i)), id);
  const dockState = () => page.evaluate(() => {
    const h = document.getElementById('ko-dock-host'); if (!h) return null;
    const d = h.shadowRoot.querySelector('.dock'); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d);
    return { hidden: d.hidden, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pos: cs.position, z: cs.zIndex, vis: getComputedStyle(h).visibility,
      panel: !h.shadowRoot.querySelector('.panel').hidden, tiles: [...h.shadowRoot.querySelectorAll('.tile')].map(t => t.dataset.tile), focus: h.shadowRoot.activeElement && (h.shadowRoot.activeElement.dataset.tile || h.shadowRoot.activeElement.className) };
  });
  const popups = () => ext0.evaluate(async () => (await chrome.windows.getAll({ populate: true })).filter(w => w.type === 'popup').map(w => (w.tabs || []).map(t => t.url).join(' ')));
  const closePopups = () => ext0.evaluate(async () => { for (const w of await chrome.windows.getAll()) if (w.type === 'popup') await chrome.windows.remove(w.id).catch(() => {}); });
  const normalTabs = () => ext0.evaluate(async () => (await chrome.tabs.query({ windowType: 'normal' })).map(t => t.url || ''));
  const findPopup = re => waitFor(async () => (await popups()).find(u => re.test(u)), 12000);
  const tile = id => 'pierce/[data-tile="' + id + '"]';
  const idbGet = (db, store, id) => ext0.evaluate((db, store, id) => new Promise((res, rej) => {
    const r = indexedDB.open(db);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains(store)) { d.close(); return res('no-store'); } const q = d.transaction(store).objectStore(store).get(id); q.onerror = () => { d.close(); rej(q.error); }; q.onsuccess = () => { const v = q.result; d.close(); res(v ? true : null); }; };
  }), db, store, id);
  const press = k => page.keyboard.press(k);
  const panelText = () => page.evaluate(() => document.getElementById('ko-dock-host').shadowRoot.querySelector('.panel').innerText);

  // ============ open, close, place ============
  check('nothing is injected until you ask', (await dockState()) === null);
  await clickIcon();
  await waitFor(async () => { const s = await dockState(); return s && !s.hidden; }, 8000);
  let s = await dockState();
  check('clicking the icon shows the toolbox in the page', !!s && !s.hidden);
  check('it is a small floating box, fixed and above everything', s && s.pos === 'fixed' && s.z === '2147483647' && s.w <= 270 && s.h < 200, s && JSON.stringify({ w: s.w, h: s.h, z: s.z }));
  check('it sits in the bottom-left corner by default', s && s.x < 40 && s.y > 700 - s.h - 40, s && s.x + ',' + s.y);
  check('it has an icon for each of the 12 tools', s && s.tiles.length === 12, s && s.tiles.join(','));
  check('the first tool has keyboard focus', s && s.focus === 'read', s && s.focus);
  await sleep(1200);
  check('it stays open (nothing closes it on its own)', !(await dockState()).hidden);
  await page.evaluate(() => window.scrollTo(0, 600)); await sleep(200);
  const afterScroll = await dockState();
  check('scrolling the page does not move it (it floats)', afterScroll.x === s.x && afterScroll.y === s.y);
  await page.evaluate(() => window.scrollTo(0, 0));

  // ============ dragging ============
  const bar = await (await page.$('pierce/.top')).boundingBox();
  await page.mouse.move(bar.x + 60, bar.y + 10); await page.mouse.down();
  await page.mouse.move(bar.x + 360, bar.y - 250, { steps: 6 }); await page.mouse.up();
  const moved = await dockState();
  check('dragging the title bar moves it', moved.x > s.x + 250 && moved.y < s.y - 200, s.x + ',' + s.y + ' -> ' + moved.x + ',' + moved.y);
  check('…and the position is remembered', !!(await waitFor(() => ext0.evaluate(async () => (await chrome.storage.local.get('ko:dockPos'))['ko:dockPos']), 4000)));
  await page.mouse.move(moved.x + 60, moved.y + 10); await page.mouse.down();
  await page.mouse.move(-400, -400, { steps: 4 }); await page.mouse.up();
  const clamped = await dockState();
  check('it can’t be dragged off the screen', clamped.x >= 0 && clamped.y >= 0, clamped.x + ',' + clamped.y);
  await page.mouse.move(clamped.x + 60, clamped.y + 10); await page.mouse.down();
  await page.mouse.move(380, 260, { steps: 4 }); await page.mouse.up();
  const parked = await dockState();
  await clickIcon();
  await waitFor(async () => (await dockState()).hidden, 4000);
  check('clicking the icon again closes it', (await dockState()).hidden);
  await clickIcon();
  await waitFor(async () => !(await dockState()).hidden, 4000);
  const back = await dockState();
  check('reopening puts it where you left it', Math.abs(back.x - parked.x) < 4 && Math.abs(back.y - parked.y) < 4, parked.x + ',' + parked.y + ' vs ' + back.x + ',' + back.y);

  // ============ tool windows, not tabs ============
  const tabsBefore = await normalTabs();
  await press('s');
  const sw1 = await findPopup(/save\.html.*view=document/);
  check('Save page opens in its own small window', !!sw1, sw1 && sw1.replace(X, ''));
  const tabsAfter = await normalTabs();
  check('…not as a browser tab', tabsAfter.length === tabsBefore.length && !tabsAfter.some(u => /save\.html/.test(u)), tabsAfter.length + ' tabs');
  check('the toolbox is still there', !(await dockState()).hidden);
  await closePopups();
  await page.bringToFront();
  for (const [key, re, name] of [['i', /investigate\.html.*view=entities/, 'Investigate'], ['v', /save\.html.*view=video/, 'Video'], ['u', /save\.html.*view=audio/, 'Audio'], ['m', /save\.html.*view=image/, 'Images']]) {
    await page.bringToFront(); await press(key);
    check(name + ' (' + key.toUpperCase() + ') opens in a small window', !!(await findPopup(re)));
    await closePopups();
  }
  await page.bringToFront(); await press('e');
  const recView = await page.evaluate(() => { const r = document.getElementById('ko-dock-host').shadowRoot; return { grid: !r.querySelector('.grid').hidden, pane: !r.querySelector('.recpane').hidden }; });
  check('Record screen (E) swaps the icons for the recorder inside the box (details in run-dock-record.js)', recView.pane && !recView.grid && !(await popups()).some(u => /record\.html/.test(u)), JSON.stringify(recView));
  await press('Escape');
  check('…and Esc brings the icons back', await page.evaluate(() => { const r = document.getElementById('ko-dock-host').shadowRoot; return !r.querySelector('.grid').hidden && r.querySelector('.recpane').hidden; }));
  await page.bringToFront();
  await press('o');
  check('All my notes (O) opens in a small window', !!(await findPopup(/notes\.html/)));
  await closePopups();
  await page.bringToFront();

  // an untrusted (page-made) click does nothing
  await page.evaluate(() => document.getElementById('ko-dock-host').shadowRoot.querySelector('[data-tile="savePage"]').click());
  await sleep(700);
  check('a click made by the page’s own script is ignored', !(await popups()).some(u => /save\.html/.test(u)));

  // ============ Look up ============
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p1')); r.setStart(document.getElementById('p1').firstChild, 4); r.setEnd(document.getElementById('p1').firstChild, 9); const g = getSelection(); g.removeAllRanges(); g.addRange(r); });
  await page.click(tile('lookup'));
  const lookVal = await page.evaluate(() => document.getElementById('ko-dock-host').shadowRoot.querySelector('.panel input').value);
  check('Look up opens inside the toolbox, filled with the text you had selected', lookVal === 'quick', lookVal);
  await page.evaluate(() => { const i = document.getElementById('ko-dock-host').shadowRoot.querySelector('.panel input'); i.value = ''; });
  await page.focus('pierce/.panel input');
  await page.keyboard.type('example.com');
  await sleep(300);
  const pills = await page.evaluate(() => [...document.getElementById('ko-dock-host').shadowRoot.querySelectorAll('.panel a.pill')].map(a => ({ t: a.textContent, h: a.href, rel: a.rel, tg: a.target })));
  check('typing a domain lists lookup links', pills.length >= 8 && pills.every(p => /^https:/.test(p.h) && /noopener/.test(p.rel) && p.tg === '_blank'), pills.length + ' links');
  check('…and says what it detected', /domain/i.test(await panelText()));
  await page.evaluate(() => { const i = document.getElementById('ko-dock-host').shadowRoot.querySelector('.panel input'); i.value = ''; i.dispatchEvent(new Event('input')); });
  check('an empty box explains how to use it', /Type or paste/.test(await panelText()));
  await press('Escape');
  check('Esc closes the panel but keeps the toolbox', !(await dockState()).panel && !(await dockState()).hidden);

  // ============ Archive and Share ============
  await page.bringToFront(); await page.click(tile('archive'));
  const arch = await page.evaluate(() => [...document.getElementById('ko-dock-host').shadowRoot.querySelectorAll('.panel a.pill')].map(a => a.href));
  check('Archive lists saved-copy and save-now links for this page', arch.some(u => u.startsWith('https://web.archive.org/web/*/' + base)) && arch.some(u => u.startsWith('https://web.archive.org/save/' + base)) && arch.some(u => /archive\.(ph|today)/.test(u)), arch.length + ' links');
  await press('Escape');
  await page.click(tile('share'));
  const shareLinks = await page.evaluate(() => [...document.getElementById('ko-dock-host').shadowRoot.querySelectorAll('.panel a.pill')].map(a => ({ t: a.textContent, h: a.href })));
  const xl = shareLinks.find(l => l.t === 'X');
  check('Share lists the post links with this page’s address filled in', !!xl && xl.h.includes(encodeURIComponent(base)) && shareLinks.some(l => l.t === 'Bluesky'), shareLinks.map(l => l.t).join(','));
  check('…with the selected text quoted', !!xl && decodeURIComponent(xl.h).includes('quick'), xl && decodeURIComponent(xl.h).slice(0, 120));
  await press('Escape');

  // ============ Shortcuts ============
  await press('?');
  await waitFor(async () => (await page.$$('pierce/tr[data-command]')).length > 10, 5000);
  const rows = await page.$$eval('pierce/tr[data-command]', trs => trs.map(t => t.dataset.command));
  check('? opens the shortcut list inside the toolbox', rows.length >= 18 && rows.includes('screenshot-full') && rows.includes('_execute_action'), rows.length + ' rows');
  await press('Escape');

  // ============ Screenshot: the card ============
  await page.bringToFront();
  await page.evaluate(() => {                       // record when the toolbox is hidden
    const h = document.getElementById('ko-dock-host'); window.__vis = [];
    new MutationObserver(() => window.__vis.push(h.style.visibility || 'shown')).observe(h, { attributes: true, attributeFilter: ['style'] });
  });
  await press('c'); await press('v');
  const cardUp = await waitFor(() => page.$('pierce/.panel img.thumb'), 15000);
  check('a screenshot appears as a card inside the toolbox', !!cardUp);
  const vis = await page.evaluate(() => window.__vis);
  check('the toolbox hid itself while the picture was taken, then came back', vis.includes('hidden') && vis[vis.length - 1] === 'shown', vis.join(','));
  const card = await page.evaluate(() => { const p = document.getElementById('ko-dock-host').shadowRoot.querySelector('.panel'); return { src: p.querySelector('img').src.slice(0, 22), text: p.innerText, btns: [...p.querySelectorAll('.btn')].map(b => b.textContent) }; });
  check('the card shows a picture, its size and Copy / Save / Notes / Edit…', /^data:image\/jpeg/.test(card.src) && /Visible part/.test(card.text) && ['Copy', 'Save', 'Notes', 'Edit…'].every(b => card.btns.includes(b)), card.text.replace(/\n/g, ' | ').slice(0, 90) + ' ' + card.btns.join(','));
  check('no screenshot tab or window was opened', !(await popups()).some(u => /shot\.html/.test(u)) && !(await normalTabs()).some(u => /shot\.html/.test(u)));
  const cardId = (await callBg(async () => Object.keys((await chrome.storage.session.get('koDockShots')).koDockShots || {})))[0];
  check('the picture is held until you act on it', !!cardId && (await idbGet('pagemate-shots', 'shots', cardId)) === true);

  await page.type('pierce/.panel input', 'The banner');
  const btn = async label => { const hs = await page.$$('pierce/.panel .btn'); for (const h of hs) if ((await h.evaluate(e => e.textContent)) === label) return h; };
  await (await btn('Notes')).click();
  const filed = await waitFor(async () => /Filed with your notes/.test(await panelText()), 6000);
  check('Notes files it under the page, with the caption', !!filed);
  const rec = await ext0.evaluate(async k => (await chrome.storage.local.get(k))[k], 'kn:p:' + base + '/');
  check('…the page’s notes record has the screenshot', !!rec && rec.shots && rec.shots.length === 1 && rec.shots[0].note === 'The banner', JSON.stringify(rec && rec.shots && rec.shots[0] && rec.shots[0].note));
  await (await btn('Copy')).click();
  const copied = await waitFor(async () => /Copied|Couldn/.test(await panelText()), 6000);
  check('Copy reports success (or says why it can’t)', !!copied, ((await panelText()).match(/Copied[^\n]*|Couldn[^\n]*/) || [''])[0].slice(0, 80));
  await (await btn('Save')).click();
  check('Save writes it to Downloads', !!(await waitFor(async () => /Saved to your Downloads/.test(await panelText()), 6000)));
  await (await btn('Edit…')).click();
  const editor = await findPopup(/shot\.html\?id=/);
  check('Edit… opens the editor in its own small window and clears the card', !!editor && !(await dockState()).panel);
  check('…and it is not a tab', !(await normalTabs()).some(u => /shot\.html/.test(u)));
  await closePopups();
  check('closing the editor window deletes the stored picture', !!(await waitFor(async () => (await idbGet('pagemate-shots', 'shots', cardId)) === null, 8000)));

  // dismissing a card deletes it
  await page.bringToFront();
  await press('c'); await press('v');
  await waitFor(() => page.$('pierce/.panel img.thumb'), 15000);
  const id2 = (await callBg(async () => Object.keys((await chrome.storage.session.get('koDockShots')).koDockShots || {})))[0];
  await page.click('pierce/.panel .ph button');
  check('dismissing the card deletes the stored picture', !!(await waitFor(async () => (await idbGet('pagemate-shots', 'shots', id2)) === null, 6000)));
  check('…and closes the panel', !(await dockState()).panel);

  // selected area: the toolbox goes out of the way while you drag
  await page.bringToFront();
  await press('c'); await press('a');
  const armed = await waitFor(() => ext0.evaluate(async () => (await chrome.storage.session.get('koRegion')).koRegion || null), 8000);
  check('Selected area arms the drag overlay', !!armed);
  check('…with the toolbox out of the way', (await dockState()).vis === 'hidden');
  await page.keyboard.press('Escape');
  await waitFor(async () => (await dockState()).vis !== 'hidden', 5000);
  check('cancelling brings the toolbox back', (await dockState()).vis !== 'hidden' && !(await dockState()).hidden);

  // ============ staying open across pages ============
  await page.goto(base + '/second');
  const returned = await waitFor(async () => { const d = await dockState(); return d && !d.hidden; }, 10000);
  check('after going to another page in the tab, the toolbox is still open', !!returned);
  const again = await dockState();
  check('…in the same place', again && Math.abs(again.x - parked.x) < 4 && Math.abs(again.y - parked.y) < 4, again && again.x + ',' + again.y);

  // closing: × and Esc
  await page.bringToFront();
  await page.click('pierce/[data-act="close"]');
  await waitFor(async () => (await dockState()).hidden, 4000);
  check('× closes the toolbox', (await dockState()).hidden);
  await page.goto(base + '/third'); await sleep(1500);
  check('a closed toolbox does not come back by itself', !(await dockState()) || (await dockState()).hidden);

  // ============ a page nothing can be injected into ============
  const prot = await browser.newPage(); await prot.goto('chrome://version/');
  await prot.bringToFront();
  const protId = await ext0.evaluate(async () => (await chrome.tabs.query({ active: true, windowType: 'normal' }))[0].id);   // (browser pages hide their address from extensions)
  await clickIcon(protId);
  const fb = await findPopup(/popup\.html\?tab=/);
  check('on a browser page the tools appear in a small window instead', !!fb, fb && fb.replace(X, ''));
  await closePopups(); await prot.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll dock tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
