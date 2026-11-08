// Drives the Notes feature in a real browser with the real extension.
// (Permissions are pre-granted in a COPY of the manifest, as in run-extension.js.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./fixture-site.js');
const CHROME = require('./chrome');
const SP = process.env.SCRATCH || os.tmpdir();
const SRC = path.join(__dirname, '../extension');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000, step = 120) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const listFiles = d => { const out = []; const walk = p => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const fp = path.join(p, f.name); f.isDirectory() ? walk(fp) : out.push(fp); } }; if (fs.existsSync(d)) walk(d); return out; };

(async () => {
  const run = Date.now();
  const ext = path.join(SP, 'notes-ext-' + run), dl = path.join(SP, 'notes-dl-' + run), profile = path.join(SP, 'notes-profile-' + run);
  fs.cpSync(SRC, ext, { recursive: true });
  fs.mkdirSync(dl, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.permissions.push('downloads');
  mf.host_permissions = ['http://*/*', 'https://*/*'];
  delete mf.optional_permissions; delete mf.optional_host_permissions;
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: dl, prompt_for_download: false }, savefile: { default_directory: dl } }));

  const site = await start();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile,
    args: ['--no-sandbox', '--host-resolver-rules=MAP *.kaltura.com ~NOTFOUND', '--disable-extensions-except=' + ext, '--load-extension=' + ext],
    ignoreDefaultArgs: ['--disable-extensions'], enableExtensions: [ext] });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const worker = await sw.worker();

  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() === 404) console.log('   404 for', r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '')); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|403|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(site.base + '/article', { waitUntil: 'networkidle0' });
  await page.bringToFront();
  const tabId = await worker.evaluate(async b => (await chrome.tabs.query({ url: b + '/*' }))[0].id, site.base);
  const cdp = await page.createCDPSession();

  // ---- helpers for the CLOSED shadow root (CDP can pierce it)
  const attrs = n => { const o = {}; for (let i = 0; n.attributes && i < n.attributes.length; i += 2) o[n.attributes[i]] = n.attributes[i + 1]; return o; };
  const tree = async () => (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root;
  const findAll = (n, pred, out = []) => { if (n.nodeType === 1 && pred(n, attrs(n))) out.push(n); for (const c of [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]) findAll(c, pred, out); return out; };
  const hasClass = (a, c) => (a.class || '').split(/\s+/).includes(c);
  const byClass = async (c, within) => findAll(within || await tree(), (n, a) => hasClass(a, c));
  const click = async node => {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId }).catch(() => {});
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const x = (model.content[0] + model.content[4]) / 2, y = (model.content[1] + model.content[5]) / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const type = async (node, text) => { await cdp.send('DOM.focus', { nodeId: node.nodeId }); await cdp.send('Input.insertText', { text }); };
  const enter = async () => { await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
  const store = () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find(x => x.startsWith('kn:p:')); return { key: k, page: k ? all[k] : null, idx: all['kn:idx'] || {} }; });
  const hlSize = name => page.evaluate(n => (CSS.highlights.get(n) || { size: 0 }).size, name);
  const selectText = (from, to) => page.evaluate((from, to) => {
    // select from the start of `from` (a unique phrase) to the end of `to`, across element boundaries
    const w = document.createTreeWalker(document.querySelector('#content'), NodeFilter.SHOW_TEXT);
    let a, b, n;
    while ((n = w.nextNode())) { if (!a && n.data.includes(from)) a = [n, n.data.indexOf(from)]; if (n.data.includes(to)) b = [n, n.data.indexOf(to) + to.length]; if (a && b) break; }
    const r = document.createRange(); r.setStart(...a); r.setEnd(...b);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return r.toString();
  }, from, to);

  // ----- open the sidebar via the same function the right-click menu uses
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-open' }), tabId);
  const hostThere = await waitFor(() => page.evaluate(() => !!document.getElementById('kn-host')));
  check('Notes opens on the page (menu action injects the script)', !!hostThere);
  let t = await tree();
  const panel = (await byClass('panel', t))[0];
  check('sidebar is shown with the empty-state help', panel && attrs(panel).hidden === undefined && (await byClass('empty', t)).length === 1);

  // ----- highlight a passage that crosses an element boundary (<strong>…</strong> text)
  const picked = await selectText('borrowing chords', 'parallel minor key');
  console.log('   selected:', JSON.stringify(picked));
  await sleep(300);
  t = await tree();
  const bar = (await byClass('bar', t)).find(n => attrs(n).role === 'toolbar');
  check('selecting text shows the color toolbar', bar && attrs(bar).hidden === undefined);
  const green = (await byClass('c-green', bar)).find(n => hasClass(attrs(n), 'dot'));
  await click(green);
  await sleep(700);
  let st = await store();
  const item = st.page && st.page.items[0];
  check('clicking a color saves a highlight (exact quote + context)', item && item.color === 'green' && item.quote === 'borrowing chords from the parallel minor key' && item.prefix.length > 0 && item.suffix.startsWith(', such as'), item && JSON.stringify(item.quote));
  check('page record has url, title and an index entry', st.page.url === site.base + '/article' && /Modal Interchange/.test(st.page.title) && st.idx[st.key] && st.idx[st.key].count === 1);
  check('highlight is drawn without touching the page HTML (CSS Custom Highlight)', (await hlSize('kn-green')) === 1 && (await page.evaluate(() => !document.querySelector('#content mark, #content [class*="kn-"]'))));

  // ----- note + tag
  t = await tree();
  const noteBox = (await byClass('note', t)).find(n => n.nodeName === 'TEXTAREA');
  await type(noteBox, 'Compare with the iv chord – exam question.');
  await sleep(700);
  t = await tree();
  const tagIn = findAll(t, (n, a) => n.nodeName === 'INPUT' && a['aria-label'] === 'Add tag')[0];
  await type(tagIn, 'Modal Interchange');
  await enter();
  await sleep(700);
  st = await store();
  check('typed note is saved', st.page.items[0].note === 'Compare with the iv chord – exam question.', JSON.stringify(st.page.items[0].note));
  check('tag is cleaned and saved', JSON.stringify(st.page.items[0].tags) === '["modal-interchange"]', JSON.stringify(st.page.items[0].tags));

  // ----- second highlight through the right-click path (message), different color via the sidebar
  await selectText('Inner paragraph in a div', 'Inner paragraph in a div');
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-highlight', color: 'yellow' }), tabId);
  await sleep(700);
  st = await store();
  check('"Highlight selection" menu action adds a second highlight', st.page.items.length === 2 && st.page.items[1].quote === 'Inner paragraph in a div');
  check('two colors are drawn', (await hlSize('kn-green')) === 1 && (await hlSize('kn-yellow')) === 1);

  // ----- export Markdown from the sidebar
  t = await tree();
  const exportBtn = findAll(t, (n, a) => a['aria-label'] === 'Export')[0];
  await click(exportBtn);
  await sleep(200);
  t = await tree();
  const dlBtn = findAll(t, (n, a) => n.nodeName === 'BUTTON' && hasClass(a, 'go') && hasClass(a, 'main'))[0];
  await click(dlBtn);
  const mdFile = await waitFor(() => listFiles(dl).find(f => /– notes\.md$/.test(f)), 15000);
  check('Markdown file downloaded', !!mdFile, mdFile && path.basename(mdFile));
  let md = '';
  if (mdFile) {
    md = fs.readFileSync(mdFile, 'utf8');
    console.log('   ---- exported ----\n' + md.split('\n').map(l => '   ' + l).join('\n') + '\n   ------------------');
    check('Markdown has frontmatter, quote, note, tag and a link back', md.startsWith('---\ntitle: "Week 3: Modal Interchange') && md.includes('> borrowing chords from the parallel minor key') && md.includes('Compare with the iv chord – exam question.') && md.includes('#modal-interchange') && md.includes('#:~:text=borrowing%20chords%20from%20the%20parallel%20minor%20key'));
    check('both highlights exported in page order', md.indexOf('borrowing chords') < md.indexOf('Inner paragraph'));
  }

  // ----- reload: highlights come back by themselves (boot script, no clicking)
  await page.reload({ waitUntil: 'networkidle0' });
  const back = await waitFor(async () => (await hlSize('kn-green')) === 1 && (await hlSize('kn-yellow')) === 1, 12000);
  check('after reload the highlights reappear automatically', !!back);
  const pillThere = await waitFor(async () => { const tt = await tree(); const p = (await byClass('pill', tt))[0]; return p && attrs(p).hidden === undefined; }, 5000);
  check('a small "✎ 2" tab shows the page has notes', !!pillThere);

  // ----- the page changes: wording edited near the passage, content inserted above
  await page.evaluate(() => {
    const strong = document.querySelector('#content p strong');
    const p = strong.parentElement;
    const intro = document.createElement('p'); intro.textContent = 'A new introductory paragraph that was added later to the page.'; p.parentElement.insertBefore(intro, p);
    strong.nextSibling.data = strong.nextSibling.data.replace('from the parallel', 'from the closely related parallel'); // edit INSIDE the highlighted passage
  });
  const kept = await waitFor(async () => (await hlSize('kn-green')) === 1 && !(await store()).page.items[0].orphan, 8000);
  check('passage edited in place: still found (approximate match) and not orphaned', !!kept);
  st = await store();
  check('stored position moved to follow the page', st.page.items[0].pos > 0);

  // ----- the passage disappears entirely
  await page.evaluate(() => { const p = [...document.querySelectorAll('#content p')].find(x => x.textContent.includes('Modal interchange means')); p.remove(); });
  const orphaned = await waitFor(async () => (await store()).page.items.find(i => i.color === 'green').orphan === true, 8000);
  check('passage removed from the page: marked as not found (never silently lost)', !!orphaned);
  st = await store();
  check('the note and tag survive', st.page.items.find(i => i.color === 'green').note.startsWith('Compare with') && st.page.items.length === 2);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-open' }), tabId);
  await sleep(500);
  t = await tree();
  check('the sidebar says so on that card', findAll(t, (n, a) => hasClass(a, 'warn')).length === 1);

  // ----- notes manager page
  const mgr = await browser.newPage();
  await mgr.setViewport({ width: 1100, height: 900 });
  await mgr.goto(`chrome-extension://${extId}/notes.html`);
  await waitFor(() => mgr.$('.page'));
  const listed = await mgr.$$eval('.page', ps => ps.map(p => ({ title: p.querySelector('.ptitle a').textContent, meta: p.querySelector('.pmeta').textContent })));
  check('manager lists the page with its highlight count', listed.length === 1 && /Modal Interchange/.test(listed[0].title) && /2 highlights/.test(listed[0].meta), JSON.stringify(listed));
  await mgr.type('#q', 'iv chord');
  await sleep(300);
  const marks = await mgr.$$eval('mark', ms => ms.map(m => m.textContent));
  check('search finds text inside notes and marks it', marks.length >= 1 && /iv chord/i.test(marks[0]), JSON.stringify(marks));
  await mgr.$eval('#q', e => { e.value = 'zzzz-nothing'; e.dispatchEvent(new Event('input')); });
  await sleep(200);
  check('search with no match shows an empty state', (await mgr.$eval('#list', e => e.textContent)).includes('Nothing matches'));
  await mgr.$eval('#q', e => { e.value = ''; e.dispatchEvent(new Event('input')); });
  await sleep(200);
  await mgr.click('.page .phead button:nth-of-type(2)'); // Export
  const mdFiles = await waitFor(() => listFiles(dl).filter(f => /– notes\.md$/.test(f)).length >= 2 || listFiles(dl).filter(f => /notes( \(1\))?\.md$/.test(f)).length >= 2, 10000);
  check('manager "Export" writes a Markdown file', !!mdFiles);
  await mgr.click('#backup');
  const bak = await waitFor(() => listFiles(dl).find(f => /PageMate notes backup .*\.json$/.test(f)), 10000);
  check('backup .json written', !!bak);
  const bakData = JSON.parse(fs.readFileSync(bak, 'utf8'));
  check('backup contains the pages, items and notes', bakData.format === 'kokoro-notes' && bakData.pages.length === 1 && bakData.pages[0].items.length === 2);

  // delete, then restore from the backup
  mgr.on('dialog', d => d.accept());
  await mgr.click('.page .phead button:nth-of-type(3)'); // Delete
  const gone = await waitFor(async () => (await store()).page === null, 8000);
  check('"Delete" removes a page\'s notes', !!gone);
  const picker = await mgr.$('#importFile');
  await picker.uploadFile(bak);
  const restored = await waitFor(async () => { const s2 = await store(); return s2.page && s2.page.items.length === 2; }, 8000);
  check('importing the backup restores the notes', !!restored);
  st = await store();
  check('restored notes keep note text, tags and colors', st.page.items.some(i => i.note.startsWith('Compare with') && i.tags[0] === 'modal-interchange' && i.color === 'green'));

  // hostile backup content must not become markup or break anything
  const evil = path.join(dl, 'evil.json');
  fs.writeFileSync(evil, JSON.stringify({ format: 'kokoro-notes', version: 1, pages: [{ url: site.base + '/evil', title: '<img src=x onerror=window.__pwned=1>', note: '<script>window.__pwned=1</script>', items: [{ id: 'e1', quote: '<b onmouseover=window.__pwned=1>hi</b>', color: 'javascript:alert(1)', note: '"><svg onload=window.__pwned=1>', tags: ['<x>'] }, { quote: 5 }, null] }] }));
  await (await mgr.$('#importFile')).uploadFile(evil);
  await sleep(1200);
  const safe = await mgr.evaluate(() => ({ pwned: !!window.__pwned, imgs: document.querySelectorAll('#list img, #list svg, #list script, #list b').length, text: document.querySelector('#list').textContent.includes('<b onmouseover') }));
  check('hostile backup is shown as plain text only (no markup, no script)', !safe.pwned && safe.imgs === 0 && safe.text, JSON.stringify(safe));
  const evilStored = await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find(x => x.includes('/evil')); return k ? all[k] : null; });
  check('import sanitised the odd values (bad color -> yellow, junk items dropped)', evilStored && evilStored.items.length === 1 && evilStored.items[0].color === 'yellow' && evilStored.items[0].tags[0] === 'x');

  check('no errors on the page or the manager', errors.length === 0, errors.join(' | '));
  await browser.close(); site.server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
