// "My notes": all pages with notes, search, Markdown export, backup / restore.
(() => {
  const K = KNCore;
  const M = KRMedia;
  const $ = id => document.getElementById(id);

  let pages = [];                 // [{ key, ...page }]
  const selected = new Set();
  const opened = new Set();
  const filter = { q: '', tag: '', case: '' };
  let format = 'md';
  let cite = '';
  let seals = [];
  let order = 'page';
  let canDownload = false;

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }

  function status(text, kind = '') {
    $('status').textContent = text || '';
    $('status').className = 'status' + (kind ? ' ' + kind : '');
  }

  async function loadPages() {
    const all = await chrome.storage.local.get(null);
    pages = Object.entries(all)
      .filter(([k, v]) => k.startsWith('kn:p:') && v && Array.isArray(v.items))
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    for (const k of [...selected]) if (!pages.some(p => p.key === k)) selected.delete(k);
    seals = ((await chrome.storage.local.get('kn:seals'))['kn:seals'] || []).slice().reverse();
  }

  const hostOf = u => { try { return new URL(u).hostname; } catch (_) { return ''; } };

  function matches(page) {
    const q = filter.q;
    if (filter.tag && !page.items.some(i => (i.tags || []).includes(filter.tag))) return false;
    if (filter.case !== '' && (page.case || '') !== (filter.case === '\u0000none' ? '' : filter.case)) return false;
    if (!q) return true;
    if ((page.title + ' ' + page.url + ' ' + (page.note || '')).toLowerCase().includes(q)) return true;
    return page.items.some(i => itemText(i).includes(q));
  }

  const itemText = i => (i.quote + ' ' + (i.note || '') + ' ' + (i.tags || []).join(' ')).toLowerCase();

  // Text with the search words marked (built with DOM nodes: nothing from a page is ever parsed as HTML).
  function marked(text) {
    const q = filter.q;
    if (!q) return text;
    const out = [];
    const lower = text.toLowerCase();
    let i = 0, at;
    while ((at = lower.indexOf(q, i)) !== -1) {
      out.push(text.slice(i, at), h('mark', { text: text.slice(at, at + q.length) }));
      i = at + q.length;
    }
    out.push(text.slice(i));
    return out;
  }

  function render() {
    const shown = pages.filter(matches);
    // tag chips across everything
    const tags = [...new Set(pages.flatMap(p => p.items.flatMap(i => i.tags || [])))].sort();
    $('tags').replaceChildren(...tags.map(t => h('button', { class: 'chip' + (filter.tag === t ? ' on' : ''), text: '#' + t, onclick: () => { filter.tag = filter.tag === t ? '' : t; render(); } })));

    const cases = [...new Set(pages.map(p => p.case || '').filter(Boolean))].sort();
    $('cases').replaceChildren(...(cases.length ? [h('span', { class: 'pmeta', text: 'Cases: ' })] : []),
      ...cases.map(c => h('button', { class: 'chip' + (filter.case === c ? ' on' : ''), text: c, onclick: () => { filter.case = filter.case === c ? '' : c; render(); } })),
      ...(cases.length && pages.some(p => !p.case) ? [h('button', { class: 'chip' + (filter.case === '\u0000none' ? ' on' : ''), text: 'No case', onclick: () => { filter.case = filter.case === '\u0000none' ? '' : '\u0000none'; render(); } })] : []));

    const list = $('list');
    if (!pages.length) { list.replaceChildren(h('div', { class: 'empty', text: 'No notes yet.' })); renderLog(); updateButtons(); return; }
    if (!shown.length) { list.replaceChildren(h('div', { class: 'empty', text: 'Nothing matches your search.' })); renderLog(); updateButtons(); return; }
    const out = [];
    const groups = cases.length ? [...cases, ''] : [null];
    for (const g of groups) {
      const inGroup = g === null ? shown : shown.filter(p => (p.case || '') === g);
      if (!inGroup.length) continue;
      if (g !== null) out.push(h('div', { class: 'group-title', text: g || 'No case' }));
      out.push(...inGroup.map(pageCard));
    }
    list.replaceChildren(...out);
    renderLog();
    updateButtons();
  }

  function renderLog() {
    const box = $('log');
    if (!seals.length) { box.replaceChildren(h('p', { class: 'pmeta', text: 'No captures yet.' })); return; }
    const head = h('tr', null, ...['When (UTC)', 'Case', 'Page', 'Manifest SHA-256'].map(t => h('th', { text: t })));
    box.replaceChildren(h('table', { class: 'log' }, head, ...seals.map(r => h('tr', null,
      h('td', { text: r.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z') }), h('td', { text: r.case || '' }),
      h('td', null, h('a', { href: r.url, target: '_blank', rel: 'noreferrer noopener', text: r.title || r.url })),
      h('td', null, h('code', { text: r.manifestSha256 }))))));
  }

  function pageCard(p) {
    const open = opened.has(p.key) || !!filter.q || !!filter.tag;
    const card = h('div', { class: 'page' + (open ? ' open' : '') });
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + p.title, onchange: () => { cb.checked ? selected.add(p.key) : selected.delete(p.key); updateButtons(); } });
    cb.checked = selected.has(p.key);
    const link = h('a', { href: p.url, target: '_blank', rel: 'noreferrer noopener' }, marked(p.title || p.url));
    const when = p.updated ? new Date(p.updated).toLocaleString() : '';
    card.append(h('div', { class: 'phead' }, cb,
      h('div', { class: 'ptitle' }, link, h('div', { class: 'pmeta' }, p.case ? h('span', { class: 'case', text: p.case }) : null, hostOf(p.url) + ' · ' + p.items.length + ' highlight' + (p.items.length === 1 ? '' : 's') + (when ? ' · ' + when : ''))),
      h('button', { class: 'ghost small', text: open ? 'Hide' : 'Show', onclick: () => { opened.has(p.key) ? opened.delete(p.key) : opened.add(p.key); render(); } }),
      h('button', { class: 'ghost small', text: 'Export', onclick: () => exportPages([p]) }),
      h('button', { class: 'ghost small', text: 'Delete', onclick: () => deletePage(p) })));
    if ((p.note || '').trim()) card.append(h('div', { class: 'pnote' }, marked(p.note)));
    const items = h('div', { class: 'items' });
    for (const it of K.sortItems(p.items)) {
      if (filter.tag && !(it.tags || []).includes(filter.tag)) continue;
      if (filter.q && !itemText(it).includes(filter.q) && !(p.title + ' ' + p.url).toLowerCase().includes(filter.q)) continue;
      const timed = K.isTime(it);
      const meta = h('div', { class: 'm' }, timed ? '⏱ ' + K.fmtTime(it.t) + (it.media && it.media.title ? ' — ' + it.media.title : '') : K.LABELS[it.color] || 'Highlight');
      if (it.tags && it.tags.length) meta.append(' · ' + it.tags.map(t => '#' + t).join(' '));
      if (timed) { const l = it.media && it.media.src ? K.timeUrl(it.media.src, it.t) : ''; if (l) meta.append(' · ', h('a', { href: l, target: '_blank', rel: 'noreferrer noopener', text: 'Play from here' })); }
      else if (!it.orphan) meta.append(' · ', h('a', { href: K.passageUrl(p.url, it), target: '_blank', rel: 'noreferrer noopener', text: 'Open at this passage' }));
      else meta.append(' · passage not found last time');
      items.append(h('div', { class: 'item c-' + (K.COLORS.includes(it.color) ? it.color : 'yellow') + (it.orphan ? ' orphan' : '') },
        timed ? null : h('p', { class: 'q' }, marked(it.quote)),
        it.note ? h('p', { class: 'n' }, marked(it.note)) : null, meta));
    }
    card.append(items);
    return card;
  }

  function updateButtons() {
    const n = [...selected].filter(k => pages.some(p => p.key === k)).length;
    $('exportSel').disabled = !n;
    $('exportSel').textContent = 'Export selected (' + n + ') as Markdown';
  }

  // ---------- export ----------

  const baseName = p => M.sanitizeName(p.title || hostOf(p.url) || 'notes', 'notes', 80);

  async function save(blob, name) {
    await M.saveBlob(blob, name, { useDownloads: canDownload });
  }

  const ankiLabels = () => new Set([...document.querySelectorAll('#ankiLabels input:checked')].map(i => i.value));
  const opts = exportedAt => ({ order, citation: cite, exportedAt });

  async function exportPages(list) {
    if (!list.length) return;
    const exportedAt = new Date();
    try {
      if (format === 'pdf') {
        if (list.length > 1) return status('PDF exports one page at a time. Tick a single page, or choose Word / Markdown for several.', 'err');
        return printPdf(list[0], exportedAt);
      }
      if (format.startsWith('anki')) return exportAnki(list, format === 'anki-cloze' ? 'cloze' : 'basic', exportedAt);

      const ext = format === 'docx' ? 'docx' : 'md';
      const make = async p => {
        if (ext === 'md') return { data: K.toMarkdown(p, opts(exportedAt)), type: 'text/markdown' };
        return { data: await KRDocx.toDocx(K.toModel(p, opts(exportedAt)), { images: new Map(), videos: 'links', meta: true, paper: 'letter', savedAt: exportedAt }), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      };
      if (list.length === 1) {
        const p = list[0];
        const out = await make(p);
        await save(out.data instanceof Blob ? out.data : new Blob([out.data], { type: out.type }), baseName(p) + ' – notes.' + ext);
        status('Saved ' + baseName(p) + ' – notes.' + ext, 'ok');
        return;
      }
      const used = new Set();
      const entries = [];
      const index = [];
      for (const p of list) {
        let name = baseName(p) + '.' + ext;
        for (let i = 2; used.has(name); i++) name = baseName(p) + ' (' + i + ').' + ext;
        used.add(name);
        entries.push({ name: 'Notes/' + name, data: (await make(p)).data });
        index.push({ title: p.title || p.url, file: name, count: p.items.length, tags: [...new Set(p.items.flatMap(i => i.tags || []))], case: p.case || '' });
      }
      entries.unshift({ name: 'Notes/index.md', data: K.indexMd(index, { exportedAt }) });
      await save(await KRZip.createZip(entries, { date: exportedAt }), 'My notes (' + list.length + ' pages).zip');
      status('Saved a .zip with ' + list.length + ' ' + (ext === 'docx' ? 'Word' : 'Markdown') + ' files and an index.', 'ok');
    } catch (e) {
      status('Couldn’t export: ' + (e && e.message || e), 'err');
    }
  }

  async function exportAnki(list, type, exportedAt) {
    const labels = ankiLabels();
    if (!labels.size) return status('Choose at least one label to make cards from.', 'err');
    const deck = list.length === 1 ? (list[0].title || 'Notes') : 'PageMate notes';
    let head = null, rows = [], skipped = 0;
    for (const p of list) {
      const r = K.toAnki(p, { type, labels, deck });
      const lines = r.text.split('\n').filter(Boolean);
      if (!head) head = lines.filter(l => l.startsWith('#'));
      rows.push(...lines.filter(l => !l.startsWith('#')));
      skipped += r.skipped;
    }
    if (!rows.length) return status(type === 'basic' ? 'No cards: in this style a highlight needs a note (it becomes the answer). Add notes, or use fill-in-the-blank.' : 'No highlights with the chosen labels.', 'err');
    const name = (list.length === 1 ? baseName(list[0]) : 'My notes') + ' – flashcards (' + (type === 'cloze' ? 'cloze' : 'basic') + ').txt';
    await save(new Blob([head.join('\n') + '\n' + rows.join('\n') + '\n'], { type: 'text/plain' }), name);
    status('Saved ' + rows.length + ' flashcard' + (rows.length === 1 ? '' : 's') + (skipped ? ' (' + skipped + ' skipped: no note)' : '') + '. In Anki: File → Import, pick the file; the note type and deck are set inside it.', 'ok');
  }

  async function printPdf(p, exportedAt) {
    const article = KRRender.renderDocument(K.toModel(p, opts(exportedAt)), { images: null, videos: 'none', meta: true, savedAt: exportedAt }, document);
    const root = $('printRoot');
    root.replaceChildren(article);
    const oldTitle = document.title;
    document.title = baseName(p) + ' – notes';
    const restore = () => { document.title = oldTitle; root.replaceChildren(); window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    status('In the print window, set Destination to “Save as PDF”.');
    await new Promise(r => setTimeout(r, 50));
    window.print();
  }

  async function deletePage(p) {
    if (!confirm('Delete all ' + p.items.length + ' highlight(s) and notes for “' + (p.title || p.url) + '”? This can’t be undone (a backup first is a good idea).')) return;
    const idx = (await chrome.storage.local.get('kn:idx'))['kn:idx'] || {};
    delete idx[p.key];
    await chrome.storage.local.remove(p.key);
    await chrome.storage.local.set({ 'kn:idx': idx });
    status('Deleted.', 'ok');
  }

  // ---------- backup / restore ----------

  async function backup() {
    const data = { format: 'kokoro-notes', version: 1, exported: new Date().toISOString(), pages: pages.map(({ key, ...p }) => p) };
    await save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'PageMate notes backup ' + data.exported.slice(0, 10) + '.json');
    status('Backup saved (' + pages.length + ' pages).', 'ok');
  }

  const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

  // A backup file is untrusted input: keep only the fields we know, with sane types and sizes.
  function cleanItem(raw) {
    if (!raw || typeof raw.quote !== 'string' || !raw.quote.trim()) return null;
    return {
      id: str(raw.id, 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      quote: raw.quote.slice(0, 4000), prefix: str(raw.prefix, 200), suffix: str(raw.suffix, 200),
      pos: Number.isFinite(raw.pos) ? raw.pos : null,
      color: K.COLORS.includes(raw.color) ? raw.color : 'yellow',
      note: str(raw.note, 20000),
      tags: (Array.isArray(raw.tags) ? raw.tags : []).map(K.cleanTag).filter(Boolean).slice(0, 30),
      created: str(raw.created, 40) || new Date().toISOString(), multi: !!raw.multi
    };
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { return status('That file isn’t a valid backup.', 'err'); }
    if (!data || data.format !== 'kokoro-notes' || !Array.isArray(data.pages)) return status('That doesn’t look like a PageMate notes backup.', 'err');
    const idx = (await chrome.storage.local.get('kn:idx'))['kn:idx'] || {};
    let added = 0, pagesTouched = 0;
    const writes = {};
    for (const raw of data.pages) {
      const key = K.pageKey(raw && raw.url);
      if (key === 'kn:p:') continue;
      const existing = (await chrome.storage.local.get(key))[key];
      const page = existing || { url: str(raw.url, 2000), title: str(raw.title, 300), note: str(raw.note, 20000), items: [], created: str(raw.created, 40) || new Date().toISOString() };
      const have = new Set(page.items.map(i => i.id));
      for (const r of Array.isArray(raw.items) ? raw.items : []) {
        const it = cleanItem(r);
        if (it && !have.has(it.id)) { page.items.push(it); have.add(it.id); added++; }
      }
      if (existing && !(existing.note || '').trim() && raw.note) page.note = str(raw.note, 20000);
      page.updated = new Date().toISOString();
      writes[key] = page;
      idx[key] = { url: page.url, title: page.title, count: page.items.length, updated: page.updated, tags: [...new Set(page.items.flatMap(i => i.tags || []))] };
      pagesTouched++;
    }
    await chrome.storage.local.set({ ...writes, 'kn:idx': idx });
    status('Imported ' + added + ' highlight' + (added === 1 ? '' : 's') + ' across ' + pagesTouched + ' page' + (pagesTouched === 1 ? '' : 's') + '.', 'ok');
  }

  // ---------- wiring ----------

  async function refresh() { await loadPages(); render(); }

  $('q').addEventListener('input', () => { filter.q = $('q').value.trim().toLowerCase(); render(); });
  $('order').addEventListener('change', () => { order = $('order').value; chrome.storage.sync.set({ knOrder: order }); });
  $('cite').addEventListener('change', () => { cite = $('cite').value; chrome.storage.sync.set({ knCite: cite }); });
  $('format').addEventListener('change', () => { format = $('format').value; chrome.storage.sync.set({ knFormat: format }); $('ankiLabels').hidden = !format.startsWith('anki'); });
  $('logCsv').addEventListener('click', async () => {
    if (!seals.length) return status('No captures to export yet.', 'err');
    await save(new Blob([KNEvidence.logCsv(seals.slice().reverse().map(r => ({ at: r.at, case: r.case, url: r.url, title: r.title, manifestSha256: r.manifestSha256, package: r.package })))], { type: 'text/csv' }), 'Capture log.csv');
    status('Capture log saved.', 'ok');
  });
  $('selAll').addEventListener('click', () => { for (const p of pages.filter(matches)) selected.add(p.key); render(); });
  $('selNone').addEventListener('click', () => { selected.clear(); render(); });
  $('exportSel').addEventListener('click', () => exportPages(pages.filter(p => selected.has(p.key))));
  $('backup').addEventListener('click', backup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => { const f = $('importFile').files[0]; $('importFile').value = ''; if (f) await importBackup(f); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && Object.keys(changes).some(k => k.startsWith('kn:p:') || k === 'kn:seals')) refresh(); });

  (async () => {
    try {
      const s = await chrome.storage.sync.get({ knOrder: 'page', knCite: '', knFormat: 'md' });
      order = s.knOrder; cite = s.knCite; format = s.knFormat;
      $('order').value = order; $('cite').value = cite; $('format').value = format; $('ankiLabels').hidden = !format.startsWith('anki');
    } catch (_) {}
    try { canDownload = await chrome.permissions.contains({ permissions: ['downloads'] }); } catch (_) {}
    await refresh();
    // Opened from the sidebar ("Word / PDF…"): preselect that page.
    const focus = /#focus=(.+)$/.exec(location.hash);
    if (focus) {
      const key = decodeURIComponent(focus[1]);
      if (pages.some(p => p.key === key)) { selected.add(key); opened.add(key); render(); status('Choose Word or PDF in the format list, then press Export selected.'); }
    }
  })();
})();
