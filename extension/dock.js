// The floating toolbox: a small panel that sits in the corner of the page, can be dragged anywhere, stays in front, and
// stays open until you close it (like the reader's player). Icons for every tool; Screenshot, Look up, Archive, Share and
// the shortcut list work right inside it. The other tools open in their own small window.
//
// It is built in a shadow root, so the page can't restyle it, and nothing from the page is ever parsed as HTML.
// Needs toolbox-core.js and osint-core.js loaded first (the background script injects all three).
(function () {
  for (const stale of document.querySelectorAll('#ko-dock-host')) stale.remove();
  const { ICONS, icon, TILES, ORDER, SHOTS, KEYROWS } = KOTools;
  const K = KOsint;

  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  const send = msg => { try { return chrome.runtime.sendMessage({ from: 'dock', ...msg }).catch(() => null); } catch (_) { return Promise.resolve(null); } };
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };
  // Only real input counts. A click made by the page's own script is ignored; a click made by this file in answer to a real
  // key press (fromKey is set only for that instant) is accepted.
  let fromKey = false;
  const trusted = e => e.isTrusted || fromKey;
  const svg = name => icon(name, document);
  const kbd = t => el('kbd', { text: t });

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .dock { position: fixed; z-index: 2147483647; width: 260px; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --bg: #ffffff; --ink: #15201f; --muted: #5d6e6c; --line: #d8e1e0; --accent: #1d7874; --soft: #e2f0ef; --field: #f4f7f6; --rec: #b33b2e; --ok: #1f7a4a; --err: #b33b2e;
      color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.28); user-select: none; }
    @media (prefers-color-scheme: dark) { .dock { --bg: #16201f; --ink: #e8efee; --muted: #9fb3b1; --line: #2c3b3a; --accent: #3fbfb5; --soft: #1d2c2b; --field: #111a19; --rec: #f08a7d; --ok: #6fd39b; --err: #f08a7d; } }
    .dock[hidden] { display: none; }
    .dock:not([hidden]) { display: flex; flex-direction: column; max-height: calc(100vh - 12px); }   /* never taller than the window: the panel scrolls */
    .dock > .top, .dock > .grid, .dock > .hint { flex: none; }
    .dock:focus { outline: none; }
    .top { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 10px; cursor: grab; border-bottom: 1px solid var(--line); touch-action: none; }
    .top:active { cursor: grabbing; }
    .grip { color: var(--muted); letter-spacing: -2px; font-size: 11px; }
    .title { font-weight: 700; font-size: 13px; flex: 1; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .ib { width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 7px; background: none; padding: 0; color: var(--muted); }
    .ib:hover, .ib:focus-visible { background: var(--soft); color: var(--accent); outline: none; }
    .ib svg { width: 15px; height: 15px; }
    svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    svg .solid { fill: currentColor; stroke: none; }
    .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; padding: 8px 8px 4px; }
    .tile { position: relative; height: 36px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--accent); padding: 0; }
    .tile svg { width: 19px; height: 19px; }
    .tile.rec { color: var(--rec); }
    .tile:hover, .tile:focus-visible, .tile[aria-pressed="true"] { background: var(--soft); border-color: var(--accent); outline: none; }
    .tile:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
    .tile kbd { position: absolute; right: 2px; bottom: 0; font: 600 8.5px/1 ui-monospace, Menlo, Consolas, monospace; color: var(--muted); background: none; border: 0; padding: 1px; }
    .hint { padding: 2px 10px 8px; min-height: 22px; font-size: 11.5px; color: var(--muted); }
    .panel { border-top: 1px solid var(--line); padding: 8px 10px 10px; user-select: text; overflow: auto; flex: 1 1 auto; min-height: 0; }
    .panel[hidden] { display: none; }
    .ph { display: flex; align-items: center; gap: 6px; margin: 0 0 7px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .ph span { flex: 1; }
    .opt { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 9px; margin-bottom: 5px; text-align: left; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); }
    .opt:hover, .opt:focus-visible { background: var(--soft); border-color: var(--accent); outline: none; }
    .opt svg { width: 18px; height: 18px; color: var(--accent); flex: none; }
    .opt small { display: block; color: var(--muted); font-size: 11px; }
    .opt kbd { margin-left: auto; }
    kbd { font: 600 10px/1.5 ui-monospace, Menlo, Consolas, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; color: var(--muted); background: var(--field); white-space: nowrap; }
    input[type=text] { width: 100%; font: inherit; color: var(--ink); background: var(--field); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; user-select: text; }
    input[type=text]:focus { outline: 2px solid var(--accent); border-color: transparent; }
    .links { max-height: 190px; overflow: auto; margin-top: 7px; }
    .links h4 { margin: 8px 0 3px; font-size: 11px; color: var(--muted); font-weight: 600; overflow-wrap: anywhere; }
    .pill { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 9px; border: 1px solid var(--line); border-radius: 999px; color: var(--accent); text-decoration: none; font-size: 12px; background: var(--field); }
    .pill:hover, .pill:focus-visible { border-color: var(--accent); outline: none; }
    .note { margin: 6px 0 0; color: var(--muted); font-size: 11.5px; }
    .warn { margin: 4px 0; padding: 5px 8px; border-radius: 7px; background: #fff6e0; color: #6b4e00; font-size: 11.5px; }
    @media (prefers-color-scheme: dark) { .warn { background: #2b2412; color: #e8d28a; } }
    .thumb { display: block; width: 100%; max-height: 150px; object-fit: cover; object-position: top; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; background: var(--field); }
    .row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }
    .btn { padding: 5px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); font-weight: 600; font-size: 12px; }
    .btn:hover, .btn:focus-visible { background: var(--soft); border-color: var(--accent); outline: none; }
    .btn.main { background: var(--accent); color: #fff; border-color: var(--accent); }
    @media (prefers-color-scheme: dark) { .btn.main { color: #0f1615; } }
    .status { margin-top: 6px; font-size: 11.5px; color: var(--muted); min-height: 1.2em; overflow-wrap: anywhere; }
    .status.ok { color: var(--ok); } .status.err { color: var(--err); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { padding: 3px 4px 3px 0; border-top: 1px solid var(--line); vertical-align: middle; }
    td.none { color: var(--muted); }
    .keys { max-height: 220px; overflow: auto; }
    @media (max-height: 640px) { .keys { max-height: 120px; } }
  `;

  // ---------- build ----------
  const host = el('div', { id: 'ko-dock-host' });
  const shadow = host.attachShadow({ mode: 'open' });   // open so tests (and people with devtools) can see inside; the page gets no way to act on it (see isTrusted below)
  const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); shadow.adoptedStyleSheets = [sheet];

  // tabindex -1: clicking anywhere in the box (even the title bar) leaves the keyboard focus inside it, so letters keep working
  const dock = el('div', { class: 'dock', role: 'dialog', 'aria-label': 'PageMate tools', hidden: true, tabindex: '-1' });
  const top = el('div', { class: 'top', title: 'Drag to move' },
    el('span', { class: 'grip', text: '⋮⋮' }), el('span', { class: 'title', text: 'PageMate' }),
    el('button', { class: 'ib', 'data-act': 'keys', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts' }, svg('keys')),
    el('button', { class: 'ib', 'data-act': 'settings', title: 'Settings (,)', 'aria-label': 'Settings' }, svg('gear')),
    el('button', { class: 'ib', 'data-act': 'close', title: 'Close (Esc)', 'aria-label': 'Close toolbox' }, svg('close')));
  const grid = el('div', { class: 'grid', role: 'toolbar', 'aria-label': 'Tools' });
  const hint = el('div', { class: 'hint', 'aria-live': 'polite' });
  const panel = el('div', { class: 'panel', hidden: true });
  dock.append(top, grid, hint, panel);
  shadow.append(dock);

  const PANELS = { shot: 1, lookup: 1, archive: 1, share: 1, keys: 1, card: 1 };
  const DEFAULT_HINT = 'Click a tool, or press its letter';
  const tileEls = {};
  for (const id of ORDER) {
    const d = TILES[id];
    const b = el('button', { class: 'tile' + (d.cls ? ' ' + d.cls : ''), 'data-tile': id, 'data-key': d.key, title: d.label + ' (' + d.key.toUpperCase() + ') — ' + d.tip, 'aria-label': d.label, 'aria-keyshortcuts': d.key.toUpperCase() }, svg(d.icon), kbd(d.key.toUpperCase()));
    b.addEventListener('mousedown', e => e.preventDefault());           // keep the page's selection (Read selection, Share quote…)
    b.addEventListener('mouseenter', () => { hint.textContent = d.label; });
    b.addEventListener('mouseleave', () => { hint.textContent = DEFAULT_HINT; });
    b.addEventListener('focus', () => { hint.textContent = d.label; });
    b.addEventListener('click', e => { if (trusted(e)) pick(id); });
    tileEls[id] = b; grid.append(b);
  }
  hint.textContent = DEFAULT_HINT;

  // ---------- state ----------
  let open = false, current = '', card = null, grabbed = '', lastSel = '';
  const pageSelection = () => { try { return (getSelection().toString() || '').trim().slice(0, 4000); } catch (_) { return ''; } };
  // Remember the last text selected on the page while the box is open (clicking into a field in the box clears the live selection).
  document.addEventListener('selectionchange', () => { if (open) { const t = pageSelection(); if (t) lastSel = t; } });

  function tool(name) { return send({ type: 'kr-tool', tool: name }); }

  function pick(id) {
    const d = TILES[id];
    grabbed = pageSelection() || lastSel;
    if (d.submenu === 'shot') return showPanel(current === 'shot' ? '' : 'shot');
    if (id === 'lookup' || id === 'archive' || id === 'share') return showPanel(current === id ? '' : id);
    showPanel('');
    tool(d.tool).then(r => { if (!r || r.ok === false) hint.textContent = 'That didn’t start. Reload the page and try again.'; });
  }

  // ---------- panels ----------
  // (If the button you just pressed lived in the panel that is replaced, focus goes back to the box, so keys keep working.)
  function showPanel(name) {
    const hadFocus = !!(shadow.activeElement && panel.contains(shadow.activeElement));
    showPanelNow(name);
    if (hadFocus && open && !panel.contains(shadow.activeElement) && shadow.activeElement == null) dock.focus({ preventScroll: true });
  }
  function showPanelNow(name) {
    if (current === 'card' && name !== 'card' && card) { send({ type: 'ko-shot-drop', id: card.id }); card = null; }   // moving on from a screenshot card discards it
    current = name;
    for (const [id, b] of Object.entries(tileEls)) b.setAttribute('aria-pressed', String(id === name || (name === 'card' && id === 'shot')));
    panel.hidden = !name;
    if (!name) { panel.replaceChildren(); settle(); return; }
    ({ shot: panelShot, lookup: panelLookup, archive: panelArchive, share: panelShare, keys: panelKeys, card: panelCard })[name]();
    settle();
  }
  const header = (title, onBack) => el('div', { class: 'ph' }, el('span', { text: title }), el('button', { class: 'ib', title: 'Close this (Esc)', 'aria-label': 'Close this panel', onclick: onBack || (() => showPanel('')) }, svg('close')));
  const focusFirst = () => { const f = panel.querySelector('input, .opt, .btn, .pill'); if (f) f.focus(); };

  function panelShot() {
    panel.replaceChildren(header('Screenshot'),
      ...SHOTS.map(s => el('button', { class: 'opt', 'data-tool': s.tool, 'data-key': s.key, onclick: e => { if (!trusted(e)) return; showPanel(''); tool(s.tool); } },
        svg(s.icon), el('span', null, s.label, el('small', { text: s.hint })), kbd(s.key.toUpperCase()))),
      el('p', { class: 'note', text: 'The toolbox hides while it takes the picture, then shows it here.' }));
    focusFirst();
  }

  // --- the card shown after a screenshot ---
  function panelCard() {
    const c = card;
    const status = el('div', { class: 'status', role: 'status' });
    const say = (t, k) => { status.textContent = t || ''; status.className = 'status' + (k ? ' ' + k : ''); };
    const caption = el('input', { type: 'text', placeholder: 'Caption for your notes (optional)', maxlength: '300', 'aria-label': 'Caption for your notes' });
    const MODES = { region: 'Selected area', visible: 'Visible part', full: 'Whole page' };
    const bytes = async () => { const r = await send({ type: 'ko-shot-data', id: c.id }); if (!r || !r.ok) throw new Error((r && r.error) || 'The screenshot is no longer available.'); return { blob: await (await fetch(r.dataUrl)).blob(), at: r.at }; };
    const copy = async (auto) => {
      try {
        if (!navigator.clipboard || !window.ClipboardItem) throw new Error('this page doesn’t allow copying (it needs a secure https page)');
        const { blob } = await bytes();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        say('Copied. Paste it anywhere with Ctrl+V.', 'ok');
      } catch (e) { say((auto ? 'Couldn’t copy it automatically: ' : 'Couldn’t copy: ') + (e && e.message || e) + '. Save it instead.', 'err'); }
    };
    const save = async () => {
      try {
        const { blob, at } = await bytes();
        const a = el('a', { href: URL.createObjectURL(blob), download: 'Screenshot - ' + (c.title || 'page').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) + ' - ' + String(at || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '.png' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
        say('Saved to your Downloads folder.', 'ok');
      } catch (e) { say('Couldn’t save: ' + (e && e.message || e), 'err'); }
    };
    const notes = async () => {
      const r = await send({ type: 'ko-shot-notes', id: c.id, caption: caption.value.trim() });
      if (r && r.ok) { caption.value = ''; say('Filed with your notes for this page (' + r.count + ' there).', 'ok'); }
      else say('Couldn’t file it: ' + ((r && r.error) || 'try again'), 'err');
    };
    const btn = (label, ic, fn, main) => el('button', { class: 'btn' + (main ? ' main' : ''), onclick: e => { if (trusted(e)) fn(); } }, label);
    panel.replaceChildren(
      header('Screenshot', dismissCard),
      el('img', { class: 'thumb', src: c.thumb, alt: 'Screenshot' }),
      el('div', { class: 'note', text: (MODES[c.mode] || 'Picture') + ' · ' + c.width + '×' + c.height + (c.truncated ? ' · cut off (page is very tall)' : '') }),
      caption,
      el('div', { class: 'row' }, btn('Copy', 'copy', () => copy(false), true), btn('Save', 'save', save), btn('Notes', 'notes', notes), btn('Edit…', 'edit', () => { const id = c.id; card = null; send({ type: 'ko-shot-edit', id }); showPanel(''); })),
      status);
    if (c.auto) { c.auto = false; copy(true); }
  }
  function dismissCard() {
    if (card) send({ type: 'ko-shot-drop', id: card.id });
    card = null; showPanel('');
  }

  // --- Look up ---
  let customServices = [];
  function panelLookup() {
    const input = el('input', { type: 'text', placeholder: 'Address, domain, email, name, number…', 'aria-label': 'What to look up', value: (grabbed || '').slice(0, 300) });
    const out = el('div', { class: 'links' });
    const draw = () => {
      const q = input.value.trim();
      out.replaceChildren();
      if (!q) { out.append(el('p', { class: 'note', text: 'Type or paste anything, or select text on the page first. Links open in a new tab; nothing is sent from here.' })); return; }
      const r = K.pivots(q, customServices);
      if (!r.groups.length) { out.append(el('p', { class: 'note', text: 'Nothing to look up for that.' })); return; }
      out.append(el('p', { class: 'note', text: 'Looks like: ' + (K.TYPE_LABEL && K.TYPE_LABEL[r.detected.type] || r.detected.type) }));
      for (const g of r.groups) {
        out.append(el('h4', { text: (K.TYPE_LABEL && K.TYPE_LABEL[g.type] || g.type) + ': ' + g.value }));
        for (const it of g.items) if (/^https?:/i.test(it.url)) out.append(el('a', { class: 'pill', href: it.url, target: '_blank', rel: 'noopener noreferrer', text: it.name }));
      }
    };
    input.addEventListener('input', draw);
    panel.replaceChildren(header('Look up'), input, out);
    draw(); input.focus(); input.select();
  }

  // --- Archive ---
  function panelArchive() {
    const url = location.href.split('#')[0];
    if (!/^https?:/i.test(url)) { panel.replaceChildren(header('Archive'), el('p', { class: 'note', text: 'This page has no web address to archive.' })); return; }
    const L = K.archiveLinks(url);
    const a = (text, href) => el('a', { class: 'pill', href, target: '_blank', rel: 'noopener noreferrer', text });
    panel.replaceChildren(header('Archive this page'),
      el('h4', { class: 'note', text: 'Find saved copies' }), el('div', null, a('Wayback Machine', L.waybackAll), a('archive.today', L.archiveTodayNewest), a('Ghostarchive', L.ghostarchive)),
      el('h4', { class: 'note', text: 'Make a copy now' }), el('div', null, a('Save to Wayback Machine', L.waybackSave), a('Save to archive.today', L.archiveTodaySave)),
      el('p', { class: 'note', text: 'Opens that service in a new tab. Saving sends the page address to it.' }));
    focusFirst();
  }

  // --- Share ---
  let shareSettings = { shareInstance: '', shareClean: true, shareHashtags: '' };
  function panelShare() {
    const url = location.href;
    if (!/^https?:/i.test(url)) { panel.replaceChildren(header('Share'), el('p', { class: 'note', text: 'This page has no web address to share.' })); return; }
    const quote = grabbed.length > 3 ? grabbed.slice(0, 400) : '';
    const links = K.shareLinks({ url, title: document.title, quote, hashtags: String(shareSettings.shareHashtags || '').split(',').map(x => x.trim()).filter(Boolean), instance: shareSettings.shareInstance, clean: shareSettings.shareClean !== false },
      ['x', 'bluesky', 'mastodon', 'threads', 'reddit', 'linkedin', 'facebook', 'telegram', 'whatsapp', 'hn', 'email']);
    const wrap = el('div');
    for (const w of K.shareWarnings(url)) wrap.append(el('div', { class: 'warn', text: '⚠ ' + w }));
    for (const l of links) if (l.href) wrap.append(el('a', { class: 'pill', href: l.href, target: '_blank', rel: 'noopener noreferrer', text: l.name, title: l.over ? 'The text is trimmed to fit' : '' }));
    panel.replaceChildren(header('Share this page'), wrap,
      el('p', { class: 'note', text: (quote ? 'Your selected text is quoted. ' : '') + 'Opens that site’s post window with the link filled in; nothing is posted for you.' }));
    focusFirst();
  }

  // --- keyboard shortcuts ---
  async function panelKeys() {
    panel.replaceChildren(header('Keyboard shortcuts'), el('div', { class: 'keys' }, el('p', { class: 'note', text: 'Loading…' })));
    const r = await send({ type: 'ko-dock-commands' });
    const by = new Map(((r && r.commands) || []).map(c => [c.name, c.shortcut]));
    const rows = KEYROWS.map(([label, own, command]) => {
      const sc = by.get(command);
      const own2 = own ? el('span', null, ...own.split(/(, then )/).map(x => x === ', then ' ? ' then ' : kbd(x))) : el('span', { text: '—' });
      return el('tr', { 'data-command': command }, el('td', { text: label }), el('td', null, own2), el('td', sc ? null : { class: 'none' }, sc ? kbd(sc) : 'not set'));
    });
    const table = el('table', null, el('tr', null, ...['Tool', 'Here', 'Anywhere'].map(t => el('td', { class: 'none', text: t }))), ...rows);
    if (current !== 'keys') return;
    panel.replaceChildren(header('Keyboard shortcuts'), el('div', { class: 'keys' }, table),
      el('div', { class: 'row' }, el('button', { class: 'btn main', onclick: e => { if (trusted(e)) send({ type: 'ko-open-shortcuts' }); } }, 'Set or change shortcuts…')),
      el('p', { class: 'note', text: 'Here = press the letter while this toolbox is open. Anywhere = works on any page; browsers allow only four tools to come with a ready-made key, so choose your own for the rest.' }));
    settle();
  }

  // ---------- header buttons ----------
  top.addEventListener('click', e => {
    if (!trusted(e)) return;
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') closeDock();
    else if (act === 'settings') send({ type: 'kr-open-options' });
    else if (act === 'keys') showPanel(current === 'keys' ? '' : 'keys');
  });

  // ---------- keyboard ----------
  const buttons = () => [...grid.querySelectorAll('button'), ...(panel.hidden ? [] : panel.querySelectorAll('button, a.pill, input'))];
  const mid = r => r.left + r.width / 2;
  function moveFocus(dir) {
    const list = buttons(), cur = shadow.activeElement, i = list.indexOf(cur);
    if (i < 0) { if (list[0]) list[0].focus(); return; }
    if (dir === 'ArrowRight') { if (list[i + 1]) list[i + 1].focus(); return; }
    if (dir === 'ArrowLeft') { if (list[i - 1]) list[i - 1].focus(); return; }
    const r = cur.getBoundingClientRect(), down = dir === 'ArrowDown';
    const cand = list.filter(b => { const q = b.getBoundingClientRect(); return down ? q.top > r.bottom - 2 : q.bottom < r.top + 2; });
    if (!cand.length) return;
    const top = b => Math.round(b.getBoundingClientRect().top);
    const row = down ? Math.min(...cand.map(top)) : Math.max(...cand.map(top));
    const inRow = cand.filter(b => Math.abs(top(b) - row) < 6).sort((a, b) => Math.abs(mid(a.getBoundingClientRect()) - mid(r)) - Math.abs(mid(b.getBoundingClientRect()) - mid(r)));
    inRow[0].focus();
  }
  dock.addEventListener('keydown', e => {
    e.stopPropagation();                                      // the page must not react to keys typed in the toolbox
    if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const typing = (e.composedPath()[0] || {}).tagName === 'INPUT';
    if (e.key === 'Escape') { e.preventDefault(); if (current) { const was = current; if (was === 'card') dismissCard(); else showPanel(''); const t = tileEls[was === 'card' ? 'shot' : was]; if (t) t.focus(); } else closeDock(); return; }
    if (typing) return;
    if (e.key.startsWith('Arrow')) { e.preventDefault(); moveFocus(e.key); return; }
    if (e.key.length !== 1) return;                            // Enter / Space / Tab keep their normal behaviour
    const k = e.key.toLowerCase();
    if (k === '?') { e.preventDefault(); showPanel(current === 'keys' ? '' : 'keys'); return; }
    if (k === 'o') { e.preventDefault(); showPanel(''); tool('all-notes'); return; }
    if (k === ',') { e.preventDefault(); send({ type: 'kr-open-options' }); return; }
    const hit = (!panel.hidden && panel.querySelector('[data-key="' + k + '"]')) || grid.querySelector('[data-key="' + k + '"]');
    if (hit) { e.preventDefault(); fromKey = true; try { hit.click(); } finally { fromKey = false; } }
  });
  dock.addEventListener('keyup', e => e.stopPropagation());
  dock.addEventListener('keypress', e => e.stopPropagation());

  // ---------- placing, moving, staying in front ----------
  let pos = null;                                              // { x, y } of the top-left corner, in px
  const place = () => {
    const r = dock.getBoundingClientRect(), w = r.width || 260, h = r.height || 120;
    if (!pos) pos = { x: 16, y: Math.max(8, innerHeight - h - 16) };   // bottom-left: away from chat widgets and from the reader
    pos.x = Math.min(Math.max(0, pos.x), Math.max(0, innerWidth - Math.min(w, innerWidth)));
    pos.y = Math.min(Math.max(0, pos.y), Math.max(0, innerHeight - Math.min(h, innerHeight)));
    dock.style.left = pos.x + 'px'; dock.style.top = pos.y + 'px';
  };
  const settle = () => { if (open) place(); };                   // keep the whole box on screen after it grows
  window.addEventListener('resize', settle);

  {
    let g = null;
    top.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
      const r = dock.getBoundingClientRect();
      g = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      top.setPointerCapture(e.pointerId);
    });
    top.addEventListener('pointermove', e => { if (!g) return; pos = { x: e.clientX - g.dx, y: e.clientY - g.dy }; place(); });
    const end = () => { if (!g) return; g = null; try { chrome.storage.local.set({ 'ko:dockPos': pos }); } catch (_) {} };
    top.addEventListener('pointerup', end); top.addEventListener('pointercancel', end);
  }

  // Stay in front: if the page moves the toolbox out of the document, put it back.
  const mo = new MutationObserver(() => { if (alive() && open && !host.isConnected) document.documentElement.append(host); });
  mo.observe(document.documentElement, { childList: true });

  // ---------- open / close ----------
  async function loadSettings() {
    try {
      const s = await chrome.storage.sync.get({ customServices: '', shareInstance: '', shareHashtags: '', shareClean: true });
      shareSettings = s;
      customServices = s.customServices ? K.parseCustomServices(s.customServices).services || [] : [];
      const p = (await chrome.storage.local.get('ko:dockPos'))['ko:dockPos'];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && !pos) pos = { x: p.x, y: p.y };
    } catch (_) {}
  }
  async function openDock() {
    if (!alive()) return;
    if (!host.isConnected) document.documentElement.append(host);
    if (!open) await loadSettings();
    open = true; dock.hidden = false; host.style.display = '';
    place();
    requestAnimationFrame(place);                                // once fonts and layout have settled
    send({ type: 'ko-dock-state', open: true });
    if (!shadow.activeElement) { const first = grid.querySelector('button'); if (first) first.focus({ preventScroll: true }); }
    lastSel = pageSelection();
  }
  function closeDock() {
    if (card) { send({ type: 'ko-shot-drop', id: card.id }); card = null; }
    open = false; dock.hidden = true; current = ''; panel.hidden = true; panel.replaceChildren(); lastSel = ''; grabbed = '';
    send({ type: 'ko-dock-state', open: false });
  }

  // ---------- messages from the background ----------
  const onMessage = (msg, _sender, reply) => {
    if (!msg || !alive() || !msg.type || !msg.type.startsWith('ko-dock-')) return;
    switch (msg.type) {
      case 'ko-dock-ping': reply({ alive: true, open }); return;
      case 'ko-dock-toggle': (open ? Promise.resolve(closeDock()) : openDock()).then(() => reply({ open })); return true;
      case 'ko-dock-open': openDock().then(() => reply({ open })); return true;
      case 'ko-dock-visible': host.style.visibility = msg.visible ? '' : 'hidden'; reply(true); return;
      case 'ko-dock-shot': {
        if (card && card.id !== msg.id) send({ type: 'ko-shot-drop', id: card.id });
        card = { id: msg.id, thumb: String(msg.thumb || ''), mode: msg.mode, width: msg.width, height: msg.height, truncated: !!msg.truncated, title: msg.title, url: msg.url, auto: false };
        const finish = async () => {
          try { const s = await chrome.storage.sync.get({ shotAutoCopy: false }); card.auto = !!s.shotAutoCopy; } catch (_) {}
          host.style.visibility = '';
          showPanel('card');
          reply({ ok: true });
        };
        (open ? Promise.resolve() : openDock()).then(finish);
        return true;
      }
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  window.__koDock = { host };
})();
