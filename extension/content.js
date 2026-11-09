// Page side: finds the readable text, shows the floating player,
// highlights the paragraph being read. Audio itself is generated and
// played by the extension (offscreen document), never by the page.
//
// This script is the source of truth for *what* is being read (the chunks
// and the current position). If the audio engine loses its state (browser
// closed it, extension service worker restarted, ...), the player simply
// restarts playback from the current position.
(() => {
  // A live copy is already here: nothing to do. A copy left over from a
  // previous version of the extension (after an update/reload) can no longer
  // talk to the extension, so tear it down and take over.
  const previous = window.__krReader;
  if (previous) {
    let alive = false;
    try { alive = previous.isAlive(); } catch (_) {}
    if (alive) return;
    try { previous.teardown(); } catch (_) {}
  }
  for (const stale of document.querySelectorAll('#kr-player-host')) stale.remove();

  const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,td,th,pre,caption,div,section,article,main,ul,ol,dl,table,tr,figure,header,footer,details,summary,hr';
  const SKIP_BASE = 'script,style,noscript,template,svg,canvas,video,audio,iframe,object,embed,nav,aside,button,select,textarea,input,label,[hidden],[role="navigation"],[role="complementary"],#kr-player-host,#ko-dock-host';
  // Hidden from assistive tech / modal: skipped unless that leaves nothing to read
  // (cookie banners often mark the whole page aria-hidden while they're open).
  const SKIP_STRICT = SKIP_BASE + ',[aria-hidden="true"],[role="dialog"]';
  const PAGE_CHROME = 'header,footer,[role="banner"],[role="contentinfo"]';
  const ROOT_CANDIDATES = 'main,[role="main"],article,#content,#main,#main-content,.user_content,.show-content,#wiki_page_show,.course-content,.page-content,.entry-content,.post-content';
  const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2];
  const END_PUNCT = /[.!?:;…]["'”’»)\]]*$/;
  const HL_NAME = 'kr-reading';
  const TICK_MS = 1000;
  const HEARTBEAT_TICKS = 5;

  let blocks = [];        // [{ el, text, range? }]
  let chunks = [];        // [{ text, block }]
  let mode = 'page';      // 'page' | 'selection'
  let open = false;
  let session = null;     // id of the current reading session
  let starting = false;   // waiting for the extension to accept a new session
  let startIndex = 0;
  let current = -1;       // current chunk index
  let currentBlock = -1;
  let paused = false;
  let finished = false;
  let speed = 1;
  let autoContinue = true;
  let lastSelection = '';
  let pickMode = false;
  let dead = false;       // extension context invalidated
  let tickTimer = null;
  let tick = 0;
  let lastUrl = urlNoHash();
  let navToken = 0;
  const frameDocs = new Set();
  const listenedDocs = new WeakSet();
  const cleanups = [];

  // ---------- messaging ----------

  function isAlive() {
    try { return !dead && !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  }

  async function send(msg) {
    if (!isAlive()) { orphaned(); return null; }
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (/context invalidated/i.test((e && e.message) || '')) orphaned();
      return null;
    }
  }

  // The extension was updated or reloaded underneath this page.
  function orphaned() {
    if (dead) return;
    dead = true;
    if (open && ui) {
      setStatus('Updated', 'err');
      showMsg('PageMate was updated. Click the extension icon again (or reload the page) to keep reading.', false);
    }
    stopTicker();
    clearHighlight();
  }

  // ---------- text extraction ----------

  const norm = s => String(s || '')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
  const hasWords = s => /[\p{L}\p{N}]/u.test(s);

  // Returns the element's display value, or null if it isn't rendered/visible.
  function displayOf(el) {
    let cs;
    try { cs = (el.ownerDocument.defaultView || window).getComputedStyle(el); } catch (_) { return null; }
    if (!cs || cs.display === 'none') return null;
    if (cs.display === 'contents') return 'contents';
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return null;
    if (!el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return null; // screen-reader-only text
    return cs.display;
  }

  function textLen(el) {
    try { return (el.innerText || '').length; } catch (_) { return 0; }
  }

  function pickRoot() {
    let best = null;
    let bestLen = 0;
    for (const el of document.querySelectorAll(ROOT_CANDIDATES)) {
      if (!displayOf(el)) continue;
      const len = textLen(el);
      if (len > bestLen) { best = el; bestLen = len; }
    }
    return bestLen >= 300 ? best : document.body;
  }

  function inlineText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/\s+/g, ' ');
    if (node.nodeName === 'BR') return '\n';
    return node.innerText || '';
  }

  // Walks the DOM collecting readable blocks. Leaf block elements become one
  // block each. Loose text that sits directly inside a container next to
  // other blocks (e.g. "<div>Intro <b>text</b><p>…</p></div>") becomes a
  // block too, highlighted via a Range instead of the element.
  function collectBlocks(root, skipSel) {
    const out = [];
    if (!root) return out;
    if (!root.querySelector(BLOCK_SEL)) {
      const text = norm(root.innerText || '');
      if (hasWords(text)) out.push({ el: root, text });
      return out;
    }
    const walk = container => {
      let run = [];
      const flush = () => {
        const nodes = run;
        run = [];
        if (!nodes.length) return;
        const text = norm(nodes.map(inlineText).join(''));
        if (text.length < 2 || !hasWords(text)) return;
        try {
          const range = container.ownerDocument.createRange();
          range.setStartBefore(nodes[0]);
          range.setEndAfter(nodes[nodes.length - 1]);
          out.push({ el: container, range, text });
        } catch (_) {}
      };
      for (const node of container.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (run.length || node.data.trim()) run.push(node);
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(skipSel)) continue;
        if (node.nodeName === 'BR') { if (run.length) run.push(node); continue; }
        const display = displayOf(node);
        if (!display) continue;
        const hasBlocks = !!node.querySelector(BLOCK_SEL);
        const inline = !hasBlocks && (display === 'contents' ||
          (display.startsWith('inline') && !node.matches(BLOCK_SEL)));
        if (inline) { run.push(node); continue; }
        flush();
        if (hasBlocks) {
          walk(node);
        } else {
          const text = norm(node.innerText || '');
          if (text.length > 1 && hasWords(text)) out.push({ el: node, text });
        }
      }
      flush();
    };
    walk(root);
    return out;
  }

  // Course pages sometimes put the lesson inside a same-site iframe.
  function collectFromIframes(skipSel) {
    const out = [];
    for (const frame of document.querySelectorAll('iframe')) {
      let doc;
      try { doc = frame.contentDocument; } catch (_) { continue; }
      if (!doc || !doc.body || !displayOf(frame)) continue;
      if (!doc.getElementById('kr-hl-style')) {
        const style = doc.createElement('style');
        style.id = 'kr-hl-style';
        style.textContent = '.kr-reading{background-color:rgba(255,214,102,.38)!important;box-shadow:0 0 0 4px rgba(255,214,102,.38)!important;border-radius:3px!important}::highlight(kr-reading){background-color:rgba(255,214,102,.45)}';
        (doc.head || doc.body).appendChild(style);
      }
      frameDocs.add(doc);
      listenDoc(doc);
      out.push(...collectBlocks(doc.body, skipSel + ',' + PAGE_CHROME));
    }
    return out;
  }

  // Finds the page's readable blocks without touching the current reading state.
  function gatherPageBlocks() {
    const totalLen = list => list.reduce((n, b) => n + b.text.length, 0);
    const tryCollect = skip => {
      const root = pickRoot();
      let list = collectBlocks(root, skip + (root === document.body ? ',' + PAGE_CHROME : ''));
      if (root !== document.body && totalLen(list) < 200) {
        list = collectBlocks(document.body, skip + ',' + PAGE_CHROME);
      }
      if (list.length < 3) list = list.concat(collectFromIframes(skip));
      return list;
    };
    let list = tryCollect(SKIP_STRICT);
    for (const skip of [SKIP_BASE + ',[role="dialog"]', SKIP_BASE]) {
      if (totalLen(list) >= 200) break;
      const relaxed = tryCollect(skip);
      if (totalLen(relaxed) > totalLen(list)) list = relaxed;
    }
    return list;
  }

  function useBlocks(list, newMode) {
    clearHighlight();
    unmarkBlocks();
    blocks = list;
    mode = newMode;
    if (mode === 'page') for (const b of blocks) if (!b.range) b.el.classList.add('kr-block');
  }

  function collectPage() {
    useBlocks(gatherPageBlocks(), 'page');
  }

  let segmenter;
  function splitSentences(text) {
    if (segmenter === undefined) {
      segmenter = null;
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        for (const lang of [document.documentElement.lang, 'en']) {
          try { if (lang) { segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' }); break; } } catch (_) {}
        }
      }
    }
    if (segmenter) return [...segmenter.segment(text)].map(s => s.segment.trim()).filter(Boolean);
    return text.match(/[^.!?]+[.!?]*\s*/g)?.map(s => s.trim()).filter(Boolean) || [text];
  }

  function splitLong(sentence, max = 320) {
    if (sentence.length <= max) return [sentence];
    const parts = [];
    let rest = sentence;
    while (rest.length > max) {
      let cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf('; ', max), rest.lastIndexOf(': ', max), rest.lastIndexOf(' – ', max), rest.lastIndexOf(' — ', max));
      if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max);
      if (cut < max * 0.4) cut = max - 1;
      parts.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) parts.push(rest);
    return parts.filter(Boolean);
  }

  // fastBlock: the block reading starts at. Its first sentence becomes its
  // own small chunk so audio starts quickly.
  function buildChunks(blockList, fastBlock = 0) {
    const out = [];
    blockList.forEach((b, bi) => {
      let fast = bi === fastBlock;
      let buf = '';
      const lines = b.text.split('\n').map(l => l.trim()).filter(hasWords);
      for (let line of lines) {
        if (!END_PUNCT.test(line)) line += '.';
        for (const s of splitSentences(line).flatMap(x => splitLong(x))) {
          const limit = fast ? 1 : 260;
          if (buf && buf.length + s.length + 1 > limit) {
            out.push({ text: buf, block: bi });
            buf = '';
            fast = false;
          }
          buf = buf ? buf + ' ' + s : s;
        }
      }
      if (buf) out.push({ text: buf, block: bi });
    });
    return out;
  }

  function rectOf(b) {
    try { return (b.range || b.el).getBoundingClientRect(); } catch (_) { return { top: 0, bottom: 0, height: 0 }; }
  }

  function firstVisibleBlock() {
    // At the top of the page: start at the beginning, even if the first
    // heading sits partly under the top edge.
    if (blocks.length && (document.scrollingElement || document.documentElement).scrollTop < 40) {
      const r = rectOf(blocks[0]);
      if (r.top > -200 && r.top < innerHeight) return 0;
    }
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].el.ownerDocument !== document) continue;
      const r = rectOf(blocks[i]);
      if (r.bottom > 60 && r.top < innerHeight) return i;
    }
    return 0;
  }

  // ---------- selection ----------

  function selectionInfo() {
    let text = '';
    let range = null;
    try {
      const sel = getSelection();
      text = sel ? sel.toString() : '';
      if (text.trim() && sel.rangeCount) range = sel.getRangeAt(0).cloneRange();
    } catch (_) {}
    if (!text.trim()) {
      const a = document.activeElement;
      try {
        if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.selectionEnd > a.selectionStart) {
          text = a.value.slice(a.selectionStart, a.selectionEnd);
        }
      } catch (_) {}
    }
    if (!text.trim()) {
      for (const frame of document.querySelectorAll('iframe')) {
        try {
          const sel = frame.contentWindow.getSelection();
          const t = sel ? sel.toString() : '';
          if (t.trim()) {
            text = t;
            range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
            break;
          }
        } catch (_) {}
      }
    }
    return { text: norm(text), range };
  }

  // ---------- player UI ----------

  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    replay: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12 18 18V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
    pick: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2"/><path d="M11 1h2v5h-2zM11 18h2v5h-2zM1 11h5v2H1zM18 11h5v2h-5z"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 2h8l5 5v15H6zM13 3.5V8h4.5zM8.5 12h7v1.6h-7zm0 3.2h7v1.6h-7z"/></svg>',
    video: '<svg viewBox="0 0 24 24"><path d="M4 5h11a2 2 0 0 1 2 2v3l4-2.5v9L17 14v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm5.5 4v6l4.5-3z"/></svg>'
  };

  const CSS = `
    :host { all: initial; }
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 316px; max-width: calc(100vw - 16px); box-sizing: border-box;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #e8efee; background: #16201f;
      border: 1px solid #2c3b3a; border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      padding: 10px 12px 12px; user-select: none;
    }
    .top { display: flex; align-items: center; gap: 8px; cursor: grab; margin-bottom: 8px; touch-action: none; }
    .top:active { cursor: grabbing; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fbfb5; flex: none; }
    .dot.busy { animation: pulse 1s ease-in-out infinite; }
    .dot.err { background: #ef6b5b !important; }
    .dot.idle { background: #6b7d7c !important; }
    @keyframes pulse { 50% { opacity: .3; } }
    .title { font-weight: 600; letter-spacing: .01em; }
    .status { margin-left: auto; color: #9fb3b1; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
    .bar { height: 3px; background: #2a3836; border-radius: 2px; overflow: hidden; margin-bottom: 10px; }
    .fill { height: 100%; width: 0; background: #3fbfb5; transition: width .3s ease; }
    .row { display: flex; align-items: center; gap: 4px; }
    button {
      all: unset; box-sizing: border-box; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 9px; color: #e8efee;
    }
    button:hover { background: #24312f; }
    button:focus-visible { outline: 2px solid #3fbfb5; outline-offset: 1px; }
    button svg { width: 18px; height: 18px; fill: currentColor; }
    button.main { width: 42px; height: 42px; border-radius: 50%; background: #3fbfb5; color: #0d1514; }
    button.main:hover { background: #57d0c6; }
    button.main svg { width: 22px; height: 22px; }
    button.pick.on { background: #3fbfb5; color: #0d1514; }
    button.speed { width: auto; min-width: 44px; padding: 0 8px; font-weight: 600; font-variant-numeric: tabular-nums; border: 1px solid #2c3b3a; height: 30px; font-size: 12px; }
    .spacer { flex: 1; }
    .tools { display: flex; gap: 6px; margin-top: 8px; }
    button.tool { width: auto; height: 28px; padding: 0 10px; gap: 6px; font-size: 12px; font-weight: 600; border: 1px solid #2c3b3a; border-radius: 8px; }
    button.tool svg { width: 15px; height: 15px; }
    .msg { margin-top: 8px; color: #f3b1a8; font-size: 12px; display: none; user-select: text; }
    .msg.show { display: block; }
    .msg a { color: #7fd8d0; cursor: pointer; text-decoration: underline; }
    .hint { margin-top: 8px; color: #7d908e; font-size: 11px; }
    @media (prefers-color-scheme: light) {
      .card { background: #fbfcfc; color: #15201f; border-color: #d5dfde; box-shadow: 0 10px 30px rgba(0,0,0,.15); }
      .status { color: #5a6b6a; }
      .bar { background: #e2e9e8; }
      button { color: #15201f; }
      button:hover { background: #eaf0ef; }
      button.speed, button.tool { border-color: #d5dfde; }
      button.main, button.pick.on { background: #1d7874; color: #fff; }
      button.main:hover { background: #24918c; }
      .fill, .dot { background: #1d7874; }
      .msg { color: #b33b2e; }
      .msg a { color: #1d7874; }
      .hint { color: #708280; }
    }
  `;

  let host, ui;

  function buildPlayer() {
    host = document.createElement('div');
    host.id = 'kr-player-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
    shadow.innerHTML = `
      <div class="card" role="region" aria-label="PageMate reader">
        <div class="top"><span class="dot busy"></span><span class="title">PageMate</span><span class="status" aria-live="polite">Starting…</span></div>
        <div class="bar"><div class="fill"></div></div>
        <div class="row">
          <button class="prev" title="Previous sentence" aria-label="Previous sentence">${ICONS.prev}</button>
          <button class="main" title="Pause (Alt+Shift+P)" aria-label="Pause">${ICONS.pause}</button>
          <button class="next" title="Next sentence" aria-label="Next sentence">${ICONS.next}</button>
          <span class="spacer"></span>
          <button class="pick" title="Choose where to read from" aria-label="Choose where to read from">${ICONS.pick}</button>
          <button class="speed" title="Reading speed" aria-label="Reading speed">1.0×</button>
          <button class="gear" title="Settings" aria-label="Settings">${ICONS.gear}</button>
          <button class="close" title="Stop and close" aria-label="Stop and close">${ICONS.close}</button>
        </div>
        <div class="tools">
          <button class="tool savedoc" title="Save this page as PDF, Word or Markdown (Alt+Shift+S)">${ICONS.doc}Save page</button>
          <button class="tool savevid" title="Download a video from this page (Alt+Shift+V)">${ICONS.video}Video</button>
        </div>
        <div class="msg"></div>
        <div class="hint">Alt+click a paragraph (or use ⌖) to read from there.</div>
      </div>`;
    const $ = s => shadow.querySelector(s);
    ui = {
      card: $('.card'), dot: $('.dot'), status: $('.status'), fill: $('.fill'),
      main: $('.main'), prev: $('.prev'), next: $('.next'), pick: $('.pick'), speed: $('.speed'),
      gear: $('.gear'), close: $('.close'), msg: $('.msg'), hint: $('.hint'),
      saveDoc: $('.savedoc'), saveVid: $('.savevid')
    };
    ui.main.addEventListener('click', onMainButton);
    ui.prev.addEventListener('click', () => step('prev'));
    ui.next.addEventListener('click', () => step('next'));
    ui.pick.addEventListener('click', () => setPickMode(!pickMode));
    ui.close.addEventListener('click', closePlayer);
    ui.gear.addEventListener('click', () => send({ type: 'kr-open-options' }));
    ui.saveDoc.addEventListener('click', () => send({ type: 'kr-open-save', view: 'document' }));
    ui.saveVid.addEventListener('click', () => send({ type: 'kr-open-save', view: 'video' }));
    ui.speed.addEventListener('click', cycleSpeed);
    makeDraggable($('.top'), ui.card);
  }

  function makeDraggable(handle, card) {
    let sx = null, sy, sr, sb;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = card.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sr = innerWidth - r.right; sb = innerHeight - r.bottom;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (sx == null) return;
      const right = Math.min(innerWidth - 120, Math.max(0, sr - (e.clientX - sx)));
      const bottom = Math.min(innerHeight - 60, Math.max(0, sb - (e.clientY - sy)));
      card.style.right = right + 'px';
      card.style.bottom = bottom + 'px';
    });
    const end = () => { sx = null; };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function setStatus(text, state = 'ok') {
    if (!ui) return;
    ui.status.textContent = text;
    ui.dot.className = 'dot' + (state === 'busy' ? ' busy' : state === 'err' ? ' err' : state === 'idle' ? ' idle' : '');
  }

  function showMsg(text, settingsLink = false) {
    if (!ui) return;
    ui.msg.textContent = text || '';
    if (text && settingsLink) {
      const a = document.createElement('a');
      a.textContent = 'Open settings';
      a.addEventListener('click', () => send({ type: 'kr-open-options' }));
      ui.msg.append(' ', a);
    }
    ui.msg.classList.toggle('show', !!text);
  }

  function setPlayIcon(isPlaying) {
    if (!ui) return;
    const icon = isPlaying ? 'pause' : finished ? 'replay' : 'play';
    ui.main.innerHTML = ICONS[icon];
    const label = isPlaying ? 'Pause' : finished ? 'Read again' : 'Play';
    ui.main.title = label + (finished && !isPlaying ? '' : ' (Alt+Shift+P)');
    ui.main.setAttribute('aria-label', label);
  }

  function fmtSpeed(v) {
    const n = Math.round(v * 100) / 100;
    return (Number.isInteger(n) ? n.toFixed(1) : String(n)) + '×';
  }

  function setSpeedLabel() {
    if (ui) ui.speed.textContent = fmtSpeed(speed);
  }

  function cycleSpeed() {
    const next = SPEEDS.find(s => s > speed + 0.001);
    speed = next === undefined ? SPEEDS[0] : next;
    setSpeedLabel();
    send({ type: 'kr-speed', speed });
  }

  function progressStatus() {
    return `${Math.max(1, current + 1)} / ${chunks.length}`;
  }

  // ---------- highlighting ----------

  function highlightRegistry(doc) {
    try { return doc.defaultView.CSS.highlights || null; } catch (_) { return null; }
  }

  function setRangeHighlight(b) {
    const reg = highlightRegistry(b.el.ownerDocument);
    if (!reg || typeof Highlight === 'undefined') return;
    try { reg.set(HL_NAME, new Highlight(b.range)); } catch (_) {}
  }

  function clearRangeHighlights() {
    for (const doc of [document, ...frameDocs]) {
      const reg = highlightRegistry(doc);
      if (reg) try { reg.delete(HL_NAME); } catch (_) {}
    }
  }

  function scrollToBlock(b) {
    if (b.el.ownerDocument !== document) return;
    const r = rectOf(b);
    const tall = r.height > innerHeight * 0.6;
    if (b.range) {
      const top = tall ? r.top - 80 : r.top - (innerHeight - r.height) / 2;
      window.scrollBy({ top, behavior: 'smooth' });
    } else {
      b.el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' });
    }
  }

  function highlightBlock(bi) {
    if (bi === currentBlock) return;
    const prev = blocks[currentBlock];
    let wasInView = true;
    if (prev) {
      if (prev.range) clearRangeHighlights(); else prev.el.classList.remove('kr-reading');
      const r = rectOf(prev);
      wasInView = r.bottom > 0 && r.top < innerHeight;
    }
    currentBlock = bi;
    const b = blocks[bi];
    if (!b) return;
    if (b.range) setRangeHighlight(b); else b.el.classList.add('kr-reading');
    const r = rectOf(b);
    const offscreen = r.top < 70 || r.bottom > innerHeight - 140;
    // Follow along only if the reader was following (don't fight the user's scrolling).
    if (offscreen && wasInView) scrollToBlock(b);
  }

  function clearHighlight() {
    const b = blocks[currentBlock];
    if (b && !b.range) { try { b.el.classList.remove('kr-reading'); } catch (_) {} }
    clearRangeHighlights();
    currentBlock = -1;
  }

  function unmarkBlocks() {
    for (const b of blocks) {
      try { b.el.classList.remove('kr-reading', 'kr-block'); } catch (_) {}
    }
  }

  // ---------- reading ----------

  function newSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function openPlayer() {
    if (!host) buildPlayer();
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = '';
    open = true;
    startTicker();
    try {
      chrome.storage.sync.get({ speed: 1, autoContinue: true }).then(s => {
        speed = Number(s.speed) || 1;
        autoContinue = !!s.autoContinue;
        setSpeedLabel();
      }).catch(() => {});
    } catch (_) {}
  }

  // Sends the current chunks to the audio engine and starts at `index`.
  async function begin(index, { paused: startPaused = false } = {}) {
    if (dead) { orphaned(); return; }
    if (!open) openPlayer();
    const id = newSessionId();
    session = id;
    starting = true;
    startIndex = Math.min(Math.max(0, index), Math.max(0, chunks.length - 1));
    current = -1;
    finished = false;
    paused = startPaused;
    showMsg('');
    setStatus('Loading…', 'busy');
    setPlayIcon(!paused);
    const res = await send({ type: 'kr-start', session: id, chunks: chunks.map(c => c.text), startIndex, paused: startPaused });
    if (session !== id) return; // superseded
    starting = false;
    if (!res || !res.ok) {
      session = null;
      paused = true;
      setPlayIcon(false);
      setStatus(res && res.setup ? 'Not set up' : 'Error', 'err');
      showMsg((res && res.error) || 'Couldn’t start reading. Try again.', !!(res && res.setup));
      return;
    }
    if (res.speed) { speed = Number(res.speed) || 1; setSpeedLabel(); }
    // The user toggled pause while we were starting.
    if (paused !== startPaused) control(paused ? 'pause' : 'resume');
  }

  function startPage(fromBlock, opts) {
    collectPage();
    if (!open) openPlayer();
    if (!blocks.length) {
      chunks = [];
      session = null;
      setStatus('No text found', 'idle');
      setPlayIcon(false);
      showMsg('Couldn’t find readable text here. Try selecting text, then right-click → “Read selection aloud”.');
      return false;
    }
    const startBlock = fromBlock == null ? firstVisibleBlock() : fromBlock;
    chunks = buildChunks(blocks, startBlock);
    const ci = chunks.findIndex(c => c.block >= startBlock);
    begin(ci < 0 ? 0 : ci, opts);
    return true;
  }

  // Reads a list of ready-made sentences (used for "read my notes aloud"); nothing on the page is highlighted.
  function startText(list) {
    useBlocks([], 'selection');
    const joined = list.join('\n');
    chunks = buildChunks([{ text: joined }], 0).map(c => ({ ...c, block: -1 }));
    if (!chunks.length) return false;
    if (!open) openPlayer();
    begin(0);
    return true;
  }

  function startSelection(text, range) {
    lastSelection = text;
    const anc = range && range.commonAncestorContainer;
    const el = anc && (anc.nodeType === 1 ? anc : anc.parentElement);
    useBlocks(el ? [{ el, range, text }] : [], 'selection');
    if (!el) range = null;
    chunks = buildChunks([{ text }], 0).map(c => ({ ...c, block: range ? 0 : -1 }));
    if (!chunks.length) return;
    begin(0);
  }

  // Audio engine lost our session (or never got it): restart from our own position.
  function restartFor(action, index) {
    if (!chunks.length) return;
    const pos = current >= 0 ? current : startIndex;
    let target = pos;
    let startPaused = paused;
    switch (action) {
      case 'resume': target = finished ? 0 : pos; startPaused = false; break;
      case 'next': target = pos + 1; break;
      case 'prev': target = pos - 1; break;
      case 'jump': target = index; startPaused = false; break;
      case 'pause':
        paused = true;
        setPlayIcon(false);
        setStatus('Paused', 'idle');
        return;
    }
    if (target >= chunks.length) { onEvent({ type: 'done' }); return; }
    begin(Math.max(0, target), { paused: startPaused });
  }

  async function control(action, index) {
    if (!session) { restartFor(action, index); return; }
    const id = session;
    const r = await send({ type: 'kr-control', action, index, session: id });
    if (dead || session !== id) return;
    if (!r || !r.ok) restartFor(action, index);
  }

  function step(action) {
    if (starting) return;
    if (finished && action === 'prev') { finished = false; begin(chunks.length - 1); return; }
    control(action);
  }

  function onMainButton() {
    if (dead) return;
    if (!chunks.length) { if (mode === 'page') startPage(); return; }
    if (starting) {
      paused = !paused;
      setPlayIcon(!paused);
      return;
    }
    if (finished || !session) {
      if (finished) begin(0);
      else restartFor('resume');
      return;
    }
    if (paused) {
      paused = false;
      setPlayIcon(true);
      setStatus(current >= 0 ? progressStatus() : 'Loading…', current >= 0 ? 'ok' : 'busy');
      control('resume');
    } else {
      paused = true;
      setPlayIcon(false);
      setStatus('Paused', 'idle');
      control('pause');
    }
  }

  function closePlayer() {
    if (session) send({ type: 'kr-control', action: 'stop', session });
    hidePlayer();
  }

  function hidePlayer() {
    session = null;
    starting = false;
    open = false;
    finished = false;
    current = -1;
    stopTicker();
    setPickMode(false);
    clearHighlight();
    unmarkBlocks();
    document.documentElement.classList.remove('kr-jump-mode');
    if (host) host.style.display = 'none';
  }

  function onEvent(ev) {
    if (!open || !ev) return;
    switch (ev.type) {
      case 'loading':
        if (ev.index !== current) setStatus('Loading…', 'busy');
        break;
      case 'chunk': {
        current = ev.index;
        finished = false;
        const c = chunks[ev.index];
        if (c && c.block >= 0) highlightBlock(c.block);
        const total = ev.total || chunks.length;
        ui.fill.style.width = (((ev.index + 1) / total) * 100).toFixed(1) + '%';
        paused = !!ev.paused;
        setStatus(paused ? 'Paused' : progressStatus(), paused ? 'idle' : 'ok');
        setPlayIcon(!paused);
        showMsg('');
        break;
      }
      case 'paused':
        paused = true;
        setPlayIcon(false);
        setStatus('Paused', 'idle');
        break;
      case 'resumed':
        paused = false;
        setPlayIcon(true);
        if (current >= 0) setStatus(progressStatus());
        break;
      case 'done':
        finished = true;
        paused = false;
        setPlayIcon(false);
        setStatus('Finished', 'idle');
        ui.fill.style.width = '100%';
        clearHighlight();
        break;
      case 'error':
        paused = true;
        if (typeof ev.index === 'number') current = ev.index;
        setPlayIcon(false);
        setStatus('Error', 'err');
        showMsg(String(ev.message || 'Something went wrong.') + ' Press play to retry.', true);
        break;
    }
  }

  // ---------- jump to a paragraph (Alt+click or pick mode) ----------

  function blockIndexAt(e, list) {
    const target = e.target;
    if (!target || target.nodeType !== 1) return -1;
    const doc = target.ownerDocument || document;
    let node = target, offset = 0;
    try {
      const cr = doc.caretRangeFromPoint && doc.caretRangeFromPoint(e.clientX, e.clientY);
      if (cr && target.contains(cr.startContainer)) { node = cr.startContainer; offset = cr.startOffset; }
    } catch (_) {}
    for (let i = 0; i < list.length; i++) {
      if (!list[i].range && list[i].el.contains(node)) return i;
    }
    for (let i = 0; i < list.length; i++) {
      const r = list[i].range;
      try { if (r && r.isPointInRange(node, offset)) return i; } catch (_) {}
    }
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      try { if (target.contains(b.el) || (b.range && b.range.intersectsNode(target))) return i; } catch (_) {}
    }
    return -1;
  }

  function jumpFromEvent(e) {
    // Fast path: the paragraph is one we're already reading from.
    if (mode === 'page' && blocks.length && chunks.length) {
      const bi = blockIndexAt(e, blocks);
      const ci = bi < 0 ? -1 : chunks.findIndex(c => c.block === bi);
      if (ci >= 0) {
        if (!session || finished || starting) begin(ci);
        else { paused = false; setPlayIcon(true); setStatus('Loading…', 'busy'); control('jump', ci); }
        return true;
      }
    }
    // Reading a selection, or the page changed since we collected it
    // (lazy-loaded content): collect again and start from the clicked block.
    const list = gatherPageBlocks();
    const bi = blockIndexAt(e, list);
    if (bi < 0) return false;
    useBlocks(list, 'page');
    chunks = buildChunks(blocks, bi);
    const ci = chunks.findIndex(c => c.block === bi);
    begin(ci < 0 ? 0 : ci);
    return true;
  }

  function onDocClick(e) {
    if (!open || dead) return;
    if (!(e.altKey || pickMode)) return;
    if (host && e.composedPath().includes(host)) return;
    if (e.button !== 0) return;
    const wasPick = pickMode;
    setPickMode(false);
    if (jumpFromEvent(e) || wasPick) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  function setPickMode(on) {
    pickMode = !!on && open;
    document.documentElement.classList.toggle('kr-jump-mode', pickMode);
    for (const d of frameDocs) { try { d.documentElement.classList.toggle('kr-jump-mode', pickMode); } catch (_) {} }
    if (ui) {
      ui.pick.classList.toggle('on', pickMode);
      ui.hint.textContent = pickMode
        ? 'Click the paragraph to read from. Esc cancels.'
        : 'Alt+click a paragraph (or use ⌖) to read from there.';
    }
  }

  function onKeyDown(e) {
    if (!open) return;
    if (e.key === 'Alt') document.documentElement.classList.add('kr-jump-mode');
    if (e.key === 'Escape' && pickMode) { setPickMode(false); e.stopPropagation(); }
  }

  function onKeyUp(e) {
    if (e.key === 'Alt' && !pickMode) document.documentElement.classList.remove('kr-jump-mode');
  }

  function onBlur() {
    if (!pickMode) document.documentElement.classList.remove('kr-jump-mode');
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  function listenDoc(doc) {
    if (listenedDocs.has(doc)) return;
    listenedDocs.add(doc);
    try {
      const win = doc.defaultView || window;
      on(win, 'click', onDocClick, true);
      if (doc !== document) on(win, 'keydown', onKeyDown, true);
    } catch (_) {}
  }

  // ---------- navigation and health ----------

  function urlNoHash() {
    return location.href.split('#')[0];
  }

  // Resolves once the DOM stops changing (or after maxMs).
  function waitForQuiet(quietMs = 600, maxMs = 5000) {
    return new Promise(resolve => {
      let timer;
      const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
      const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quietMs); });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(done, quietMs);
      const cap = setTimeout(done, maxMs);
    });
  }

  // Same-tab navigation in a single-page app (no full page load).
  async function onSpaNavigate() {
    if (mode === 'selection') return; // a selection reads the same regardless of URL
    const token = ++navToken;
    await waitForQuiet(700, 6000);
    if (token !== navToken || !open) return;
    // Some sites update the URL while you scroll or switch a tab. If what we're
    // reading is still on screen, keep going.
    const b = blocks[currentBlock >= 0 ? currentBlock : (chunks[startIndex] ? chunks[startIndex].block : -1)];
    const el = b && (b.range ? b.range.startContainer.parentElement : b.el);
    if (!finished && el && el.isConnected && displayOf(el)) return;
    if (!autoContinue) { closePlayer(); return; }
    // Starting a new session replaces the old one in the audio engine.
    startPage(0, { paused: paused && !finished });
  }

  // Started by the extension after a full page load in the tab we were reading.
  async function autoStart(startPaused) {
    const token = ++navToken;
    openPlayer();
    setStatus('Loading…', 'busy');
    await waitForQuiet(500, 3000);
    if (token !== navToken || !open) return;
    if (!startPage(null, { paused: startPaused })) {
      // Late-rendering pages: give them one more chance.
      await new Promise(r => setTimeout(r, 1500));
      if (token === navToken && open) startPage(null, { paused: startPaused });
    }
  }

  async function heartbeat() {
    if (!session || starting || paused || finished || dead) return;
    const id = session;
    const r = await send({ type: 'kr-control', action: 'status', session: id });
    if (dead || session !== id || starting) return;
    if (!r || !r.ok) {
      // The audio engine went away while we were playing: pick up where we were.
      restartFor('status');
    }
  }

  function onTick() {
    if (!open) return;
    if (!isAlive()) { orphaned(); return; }
    const url = urlNoHash();
    if (url !== lastUrl) {
      lastUrl = url;
      onSpaNavigate();
      return;
    }
    if (++tick % HEARTBEAT_TICKS === 0) heartbeat();
  }

  function startTicker() {
    if (!tickTimer) tickTimer = setInterval(onTick, TICK_MS);
  }

  function stopTicker() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function onPageHide() {
    if (!open || !session || dead) return;
    try {
      chrome.runtime.sendMessage({ type: 'kr-page-leaving', session, paused: paused && !finished }).catch(() => {});
    } catch (_) {}
  }

  function onPageShow(e) {
    // Restored from the back/forward cache: the old session is over. If
    // auto-continue is on, the extension will start a fresh one.
    if (e.persisted && open) hidePlayer();
    lastUrl = urlNoHash();
  }

  // ---------- wiring ----------

  listenDoc(document);
  on(window, 'keydown', onKeyDown, true);
  on(window, 'keyup', onKeyUp, true);
  on(window, 'blur', onBlur);
  on(window, 'pagehide', onPageHide);
  on(window, 'pageshow', onPageShow);

  const onStorage = (changes, area) => {
    if (area !== 'sync') return;
    if (changes.speed) { speed = Number(changes.speed.newValue) || 1; setSpeedLabel(); }
    if (changes.autoContinue) autoContinue = !!changes.autoContinue.newValue;
  };
  try { chrome.storage.onChanged.addListener(onStorage); } catch (_) {}

  const onMessage = (msg, _sender, sendResponse) => {
    if (!msg || dead) return;
    switch (msg.type) {
      case 'kr-ping':
        sendResponse({ alive: true, open, session });
        return;
      case 'kr-toggle': {
        navToken++;
        const local = selectionInfo();
        const text = local.text || norm(msg.selectionText || '');
        const range = local.text ? local.range : null;
        if (msg.mode === 'page') {
          startPage();
        } else if (msg.mode === 'selection') {
          if (text && hasWords(text)) startSelection(text, range);
          else {
            openPlayer();
            setStatus('Nothing selected', 'idle');
            setPlayIcon(false);
            showMsg('Select some text first, then choose “Read selection aloud”.');
          }
        } else if (text.length > 20 && hasWords(text) && (!open || text !== lastSelection)) {
          startSelection(text, range);
        } else if (open) {
          closePlayer();
        } else {
          startPage();
        }
        sendResponse(true);
        return;
      }
      case 'kr-read-text':
        navToken++;
        sendResponse(startText((msg.chunks || []).filter(x => typeof x === 'string' && x.trim())));
        return;
      case 'kr-autostart':
        autoStart(!!msg.paused);
        sendResponse(true);
        return;
      case 'kr-toggle-pause':
        if (open) onMainButton();
        sendResponse(true);
        return;
      case 'kr-event':
        if (msg.session && msg.session === session) onEvent(msg.event);
        return;
      case 'kr-stopped':
        hidePlayer();
        return;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  function teardown() {
    dead = true;
    stopTicker();
    try { clearHighlight(); unmarkBlocks(); } catch (_) {}
    for (const fn of cleanups.splice(0)) { try { fn(); } catch (_) {} }
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) {}
    try { chrome.storage.onChanged.removeListener(onStorage); } catch (_) {}
    document.documentElement.classList.remove('kr-jump-mode');
    if (host) host.remove();
    if (window.__krReader === api) window.__krReader = null;
  }

  const api = { isAlive, teardown };
  window.__krReader = api;
})();
