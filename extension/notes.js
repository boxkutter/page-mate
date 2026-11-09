// Page side of Notes: selection toolbar, highlights, sidebar.
//
// Highlights are drawn with the browser's Custom Highlight API, so the page's own HTML is
// never modified. Each one is remembered as an exact quote plus the words around it, and
// found again by notes-core.js whenever the page is loaded.
// Injected on demand (right-click menu, shortcut) or, for pages that already have notes,
// by notes-boot.js. Needs notes-core.js and notes-dom.js (injected first) and notes.css.
(() => {
  const K = self.KNCore;
  const D = self.KNDom;
  const prev = window.__knNotes;
  if (prev) {
    let alive = false;
    try { alive = prev.isAlive(); } catch (_) {}
    if (alive) return;
    try { prev.teardown(); } catch (_) {}
  }
  for (const stale of document.querySelectorAll('#kn-host')) stale.remove();

  const MAX_QUOTE = 2000;
  const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,dd,dt,figcaption,article,section';
  const INDEX_OPTS = { exclude: '#kn-host', checkVisible: true };

  let page = null;            // { url, title, note, case, meta, items, created, updated }
  let key = '';
  let index = null;           // text of the page + where each character lives
  let anchors = new Map();    // item id -> Range
  let open = false;
  let dead = false;
  let saveTimer = null;
  let lastWrite = '';
  let observer = null;
  let reanchorTimer = null;
  let urlTimer = null;
  let lastUrl = location.href.split('#')[0];
  let order = 'page';
  let citeStyle = 'apa';
  let cases = [];
  let toastTimer = null;
  const filter = { q: '', colors: new Set(), tag: '' };
  const cleanups = [];

  // ---------- small helpers ----------

  const isAlive = () => { try { return !dead && !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  async function send(msg) {
    try { return await chrome.runtime.sendMessage(msg); } catch (_) { return null; }
  }

  const blockOf = n => { const el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest(BLOCK_SEL); };

  // ---------- storage ----------

  function pageUrl() { return location.href.split('#')[0]; }

  async function load() {
    key = K.pageKey(location.href);
    let r = {};
    try { r = await chrome.storage.local.get([key, 'kn:idx']); } catch (_) {}
    page = r[key] || { url: pageUrl(), title: document.title || '', note: '', case: '', items: [], created: new Date().toISOString() };
    page.items = page.items || [];
    cases = [...new Set(Object.values(r['kn:idx'] || {}).map(e => e.case).filter(Boolean))].sort();
    try {
      const s = await chrome.storage.sync.get({ knOrder: 'page', knCite: 'apa' });
      order = s.knOrder; citeStyle = s.knCite;
    } catch (_) {}
  }

  function persist(now) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, now ? 0 : 350);
  }

  async function save() {
    if (!isAlive() || !page) return;
    page.updated = new Date().toISOString();
    page.title = document.title || page.title;
    page.url = pageUrl();
    const empty = !page.items.length && !(page.note || '').trim() && !(page.shots || []).length;   // screenshots filed here keep the page alive
    try {
      const idx = (await chrome.storage.local.get('kn:idx'))['kn:idx'] || {};
      if (empty) { await chrome.storage.local.remove(key); delete idx[key]; }
      else {
        lastWrite = page.updated;
        const tags = [...new Set(page.items.flatMap(i => i.tags || []))];
        idx[key] = { url: page.url, title: page.title, count: page.items.length, updated: page.updated, tags, case: page.case || '' };
        await chrome.storage.local.set({ [key]: page });
      }
      await chrome.storage.local.set({ 'kn:idx': idx });
    } catch (e) {
      toast('Couldn’t save your notes: ' + (e && e.message ? e.message : e), true);
    }
  }

  // ---------- page details for citations ----------

  function pageMeta() {
    const meta = n => { const e = document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]'); return e ? (e.getAttribute('content') || '').trim() : ''; };
    const metas = n => [...document.querySelectorAll('meta[name="' + n + '"],meta[property="' + n + '"]')].map(e => (e.getAttribute('content') || '').trim()).filter(Boolean);
    let ld = null;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const flat = Array.isArray(data) ? data : data['@graph'] || [data];
        ld = flat.find(o => o && (o.datePublished || o.author)) || ld;
        if (ld && ld.datePublished) break;
      } catch (_) {}
    }
    const ldAuthors = ld && ld.author ? [].concat(ld.author).map(a => (typeof a === 'string' ? a : a && a.name)).filter(Boolean) : [];
    let authors = metas('citation_author');
    if (!authors.length) authors = [meta('author')].filter(a => a && !/^https?:/i.test(a));
    if (!authors.length) authors = ldAuthors;
    if (!authors.length) authors = metas('article:author').filter(a => !/^https?:/i.test(a));
    const time = document.querySelector('time[datetime]');
    const canonical = document.querySelector('link[rel="canonical"]');
    let url = pageUrl();
    try { if (canonical && /^https?:/i.test(canonical.href)) url = canonical.href; } catch (_) {}
    return {
      authors: authors.join('; '),
      title: meta('citation_title') || meta('og:title') || (document.title || '').trim(),
      site: meta('og:site_name') || (ld && ld.publisher && (ld.publisher.name || (typeof ld.publisher === 'string' ? ld.publisher : ''))) || location.hostname.replace(/^www\./, ''),
      published: (meta('citation_publication_date') || meta('citation_date') || meta('article:published_time') || (ld && ld.datePublished) || (time && time.getAttribute('datetime')) || '').slice(0, 10),
      url,
      accessed: new Date().toISOString().slice(0, 10)
    };
  }

  function ensureMeta() {
    if (!page.meta) { page.meta = pageMeta(); persist(); }
    return page.meta;
  }

  // ---------- anchoring + drawing highlights ----------

  function anchorAll() {
    if (!page) return;
    index = D.buildIndex(document.body || document.documentElement, INDEX_OPTS);
    anchors = new Map();
    const byColor = {};
    let changed = false;
    for (const it of page.items) {
      if (K.isTime(it)) continue;
      const hit = K.locate(index.text, it);
      const orphan = !hit;
      if (!!it.orphan !== orphan) { it.orphan = orphan; changed = true; }
      if (!hit) continue;
      const range = D.indexToRange(index, hit.start, hit.end);
      if (!range) { it.orphan = true; changed = true; continue; }
      anchors.set(it.id, range);
      (byColor[it.color] = byColor[it.color] || []).push(range);
      if (it.pos !== hit.start) { it.pos = hit.start; changed = true; }
    }
    drawHighlights(byColor);
    if (changed) persist();
    render();
  }

  function drawHighlights(byColor) {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    for (const c of K.COLORS) {
      const ranges = byColor[c];
      if (ranges && ranges.length) CSS.highlights.set('kn-' + c, new Highlight(...ranges));
      else CSS.highlights.delete('kn-' + c);
    }
  }

  function clearHighlights() {
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    for (const c of [...K.COLORS, 'active']) CSS.highlights.delete('kn-' + c);
  }

  function needsReanchor() {
    if (!page) return false;
    return page.items.some(it => !K.isTime(it) && it.orphan) || [...anchors.values()].some(r => r.collapsed || !r.startContainer.isConnected || !r.endContainer.isConnected);
  }

  // Pages that finish rendering late, or swap their content, get their highlights back.
  function watchPage() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      clearTimeout(reanchorTimer);
      reanchorTimer = setTimeout(() => { if (isAlive() && needsReanchor()) anchorAll(); }, 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function flash(id) {
    const r = anchors.get(id);
    if (!r || typeof CSS === 'undefined' || !CSS.highlights) return;
    const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    CSS.highlights.set('kn-active', new Highlight(r));
    setTimeout(() => CSS.highlights.delete('kn-active'), 1800);
  }

  // ---------- creating / editing highlights ----------

  function currentSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const el = anc.nodeType === 1 ? anc : anc.parentElement;
    if (!el || el.closest('#kn-host, input, textarea, [contenteditable=""], [contenteditable="true"]')) return null;
    return range;
  }

  function addFromSelection(color, withNote) {
    const range = currentSelection();
    if (!range) { openSidebar(); toast('Select some text on the page first, then choose a color.'); return; }
    const ix = D.buildIndex(document.body || document.documentElement, INDEX_OPTS);
    const span = D.rangeToIndex(ix, range);
    if (!span) { toast('Select a little more text.'); return; }
    if (span.e - span.s > MAX_QUOTE) { toast('That’s a long passage. Select less than ' + MAX_QUOTE + ' characters.'); return; }
    const sels = K.makeSelectors(ix.text, span.s, span.e);
    const existing = page.items.find(i => i.quote === sels.quote && Math.abs((i.pos || 0) - sels.pos) < 5);
    let item;
    if (existing) { existing.color = color; item = existing; }
    else {
      item = { id: newId(), ...sels, color, note: '', tags: [], created: new Date().toISOString(), multi: blockOf(range.startContainer) !== blockOf(range.endContainer) };
      page.items.push(item);
      ensureMeta();
    }
    persist();
    getSelection().removeAllRanges();
    hideBar();
    anchorAll();
    openSidebar();
    if (withNote) focusNote(item.id);
  }

  function reattach(id) {
    const item = page.items.find(i => i.id === id);
    const range = currentSelection();
    if (!item || !range) { toast('Select the passage on the page first, then press Re-attach.'); return; }
    const ix = D.buildIndex(document.body || document.documentElement, INDEX_OPTS);
    const span = D.rangeToIndex(ix, range);
    if (!span || span.e - span.s > MAX_QUOTE) { toast('Select a shorter, clearer passage.'); return; }
    Object.assign(item, K.makeSelectors(ix.text, span.s, span.e), { orphan: false, multi: blockOf(range.startContainer) !== blockOf(range.endContainer) });
    persist();
    getSelection().removeAllRanges();
    anchorAll();
  }

  let undo = null;
  function removeItem(id) {
    const i = page.items.findIndex(x => x.id === id);
    if (i < 0) return;
    undo = { item: page.items[i], at: i };
    page.items.splice(i, 1);
    persist();
    anchorAll();
    toast('Note deleted.', false, 'Undo', () => {
      if (!undo) return;
      page.items.splice(Math.min(undo.at, page.items.length), 0, undo.item);
      undo = null;
      persist();
      anchorAll();
    });
  }

  // ---------- video / audio time notes ----------

  function findMedia() {
    const list = [...document.querySelectorAll('video,audio')].filter(m => m.readyState > 0 || m.currentTime > 0 || m.duration > 0);
    if (!list.length) return null;
    const score = m => (!m.paused ? 1e9 : 0) + m.getBoundingClientRect().width * m.getBoundingClientRect().height;
    return list.sort((a, b) => score(b) - score(a))[0];
  }

  function mediaInfo(m) {
    let src = '';
    try { src = m.currentSrc && /^https?:/i.test(m.currentSrc) ? m.currentSrc : ''; } catch (_) {}
    const title = (m.getAttribute('aria-label') || m.getAttribute('title') || '').trim() || (document.title || '').trim();
    return { src, title: title.slice(0, 120) };
  }

  function parseTime(s) {
    const t = String(s || '').trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) return Math.floor(parseFloat(t));
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
  }

  function addTimeNote(seconds, media) {
    const item = { id: newId(), kind: 'time', t: Math.max(0, Math.floor(seconds)), quote: '', media: media || { src: '', title: (document.title || '').slice(0, 120) },
      color: 'blue', note: '', tags: [], created: new Date().toISOString() };
    page.items.push(item);
    ensureMeta();
    persist();
    render();
    openSidebar();
    focusNote(item.id);
  }

  function noteAtCurrentTime() {
    const m = findMedia();
    if (!m) return toast('No playing or loaded video found on this page. Type a time (like 12:35) instead.');
    addTimeNote(m.currentTime, mediaInfo(m));
  }

  function jumpToTime(it) {
    const m = findMedia();
    if (!m) return toast('No video on this page to jump in. The player may be inside an embedded frame.');
    try { m.currentTime = it.t; m.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
  }

  // ---------- UI ----------

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e8efee; }
    .layer > * { pointer-events: auto; }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid #3fbfb5; outline-offset: 1px; }
    .panel { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 344px; max-width: calc(100vw - 24px); display: flex; flex-direction: column;
      background: #16201f; border: 1px solid #2c3b3a; border-radius: 14px; box-shadow: 0 12px 34px rgba(0,0,0,.4); overflow: hidden; }
    .panel[hidden], .bar[hidden], .pill[hidden], .menu[hidden], .toast[hidden], .cite[hidden], [hidden] { display: none !important; }
    .head { display: flex; align-items: center; gap: 2px; padding: 10px 8px 8px 14px; border-bottom: 1px solid #2c3b3a; }
    .head b { font-size: 14px; }
    .count { color: #9fb3b1; margin-left: 4px; }
    .sp { flex: 1; }
    .ibtn { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: #cfe0de; }
    .ibtn:hover { background: #24312f; }
    .menu { position: absolute; right: 10px; top: 44px; z-index: 5; width: 262px; background: #1b2928; border: 1px solid #34504d; border-radius: 12px; padding: 10px; box-shadow: 0 10px 28px rgba(0,0,0,.45); }
    .menu label { display: block; font-size: 12px; color: #9fb3b1; margin: 8px 0 4px; }
    .menu select { width: 100%; font: inherit; color: inherit; background: #111a19; border: 1px solid #2c3b3a; border-radius: 8px; padding: 6px; }
    .menu .go { display: block; width: 100%; text-align: left; padding: 7px 10px; border-radius: 8px; margin-top: 4px; }
    .menu .go:hover { background: #24312f; }
    .menu .go.main { background: #3fbfb5; color: #0d1514; font-weight: 600; }
    .menu .go.main:hover { background: #57d0c6; }
    .menu hr { border: 0; border-top: 1px solid #2c3b3a; margin: 8px 0 4px; }
    .scroll { flex: 1; overflow: auto; padding: 10px 12px 12px; }
    textarea, input, select { font: inherit; color: inherit; background: #111a19; border: 1px solid #2c3b3a; border-radius: 8px; padding: 6px 8px; width: 100%; resize: none; }
    textarea::placeholder, input::placeholder { color: #70827f; }
    .pagenote { min-height: 52px; margin-bottom: 6px; }
    .row2 { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
    .row2 input { flex: 1; min-width: 0; }
    .small { font-size: 12px; padding: 3px 9px; border-radius: 8px; background: #24312f; white-space: nowrap; }
    .small:hover { background: #2d3d3b; }
    .cite { border: 1px solid #2c3b3a; border-radius: 10px; padding: 8px; margin-bottom: 8px; background: #1a2625; }
    .cite label { display: block; font-size: 12px; color: #9fb3b1; margin: 6px 0 2px; }
    .cite .out { margin-top: 8px; padding: 6px 8px; border-radius: 8px; background: #111a19; user-select: text; font-size: 12.5px; overflow-wrap: anywhere; }
    .filters { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; flex: none; }
    .dot.on { border-color: #fff; }
    .dot.off { opacity: .35; }
    .c-yellow { --c: #f2c200; } .c-green { --c: #3fbf74; } .c-blue { --c: #4a9bff; } .c-pink { --c: #ff6ea0; }
    .dot { background: var(--c); }
    .tagbar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .chip { background: #24312f; border-radius: 999px; padding: 1px 8px; font-size: 12px; color: #cfe0de; }
    .chip.on { background: #3fbfb5; color: #0d1514; }
    .card { position: relative; border: 1px solid #2c3b3a; border-left: 4px solid var(--c, #888); border-radius: 10px; padding: 8px 10px 8px 10px; margin-bottom: 8px; background: #1a2625; }
    .card.hot { box-shadow: 0 0 0 2px var(--c); }
    .card.orphan { opacity: .75; border-style: dashed; border-left-style: solid; }
    .card.time { border-left-style: double; }
    .q { margin: 0 0 6px; cursor: pointer; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; color: #e8efee; }
    .q:hover { color: #fff; }
    .card.expanded .q { -webkit-line-clamp: unset; }
    .tm { font-weight: 600; cursor: pointer; margin: 0 0 6px; }
    .warn { font-size: 12px; color: #f3b1a8; margin: 0 0 6px; }
    .note { min-height: 30px; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
    .tags input { width: 90px; padding: 1px 6px; font-size: 12px; border-radius: 999px; }
    .chip button { margin-left: 4px; color: inherit; opacity: .7; }
    .acts { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .acts .dot { width: 14px; height: 14px; }
    .acts .link { font-size: 12px; color: #9fb3b1; padding: 2px 6px; border-radius: 6px; }
    .acts .link:hover { background: #24312f; color: #fff; }
    .empty { color: #9fb3b1; padding: 18px 8px; text-align: center; }
    .toast { position: absolute; left: 12px; right: 12px; bottom: 12px; background: #2b3a38; border: 1px solid #3a504d; border-radius: 10px; padding: 8px 10px; display: flex; gap: 10px; align-items: center; z-index: 6; }
    .toast.err { border-color: #b33b2e; }
    .toast button { color: #7fd8d0; font-weight: 600; }
    .bar { position: fixed; display: flex; gap: 6px; align-items: center; background: #16201f; border: 1px solid #34504d; border-radius: 999px; padding: 6px 8px; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
    .bar .dot { width: 22px; height: 22px; cursor: pointer; }
    .bar .dot:hover { border-color: #fff; }
    .bar .note-btn { padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #24312f; }
    .pill { position: absolute; right: 0; top: 50%; transform: translateY(-50%); background: #16201f; border: 1px solid #2c3b3a; border-right: 0; border-radius: 10px 0 0 10px; padding: 8px 8px 8px 10px; box-shadow: -4px 4px 14px rgba(0,0,0,.3); }
    @media (prefers-color-scheme: light) {
      .layer { color: #15201f; }
      .panel, .bar, .pill { background: #fbfcfc; border-color: #d5dfde; box-shadow: 0 12px 34px rgba(0,0,0,.18); }
      .head { border-color: #e1e9e8; }
      .count { color: #5a6b6a; }
      .ibtn { color: #33504d; } .ibtn:hover { background: #eaf0ef; }
      .menu { background: #fff; border-color: #cfdcdb; } .menu label { color: #5a6b6a; } .menu select { background: #f4f7f6; border-color: #d5dfde; }
      .menu .go:hover { background: #eaf0ef; } .menu .go.main { background: #1d7874; color: #fff; } .menu hr { border-color: #e1e9e8; }
      textarea, input, select { background: #f4f7f6; border-color: #d5dfde; } textarea::placeholder, input::placeholder { color: #8a9b99; }
      .small { background: #e6eeed; } .small:hover { background: #dbe6e5; }
      .cite { background: #fff; border-color: #d5dfde; } .cite label { color: #5a6b6a; } .cite .out { background: #f4f7f6; }
      .chip { background: #e6eeed; color: #33504d; } .chip.on { background: #1d7874; color: #fff; }
      .card { background: #fff; border-color: #d5dfde; } .q, .q:hover { color: #15201f; }
      .warn { color: #b33b2e; }
      .acts .link { color: #5a6b6a; } .acts .link:hover { background: #eaf0ef; color: #15201f; }
      .empty { color: #5a6b6a; }
      .toast { background: #eef3f2; border-color: #cfdcdb; } .toast button { color: #1d7874; }
      .bar .note-btn { background: #e6eeed; }
      .dot.on { border-color: #15201f; }
    }
  `;

  const ui = {};

  function build() {
    const host = h('div', { id: 'kn-host' });
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS_TEXT);
    shadow.adoptedStyleSheets = [sheet];

    ui.count = h('span', { class: 'count' });
    ui.close = h('button', { class: 'ibtn', 'aria-label': 'Close notes', title: 'Close', text: '✕', onclick: closeSidebar });
    ui.exportBtn = h('button', { class: 'ibtn', 'aria-label': 'Export', title: 'Export', text: '⤓', onclick: () => { ui.menu.hidden = !ui.menu.hidden; } });
    ui.readBtn = h('button', { class: 'ibtn', 'aria-label': 'Read notes aloud', title: 'Read these notes aloud', text: '🔊', onclick: readAloud });
    ui.allBtn = h('button', { class: 'ibtn', 'aria-label': 'All notes', title: 'All my notes', text: '☰', onclick: () => send({ type: 'kn-open-manager' }) });

    ui.orderSel = h('select', { 'aria-label': 'Order', onchange: () => { order = ui.orderSel.value; try { chrome.storage.sync.set({ knOrder: order }); } catch (_) {} } },
      h('option', { value: 'page', text: 'In page order' }), h('option', { value: 'label', text: 'Grouped by label' }));
    ui.citeSel = h('select', { 'aria-label': 'Citation in export', onchange: () => { citeStyle = ui.citeSel.value; try { chrome.storage.sync.set({ knCite: citeStyle }); } catch (_) {} } },
      h('option', { value: '', text: 'No citation' }), h('option', { value: 'apa', text: 'APA 7' }), h('option', { value: 'mla', text: 'MLA 9' }), h('option', { value: 'chicago', text: 'Chicago 17' }));
    ui.menu = h('div', { class: 'menu', hidden: true },
      h('button', { class: 'go main', text: 'Download Markdown (.md)', onclick: exportMarkdown }),
      h('button', { class: 'go', text: 'Copy Markdown', onclick: copyMarkdown }),
      h('button', { class: 'go', text: 'Anki flashcards: highlight → note (.txt)', onclick: () => exportAnki('basic') }),
      h('button', { class: 'go', text: 'Anki flashcards: fill-in-the-blank (.txt)', onclick: () => exportAnki('cloze') }),
      h('button', { class: 'go', text: 'Word / PDF… (in My notes)', onclick: () => { ui.menu.hidden = true; send({ type: 'kn-open-manager', focus: key }); } }),
      h('button', { class: 'go', text: 'Download backup (.json)', onclick: exportJson }),
      h('hr'),
      h('label', { text: 'Order in the file' }), ui.orderSel,
      h('label', { text: 'Include a citation' }), ui.citeSel);

    ui.pageNote = h('textarea', { class: 'pagenote', rows: 2, placeholder: 'Page note: what is this page about? (Markdown is fine)', 'aria-label': 'Page note',
      oninput: () => { page.note = ui.pageNote.value; persist(); } });
    ui.caseDl = h('datalist', { id: 'kn-cases' });
    ui.caseIn = h('input', { type: 'text', list: 'kn-cases', placeholder: 'Case / folder (optional)', 'aria-label': 'Case or folder', oninput: () => { page.case = ui.caseIn.value.trim().slice(0, 120); persist(); } });
    ui.citeBtn = h('button', { class: 'small', text: 'Cite…', title: 'Citation for this page (APA, MLA, Chicago)', onclick: () => { ui.cite.hidden = !ui.cite.hidden; if (!ui.cite.hidden) fillCite(); } });

    // citation panel
    const cf = (label, name, ph) => { const i = h('input', { type: 'text', placeholder: ph || '', 'aria-label': label, oninput: () => { ensureMeta()[name] = i.value.trim(); persist(); showCite(); } }); ui[name + 'In'] = i; return [h('label', { text: label }), i]; };
    ui.styleSel = h('select', { 'aria-label': 'Citation style', onchange: showCite }, h('option', { value: 'apa', text: 'APA 7' }), h('option', { value: 'mla', text: 'MLA 9' }), h('option', { value: 'chicago', text: 'Chicago 17' }));
    ui.citeOut = h('div', { class: 'out' });
    ui.cite = h('div', { class: 'cite', hidden: true },
      ...cf('Author(s): “Last, First; Last, First” or an organization', 'authors', 'e.g. Smith, Jane'), ...cf('Title', 'title'), ...cf('Website / publisher', 'site'), ...cf('Published (YYYY-MM-DD)', 'published', 'YYYY-MM-DD'),
      h('label', { text: 'Style' }), ui.styleSel, ui.citeOut,
      h('div', { class: 'row2', style: 'margin-top:8px' }, h('button', { class: 'small', text: 'Copy citation', onclick: copyCitation }), h('span', { class: 'sp', style: 'flex:1' }),
        h('span', { style: 'font-size:11px;color:#9fb3b1', text: 'Built from the page’s own details. Check it against your style guide.' })));

    // video / audio time notes
    ui.timeIn = h('input', { type: 'text', placeholder: 'mm:ss', 'aria-label': 'Time for a video note', style: 'width:70px;flex:none', onkeydown: e => { if (e.key === 'Enter') addTyped(); } });
    ui.timeAdd = h('button', { class: 'small', text: '⏱ Add at time', onclick: addTyped });
    ui.timeNow = h('button', { class: 'small', text: '⏱ Note at current time', title: 'Add a note at the video’s current position', onclick: noteAtCurrentTime });
    ui.timeRow = h('div', { class: 'row2' }, ui.timeNow, ui.timeIn, ui.timeAdd);

    ui.search = h('input', { type: 'search', placeholder: 'Search this page’s notes', 'aria-label': 'Search notes', oninput: () => { filter.q = ui.search.value.trim().toLowerCase(); render(); } });
    ui.dots = h('span', { style: 'display:flex;gap:4px' });
    for (const c of K.COLORS) {
      ui.dots.append(h('button', { class: 'dot c-' + c, title: 'Show only: ' + K.LABELS[c], 'aria-label': 'Filter ' + K.LABELS[c],
        onclick: () => { filter.colors.has(c) ? filter.colors.delete(c) : filter.colors.add(c); render(); } }));
    }
    ui.tagbar = h('div', { class: 'tagbar' });
    ui.list = h('div');
    ui.empty = h('div', { class: 'empty', text: 'Select text on the page, then pick a color. Notes are saved in this browser only.' });
    ui.toast = h('div', { class: 'toast', hidden: true });
    ui.panel = h('div', { class: 'panel', role: 'complementary', 'aria-label': 'Notes', hidden: true },
      h('div', { class: 'head' }, h('b', { text: 'Notes' }), ui.count, h('span', { class: 'sp' }), ui.readBtn, ui.exportBtn, ui.allBtn, ui.close),
      ui.menu,
      h('div', { class: 'scroll' }, ui.pageNote, h('div', { class: 'row2' }, ui.caseIn, ui.caseDl, ui.citeBtn), ui.cite, ui.timeRow,
        h('div', { class: 'filters' }, ui.search, ui.dots), ui.tagbar, ui.list, ui.empty),
      ui.toast);

    ui.bar = h('div', { class: 'bar', hidden: true, role: 'toolbar', 'aria-label': 'Highlight selection' });
    for (const c of K.COLORS) ui.bar.append(h('button', { class: 'dot c-' + c, title: 'Highlight: ' + K.LABELS[c], 'aria-label': 'Highlight as ' + K.LABELS[c], onclick: () => addFromSelection(c, false) }));
    ui.bar.append(h('button', { class: 'note-btn', text: '✎ Note', title: 'Highlight and add a note', onclick: () => addFromSelection('yellow', true) }));
    ui.bar.addEventListener('mousedown', e => e.preventDefault()); // keep the page selection

    ui.pill = h('button', { class: 'pill', hidden: true, 'aria-label': 'Open notes', onclick: openSidebar });
    shadow.append(h('div', { class: 'layer' }, ui.panel, ui.bar, ui.pill));
    ui.host = host;
    document.documentElement.appendChild(host);
    // buttons inside the panel must not steal the page selection (needed by "Re-attach")
    ui.panel.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  }

  function addTyped() {
    const t = parseTime(ui.timeIn.value);
    if (t == null) return toast('Type a time like 12:35 or 1:02:05.', true);
    const m = findMedia();
    ui.timeIn.value = '';
    addTimeNote(t, m ? mediaInfo(m) : null);
  }

  function citeMeta() {
    const m = ensureMeta();
    return { url: pageUrl(), title: document.title, accessed: (page.created || '').slice(0, 10) || new Date().toISOString().slice(0, 10), ...m };
  }

  function fillCite() {
    const m = ensureMeta();
    for (const f of ['authors', 'title', 'site', 'published']) ui[f + 'In'].value = m[f] || '';
    ui.styleSel.value = citeStyle || 'apa';
    showCite();
  }

  function showCite() {
    ui.citeOut.textContent = K.citationString(citeMeta(), ui.styleSel.value, 'plain');
  }

  async function copyCitation() {
    try { await navigator.clipboard.writeText(K.citationString(citeMeta(), ui.styleSel.value, 'plain')); toast('Citation copied.'); }
    catch (_) { toast('Couldn’t copy. Select the text above and copy it.', true); }
  }

  function toast(text, isErr, actionLabel, action) {
    if (!ui.toast) return;
    clearTimeout(toastTimer);
    ui.toast.className = 'toast' + (isErr ? ' err' : '');
    ui.toast.replaceChildren(h('span', { text }));
    if (actionLabel) ui.toast.append(h('button', { text: actionLabel, onclick: () => { ui.toast.hidden = true; action(); } }));
    ui.toast.hidden = false;
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, actionLabel ? 7000 : 4500);
    if (!open) openSidebar();
  }

  function openSidebar() {
    open = true;
    ui.panel.hidden = false;
    ui.pill.hidden = true;
    render();
  }

  function closeSidebar() {
    open = false;
    ui.panel.hidden = true;
    ui.menu.hidden = true;
    updatePill();
  }

  function updatePill() {
    ui.pill.hidden = open || !page || !page.items.length;
    ui.pill.textContent = '✎ ' + (page ? page.items.length : 0);
  }

  function hideBar() { if (ui.bar) ui.bar.hidden = true; }

  function showBarFor(range) {
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return hideBar();
    ui.bar.hidden = false;
    const w = ui.bar.offsetWidth || 190;
    let left = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let top = r.top - 46;
    if (top < 8) top = Math.min(innerHeight - 50, r.bottom + 10);
    ui.bar.style.left = left + 'px';
    ui.bar.style.top = top + 'px';
  }

  function focusNote(id) {
    openSidebar();
    requestAnimationFrame(() => {
      const card = ui.list.querySelector('[data-id="' + id + '"]');
      if (!card) return;
      card.scrollIntoView({ block: 'nearest' });
      const ta = card.querySelector('.note');
      if (ta) ta.focus();
    });
  }

  // ---------- sidebar list ----------

  function visibleItems() {
    return K.sortItems(page.items).filter(it => {
      if (filter.colors.size && !filter.colors.has(it.color)) return false;
      if (filter.tag && !(it.tags || []).includes(filter.tag)) return false;
      if (filter.q && !((it.quote + ' ' + (it.note || '') + ' ' + (it.tags || []).join(' ') + (K.isTime(it) ? ' ' + K.fmtTime(it.t) : '')).toLowerCase().includes(filter.q))) return false;
      return true;
    });
  }

  function render() {
    if (!ui.panel || !page) return;
    ui.count.textContent = page.items.length ? '· ' + page.items.length : '';
    if (ui.pageNote.value !== (page.note || '')) ui.pageNote.value = page.note || '';
    if (ui.caseIn.value !== (page.case || '')) ui.caseIn.value = page.case || '';
    ui.caseDl.replaceChildren(...cases.map(c => h('option', { value: c })));
    const media = findMedia();
    ui.timeNow.hidden = !media;
    for (const d of ui.dots.children) {
      const c = K.COLORS.find(x => d.classList.contains('c-' + x));
      d.classList.toggle('on', filter.colors.has(c));
      d.classList.toggle('off', filter.colors.size > 0 && !filter.colors.has(c));
    }
    const tags = [...new Set(page.items.flatMap(i => i.tags || []))].sort();
    ui.tagbar.replaceChildren(...tags.map(t => h('button', { class: 'chip' + (filter.tag === t ? ' on' : ''), text: '#' + t, onclick: () => { filter.tag = filter.tag === t ? '' : t; render(); } })));
    const items = visibleItems();
    ui.list.replaceChildren(...items.map(cardFor));
    ui.empty.hidden = items.length > 0;
    ui.empty.textContent = page.items.length ? 'Nothing matches the filters.' : 'Select text on the page, then pick a color. Notes are saved in this browser only.';
    updatePill();
  }

  function cardFor(it) {
    const timed = K.isTime(it);
    const card = h('div', { class: 'card c-' + it.color + (it.orphan && !timed ? ' orphan' : '') + (timed ? ' time' : ''), 'data-id': it.id });
    if (timed) {
      card.append(h('p', { class: 'tm', title: 'Jump to this moment in the video', onclick: () => jumpToTime(it),
        text: '⏱ ' + K.fmtTime(it.t) + (it.media && it.media.title ? ' — ' + it.media.title : '') }));
    } else {
      const q = h('p', { class: 'q', text: it.quote, title: it.orphan ? 'Not found on the page' : 'Click to jump to this passage', onclick: () => {
        if (it.orphan) card.classList.toggle('expanded'); else { flash(it.id); card.classList.add('hot'); setTimeout(() => card.classList.remove('hot'), 1500); } } });
      card.append(q);
      if (it.orphan) card.append(h('p', { class: 'warn', text: 'This passage isn’t on the page right now (it may have changed or not loaded yet).' }));
    }
    const note = h('textarea', { class: 'note', rows: 1, placeholder: 'Add a note…', 'aria-label': 'Note', oninput: () => {
      it.note = note.value; note.style.height = 'auto'; note.style.height = note.scrollHeight + 'px'; persist(); } });
    note.value = it.note || '';
    card.append(note);
    requestAnimationFrame(() => { if (note.scrollHeight > 34) note.style.height = note.scrollHeight + 'px'; });

    const tagRow = h('div', { class: 'tags' });
    for (const t of it.tags || []) {
      tagRow.append(h('span', { class: 'chip' }, '#' + t, h('button', { 'aria-label': 'Remove tag ' + t, text: '×', onclick: () => { it.tags = it.tags.filter(x => x !== t); persist(); render(); } })));
    }
    const tagIn = h('input', { type: 'text', placeholder: '+ tag', 'aria-label': 'Add tag', onkeydown: e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const t = K.cleanTag(tagIn.value);
        if (t && !(it.tags || []).includes(t)) { it.tags = [...(it.tags || []), t]; persist(); render(); }
        else tagIn.value = '';
      }
    } });
    tagRow.append(tagIn);
    card.append(tagRow);

    const acts = h('div', { class: 'acts' });
    if (!timed) {
      for (const c of K.COLORS) acts.append(h('button', { class: 'dot c-' + c + (c === it.color ? ' on' : ''), title: K.LABELS[c], 'aria-label': 'Label as ' + K.LABELS[c],
        onclick: () => { it.color = c; persist(); anchorAll(); } }));
    }
    acts.append(h('span', { class: 'sp', style: 'flex:1' }));
    if (it.orphan && !timed) acts.append(h('button', { class: 'link', text: 'Re-attach to selection', onclick: () => reattach(it.id) }));
    acts.append(h('button', { class: 'link', text: 'Delete', onclick: () => removeItem(it.id) }));
    card.append(acts);
    return card;
  }

  // ---------- export / read aloud ----------

  const fileName = ext => (page.title || 'notes').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + ' – notes.' + ext;
  const forExport = () => ({ ...page, title: page.title || document.title });

  function markdownNow() {
    return K.toMarkdown(forExport(), { order, citation: citeStyle, exportedAt: new Date() });
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function exportMarkdown() {
    ui.menu.hidden = true;
    if (!page.items.length && !(page.note || '').trim()) return toast('Nothing to export yet.');
    download(fileName('md'), markdownNow(), 'text/markdown');
  }

  function exportAnki(type) {
    ui.menu.hidden = true;
    const r = K.toAnki(forExport(), { type });
    if (!r.count) return toast(type === 'basic' ? 'No flashcards yet: for this style a highlight needs a note (the note becomes the answer).' : 'No highlights to turn into flashcards.');
    download(fileName(type === 'cloze' ? 'cloze.txt' : 'anki.txt').replace('notes.', 'flashcards.'), r.text, 'text/plain');
    toast(r.count + ' flashcard' + (r.count === 1 ? '' : 's') + ' saved' + (r.skipped ? ' (' + r.skipped + ' skipped: no note)' : '') + '. In Anki: File → Import.');
  }

  async function copyMarkdown() {
    ui.menu.hidden = true;
    try { await navigator.clipboard.writeText(markdownNow()); toast('Markdown copied.'); }
    catch (_) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = markdownNow();
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      toast(ok ? 'Markdown copied.' : 'Couldn’t copy. Use Download instead.', !ok);
    }
  }

  function exportJson() {
    ui.menu.hidden = true;
    download(fileName('json'), JSON.stringify({ format: 'kokoro-notes', version: 1, exported: new Date().toISOString(), pages: [page] }, null, 2), 'application/json');
  }

  async function readAloud() {
    if (!page.items.length && !(page.note || '').trim()) return toast('Nothing to read yet.');
    const r = await send({ type: 'kn-read', chunks: K.toSpeech(forExport()) });
    if (!r || r.ok === false) toast((r && r.error) || 'Couldn’t start reading. Check your Kokoro server in the extension settings.', true);
  }

  // ---------- events ----------

  function onMouseUp(e) {
    if (!ui.bar || e.composedPath().includes(ui.host)) return;
    setTimeout(() => {
      const range = currentSelection();
      if (range && range.toString().trim().length >= 2) showBarFor(range); else hideBar();
    }, 10);
  }

  function onKeyUp(e) {
    if (e.key === 'Escape') { hideBar(); return; }
    if (e.shiftKey || e.key === 'Shift') onMouseUp({ composedPath: () => [] });
  }

  // Clicking highlighted text jumps to its note.
  function onClick(e) {
    if (!open && !(page && page.items.length)) return;
    if (e.composedPath().includes(ui.host) || e.target.closest('a,button,input,textarea,select,summary,[contenteditable]')) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    let pos = null;
    try { pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null; } catch (_) {}
    const node = pos ? pos.offsetNode : null;
    const offset = pos ? pos.offset : 0;
    if (!node) return;
    let hit = null;
    for (const [id, r] of anchors) {
      try { if (r.isPointInRange(node, offset) && (!hit || r.toString().length < hit.len)) hit = { id, len: r.toString().length }; } catch (_) {}
    }
    if (!hit) return;
    openSidebar();
    requestAnimationFrame(() => {
      const card = ui.list.querySelector('[data-id="' + hit.id + '"]');
      if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('hot'); setTimeout(() => card.classList.remove('hot'), 1600); }
    });
  }

  function onSpaCheck() {
    if (!isAlive()) return;
    const url = pageUrl();
    if (url === lastUrl) return;
    lastUrl = url;
    switchPage();
  }

  async function switchPage() {
    await save();
    await load();
    setTimeout(anchorAll, 900); // let the new view render
    anchorAll();
    render();
  }

  const onStorage = (changes, area) => {
    if (area !== 'local' || !page) return;
    const c = changes[key];
    if (!c) return;
    if (c.newValue && c.newValue.updated === lastWrite) return; // our own write
    page = c.newValue || { url: pageUrl(), title: document.title || '', note: '', case: '', items: [], created: new Date().toISOString() };
    page.items = page.items || [];
    anchorAll();
  };

  const onMessage = (msg, _sender, sendResponse) => {
    if (!msg || dead || !msg.type || !msg.type.startsWith('kn-')) return;
    switch (msg.type) {
      case 'kn-ping': sendResponse({ alive: true, open }); return;
      case 'kn-open': openSidebar(); sendResponse(true); return;
      case 'kn-toggle': open ? closeSidebar() : openSidebar(); sendResponse(true); return;
      case 'kn-highlight': addFromSelection(K.COLORS.includes(msg.color) ? msg.color : 'yellow', !!msg.withNote); sendResponse(true); return;
      case 'kn-quiet': updatePill(); sendResponse(true); return;
    }
  };

  function teardown() {
    dead = true;
    clearTimeout(saveTimer); clearTimeout(reanchorTimer); clearInterval(urlTimer);
    if (observer) observer.disconnect();
    clearHighlights();
    for (const fn of cleanups.splice(0)) { try { fn(); } catch (_) {} }
    try { chrome.runtime.onMessage.removeListener(onMessage); chrome.storage.onChanged.removeListener(onStorage); } catch (_) {}
    if (ui.host) ui.host.remove();
    if (window.__knNotes === api) window.__knNotes = null;
  }

  // ---------- start ----------

  async function start() {
    build();
    on(document, 'mouseup', onMouseUp, true);
    on(document, 'keyup', onKeyUp, true);
    on(document, 'click', onClick, true);
    on(document, 'mousedown', e => { if (ui.bar && !e.composedPath().includes(ui.host)) hideBar(); }, true);
    on(window, 'pagehide', () => { if (page) { clearTimeout(saveTimer); save(); } });
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.storage.onChanged.addListener(onStorage);
    urlTimer = setInterval(onSpaCheck, 1000);
    await load();
    ui.orderSel.value = order;
    ui.citeSel.value = citeStyle;
    anchorAll();
    watchPage();
    // Content that renders late: try again for anything not found yet.
    for (const ms of [1500, 4000]) setTimeout(() => { if (isAlive() && needsReanchor()) anchorAll(); }, ms);
    updatePill();
  }

  const api = { isAlive, teardown };
  window.__knNotes = api;
  start();
})();
