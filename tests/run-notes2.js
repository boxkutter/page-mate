// Second wave of Notes, in a real browser: case, citation, video-time notes, Anki, read-aloud,
// manager (Word / PDF / Anki), notes inside the saved page + PDF, and the sealed capture.
// (Permissions are pre-granted in a COPY of the manifest, as in run-extension.js.)
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
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
  const ext = path.join(SP, 'n2-ext-' + run), dl = path.join(SP, 'n2-dl-' + run), profile = path.join(SP, 'n2-profile-' + run);
  fs.cpSync(SRC, ext, { recursive: true });
  fs.mkdirSync(dl, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  mf.permissions.push('downloads', 'pageCapture');
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
  await page.setViewport({ width: 1300, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|403|404/.test(m.text())) errors.push(m.text()); });
  await page.goto(site.base + '/article', { waitUntil: 'networkidle0' });
  await page.bringToFront();
  const tabId = await worker.evaluate(async b => (await chrome.tabs.query({ url: b + '/*' }))[0].id, site.base);
  const cdp = await page.createCDPSession();

  // ---- helpers for the CLOSED shadow root
  const attrs = n => { const o = {}; for (let i = 0; n.attributes && i < n.attributes.length; i += 2) o[n.attributes[i]] = n.attributes[i + 1]; return o; };
  const tree = async () => (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root;
  const findAll = (n, pred, out = []) => { if (n.nodeType === 1 && pred(n, attrs(n))) out.push(n); for (const c of [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]) findAll(c, pred, out); return out; };
  const hasClass = (a, c) => (a.class || '').split(/\s+/).includes(c);
  const textOf = n => (n.nodeValue || '') + (n.children || []).map(textOf).join('');
  const byLabel = (t, label) => findAll(t, (n, a) => a['aria-label'] === label)[0];
  const byTitle = (t, title) => findAll(t, (n, a) => a.title === title)[0];
  const byText = (t, text) => findAll(t, n => n.nodeName === 'BUTTON' && textOf(n).trim() === text)[0];
  const click = async node => {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId }).catch(() => {});
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const x = (model.content[0] + model.content[4]) / 2, y = (model.content[1] + model.content[5]) / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const type = async (node, text) => { await cdp.send('DOM.focus', { nodeId: node.nodeId }); await cdp.send('Input.insertText', { text }); };
  const store = async () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find(x => x.startsWith('kn:p:')); return { key: k, page: k ? all[k] : null, idx: all['kn:idx'] || {}, seals: all['kn:seals'] || [] }; });
  const selectText = (from, to) => page.evaluate((from, to) => {
    const w = document.createTreeWalker(document.querySelector('#content'), NodeFilter.SHOW_TEXT);
    let a, b, n;
    while ((n = w.nextNode())) { if (!a && n.data.includes(from)) a = [n, n.data.indexOf(from)]; if (n.data.includes(to)) b = [n, n.data.indexOf(to) + to.length]; if (a && b) break; }
    const r = document.createRange(); r.setStart(...a); r.setEnd(...b);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return r.toString();
  }, from, to);
  const openMenu = async () => { await click(byLabel(await tree(), 'Export')); await sleep(150); };

  // ----- two highlights (the same path the right-click menu uses)
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-open' }), tabId);
  await waitFor(() => page.evaluate(() => !!document.getElementById('kn-host')));
  await selectText('borrowing chords', 'parallel minor key');
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-highlight', color: 'green' }), tabId);
  await sleep(500);
  await selectText('Inner paragraph in a div', 'Inner paragraph in a div');
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-highlight', color: 'yellow' }), tabId);
  await sleep(600);
  let st = await store();
  check('two highlights exist, with sentence context for flashcards', st.page && st.page.items.length === 2 && typeof st.page.items[0].cb === 'string' && st.page.items[0].cb.length > 0 && typeof st.page.items[0].ca === 'string', JSON.stringify(st.page.items[0] && { cb: st.page.items[0].cb, ca: st.page.items[0].ca }));

  // ----- note text on the first highlight (needed for "Basic" Anki cards)
  let t = await tree();
  const noteBox = findAll(t, (n, a) => n.nodeName === 'TEXTAREA' && hasClass(a, 'note'))[0];
  await type(noteBox, 'The iv chord borrowed from minor.');
  await sleep(600);

  // ----- case / folder
  t = await tree();
  await type(byLabel(t, 'Case or folder'), 'Harmony II / Exam 2');
  await sleep(700);
  st = await store();
  check('case is saved on the page and in the index', st.page.case === 'Harmony II / Exam 2' && st.idx[st.key].case === 'Harmony II / Exam 2');

  // ----- citation panel, filled from the page's own metadata
  t = await tree();
  await click(byTitle(t, 'Citation for this page (APA, MLA, Chicago)'));
  await sleep(400);
  t = await tree();
  const out = findAll(t, (n, a) => hasClass(a, 'out'))[0];
  const cite = textOf(out);
  check('citation is built from the page’s metadata (authors, date, site)', cite === 'Smith, J., & Lee, C. (2024, March 5). Week 3: Modal Interchange – Harmony II. Harmony Today. ' + site.base + '/article', cite);
  st = await store();
  check('page details are stored with the notes', st.page.meta && st.page.meta.authors === 'Smith, Jane; Lee, Chris' && st.page.meta.published === '2024-03-05' && st.page.meta.site === 'Harmony Today');

  // ----- video notes (the fixture page has a real <video>)
  await page.evaluate(async () => { const v = document.getElementById('v1'); if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true })); v.currentTime = 5; await new Promise(r => v.addEventListener('seeked', r, { once: true })); });
  await worker.evaluate(id => notesCommand({ id }, { type: 'kn-open' }), tabId); // re-render so the sidebar notices the video
  await sleep(400);
  t = await tree();
  const nowBtn = byTitle(t, 'Add a note at the video’s current position');
  check('"Note at current time" appears when the page has a video', nowBtn && attrs(nowBtn).hidden === undefined);
  await click(nowBtn);
  await sleep(600);
  st = await store();
  const tn = st.page.items.find(i => i.kind === 'time');
  check('video note saved with the time and the video address', tn && tn.t === 5 && tn.media.src.endsWith('/protected/lesson3.mp4'), JSON.stringify(tn && { t: tn.t, src: tn.media && tn.media.src }));
  t = await tree();
  await type(byLabel(t, 'Time for a video note'), '1:02');
  await click(byText(t, '⏱ Add at time'));
  await sleep(600);
  st = await store();
  check('a typed time (1:02) adds a note at 62 seconds', st.page.items.some(i => i.kind === 'time' && i.t === 62));
  await page.evaluate(() => { document.getElementById('v1').currentTime = 0; });
  t = await tree();
  const tm = findAll(t, (n, a) => hasClass(a, 'tm'))[0];
  await click(tm);
  await sleep(500);
  const cur = await page.evaluate(() => document.getElementById('v1').currentTime);
  check('clicking a video note jumps the video to that moment', Math.abs(cur - 5) < 0.6, 'currentTime=' + cur);

  // ----- Markdown export: citation + case + video note
  await openMenu();
  t = await tree();
  await click(byText(t, 'Download Markdown (.md)'));
  const md = await waitFor(() => { const f = listFiles(dl).find(x => /– notes\.md$/.test(x)); return f && fs.readFileSync(f, 'utf8'); });
  check('Markdown has the case, an APA citation and the video notes with play links', md && md.includes('case: "Harmony II / Exam 2"') && md.includes('## Citation (APA 7)') && md.includes('Smith, J., & Lee, C. (2024, March 5).') && md.includes('⏱ 0:05') && md.includes('lesson3.mp4#t=5') && md.includes('⏱ 1:02'));

  // ----- Anki from the sidebar
  await openMenu();
  t = await tree();
  await click(byText(t, 'Anki flashcards: fill-in-the-blank (.txt)'));
  const cloze = await waitFor(() => listFiles(dl).find(x => /flashcards\.cloze\.txt$/.test(x)));
  const ctext = cloze && fs.readFileSync(cloze, 'utf8');
  check('Anki cloze file: header + the highlighted words hidden in their sentence', ctext && ctext.startsWith('#separator:tab\n#html:true\n#notetype:Cloze\n') && /\{\{c1::borrowing chords from the parallel minor key\}\}/.test(ctext) && !ctext.includes('⏱'), ctext && ctext.split('\n').slice(0, 8).join(' | ').slice(0, 300));
  await openMenu();
  t = await tree();
  await click(byText(t, 'Anki flashcards: highlight → note (.txt)'));
  const basic = await waitFor(() => listFiles(dl).find(x => /flashcards\.anki\.txt$/.test(x)));
  const btext = basic && fs.readFileSync(basic, 'utf8');
  const brows = btext ? btext.split('\n').filter(l => l && !l.startsWith('#')) : [];
  check('Anki basic file: only the highlight that has a note', brows.length === 1 && brows[0].startsWith('borrowing chords from the parallel minor key\tThe iv chord borrowed from minor.'), JSON.stringify(brows));

  // ----- Read aloud: hands the notes to the Kokoro reader
  await worker.evaluate(() => chrome.storage.sync.set({ serverUrl: 'http://127.0.0.1:9' }));
  t = await tree();
  await click(byLabel(t, 'Read notes aloud'));
  const reader = await waitFor(() => page.evaluate(() => !!document.getElementById('kr-player-host')), 10000);
  check('"Read notes aloud" starts the reader player on the page', !!reader);

  // ----- Manager: cases, Word, PDF, Anki
  const mgr = await browser.newPage();
  await mgr.setViewport({ width: 1200, height: 1000 });
  await mgr.goto(`chrome-extension://${extId}/notes.html`);
  await waitFor(() => mgr.$('.page'));
  const chips = await mgr.$$eval('#cases .chip', cs => cs.map(c => c.textContent));
  check('manager shows the case as a filter and groups pages under it', chips.includes('Harmony II / Exam 2') && (await mgr.$eval('#list', e => e.textContent)).includes('Harmony II / Exam 2'), JSON.stringify(chips));
  await mgr.select('#format', 'docx');
  await mgr.select('#cite', 'mla');
  await mgr.$eval('.page input[type=checkbox]', e => e.click());
  await mgr.click('#exportSel');
  const docx = await waitFor(() => listFiles(dl).find(x => /– notes\.docx$/.test(x)), 15000);
  check('manager: Word export written', !!docx);
  if (docx) {
    const xml = execFileSync('unzip', ['-p', docx, 'word/document.xml']).toString();
    check('Word file has the case, an MLA citation, the quote, the note and a video note', xml.includes('Case: ') && xml.includes('Citation (MLA 9)') && xml.includes('borrowing chords from the parallel minor key') && xml.includes('The iv chord borrowed from minor.') && xml.includes('0:05'));
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dl, docx], { stdio: 'ignore', timeout: 120000 });
    check('Word file opens in LibreOffice', listFiles(dl).some(f => /– notes\.pdf$/.test(f)));
  }
  await mgr.select('#format', 'pdf');
  await mgr.evaluate(() => { window.print = () => { window.__printed = true; window.__printHas = document.querySelector('#printRoot .kr-doc') ? document.querySelector('#printRoot').innerText : ''; }; });
  await mgr.click('#exportSel');
  await waitFor(() => mgr.evaluate(() => window.__printed), 5000);
  const printed = await mgr.evaluate(() => window.__printHas);
  check('manager: PDF prepares a print layout with the notes', /Notes: Week 3/.test(printed) && /borrowing chords/.test(printed) && /The iv chord borrowed from minor/.test(printed), printed.slice(0, 80));
  await mgr.select('#format', 'anki-cloze');
  const hintVisible = await mgr.$eval('#ankiLabels', e => !e.hidden);
  await mgr.click('#exportSel');
  const mcloze = await waitFor(() => listFiles(dl).find(x => /flashcards \(cloze\)\.txt$/.test(x)), 10000);
  check('manager: Anki export (label checkboxes shown) writes a file', hintVisible && !!mcloze);

  // ----- Save page: highlights + notes inside the PDF preview and the offline web page
  const save = await browser.newPage();
  await save.setViewport({ width: 1300, height: 1000 });
  const serrors = [];
  save.on('pageerror', e => serrors.push(e.message));
  save.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|403|404/.test(m.text())) serrors.push(m.text()); });
  await save.goto(`chrome-extension://${extId}/save.html?tab=${tabId}`);
  await save.waitForSelector('.kr-doc', { timeout: 20000 });
  await waitFor(async () => !(await save.$eval('#notesLabel', e => e.hidden)), 8000);
  check('Save page offers "My highlights and notes" because this page has notes', !(await save.$eval('#notesLabel', e => e.hidden)), await save.$eval('#notesHint', e => e.textContent));
  const marks = await waitFor(async () => { const n = await save.$$eval('#paper mark.kn-mark', ms => ms.length); return n >= 2 ? n : 0; }, 10000);
  check('PDF preview marks the highlights and lists the notes', marks >= 2 && (await save.$$eval('#paper .kn-notes li', l => l.length)) === 4, 'marks=' + marks);
  await save.click('input[name="format"][value="html"]');
  await sleep(300);
  await save.select('#optHtmlVideos', 'links');
  await save.select('#optPackage', 'folder');
  await save.click('#download');
  await waitFor(async () => /Saved to/.test(await save.$eval('#docStatus', e => e.textContent)), 60000);
  const indexFile = await waitFor(() => listFiles(dl).find(f => f.endsWith('/index.html') && f.includes('web page')));
  check('web page saved with the highlights built in', !!indexFile);
  if (indexFile) {
    const html = fs.readFileSync(indexFile, 'utf8');
    check('saved page carries highlight marks, numbered references and the notes list (still no scripts)', /class="kn-mark kn-green"/.test(html) && /class="kn-ref"/.test(html) && html.includes('class="kn-notes"') && html.includes('The iv chord borrowed from minor.') && !/<script/i.test(html));
    const off = await browser.newPage();
    await off.goto('file://' + indexFile);
    const view = await off.evaluate(() => ({ marks: document.querySelectorAll('mark.kn-mark').length, items: document.querySelectorAll('.kn-notes li').length, marked: [...document.querySelectorAll('mark.kn-green')].map(m => m.textContent).join('') }));
    check('opened offline: highlighted text is marked and the notes list is there', view.marks >= 2 && view.items === 4 && /borrowing chords/.test(view.marked), JSON.stringify(view));
    await off.close();
  }

  // ----- Capture & seal
  await save.click('#tab-capture');
  await sleep(500);
  check('capture tab pre-fills the case from the notes', (await save.$eval('#capCase', e => e.value)) === 'Harmony II / Exam 2');
  await save.type('#capBy', 'Test Examiner');
  await save.type('#capNote', 'Found via course page.');
  await save.click('#capGo');
  const sealed = await waitFor(async () => /Sealed/.test(await save.$eval('#capStatus', e => e.textContent)) || /Couldn/.test(await save.$eval('#capStatus', e => e.textContent)), 60000);
  const capStatus = await save.$eval('#capStatus', e => e.textContent);
  console.log('   capture status:', capStatus.slice(0, 200));
  check('capture and seal completes', /Sealed/.test(capStatus));
  const evZip = await waitFor(() => listFiles(dl).find(f => /Evidence[\\/].*\.zip$/.test(f)), 15000);
  check('sealed package .zip written into the Evidence folder', !!evZip, evZip && path.basename(evZip));
  if (evZip) {
    const work = fs.mkdtempSync(path.join(SP, 'seal-'));
    execFileSync('unzip', ['-q', evZip, '-d', work]);
    const folder = path.join(work, fs.readdirSync(work)[0]);
    const names = fs.readdirSync(folder).sort();
    check('package contents: capture, text, notes, manifest, sums, custody, readme', ['SHA256SUMS', 'README.txt', 'capture.mhtml', 'chain-of-custody.md', 'manifest.json', 'notes.json', 'notes.md', 'page-text.txt'].every(n => names.includes(n)), names.join(', '));
    const ver = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: folder, encoding: 'utf8' });
    check('`sha256sum -c SHA256SUMS` verifies every file', ver.status === 0 && (ver.stdout.match(/: OK/g) || []).length === 7, ver.stdout.replace(/\n/g, ' | '));
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    check('manifest: case, examiner, UTC time, url, tool version, highlights', manifest.case === 'Harmony II / Exam 2' && manifest.captured_by === 'Test Examiner' && /Z$/.test(manifest.captured_at_utc) && manifest.url === site.base + '/article' && manifest.tool_version === '1.6.0' && manifest.highlights_in_notes === 4 && manifest.examiner_note === 'Found via course page.');
    const mh = fs.readFileSync(path.join(folder, 'capture.mhtml'), 'utf8');
    check('capture.mhtml is a real page snapshot with the page content', /MIME-Version/i.test(mh.slice(0, 600)) && mh.includes('borrowing chords') || mh.includes('Modal Interchange'), 'size ' + mh.length);
    const shownHash = await save.$eval('#capHash', e => e.textContent);
    const actual = execFileSync('sha256sum', [path.join(folder, 'manifest.json')]).toString().split(' ')[0];
    check('the fingerprint shown on screen equals the manifest’s real SHA-256', shownHash === actual, shownHash.slice(0, 16) + '…');
    const custody = fs.readFileSync(path.join(folder, 'chain-of-custody.md'), 'utf8');
    check('custody record: states the limits and shows the same fingerprint', custody.includes(shownHash) && /not digitally signed/.test(custody) && /Test Examiner/.test(custody));
    const text = fs.readFileSync(path.join(folder, 'page-text.txt'), 'utf8');
    check('page-text.txt has the readable text', text.includes('borrowing chords') && text.includes('Final paragraph'));
    // tamper
    const b = fs.readFileSync(path.join(folder, 'page-text.txt')); b[b.length - 5] ^= 1; fs.writeFileSync(path.join(folder, 'page-text.txt'), b);
    check('changing one byte makes the real package fail verification', spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: folder, encoding: 'utf8' }).status !== 0);
  }
  st = await store();
  check('capture is added to the running log', st.seals.length === 1 && st.seals[0].case === 'Harmony II / Exam 2' && /^[0-9a-f]{64}$/.test(st.seals[0].manifestSha256));
  await mgr.reload();
  await waitFor(() => mgr.$('table.log'));
  check('manager shows the capture log', (await mgr.$$eval('table.log tr', r => r.length)) === 2);

  check('no unexpected errors on the page, the Save page or the manager', errors.length === 0 && serrors.length === 0, errors.concat(serrors).join(' | '));
  await browser.close(); site.server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
