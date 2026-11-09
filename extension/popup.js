// The toolbox shown when you click the toolbar icon: one tile per tool, so you choose what to do.
// Each tile asks the background script to run a tool on the tab you were looking at (the background owns the logic;
// this page only picks). Everything is built with createElement / textContent.
//
// Keyboard: every tile has a letter (shown on it), the arrow keys move between tiles, Enter / Space starts one,
// Esc goes back. "Shortcuts" lists these letters and the browser-wide shortcuts of every tool.
(function () {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  const { ICONS, icon, TILES, GROUPS, SHOTS, KEYROWS } = KOTools;

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
