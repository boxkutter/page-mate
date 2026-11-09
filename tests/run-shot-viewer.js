// Screenshot viewer in real Chromium: warns before losing edits, deletes the stored picture when its tab closes, files a
// screenshot with the page's notes (Save to Notes) and shows / deletes it in "All my notes", copies automatically when asked.
// (A copy of the extension is made with all-sites access and the clipboard permission granted, because a permission prompt
// can't be clicked headlessly; all shipped code runs unchanged.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000, step = 150) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Viewer Test Page</title></head><body style="margin:0;font:18px system-ui"><div style="height:900px;background:linear-gradient(#fff,#79c);padding:20px"><h1>Hello</h1><p id="p1">The first paragraph holds some words worth remembering for later.</p><p id="p2">The second paragraph holds other words that also deserve a highlight.</p></div></body></html>';

(async () => {
  const run = Date.now();
  const tmp = path.join(SP, 'shotv-' + run), ext = path.join(tmp, 'ext'), profile = path.join(tmp, 'profile');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.cpSync(path.join(__dirname, '../extension'), ext, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.host_permissions = ['<all_urls>']; delete mf.optional_host_permissions;
  mf.permissions.push('clipboardWrite'); mf.optional_permissions = mf.optional_permissions.filter(p => p !== 'clipboardWrite');
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const NOTES_KEY = 'kn:p:' + base + '/';

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, args: ['--no-sandbox', '--disable-extensions-except=' + ext, '--load-extension=' + ext], ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext] });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const X = `chrome-extension://${new URL(sw.url()).host}/`;
  const errors = [];

  const ext0 = await browser.newPage();           // an extension page to read storage / IndexedDB from
  await ext0.goto(X + 'options.html');
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(base + '/');
  await page.bringToFront();
  const pageTabId = await ext0.evaluate(async u => (await chrome.tabs.query({})).find(t => (t.url || '').startsWith(u)).id, base);

  const callBg = async (fnSrc, ...args) => {
    const t = await browser.waitForTarget(x => x.type() === 'service_worker' && /background\.js/.test(x.url()), { timeout: 10000 });
    return (await t.worker()).evaluate(fnSrc, ...args);
  };
  const findPage = re => waitFor(async () => (await browser.pages()).find(p => re.test(p.url())), 12000);
  const takeShot = async (mode = 'visible') => {
    await callBg(async (m, id) => startShot(await chrome.tabs.get(id), m), mode, pageTabId);
    const v = await findPage(/shot\.html\?id=/);
    if (v) { v.on('pageerror', e => errors.push(e.message)); v.on('dialog', d => d.accept());   // the "leave this page?" prompt, when there are unsaved edits
      await v.bringToFront(); await v.setViewport({ width: 1300, height: 900 }); await v.waitForSelector('#cv'); await waitFor(() => v.$eval('#meta', e => e.textContent.includes('SHA-256')).catch(() => false)); }
    return v;
  };
  const idOf = v => new URL(v.url()).searchParams.get('id');
  // IndexedDB probes: only after the extension has created the database (opening it first would create an empty one)
  const idbGet = (db, store, id) => ext0.evaluate((db, store, id) => new Promise((res, rej) => {
    const r = indexedDB.open(db);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(store)) { d.close(); return res('no-store'); }
      const q = d.transaction(store).objectStore(store).get(id);
      q.onerror = () => { d.close(); rej(q.error); };
      q.onsuccess = async () => { const v = q.result; d.close(); if (!v) return res(null); const b = v.blob || v; res({ size: b.size, magic: [...new Uint8Array(await b.slice(0, 4).arrayBuffer())] }); };
    };
  }), db, store, id);
  const wouldWarn = v => v.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  const drawBox = async (v, x0 = 0.2, y0 = 0.2, x1 = 0.5, y1 = 0.4) => {
    await v.click('button.tool[data-tool="box"]');
    const b = await (await v.$('#cv')).boundingBox();
    await v.mouse.move(b.x + b.width * x0, b.y + b.height * y0); await v.mouse.down();
    await v.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 4 }); await v.mouse.up();
  };

  // ============ 1. unsaved edits ============
  let v = await takeShot('visible');
  check('screenshot viewer opens', !!v);
  if (!v) { console.log('cannot continue'); process.exit(1); }
  const id1 = idOf(v);
  check('a fresh, unedited screenshot does not warn on close', !(await wouldWarn(v)));
  await drawBox(v);
  check('after drawing a mark, closing the tab warns', await wouldWarn(v));
  await v.click('#undo');
  check('undoing it back to the saved state stops the warning', !(await wouldWarn(v)));
  await drawBox(v);
  check('marked again: warns', await wouldWarn(v));
  await v.click('#savePng');
  await waitFor(() => v.$eval('#status', e => /^Saved/.test(e.textContent)), 8000);
  check('after Save PNG the warning stops', !(await wouldWarn(v)));
  await drawBox(v, 0.6, 0.5, 0.8, 0.7);
  check('a further mark warns again', await wouldWarn(v));
  await v.bringToFront();   // the clipboard needs the tab focused
  await v.click('#copyImg');
  await waitFor(() => v.$eval('#status', e => /Copied|Couldn/.test(e.textContent)), 5000);
  const copied = /^Copied/.test(await v.$eval('#status', e => e.textContent));
  check('Copy image works here and clears the warning', copied ? !(await wouldWarn(v)) : true, copied ? '' : 'clipboard unavailable in this browser, skipped');

  // ============ 2. a reload keeps it, closing the tab deletes it ============
  await v.reload(); await v.waitForSelector('#cv');
  await waitFor(() => v.$eval('#meta', e => e.textContent.includes('SHA-256')).catch(() => false));
  check('reloading the viewer still shows the picture', !(/no longer available/.test(await v.$eval('#source', e => e.textContent))) && (await v.$eval('#cv', c => c.width)) > 50);
  check('…the original is in the temporary store', !!(await idbGet('pagemate-shots', 'shots', id1)));
  await v.close();
  const gone = await waitFor(async () => (await idbGet('pagemate-shots', 'shots', id1)) === null, 8000);
  check('closing the viewer tab deletes the stored screenshot', !!gone);
  const v2 = await browser.newPage(); await v2.goto(X + 'shot.html?id=' + id1);
  await waitFor(() => v2.$eval('#source', e => e.textContent).catch(() => ''), 4000);
  check('reopening it says it is gone and explains why', /no longer available/.test(await v2.$eval('#source', e => e.textContent)) && /closed/.test(await v2.$eval('#source', e => e.textContent)));
  await v2.close();

  // ============ 3. Save to Notes ============
  v = await takeShot('visible');
  await drawBox(v);
  await v.type('#shotCaption', 'Evidence of the hero banner');
  await v.click('#toNotes');
  const filed = await waitFor(() => v.$eval('#notesStatus', e => /Filed|Couldn/.test(e.textContent) ? e.textContent : ''), 8000);
  check('Save to Notes reports it is filed, with a link to the notes', /^Filed with your notes/.test(filed || '') && !!(await v.$('#notesStatus a')), filed);
  check('…and counts as kept (no warning)', !(await wouldWarn(v)));
  check('…and the caption box is cleared', (await v.$eval('#shotCaption', e => e.value)) === '');
  const rec = await ext0.evaluate(async k => (await chrome.storage.local.get([k, 'kn:idx'])), NOTES_KEY);
  const pageRec = rec[NOTES_KEY];
  check('the page’s notes record now has one screenshot entry', !!pageRec && pageRec.shots && pageRec.shots.length === 1, JSON.stringify(pageRec && pageRec.shots && pageRec.shots[0]).slice(0, 160));
  const s0 = pageRec && pageRec.shots[0];
  check('entry has caption, size, marked flag, hash and no picture data inline', s0 && s0.note === 'Evidence of the hero banner' && s0.w > 100 && s0.marked === true && /^[0-9a-f]{64}$/.test(s0.sha256) && JSON.stringify(s0).length < 600);
  check('the notes index counts it', rec['kn:idx'] && rec['kn:idx'][NOTES_KEY] && rec['kn:idx'][NOTES_KEY].shots === 1);
  const img = s0 && await idbGet('pagemate-note-shots', 'images', s0.id);
  check('the picture is stored as a real PNG', img && img.size > 1000 && img.magic.join() === '137,80,78,71', JSON.stringify(img));
  const viewerId = idOf(v);
  await v.close();
  await waitFor(async () => (await idbGet('pagemate-shots', 'shots', viewerId)) === null, 8000);
  check('after the viewer is closed the filed picture is still there', !!(s0 && await idbGet('pagemate-note-shots', 'images', s0.id)));

  // ============ 4. All my notes ============
  const mgr = await browser.newPage(); await mgr.setViewport({ width: 1100, height: 900 });
  mgr.on('pageerror', e => errors.push(e.message));
  mgr.on('dialog', d => d.accept());
  await mgr.goto(X + 'notes.html#shots=' + encodeURIComponent(NOTES_KEY));
  await mgr.waitForSelector('.shot', { timeout: 10000 }).catch(() => {});
  check('All my notes shows the page, opened on its screenshot', !!(await mgr.$('.page.open .shot')));
  const loaded = await waitFor(() => mgr.$eval('.shot img.thumb', i => i.complete && i.naturalWidth > 0).catch(() => false), 6000);
  check('the thumbnail loads', !!loaded);
  const shotText = await mgr.$eval('.shot', e => e.innerText);
  check('it shows the caption, mode, size, “with your marks” and date', /Evidence of the hero banner/.test(shotText) && /Visible part/.test(shotText) && /with your marks/.test(shotText) && /\d+×\d+/.test(shotText), shotText.replace(/\n/g, ' | ').slice(0, 160));
  check('page line says 1 screenshot', /1 screenshot/.test(await mgr.$eval('.page .pmeta', e => e.textContent)));
  const labels = await mgr.$$eval('.shot .acts button', bs => bs.map(b => b.textContent));
  check('Open / Copy / Save / Delete are offered', ['Open', 'Copy', 'Save', 'Delete'].every(l => labels.includes(l)), labels.join(','));
  await mgr.type('#q', 'hero banner');
  check('searching the caption finds the page', !!(await mgr.$('.page .shot')));
  await mgr.$eval('#q', e => { e.value = ''; e.dispatchEvent(new Event('input')); });

  // ============ 5. notes on the page and screenshots coexist ============
  await page.bringToFront();
  const highlight = async sel => {
    await page.evaluate(s => { const r = document.createRange(); r.selectNodeContents(document.querySelector(s)); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }, sel);
    await callBg(async id => notesCommand(await chrome.tabs.get(id), { type: 'kn-highlight', color: 'yellow' }), pageTabId);
  };
  await highlight('#p1');
  const afterFirst = await waitFor(async () => { const r = (await ext0.evaluate(async k => (await chrome.storage.local.get(k))[k], NOTES_KEY)); return r && r.items.length === 1 ? r : null; }, 8000);
  check('a highlight made after a screenshot was filed keeps the screenshot', !!afterFirst && afterFirst.shots.length === 1);
  // now a second screenshot is filed while the notes script is already running on the page
  v = await takeShot('visible');
  await v.click('#toNotes');
  await waitFor(() => v.$eval('#notesStatus', e => /Filed|Couldn/.test(e.textContent)), 8000);
  await v.close();
  await page.bringToFront(); await sleep(400);
  await highlight('#p2');
  const afterSecond = await waitFor(async () => { const r = (await ext0.evaluate(async k => (await chrome.storage.local.get(k))[k], NOTES_KEY)); return r && r.items.length === 2 ? r : null; }, 8000);
  check('a highlight made after another screenshot was filed (page already loaded) keeps BOTH screenshots', !!afterSecond && afterSecond.shots.length === 2, afterSecond ? afterSecond.shots.length + ' shots, ' + afterSecond.items.length + ' items' : 'no record');

  // ============ 6. delete one, then the page ============
  await mgr.bringToFront();
  await mgr.reload(); await mgr.waitForSelector('.page');
  await mgr.$$eval('.page .phead button', bs => { const b = bs.find(x => /Show/.test(x.textContent)); if (b) b.click(); });
  await mgr.waitForSelector('.shot');
  check('both screenshots are listed', (await mgr.$$('.shot')).length === 2);
  const firstId = await mgr.$eval('.shot', e => e.dataset.shot);
  await mgr.$$eval('.shot .acts button', bs => bs.find(b => b.textContent === 'Delete').click());
  const left = await waitFor(async () => { const r = await ext0.evaluate(async k => (await chrome.storage.local.get(k))[k], NOTES_KEY); return r && r.shots.length === 1 ? r : null; }, 8000);
  check('deleting one removes its entry', !!left && !left.shots.some(s => s.id === firstId));
  check('…and its stored picture', (await idbGet('pagemate-note-shots', 'images', firstId)) === null);
  check('…the highlights are untouched', left && left.items.length === 2);
  const lastId = left && left.shots[0].id;
  await mgr.waitForFunction(() => document.querySelectorAll('.shot').length === 1, { timeout: 6000 }).catch(() => {});
  await mgr.$$eval('.page .phead button', bs => bs.find(x => x.textContent === 'Delete').click());
  const pageGone = await waitFor(async () => (await ext0.evaluate(async k => (await chrome.storage.local.get(k))[k] || null, NOTES_KEY)) === null, 8000);
  check('deleting the page’s notes removes the record', !!pageGone);
  check('…and the screenshot pictures that belonged to it', lastId && (await idbGet('pagemate-note-shots', 'images', lastId)) === null);
  await mgr.close();

  // ============ 7. copy automatically ============
  await ext0.evaluate(() => chrome.storage.sync.set({ shotAutoCopy: false }));
  v = await takeShot('visible');
  check('auto-copy off: nothing is copied and the box is unticked', !(await v.$eval('#autoCopy', e => e.checked)) && !/^Copied/.test(await v.$eval('#status', e => e.textContent)));
  await v.click('#autoCopy');
  await sleep(500);
  check('ticking it turns the setting on (permission already held here)', (await ext0.evaluate(async () => (await chrome.storage.sync.get({ shotAutoCopy: false })).shotAutoCopy)) === true && await v.$eval('#autoCopy', e => e.checked));
  await v.close();
  v = await takeShot('visible');
  const auto = await waitFor(() => v.$eval('#status', e => e.textContent).then(t => /Copied|Couldn/.test(t) ? t : ''), 8000);
  check('auto-copy on: the new screenshot is copied as soon as it opens', /^Copied to your clipboard/.test(auto || ''), auto);
  check('…and the box is ticked', await v.$eval('#autoCopy', e => e.checked));
  await v.click('#autoCopy'); await sleep(400);
  check('unticking turns it off again', (await ext0.evaluate(async () => (await chrome.storage.sync.get({ shotAutoCopy: false })).shotAutoCopy)) === false);
  await v.close();
  const opt = await browser.newPage(); await opt.goto(X + 'options.html'); await opt.waitForSelector('#shotAutoCopy');
  check('the Settings page has the same switch', !(await opt.$eval('#shotAutoCopy', e => e.checked)));
  await opt.click('#shotAutoCopy'); await sleep(400);
  check('…and it works from there too', (await ext0.evaluate(async () => (await chrome.storage.sync.get({ shotAutoCopy: false })).shotAutoCopy)) === true);
  await opt.close();

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll shot-viewer tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
