// The toolbox shown when you click the toolbar icon: one tile per tool, so you choose what to do.
// Each tile asks the background script to run a tool on the tab you were looking at (the background owns the logic;
// this page only picks). Everything is built with createElement / textContent.
//
// Keyboard: every tile has a letter (shown on it), the arrow keys move between tiles, Enter / Space starts one,
// Esc goes back. "Shortcuts" lists these letters and the browser-wide shortcuts of every tool.
(function () {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  // Icons as shapes on a 24x24 grid: ['p', pathData] | ['c', cx, cy, r] | ['s', cx, cy, r] (solid dot).
  const ICONS = {
    read: [['p', 'M11 5 6 9H3v6h3l5 4z'], ['p', 'M15.5 8.5a5 5 0 0 1 0 7'], ['p', 'M18.5 5.5a9 9 0 0 1 0 13']],
    stop: [['p', 'M6 6h12v12H6z']],
    notes: [['p', 'M4 20h4L19 9l-4-4L4 16z'], ['p', 'M13 7l4 4']],
    page: [['p', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'], ['p', 'M14 3v5h5'], ['p', 'M12 11v6'], ['p', 'M9.5 14.5 12 17l2.5-2.5']],
    video: [['p', 'M3 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3z'], ['p', 'M17 10.5 21 8v8l-4-2.5']],
    audio: [['p', 'M4 15v-3a8 8 0 0 1 16 0v3'], ['p', 'M4 14h3v6H4z'], ['p', 'M17 14h3v6h-3z']],
    images: [['p', 'M4 5h16v14H4z'], ['p', 'M4 16l5-5 4 4 3-3 4 4'], ['s', 9, 9.5, 1.3]],
    shot: [['p', 'M4 8V5a1 1 0 0 1 1-1h3'], ['p', 'M16 4h3a1 1 0 0 1 1 1v3'], ['p', 'M20 16v3a1 1 0 0 1-1 1h-3'], ['p', 'M8 20H5a1 1 0 0 1-1-1v-3'], ['c', 12, 12, 3]],
    region: [['p', 'M5 9V6a1 1 0 0 1 1-1h3'], ['p', 'M15 5h3a1 1 0 0 1 1 1v3'], ['p', 'M19 15v3a1 1 0 0 1-1 1h-3'], ['p', 'M9 19H6a1 1 0 0 1-1-1v-3']],
    visible: [['p', 'M3 5h18v14H3z'], ['p', 'M3 9h18']],
    full: [['p', 'M7 3h10v18H7z'], ['p', 'M10 8h4M10 12h4M10 16h4']],
    record: [['c', 12, 12, 9], ['s', 12, 12, 4.2]],
    investigate: [['c', 11, 11, 6.5], ['p', 'M16 16l5 5']],
    lookup: [['p', 'M4 6h16M4 11h7M4 16h7'], ['c', 16.5, 15.5, 3], ['p', 'M18.7 17.7 21 20']],
    archive: [['p', 'M3 4h18v4H3z'], ['p', 'M5 8v11h14V8'], ['p', 'M10 12h4']],
    share: [['c', 18, 5.5, 2.7], ['c', 6, 12, 2.7], ['c', 18, 18.5, 2.7], ['p', 'M8.4 10.7l7.2-3.9M8.4 13.3l7.2 3.9']]
  };
  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const [kind, ...a] of ICONS[name] || []) {
      let el;
      if (kind === 'p') { el = document.createElementNS(NS, 'path'); el.setAttribute('d', a[0]); }
      else { el = document.createElementNS(NS, 'circle'); el.setAttribute('cx', a[0]); el.setAttribute('cy', a[1]); el.setAttribute('r', a[2]); if (kind === 's') el.setAttribute('class', 'solid'); }
      svg.append(el);
    }
    return svg;
  }

  // page: the tool works on the page you are looking at, so it needs an ordinary web page.
  // key: the letter that starts it while the toolbox is open. command: its browser-wide shortcut slot (manifest "commands").
  const TILES = {
    read: { label: 'Read aloud', tip: 'Read this page aloud, or just your selection if you have selected text', icon: 'read', tool: 'read', page: true, key: 'r', command: 'read-page' },
    notes: { label: 'Notes', tip: 'Highlight and keep notes on this page', icon: 'notes', tool: 'notes', page: true, key: 'n', command: 'toggle-notes' },
    savePage: { label: 'Save page', tip: 'Save this page as PDF, Word or Markdown', icon: 'page', tool: 'save-page', page: true, key: 's', command: 'save-page' },
    saveVideo: { label: 'Video', tip: 'Download a video from this page', icon: 'video', tool: 'save-video', page: true, key: 'v', command: 'save-video' },
    saveAudio: { label: 'Audio', tip: 'Download audio from this page', icon: 'audio', tool: 'save-audio', page: true, key: 'u', command: 'save-audio' },
    saveImages: { label: 'Images', tip: 'Download images from this page', icon: 'images', tool: 'save-images', page: true, key: 'm', command: 'save-images' },
    shot: { label: 'Screenshot', tip: 'Take a screenshot: an area, what you see, or the whole page', icon: 'shot', submenu: 'shot', page: true, key: 'c' },
    record: { label: 'Record screen', tip: 'Record the screen, a window or a tab', icon: 'record', tool: 'record', cls: 'rec', key: 'e', command: 'record-screen' },
    investigate: { label: 'Investigate', tip: 'Everything on this page: names, addresses, images, site details', icon: 'investigate', tool: 'investigate', page: true, key: 'i', command: 'investigate' },
    lookup: { label: 'Look up', tip: 'Look up an address, domain, email, name or number in many services', icon: 'lookup', tool: 'lookup', key: 'l', command: 'lookup' },
    archive: { label: 'Archive', tip: 'Find or make saved copies of this page', icon: 'archive', tool: 'archive', page: true, key: 'a', command: 'archive' },
    share: { label: 'Share', tip: 'Share this page, with tracking codes removed', icon: 'share', tool: 'share', page: true, key: 'h', command: 'share' }
  };
  const GROUPS = [
    ['Listen and notes', ['read', 'notes']],
    ['Save', ['savePage', 'saveVideo', 'saveAudio', 'saveImages']],
    ['Capture', ['shot', 'record']],
    ['Investigate', ['investigate', 'lookup', 'archive', 'share']]
  ];
  const SHOTS = [
    { label: 'Selected area', hint: 'Drag a box over the part you want', icon: 'region', tool: 'shot-region', key: 'a', command: 'screenshot-region' },
    { label: 'Visible part', hint: 'What you can see right now', icon: 'visible', tool: 'shot-visible', key: 'v', command: 'screenshot-visible' },
    { label: 'Whole page', hint: 'Scrolls down the page and stitches it together', icon: 'full', tool: 'shot-full', key: 'w', command: 'screenshot-full' }
  ];
  // The Shortcuts panel: [what it does, toolbox letter(s), browser-wide command]
  const KEYROWS = [
    ['Open this toolbox', '', '_execute_action'],
    ['Read aloud (start / stop)', 'R', 'read-page'],
    ['Pause / resume reading', '', 'toggle-pause'],
    ['Notes sidebar', 'N', 'toggle-notes'],
    ['Highlight the selection', '', 'highlight-selection'],
    ['Save page as PDF / Word / Markdown', 'S', 'save-page'],
    ['Download a video', 'V', 'save-video'],
    ['Download audio', 'U', 'save-audio'],
    ['Download images', 'M', 'save-images'],
    ['Screenshot: selected area', 'C, then A', 'screenshot-region'],
    ['Screenshot: visible part', 'C, then V', 'screenshot-visible'],
    ['Screenshot: whole page', 'C, then W', 'screenshot-full'],
    ['Record screen', 'E', 'record-screen'],
    ['Investigate this page', 'I', 'investigate'],
    ['Look up', 'L', 'lookup'],
    ['Archive this page', 'A', 'archive'],
    ['Share this page', 'H', 'share'],
    ['All my notes', 'O', 'all-notes']
  ];

  let tab = null, usable = true;

  function setNote(text) { $('note').textContent = text || ''; $('note').hidden = !text; }
  const kbd = text => { const k = document.createElement('kbd'); k.textContent = text; return k; };

  async function run(tool, btn) {
    if (btn) btn.disabled = true;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: 'kr-tool', tool, tabId: tab && tab.id }); } catch (_) {}
    if (!r || r.ok === false) {
      setNote('That didn’t start. Reload the page and try again.');
      if (btn) btn.disabled = false;
      return;
    }
    window.close();
  }

  function tileButton(def, { wide = false } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile' + (wide ? ' wide' : '') + (def.cls ? ' ' + def.cls : '');
    b.title = (def.tip || def.hint || '') + (def.key ? '  (' + def.key.toUpperCase() + ')' : '');
    if (def.key) { b.dataset.key = def.key; b.setAttribute('aria-keyshortcuts', def.key.toUpperCase()); }
    b.append(icon(def.icon));
    const t = document.createElement('span');
    t.textContent = def.label;
    if (wide && def.hint) { const s = document.createElement('small'); s.textContent = def.hint; t.append(s); }
    b.append(t);
    if (def.key) b.append(kbd(def.key.toUpperCase()));
    if (def.page && !usable) { b.disabled = true; b.title = 'Not available on this page'; }
    b.addEventListener('click', () => {
      if (def.submenu === 'shot') { show('shot'); return; }
      run(def.tool, b);
    });
    return b;
  }

  function render() {
    const main = $('main');
    main.replaceChildren();
    for (const [title, ids] of GROUPS) {
      const h = document.createElement('h2'); h.textContent = title;
      const g = document.createElement('div'); g.className = 'grid';
      for (const id of ids) { const b = tileButton(TILES[id]); b.dataset.tile = id; g.append(b); }
      main.append(h, g);
    }
    $('shotList').replaceChildren(...SHOTS.map(s => { const b = tileButton(s, { wide: true }); b.dataset.tile = s.tool; return b; }));
  }

  // ---------- views: the tools, the screenshot choices, the shortcuts list ----------

  let view = 'main';
  const VIEWS = { main: 'main', shot: 'shotView', keys: 'keysView' };
  function show(name) {
    view = name;
    for (const [n, id] of Object.entries(VIEWS)) $(id).hidden = n !== name;
    const box = $(VIEWS[name]);
    const first = box.querySelector('button.tile:not(:disabled)') || box.querySelector('button:not(:disabled)');
    if (first) first.focus();
    if (name === 'keys') renderKeys();
  }
  $('shotBack').addEventListener('click', () => show('main'));
  $('keysBack').addEventListener('click', () => show('main'));
  $('shortcuts').addEventListener('click', () => show('keys'));
  $('allNotes').addEventListener('click', () => run('all-notes'));
  $('settings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  $('setKeys').addEventListener('click', () => { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); window.close(); });

  async function renderKeys() {
    let cmds = [];
    try { cmds = await chrome.commands.getAll(); } catch (_) {}
    const byName = new Map(cmds.map(c => [c.name, c.shortcut || '']));
    const table = $('keyTable');
    const head = document.createElement('tr');
    for (const t of ['Tool', 'Toolbox', 'Anywhere']) { const th = document.createElement('th'); th.textContent = t; head.append(th); }
    const rows = KEYROWS.map(([label, own, command]) => {
      const tr = document.createElement('tr');
      const a = document.createElement('td'), b = document.createElement('td'), c = document.createElement('td');
      a.textContent = label;
      if (own) b.append(...own.split(/(, then )/).map(x => x === ', then ' ? document.createTextNode(' then ') : kbd(x))); else { b.textContent = '—'; b.className = 'none'; }
      const sc = byName.get(command);
      if (sc) c.append(kbd(sc)); else { c.textContent = 'not set'; c.className = 'none'; }
      tr.append(a, b, c);
      tr.dataset.command = command;
      return tr;
    });
    table.replaceChildren(head, ...rows);
  }

  // ---------- keyboard ----------

  const focusables = () => [...$(VIEWS[view]).querySelectorAll('button:not(:disabled)'), ...document.querySelectorAll('footer button')];
  const center = r => r.left + r.width / 2;
  function moveFocus(dir) {
    const list = focusables();
    const cur = document.activeElement;
    const i = list.indexOf(cur);
    if (i < 0) { if (list[0]) list[0].focus(); return; }
    if (dir === 'ArrowRight') { if (list[i + 1]) list[i + 1].focus(); return; }
    if (dir === 'ArrowLeft') { if (list[i - 1]) list[i - 1].focus(); return; }
    const r = cur.getBoundingClientRect();
    const down = dir === 'ArrowDown';
    const cand = list.filter(b => { const q = b.getBoundingClientRect(); return down ? q.top > r.bottom - 2 : q.bottom < r.top + 2; });
    if (!cand.length) return;
    const top = b => Math.round(b.getBoundingClientRect().top);
    const row = down ? Math.min(...cand.map(top)) : Math.max(...cand.map(top));
    const inRow = cand.filter(b => Math.abs(top(b) - row) < 6);
    inRow.sort((a, b) => Math.abs(center(a.getBoundingClientRect()) - center(r)) - Math.abs(center(b.getBoundingClientRect()) - center(r)));
    inRow[0].focus();
  }

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); if (view !== 'main') show('main'); else window.close(); return; }
    if (e.key.startsWith('Arrow')) { e.preventDefault(); moveFocus(e.key); return; }
    if (e.key.length !== 1) return;                       // Tab, Enter, Space etc. keep their normal behaviour
    const k = e.key.toLowerCase();
    const root = view === 'keys' ? null : $(VIEWS[view]);
    const hit = (root && root.querySelector('button[data-key="' + (k === '"' ? '\\"' : k) + '"]')) || document.querySelector('footer button[data-key="' + (k === '"' ? '\\"' : k) + '"]');
    if (!hit) return;
    e.preventDefault();
    if (!hit.disabled) hit.click();
  });

  async function init() {
    // The toolbox acts on the tab you were looking at. (?tab=<id> lets a test point it at one.)
    const forced = Number(new URLSearchParams(location.search).get('tab')) || null;
    try { tab = forced ? await chrome.tabs.get(forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; } catch (_) {}
    const url = (tab && tab.url) || '';
    usable = !!tab && (!url || /^(https?|file|ftp):/i.test(url));
    if (tab && url) {
      try { $('page').textContent = (tab.title ? tab.title + ' · ' : '') + new URL(url).host; } catch (_) {}
    }
    if (!tab) setNote('Couldn’t find the page you were on. Close this and click the icon again.');
    else if (!usable) setNote('The browser doesn’t let extensions work on this kind of page, so only some tools are available.');
    render();
    const first = $('main').querySelector('button.tile:not(:disabled)');
    if (first) first.focus();

    // "Read aloud" becomes "Close reader" while the reader is open on this page.
    if (tab && usable) {
      chrome.runtime.sendMessage({ type: 'kr-popup-info', tabId: tab.id }).then(r => {
        if (!r || !r.readerOpen) return;
        const b = $('main').querySelector('[data-tile="read"]');
        if (!b) return;
        b.replaceChildren(icon('stop'), Object.assign(document.createElement('span'), { textContent: 'Close reader' }), kbd('R'));
      }).catch(() => {});
    }
  }
  init();
})();
