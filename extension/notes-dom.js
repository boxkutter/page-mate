// Notes: DOM helpers shared by the page script (notes.js) and the Save page.
//
//  - buildIndex(): the visible text of a DOM subtree with spaces collapsed, plus where every
//    character lives, so "characters 120-150" can become a DOM Range and back
//  - applyNotes(): draws a page's highlights and a numbered notes list into a DOM tree
//    (used for the offline web page and the PDF)
(function (root) {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION', 'SELECT']);

  // opts.exclude: CSS selector of subtrees to ignore; opts.checkVisible: skip display:none text
  function buildIndex(rootEl, opts = {}) {
    const doc = rootEl.ownerDocument || document;
    const nodes = [], chars = [], ni = [], off = [], first = [], count = [];
    const seen = new Map();
    const visible = el => {
      if (!opts.checkVisible) return true;
      if (!seen.has(el)) { let v = true; try { v = el.checkVisibility ? el.checkVisibility() : true; } catch (_) {} seen.set(el, v); }
      return seen.get(el);
    };
    const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || (opts.exclude && p.closest(opts.exclude)) || !visible(p)) return NodeFilter.FILTER_REJECT;
        return n.data ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let lastSpace = true;
    let n;
    while ((n = walker.nextNode())) {
      const idx = nodes.length;
      nodes.push(n);
      // a break between text nodes reads as one space
      if (!lastSpace) { chars.push(' '); ni.push(Math.max(0, idx - 1)); off.push(nodes[idx - 1] ? nodes[idx - 1].data.length : 0); lastSpace = true; }
      first[idx] = chars.length;
      const d = n.data;
      for (let i = 0; i < d.length; i++) {
        const c = d.charCodeAt(i);
        const space = c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0x2007 || c === 0x202f;
        if (space) { if (lastSpace) continue; chars.push(' '); lastSpace = true; }
        else if (c === 0x200b || c === 0xad || c === 0xfeff) continue;
        else { chars.push(d[i]); lastSpace = false; }
        ni.push(idx);
        off.push(i);
      }
      count[idx] = chars.length - first[idx];
    }
    return { text: chars.join(''), ni, off, nodes, first, count, nodeIdx: new Map(nodes.map((nd, i) => [nd, i])), doc, root: rootEl };
  }

  // first output index inside node idx whose offset is >= o
  function lowerBound(ix, idx, o) {
    let lo = ix.first[idx], hi = ix.first[idx] + ix.count[idx];
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ix.off[mid] < o) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function boundaryIndex(ix, container, offset, isEnd) {
    if (container.nodeType === 3 && ix.nodeIdx.has(container)) return lowerBound(ix, ix.nodeIdx.get(container), offset);
    // The boundary is between elements: compare against each text node.
    const r = ix.doc.createRange();
    r.setStart(container, offset);
    r.collapse(true);
    if (!isEnd) {
      for (let i = 0; i < ix.nodes.length; i++) {
        if (r.comparePoint(ix.nodes[i], ix.nodes[i].length) !== -1) return ix.first[i];
      }
      return ix.text.length;
    }
    let last = -1;
    for (let i = 0; i < ix.nodes.length; i++) { if (r.comparePoint(ix.nodes[i], 0) !== 1) last = i; else break; }
    return last < 0 ? 0 : ix.first[last] + ix.count[last];
  }

  function rangeToIndex(ix, range) {
    let s = boundaryIndex(ix, range.startContainer, range.startOffset, false);
    let e = boundaryIndex(ix, range.endContainer, range.endOffset, true);
    while (s < e && ix.text[s] === ' ') s++;
    while (e > s && ix.text[e - 1] === ' ') e--;
    return e - s >= 2 ? { s, e } : null;
  }

  function indexToRange(ix, s, e) {
    if (s >= e || e > ix.ni.length) return null;
    const a = ix.nodes[ix.ni[s]], b = ix.nodes[ix.ni[e - 1]];
    // Still inside the tree that was indexed? (Works for a detached tree, e.g. a page being assembled.)
    if (!a || !b || !ix.root.contains(a) || !ix.root.contains(b)) return null;
    const r = ix.doc.createRange();
    try { r.setStart(a, ix.off[s]); r.setEnd(b, ix.off[e - 1] + 1); } catch (_) { return null; }
    return r;
  }

  // Wraps the text inside a Range in <mark> elements (one per text node, so it works across
  // paragraphs and inline tags). Returns the marks.
  function wrapRange(range, make) {
    const doc = range.startContainer.ownerDocument || document;
    const pieces = [];
    const w = doc.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!range.intersectsNode(n)) continue;
      const start = n === range.startContainer ? range.startOffset : 0;
      const end = n === range.endContainer ? range.endOffset : n.length;
      if (end > start) pieces.push({ n, start, end });
    }
    const marks = [];
    for (const { n: node, start, end } of pieces) {
      let target = node;
      if (start > 0) target = node.splitText(start);
      if (end - start < target.length) target.splitText(end - start);
      if (!target.data.trim() && target.data.length < 1) continue;
      const mark = make();
      target.replaceWith(mark);
      mark.append(target);
      marks.push(mark);
    }
    return marks;
  }

  // Draws highlights + a numbered notes list into `article` (a DOM tree, e.g. the offline page).
  //   K: KNCore   page: { items, ... }
  //   opts.mediaLink(src, t): link for a video note, or ''  opts.heading: title of the list
  // Returns { placed, total }.
  function applyNotes(article, page, K, opts = {}) {
    const doc = article.ownerDocument || document;
    const items = K.sortItems(page.items);
    const text = buildIndex(article, {}).text;
    const spans = new Map();
    for (const it of items) {
      if (K.isTime(it)) continue;
      const hit = K.locate(text, it);
      if (hit) spans.set(it.id, hit);
    }
    const numbering = new Map(items.map((it, i) => [it.id, i + 1]));
    let placed = 0;
    for (const it of items) {
      const hit = spans.get(it.id);
      if (!hit) continue;
      const ix = buildIndex(article, {}); // text is unchanged by marks; only the node mapping moves
      const range = indexToRange(ix, hit.start, hit.end);
      if (!range) continue;
      const n = numbering.get(it.id);
      const marks = wrapRange(range, () => {
        const m = doc.createElement('mark');
        m.className = 'kn-mark kn-' + (K.COLORS.includes(it.color) ? it.color : 'yellow');
        if (it.note) m.title = it.note.slice(0, 300);
        return m;
      });
      if (!marks.length) continue;
      placed++;
      const sup = doc.createElement('sup');
      sup.className = 'kn-ref';
      const a = doc.createElement('a');
      a.href = '#kn-note-' + n;
      a.textContent = '[' + n + ']';
      sup.appendChild(a);
      marks[marks.length - 1].after(sup);
    }

    if (items.length) {
      const sec = doc.createElement('section');
      sec.className = 'kn-notes';
      const h = doc.createElement('h2');
      h.textContent = opts.heading || 'My highlights and notes';
      sec.appendChild(h);
      const ol = doc.createElement('ol');
      for (const it of items) {
        const li = doc.createElement('li');
        li.id = 'kn-note-' + numbering.get(it.id);
        li.className = 'kn-item kn-c-' + (K.COLORS.includes(it.color) ? it.color : 'blue');
        const lead = doc.createElement('strong');
        if (K.isTime(it)) {
          lead.textContent = '⏱ ' + K.fmtTime(it.t) + (it.media && it.media.title ? ' — ' + it.media.title : '');
          li.appendChild(lead);
          const link = opts.mediaLink ? opts.mediaLink(it.media && it.media.src, it.t) : '';
          if (link) { li.append(' '); const a = doc.createElement('a'); a.href = link; a.textContent = '(play from here)'; li.appendChild(a); }
        } else {
          lead.textContent = K.LABELS[it.color] || 'Highlight';
          li.appendChild(lead);
          const q = doc.createElement('blockquote');
          q.textContent = it.quote;
          li.appendChild(q);
          if (!spans.has(it.id)) { const w = doc.createElement('p'); w.className = 'kn-missing'; w.textContent = 'This passage isn’t in the saved copy.'; li.appendChild(w); }
        }
        if ((it.note || '').trim()) for (const para of it.note.trim().split(/\n{2,}/)) { const p = doc.createElement('p'); p.textContent = para; li.appendChild(p); }
        if (it.tags && it.tags.length) { const p = doc.createElement('p'); p.className = 'kn-tags'; p.textContent = it.tags.map(t => '#' + t).join(' '); li.appendChild(p); }
        ol.appendChild(li);
      }
      sec.appendChild(ol);
      article.appendChild(sec);
    }
    return { placed, total: items.filter(i => !K.isTime(i)).length };
  }

  const api = { buildIndex, rangeToIndex, indexToRange, wrapRange, applyNotes };
  root.KNDom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
