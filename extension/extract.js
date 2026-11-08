// Page side of "Save": turns the page (or the current selection) into a small,
// format-neutral document model, and finds the videos on the page.
//
// Injected on demand by the Save page. It never sends anything anywhere: the
// model is handed straight back to the extension page that asked for it.
//
// Model
//   { title, url, lang, blocks: Block[] }
//   Block = { t:'h', l:1-6, r:Run[] }
//         | { t:'p', r:Run[], cap?:true }
//         | { t:'list', ordered:bool, start:n, items: Block[][] }
//         | { t:'quote', b:Block[] }
//         | { t:'code', text, lang }
//         | { t:'img', src, alt, w, h }
//         | { t:'video', src, poster, title, embed?:true, audio?:true, stream?:true }
//         | { t:'table', rows: Cell[][] }      Cell = { h:bool, r:Run[], cs:n }
//         | { t:'hr' }
//   Run   = { x:text, b,i,c,u,s,sup,sub: 1, a: href }  |  { br: 1 }
(() => {
  const VERSION = 2;

  const SKIP = 'script,style,noscript,template,canvas,object,embed,nav,select,textarea,input,' +
    'datalist,optgroup,option,svg,math-hidden,[hidden]:not([hidden="until-found"]),[role="navigation"],' +
    '[role="dialog"],[role="alertdialog"],[aria-modal="true"],#kr-player-host';
  const PAGE_CHROME = 'header,footer,aside,[role="banner"],[role="contentinfo"],[role="complementary"]';
  const NOISE_NAME = /(^|[\s_-])(cookie|consent|gdpr|skip-?link|breadcrumbs?|screenreader|sr-only|visually-hidden)([\s_-]|$)/i;
  const ROOT_CANDIDATES = 'main,[role="main"],article,#content,#main,#main-content,.user_content,.show-content,' +
    '#wiki_page_show,.course-content,.page-content,.entry-content,.post-content';
  const INLINE_TAGS = new Set(['A', 'ABBR', 'ACRONYM', 'B', 'BDI', 'BDO', 'BIG', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM',
    'FONT', 'I', 'INS', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME', 'TT',
    'U', 'VAR', 'WBR', 'LABEL', 'BR']);
  const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|flow-root|table-row|table-cell)/;
  const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|wistia\.(com|net)|fast\.wistia|kaltura\.com|panopto\.(com|eu)|zoom\.us|brightcove(\.net|\.com)|players\.brightcove|loom\.com|jwplatform\.com|jwplayer\.com|vidyard\.com|dailymotion\.com|twitch\.tv|mediasite\.com|echo360\.(org|com)|ted\.com|vzaar\.com|cloudfront\.net\/.*video|streamable\.com|bitchute\.com|odysee\.com|rumble\.com|screencast-o-matic\.com|screencast\.com|techsmith\.com|microsoftstream\.com|sharepoint\.com|video\.ibm\.com|ustream\.tv|vevo\.com|spotify\.com|soundcloud\.com|bandcamp\.com)$/i;
  const MIN_IMG = 32; // rendered px; smaller images are icons / spacers

  function nearestHeading(el) {
    let n = el;
    for (let depth = 0; n && depth < 4; depth++, n = n.parentElement) {
      let p = n.previousElementSibling;
      for (let i = 0; p && i < 3; i++, p = p.previousElementSibling) {
        if (/^H[1-6]$/.test(p.tagName)) return cleanText(p.textContent).replace(/\s+/g, ' ').trim().slice(0, 120);
      }
    }
    return '';
  }

  // Kaltura "click to start" buttons: <button kaltura source="ENTRY" poster=".../p/PARTNER/thumbnail/entry_id/ENTRY/...">
  function kalturaFrom(el) {
    const poster = el.getAttribute('poster') || ((el.querySelector && el.querySelector('img')) || {}).src || '';
    const entry = el.getAttribute('source') || el.getAttribute('data-entry-id') || (/entry_id\/([0-9a-z_]+)/i.exec(poster) || [])[1] || '';
    const pid = (/\/p\/(\d+)\//.exec(poster) || [])[1] || el.getAttribute('data-partner-id') || '';
    return { entry, pid, poster: safeSrc(poster, el.ownerDocument.baseURI) };
  }
  const isKalturaButton = el => el.hasAttribute('kaltura') || (el.hasAttribute('poster') && el.hasAttribute('source'));

  // ---------- small helpers ----------

  const cleanText = s => String(s == null ? '' : s)
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍⁠﻿­]/g, '');

  function safeHref(raw, base) {
    if (!raw) return '';
    try {
      const u = new URL(raw, base || location.href);
      return /^(https?|mailto|tel):$/.test(u.protocol) ? u.href : '';
    } catch (_) { return ''; }
  }

  function safeSrc(raw, base) {
    if (!raw) return '';
    if (/^data:image\//i.test(raw)) return raw;
    try {
      const u = new URL(raw, base || location.href);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch (_) { return ''; }
  }

  function sameDocLink(href, doc) {
    const here = (doc.location ? doc.location.href : location.href).split('#')[0];
    return href.startsWith(here + '#');
  }

  // ---------- converter ----------

  // `live` is true when walking the real page (computed styles are available);
  // false when walking a detached copy of the selection.
  function createConverter(rootDoc, live, stats, skipSet) {
    const view = d => d.defaultView || window;

    function styleOf(el) {
      if (!live) return null;
      try { return view(el.ownerDocument).getComputedStyle(el); } catch (_) { return null; }
    }

    function hidden(el) {
      if (el.nodeType !== 1) return false;
      if (el.matches(SKIP) || (skipSet && skipSet.has(el))) return true;
      if (!live) return false;
      const cs = styleOf(el);
      if (!cs) return false;
      if (cs.display === 'none') return true;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
        // Scroll-reveal libraries (ScrollReveal etc.) keep content visibility:hidden until it is scrolled
        // into view. It is real content, so keep it.
        if (!el.closest('[data-sr-id],[data-sr-processed],[data-aos],.wow,.reveal')) return true;
      }
      const name = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      if (NOISE_NAME.test(name)) {
        // "sr-only" style helpers carry real text sometimes; only drop them when they render as nothing.
        if (/cookie|consent|gdpr/i.test(name)) return true;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return true;
        if (/breadcrumb|skip/i.test(name)) return true;
      }
      if (!INLINE_TAGS.has(el.tagName) || el.textContent) {
        // Visually-hidden text (clip / 1px boxes) is for screen readers only.
        if (cs.position === 'absolute' && (cs.clip !== 'auto' || cs.clipPath !== 'none') && el.getBoundingClientRect().width <= 1) return true;
      }
      return false;
    }

    function kids(el) {
      try {
        if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
        if (el.tagName === 'SLOT') {
          const assigned = el.assignedNodes({ flatten: true });
          if (assigned.length) return assigned;
        }
      } catch (_) {}
      return Array.from(el.childNodes);
    }

    function isBlockish(el) {
      if (!INLINE_TAGS.has(el.tagName)) return true;
      if (el.tagName === 'BR') return false;
      const cs = styleOf(el);
      return !!(cs && BLOCK_DISPLAY.test(cs.display));
    }

    // Does this inline-looking element hold anything that must be its own block?
    const BLOCK_INSIDE = 'p,div,ul,ol,li,table,pre,blockquote,h1,h2,h3,h4,h5,h6,img,picture,video,audio,iframe,figure,hr,dl,section,article';
    function holdsBlocks(el) {
      try { return !!el.querySelector(BLOCK_INSIDE); } catch (_) { return false; }
    }

    // ----- inline runs -----

    function pushText(st, text, fmt) {
      if (!text) return;
      const last = st.run[st.run.length - 1];
      if (last && last.x != null && sameFmt(last, fmt)) { last.x += text; return; }
      st.run.push({ x: text, ...fmt });
    }

    function sameFmt(run, fmt) {
      return !!run.b === !!fmt.b && !!run.i === !!fmt.i && !!run.c === !!fmt.c && !!run.u === !!fmt.u &&
        !!run.s === !!fmt.s && !!run.sup === !!fmt.sup && !!run.sub === !!fmt.sub && (run.a || '') === (fmt.a || '');
    }

    function fmtFor(el, fmt) {
      const f = { ...fmt };
      switch (el.tagName) {
        case 'B': case 'STRONG': f.b = 1; break;
        case 'I': case 'EM': case 'CITE': case 'DFN': case 'VAR': f.i = 1; break;
        case 'CODE': case 'KBD': case 'SAMP': case 'TT': f.c = 1; break;
        case 'U': case 'INS': f.u = 1; break;
        case 'S': case 'STRIKE': case 'DEL': f.s = 1; break;
        case 'SUP': f.sup = 1; break;
        case 'SUB': f.sub = 1; break;
        case 'MARK': f.b = 1; break;
        case 'A': {
          const href = safeHref(el.getAttribute('href') != null ? el.href || el.getAttribute('href') : '', el.ownerDocument.baseURI);
          if (href && !sameDocLink(href, el.ownerDocument)) f.a = href;
          break;
        }
      }
      if (live && !f.b) {
        const cs = styleOf(el);
        if (cs && (cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 600) && el.tagName === 'SPAN') f.b = 1;
        if (cs && cs.fontStyle === 'italic' && el.tagName === 'SPAN') f.i = 1;
      }
      return f;
    }

    function inlineNode(node, st, fmt) {
      if (node.nodeType === 3) {
        const raw = node.data;
        const text = fmt.pre ? cleanText(raw) : cleanText(raw).replace(/[ \t\r\n\f]+/g, ' ');
        pushText(st, text, stripPre(fmt));
        return;
      }
      if (node.nodeType !== 1) return;
      if (hidden(node)) return;
      const tag = node.tagName;
      if (tag === 'BR') { st.run.push({ br: 1 }); return; }
      if (tag === 'WBR') return;
      if (tag === 'IMG' || tag === 'PICTURE') { blockLevel(node, st); return; }
      if (['VIDEO', 'AUDIO', 'IFRAME', 'FIGURE', 'TABLE', 'UL', 'OL', 'PRE', 'P', 'DIV', 'BLOCKQUOTE', 'HR'].includes(tag)) {
        blockLevel(node, st);
        return;
      }
      if (tag === 'INPUT') return;
      const f = fmtFor(node, fmt);
      for (const k of kids(node)) {
        if (k.nodeType === 1 && (isBlockish(k) || holdsBlocks(k)) && !INLINE_TAGS.has(k.tagName)) { blockLevel(k, st); continue; }
        inlineNode(k, st, f);
      }
    }

    const stripPre = f => { if (!f.pre) return f; const { pre, ...rest } = f; return rest; };

    function flush(st) {
      const run = tidyRuns(st.run);
      st.run = [];
      if (run.length) st.out.push({ t: 'p', r: run });
    }

    // Trim edges, drop empty runs, merge neighbours.
    function tidyRuns(runs) {
      const out = [];
      for (const r of runs) {
        if (r.br) {
          if (out.length && !out[out.length - 1].br) out.push(r);
          continue;
        }
        if (!r.x) continue;
        const last = out[out.length - 1];
        if (last && last.x != null && sameFmt(last, r)) last.x += r.x; else out.push({ ...r });
      }
      while (out.length && out[out.length - 1].br) out.pop();
      while (out.length && out[0].br) out.shift();
      // Spaces next to a line break are noise.
      for (let i = 0; i < out.length; i++) {
        if (out[i].br) {
          if (out[i - 1] && out[i - 1].x != null) out[i - 1].x = out[i - 1].x.replace(/ +$/, '');
          if (out[i + 1] && out[i + 1].x != null) out[i + 1].x = out[i + 1].x.replace(/^ +/, '');
        }
      }
      if (out.length && out[0].x != null) out[0].x = out[0].x.replace(/^ +/, '');
      const end = out[out.length - 1];
      if (end && end.x != null) end.x = end.x.replace(/ +$/, '');
      const kept = out.filter(r => r.br || r.x);
      return kept.some(r => r.x != null && /[^\s]/.test(r.x)) || kept.some(r => r.a) ? kept : [];
    }

    // ----- block-level -----

    function convertChildren(el, st) {
      for (const k of kids(el)) {
        if (k.nodeType === 3) { inlineNode(k, st, {}); continue; }
        if (k.nodeType !== 1) continue;
        if (hidden(k)) continue;
        if (!isBlockish(k) && !holdsBlocks(k)) { inlineNode(k, st, {}); continue; }
        blockLevel(k, st);
      }
    }

    function childBlocks(el) {
      const st = { out: [], run: [] };
      convertChildren(el, st);
      flush(st);
      return st.out;
    }

    function runsOf(el) {
      const st = { out: [], run: [] };
      for (const k of kids(el)) inlineNode(k, st, {});
      const run = tidyRuns(st.run);
      // Nested blocks got pushed to st.out; fold their text in.
      const folded = [];
      for (const b of st.out) { folded.push(...blockRuns(b)); folded.push({ br: 1 }); }
      return tidyRuns(run.length || !folded.length ? (folded.length ? [...folded, ...run] : run) : folded);
    }

    function blockRuns(b) {
      switch (b.t) {
        case 'p': case 'h': return b.r;
        case 'list': return b.items.flatMap(it => it.flatMap(x => [...blockRuns(x), { br: 1 }]));
        case 'quote': return b.b.flatMap(x => [...blockRuns(x), { br: 1 }]);
        case 'code': return [{ x: b.text, c: 1 }];
        case 'img': return b.alt ? [{ x: b.alt }] : [];
        default: return [];
      }
    }

    function cellOf(cell) {
      const st = { out: [], run: [] };
      convertChildren(cell, st);
      flush(st);
      const r = tidyRuns(st.out.flatMap((b, i) => (i ? [{ br: 1 }] : []).concat(blockRuns(b))));
      return { h: cell.tagName === 'TH', r, cs: Math.max(1, Math.min(20, parseInt(cell.getAttribute('colspan'), 10) || 1)) };
    }

    function tableBlock(table) {
      const rows = [];
      const rowEls = Array.from(table.rows || table.querySelectorAll('tr'));
      for (const tr of rowEls) {
        if (hidden(tr)) continue;
        const cells = [];
        for (const c of Array.from(tr.cells || tr.children)) {
          if (c.nodeType !== 1 || !/^(TD|TH)$/.test(c.tagName) || hidden(c)) continue;
          cells.push(cellOf(c));
        }
        if (cells.some(c => c.r.length)) rows.push(cells);
      }
      const cap = table.querySelector && table.querySelector('caption');
      const out = [];
      if (cap && !hidden(cap)) {
        const r = runsOf(cap);
        if (r.length) out.push({ t: 'p', r: r.map(x => (x.x != null ? { ...x, b: 1 } : x)) });
      }
      if (rows.length) out.push({ t: 'table', rows });
      return out;
    }

    function imageBlock(img, st) {
      // Lazy-loaded images keep the real address in a data attribute.
      let raw = img.currentSrc || img.getAttribute('src') || '';
      if (!raw || /^data:image\/(gif|svg\+xml);base64,.{0,200}$/i.test(raw)) {
        for (const a of ['data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'srcset']) {
          const v = img.getAttribute(a);
          if (v) { raw = v.split(',')[0].trim().split(/\s+/)[0]; if (raw) break; }
        }
      }
      const src = safeSrc(raw, img.ownerDocument.baseURI);
      const alt = cleanText(img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      const w = img.naturalWidth || parseInt(img.getAttribute('width'), 10) || 0;
      const h = img.naturalHeight || parseInt(img.getAttribute('height'), 10) || 0;
      if (live) {
        const rw = img.clientWidth || (img.getBoundingClientRect().width | 0);
        const rh = img.clientHeight || (img.getBoundingClientRect().height | 0);
        if ((rw && rw < MIN_IMG) || (rh && rh < MIN_IMG)) {
          // Emoji and tiny glyph images: keep their text if they have any.
          if (alt) pushText(st, ' ' + alt + ' ', {});
          return;
        }
      }
      if (!src) { if (alt) pushText(st, alt, {}); return; }
      if (img.getAttribute('role') === 'presentation' && !alt) return;
      flush(st);
      st.out.push({ t: 'img', src, alt, w, h });
      stats.images++;
    }

    function mediaBlock(el, st) {
      const audio = el.tagName === 'AUDIO';
      const base = el.ownerDocument.baseURI;
      let raw = el.currentSrc || el.getAttribute('src') || '';
      if (!raw) {
        const s = el.querySelector('source[src]');
        if (s) raw = s.getAttribute('src');
      }
      const stream = /^blob:/i.test(raw);
      const src = stream ? '' : safeHref(raw, base);
      const poster = safeSrc(el.getAttribute('poster') || '', base);
      const title = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim() || nearestHeading(el);
      flush(st);
      st.out.push({ t: 'video', src, poster, title, audio, stream: stream || !src, el: mark(el) });
      stats.videos++;
    }


    function iframeBlock(frame, st) {
      const base = frame.ownerDocument.baseURI;
      const src = safeHref(frame.getAttribute('src') || frame.getAttribute('data-src') || '', base);
      let doc = null;
      try { doc = frame.contentDocument; } catch (_) {}
      if (doc && doc.body && doc.body.innerText && doc.body.innerText.trim().length > 40 && !isVideoFrame(frame, src)) {
        // Same-site frame (course pages often put the lesson in one): include its content in place.
        flush(st);
        const sub = createConverter(doc, live, stats, skipSet);
        const blocks = sub.childBlocks(doc.body);
        st.out.push(...blocks);
        return;
      }
      if (!src) return;
      const r = live ? frame.getBoundingClientRect() : { width: 999, height: 999 };
      if (live && (r.width < 100 || r.height < 60)) return;
      flush(st);
      const title = (frame.getAttribute('title') || frame.getAttribute('aria-label') || '').trim();
      if (isVideoFrame(frame, src)) {
        st.out.push({ t: 'video', src, poster: '', title, embed: true, el: mark(frame) });
        stats.videos++;
      } else {
        st.out.push({ t: 'p', r: [{ x: 'Embedded content: ' }, { x: title || src, a: src }] });
      }
    }

    function isVideoFrame(frame, src) {
      try {
        if (src && VIDEO_HOSTS.test(new URL(src).hostname)) return true;
      } catch (_) {}
      const allow = (frame.getAttribute('allow') || '') + ' ' + (frame.getAttribute('title') || '');
      return /(autoplay|picture-in-picture|encrypted-media)/i.test(allow) || /video|player|recording|lecture/i.test(allow);
    }

    function listBlock(el, st) {
      const ordered = el.tagName === 'OL';
      const items = [];
      for (const li of kids(el)) {
        if (li.nodeType !== 1 || hidden(li)) continue;
        if (li.tagName === 'LI' || li.getAttribute('role') === 'listitem') {
          const blocks = childBlocks(li);
          if (blocks.length) items.push(blocks);
        } else if (li.tagName === 'UL' || li.tagName === 'OL') {
          // Malformed nesting: <ul><ul>…</ul></ul>
          const sub = [];
          listBlock(li, { out: sub, run: [] });
          if (sub.length) items.push(sub);
        }
      }
      if (!items.length) return;
      flush(st);
      const start = ordered ? parseInt(el.getAttribute('start'), 10) : NaN;
      st.out.push({ t: 'list', ordered, start: Number.isFinite(start) ? start : 1, items });
    }

    function blockLevel(el, st) {
      if (hidden(el)) return;
      const tag = el.tagName;
      switch (tag) {
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
          const r = runsOf(el);
          if (r.length) { flush(st); st.out.push({ t: 'h', l: +tag[1], r }); }
          return;
        }
        case 'P': {
          // A paragraph that contains other blocks is just a container (invalid but common).
          if (holdsBlocks(el)) { flush(st); convertChildren(el, st); flush(st); return; }
          const r = runsOf(el);
          if (r.length) { flush(st); st.out.push({ t: 'p', r }); }
          return;
        }
        case 'FIGCAPTION': {
          const r = runsOf(el);
          if (r.length) { flush(st); st.out.push({ t: 'p', r, cap: true }); }
          return;
        }
        case 'UL': case 'OL': listBlock(el, st); return;
        case 'DL': {
          for (const k of kids(el)) {
            if (k.nodeType !== 1 || hidden(k)) continue;
            if (k.tagName === 'DT') { const r = runsOf(k); if (r.length) { flush(st); st.out.push({ t: 'p', r: r.map(x => (x.x != null ? { ...x, b: 1 } : x)) }); } }
            else if (k.tagName === 'DD') { flush(st); st.out.push({ t: 'quote', b: childBlocks(k) }); }
            else if (k.tagName === 'DIV') blockLevel(k, st);
          }
          return;
        }
        case 'BLOCKQUOTE': {
          const b = childBlocks(el);
          if (b.length) { flush(st); st.out.push({ t: 'quote', b }); }
          return;
        }
        case 'PRE': {
          const text = cleanText(el.textContent).replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
          if (!text) return;
          const cls = (el.className || '') + ' ' + ((el.querySelector('code') || {}).className || '');
          const m = /(?:language|lang)-([\w+#-]+)/.exec(cls);
          flush(st);
          st.out.push({ t: 'code', text, lang: m ? m[1] : '' });
          return;
        }
        case 'HR': flush(st); st.out.push({ t: 'hr' }); return;
        case 'TABLE': {
          const blocks = tableBlock(el);
          if (blocks.length) { flush(st); st.out.push(...blocks); }
          return;
        }
        case 'IMG': imageBlock(el, st); return;
        case 'PICTURE': { const img = el.querySelector('img'); if (img) imageBlock(img, st); return; }
        case 'VIDEO': case 'AUDIO': mediaBlock(el, st); return;
        case 'IFRAME': iframeBlock(el, st); return;
        case 'BUTTON': {
          if (isKalturaButton(el)) {
            const k = kalturaFrom(el);
            flush(st);
            st.out.push({ t: 'video', src: location.href.split('#')[0], poster: k.poster, title: nearestHeading(el) || 'Course video' + (k.entry ? ' (' + k.entry + ')' : ''), kaltura: k.entry ? { pid: k.pid, entry: k.entry } : null, el: mark(el) });
            stats.videos++;
            return;
          }
          // Other buttons are controls, but pictures inside them (lightbox thumbnails) are content.
          for (const img of el.querySelectorAll('img')) { if (!hidden(img)) imageBlock(img, st); }
          return;
        }
        case 'DETAILS': {
          flush(st);
          const sum = Array.from(el.children).find(c => c.tagName === 'SUMMARY');
          if (sum) { const r = runsOf(sum); if (r.length) st.out.push({ t: 'p', r: r.map(x => (x.x != null ? { ...x, b: 1 } : x)) }); }
          for (const k of kids(el)) { if (k !== sum && k.nodeType === 1 && !hidden(k)) { if (!isBlockish(k) && !holdsBlocks(k)) inlineNode(k, st, {}); else blockLevel(k, st); } else if (k.nodeType === 3) inlineNode(k, st, {}); }
          flush(st);
          return;
        }
        default: {
          if (el.getAttribute && el.getAttribute('role') === 'heading') {
            const r = runsOf(el);
            if (r.length) { flush(st); st.out.push({ t: 'h', l: Math.min(6, Math.max(1, parseInt(el.getAttribute('aria-level'), 10) || 2)), r }); }
            return;
          }
          // Containers (div, section, article, figure, custom elements ...) and
          // block-styled inline tags: their loose text becomes paragraphs.
          flush(st);
          convertChildren(el, st);
          flush(st);
        }
      }
    }

    return { childBlocks };
  }

  // ---------- page-level ----------

  function visibleLen(el) {
    try { return (el.innerText || '').length; } catch (_) { return 0; }
  }

  function pickRoot() {
    let best = null;
    let bestLen = 0;
    for (const el of document.querySelectorAll(ROOT_CANDIDATES)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const len = visibleLen(el);
      if (len > bestLen) { best = el; bestLen = len; }
    }
    return bestLen >= 300 ? best : document.body;
  }

  function sameText(a, b) {
    const n = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const x = n(a), y = n(b);
    return !!x && !!y && (x === y || y.includes(x) || x.includes(y));
  }

  function textOfRuns(r) { return r.map(x => x.x || ' ').join(''); }

  function totalChars(blocks) {
    let n = 0;
    const walk = bs => {
      for (const b of bs) {
        if (b.r) n += textOfRuns(b.r).length;
        if (b.b) walk(b.b);
        if (b.items) b.items.forEach(walk);
        if (b.rows) b.rows.forEach(row => row.forEach(c => { n += textOfRuns(c.r).length; }));
        if (b.text) n += b.text.length;
        if (b.t === 'img' || b.t === 'video') n += 50;
      }
    };
    walk(blocks);
    return n;
  }

  function selectionFragment() {
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      const holder = document.createElement('div');
      for (let i = 0; i < sel.rangeCount; i++) holder.appendChild(sel.getRangeAt(i).cloneContents());
      return holder;
    }
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const s = frame.contentWindow.getSelection();
        if (s && !s.isCollapsed && s.toString().trim()) {
          const holder = frame.contentDocument.createElement('div');
          for (let i = 0; i < s.rangeCount; i++) holder.appendChild(s.getRangeAt(i).cloneContents());
          return holder;
        }
      } catch (_) {}
    }
    return null;
  }

  function probe() {
    let selLen = 0;
    try { const f = selectionFragment(); selLen = f ? f.textContent.trim().length : 0; } catch (_) {}
    return { title: document.title || '', url: location.href, selectionChars: selLen };
  }

  function run(opts = {}) {
    const stats = { images: 0, videos: 0 };
    const title = cleanText(document.title).replace(/\s+/g, ' ').trim() || location.hostname;
    let blocks = [];
    let scope = 'page';

    if (opts.scope === 'selection') {
      const holder = selectionFragment();
      if (holder) {
        scope = 'selection';
        const conv = createConverter(holder.ownerDocument, false, stats);
        blocks = conv.childBlocks(holder);
      }
    }

    if (scope === 'page') {
      const root = pickRoot();
      const convert = el => {
        stats.images = 0; stats.videos = 0;
        // When falling back to the whole page, leave out site headers, footers and sidebars.
        const skip = new Set();
        if (el === document.body) {
          for (const n of document.body.querySelectorAll(PAGE_CHROME)) {
            if (!n.closest('article,main,[role="main"]')) skip.add(n);
          }
        }
        return createConverter(document, true, stats, skip).childBlocks(el);
      };
      blocks = convert(root);
      if (root !== document.body && totalChars(blocks) < 200) blocks = convert(document.body);
    }

    // The page's own big heading usually repeats the tab title.
    if (blocks.length && blocks[0].t === 'h' && sameText(textOfRuns(blocks[0].r), title)) blocks.shift();

    stats.pageImages = document.images.length;
    return {
      ok: true,
      scope,
      model: { title, url: location.href, lang: document.documentElement.lang || '', blocks },
      stats
    };
  }

  // ---------- videos ----------

  function mark(el) {
    let id = el.getAttribute('data-kr-vid');
    if (!id) {
      // The counter lives on window so a re-injected copy of this script never reuses an id.
      window.__krMarkSeq = (window.__krMarkSeq || 0) + 1;
      id = String(window.__krMarkSeq);
      el.setAttribute('data-kr-vid', id);
    }
    return id;
  }

  function scanVideos() {
    const frameTitle = (document.title || '').trim();
    const out = [];
    for (const v of document.querySelectorAll('video, audio')) {
      const r = v.getBoundingClientRect();
      const sources = [];
      const add = (u, type) => { const h = safeHref(u, document.baseURI); if (h && !sources.some(s => s.src === h)) sources.push({ src: h, type: type || '' }); };
      add(v.getAttribute('src'), '');
      v.querySelectorAll('source[src]').forEach(s => add(s.getAttribute('src'), s.getAttribute('type')));
      const current = v.currentSrc || '';
      const tracks = [];
      v.querySelectorAll('track[src]').forEach(t => {
        const h = safeHref(t.getAttribute('src'), document.baseURI);
        if (h) tracks.push({ src: h, kind: t.kind || 'subtitles', lang: t.srclang || '', label: t.label || '' });
      });
      out.push({
        id: mark(v),
        audio: v.tagName === 'AUDIO',
        sources,
        current: /^blob:/i.test(current) ? '' : safeHref(current, document.baseURI),
        blob: /^blob:/i.test(current || v.getAttribute('src') || ''),
        poster: safeSrc(v.getAttribute('poster') || '', document.baseURI),
        duration: Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
        w: Math.round(r.width), h: Math.round(r.height),
        label: (v.getAttribute('aria-label') || v.getAttribute('title') || '').trim(),
        tracks,
        drm: !!v.mediaKeys
      });
    }
    const frames = [];
    for (const f of document.querySelectorAll('iframe')) {
      const src = safeHref(f.getAttribute('src') || f.getAttribute('data-src') || '', document.baseURI);
      if (!src) continue;
      const r = f.getBoundingClientRect();
      if (r.width < 100 || r.height < 60) continue;
      let host = '';
      try { host = new URL(src).hostname; } catch (_) {}
      frames.push({ id: mark(f), src, host, title: (f.getAttribute('title') || '').trim(), w: Math.round(r.width), h: Math.round(r.height) });
    }
    const kaltura = [];
    for (const b of document.querySelectorAll('button[kaltura], [kaltura][source], button[poster][source]')) {
      const k = kalturaFrom(b);
      if (k.entry) kaltura.push({ id: mark(b), ...k, title: nearestHeading(b) });
    }
    for (const f of frames) {
      if (!/kaltura\.com/i.test(f.host)) continue;
      const entry = (/[?&/]entry_id[=/]([0-9a-z_]+)/i.exec(f.src) || [])[1];
      const pid = (/partner_id[=/](\d+)/i.exec(f.src) || /\/p\/(\d+)\//.exec(f.src) || [])[1];
      if (entry && pid && !kaltura.some(k => k.entry === entry)) kaltura.push({ id: f.id, entry, pid, poster: '', title: f.title || nearestHeading(document.querySelector('[data-kr-vid="' + f.id + '"]') || document.body) });
    }
    // Plain download links to audio files (podcasts, recorded lectures).
    const audioLinks = [];
    const seenAudio = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = safeHref(a.getAttribute('href'), document.baseURI);
      if (!href || !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i.test(href) || seenAudio.has(href)) continue;
      seenAudio.add(href);
      audioLinks.push({ url: href, text: (a.textContent || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 120), id: mark(a) });
    }
    return { url: location.href, title: frameTitle, top: window === window.top, videos: out, frames, kaltura, audioLinks };
  }

  // ---------- images ----------

  const IMG_URL = /\.(jpe?g|png|gif|webp|avif|svg|bmp)(?:[?#]|$)/i;

  // The largest candidate in a srcset ("a.jpg 480w, b.jpg 1200w" / "a.jpg 1x, b.jpg 2x").
  function bestFromSrcset(srcset) {
    let best = '', score = -1;
    for (const part of String(srcset || '').split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const n = d ? parseFloat(d) || 1 : 1;
      if (n > score) { score = n; best = u; }
    }
    return best;
  }

  function scanImages() {
    const out = [];
    const seen = new Set();
    const base = document.baseURI;
    const add = (raw, o) => {
      const url = safeSrc(raw, base);
      if (!url || seen.has(url)) return;
      if (url.startsWith('data:') && url.length > 2 * 1024 * 1024) return;
      seen.add(url);
      out.push({ url, full: '', alt: '', w: 0, h: 0, rw: 0, rh: 0, kind: 'img', ...o });
    };

    for (const img of document.images) {
      let raw = img.currentSrc || img.getAttribute('src') || '';
      if (!raw || /^data:image\/(gif|svg\+xml);base64,.{0,200}$/i.test(raw)) {
        for (const a of ['data-src', 'data-lazy-src', 'data-original']) { const v = img.getAttribute(a); if (v) { raw = v; break; } }
      }
      // Prefer the biggest version the page offers, and a lightbox link to the full-size file.
      const big = bestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
      const anchor = img.closest('a[href]');
      const link = anchor && IMG_URL.test(anchor.getAttribute('href') || '') ? safeSrc(anchor.getAttribute('href'), base) : '';
      const r = img.getBoundingClientRect();
      add(raw, {
        full: link || safeSrc(big, base) || '',
        alt: (img.getAttribute('alt') || img.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        w: img.naturalWidth || 0, h: img.naturalHeight || 0, rw: Math.round(r.width), rh: Math.round(r.height), id: mark(img)
      });
    }

    for (const src of document.querySelectorAll('picture source[srcset]')) {
      const big = bestFromSrcset(src.getAttribute('srcset'));
      const img = src.parentElement && src.parentElement.querySelector('img');
      if (big) add(big, { alt: img ? (img.getAttribute('alt') || '').trim().slice(0, 300) : '', id: img ? mark(img) : '' });
    }

    // CSS background images (hero banners, thumbnails). Capped so huge pages stay fast.
    let looked = 0;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      if (++looked > 4000) break;
      if (el.tagName === 'IMG' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      let bg = '';
      try { bg = getComputedStyle(el).backgroundImage; } catch (_) {}
      if (!bg || bg === 'none') continue;
      const r = el.getBoundingClientRect();
      for (const m of bg.matchAll(/url\((["']?)(.*?)\1\)/g)) {
        add(m[2], { kind: 'bg', rw: Math.round(r.width), rh: Math.round(r.height), id: mark(el), alt: (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 300) });
      }
    }

    // Open Graph / social preview images are often the nicest picture on a page.
    for (const m of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) add(m.content, { kind: 'meta', alt: 'Page preview image' });

    return { url: location.href, top: window === window.top, images: out };
  }

  function locate(id) {
    const el = document.querySelector('[data-kr-vid="' + String(id).replace(/[^\d]/g, '') + '"]');
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = el.style.cssText;
    el.style.outline = '4px solid #3fbfb5';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.cssText = prev; }, 2200);
    return true;
  }

  // Fetches a file from inside the page (so the page's own cookies / origin apply).
  async function fetchAsDataUrl(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  window.__krExtract = { version: VERSION, probe, run, scanVideos, scanImages, locate, fetchAsDataUrl };
})();
