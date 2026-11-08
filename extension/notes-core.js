// Notes: the parts that don't touch the page. Shared by the page script, the notes
// manager and the tests.
//
//  - a highlight is stored as the exact quote plus a little text before and after it
//    (the same idea as the W3C "text quote selector"), so it can be found again even if
//    the page moves things around
//  - toMarkdown() writes a page's notes as Markdown (the main export)
//  - toAnki(), toModel() (Word / PDF), toSpeech(), formatCitation() build the other outputs
(function (root) {
  const LABELS = { yellow: 'Key term', green: 'Evidence', blue: 'Question', pink: 'Verify' };
  const COLORS = Object.keys(LABELS);
  const TRACKING = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src)$/i;
  const CTX = 40;      // characters of context kept before / after a quote
  const SENT_MAX = 300; // how far a "sentence" for cloze cards may reach either side

  // ---------- addresses ----------

  // One key per page: no #fragment, no tracking parameters.
  function normalizeUrl(raw) {
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) return '';
      u.hash = '';
      for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
      return u.href;
    } catch (_) { return ''; }
  }

  const pageKey = url => 'kn:p:' + normalizeUrl(url);

  // ---------- anchoring ----------

  function allIndexes(hay, needle, max = 2000) {
    const out = [];
    if (!needle) return out;
    let i = -1;
    while ((i = hay.indexOf(needle, i + 1)) !== -1) { out.push(i); if (out.length >= max) break; }
    return out;
  }

  function commonPrefixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
  }

  function commonSuffixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }

  // Similarity of two strings, 0..1 (Sørensen–Dice on letter pairs).
  function dice(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const pairs = new Map();
    for (let i = 0; i < a.length - 1; i++) { const p = a.slice(i, i + 2); pairs.set(p, (pairs.get(p) || 0) + 1); }
    let hit = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const p = b.slice(i, i + 2);
      const n = pairs.get(p);
      if (n) { hit++; pairs.set(p, n - 1); }
    }
    return (2 * hit) / (a.length + b.length - 2);
  }

  // Start / end of the sentence(s) around text[s, e), within SENT_MAX characters each side.
  function sentenceBounds(text, s, e) {
    let a = Math.max(0, s - SENT_MAX);
    for (let i = s - 2; i >= Math.max(0, s - SENT_MAX); i--) {
      if ('.!?'.includes(text[i]) && text[i + 1] === ' ') { a = i + 2; break; }
    }
    let b = Math.min(text.length, e + SENT_MAX);
    for (let i = e; i < Math.min(text.length, e + SENT_MAX); i++) {
      if ('.!?'.includes(text[i]) && (text[i + 1] === ' ' || i + 1 === text.length)) { b = i + 1; break; }
    }
    return { a, b };
  }

  // What to remember about a selection: text[start, end).
  function makeSelectors(text, start, end) {
    const { a, b } = sentenceBounds(text, start, end);
    return {
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CTX), start),
      suffix: text.slice(end, end + CTX),
      cb: text.slice(a, start).trimStart(),   // rest of the sentence before / after, for cloze flashcards
      ca: text.slice(end, b).trimEnd(),
      pos: start
    };
  }

  // Finds a stored highlight in the page's current text.
  // Returns { start, end, how: 'exact' | 'approx' } or null (the passage is gone).
  function locate(text, rec) {
    const q = rec.quote || '';
    if (!q) return null;

    const pick = hits => {
      if (hits.length === 1) return hits[0];
      let best = hits[0], bestScore = -Infinity;
      for (const h of hits) {
        const before = text.slice(Math.max(0, h - (rec.prefix || '').length), h);
        const after = text.slice(h + q.length, h + q.length + (rec.suffix || '').length);
        const ctx = commonSuffixLen(before, rec.prefix || '') + commonPrefixLen(after, rec.suffix || '');
        const near = rec.pos == null ? 0 : -Math.abs(h - rec.pos) / Math.max(1, text.length);
        const score = ctx + near;
        if (score > bestScore) { bestScore = score; best = h; }
      }
      return best;
    };

    let hits = allIndexes(text, q);
    if (!hits.length) {
      const lower = text.toLowerCase();
      if (lower.length === text.length) hits = allIndexes(lower, q.toLowerCase());
    }
    if (hits.length) { const s = pick(hits); return { start: s, end: s + q.length, how: 'exact' }; }

    // The passage was edited a little: find where it starts and ends, and check the middle still resembles it.
    // Try long anchors first (fewer false hits), then shorter ones in case the edit was near an end.
    if (q.length >= 30) {
      for (const want of [24, 16, 10]) {
        const k = Math.min(want, Math.floor(q.length / 3));
        const head = q.slice(0, k), tail = q.slice(-k);
        let best = null;
        for (const h of allIndexes(text, head, 300)) {
          const lo = h + Math.floor(q.length * 0.6), hi = h + Math.ceil(q.length * 1.5);
          let t = text.indexOf(tail, lo);
          while (t !== -1 && t <= hi) {
            const end = t + k;
            const sim = dice(text.slice(h, end), q);
            const before = text.slice(Math.max(0, h - (rec.prefix || '').length), h);
            const ctx = commonSuffixLen(before, rec.prefix || '') / Math.max(1, (rec.prefix || '').length);
            if (sim >= 0.72 && (!best || sim + ctx * 0.2 > best.score)) best = { start: h, end, score: sim + ctx * 0.2 };
            t = text.indexOf(tail, t + 1);
          }
        }
        if (best) return { start: best.start, end: best.end, how: 'approx' };
      }
    }
    return null;
  }

  // ---------- links back to the passage ----------

  // "#:~:text=" makes the browser scroll to and mark a passage when the link is opened.
  // A passage that crosses paragraphs needs the start,end form (each end lives in one block).
  function textFragment(quote, multiBlock) {
    const enc = s => encodeURIComponent(s).replace(/-/g, '%2D').replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const words = quote.trim().split(/\s+/);
    if (!multiBlock && quote.length <= 200) return '#:~:text=' + enc(quote.trim());
    if (words.length < 2) return '#:~:text=' + enc(words[0] || '');
    const n = Math.min(5, Math.ceil(words.length / 2));
    return '#:~:text=' + enc(words.slice(0, n).join(' ')) + ',' + enc(words.slice(-n).join(' '));
  }

  function passageUrl(pageUrl, item) {
    try {
      const u = new URL(pageUrl);
      u.hash = '';
      return u.href + textFragment(item.quote, !!item.multi);
    } catch (_) { return pageUrl; }
  }

  // ---------- video / audio time notes ----------

  const isTime = it => it && it.kind === 'time';

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  // Link that opens a media file at a time (browsers understand #t=seconds on a media URL).
  function timeUrl(src, sec) {
    try { const u = new URL(src); u.hash = 't=' + Math.max(0, Math.floor(Number(sec) || 0)); return u.href; } catch (_) { return ''; }
  }

  // ---------- tags ----------

  function cleanTag(t) {
    return String(t || '').replace(/^#+/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  }

  // ---------- citations ----------

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  const ORG_WORDS = /\b(university|college|institute|inc|llc|ltd|corp|corporation|company|association|society|board|department|ministry|agency|council|committee|foundation|center|centre|school|academy|group|press|times|post|news|journal|office|bureau|commission|organization|organisation)\b/i;

  // "2024-03-05", "2024-03-05T10:00:00Z", "2024" -> { y, m (1-12 | 0), d (1-31 | 0) } or null
  function parseDate(s) {
    const m = /^\s*(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = m[2] ? +m[2] : 0, d = m[3] ? +m[3] : 0;
    if (y < 1000 || mo > 12 || d > 31) return null;
    return { y, m: mo, d };
  }

  // Authors as typed: "Last, First; Last, First", "First Last; First Last", or an organization name.
  function parseAuthors(raw) {
    return String(raw || '').split(/\s*;\s*|\s+and\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean).map(a => {
      if (a.includes(',')) {
        const [family, ...rest] = a.split(',');
        return { family: family.trim(), given: rest.join(',').trim() };
      }
      const words = a.split(/\s+/);
      if (words.length === 1 || words.length > 3 || ORG_WORDS.test(a)) return { org: a };
      return { family: words[words.length - 1], given: words.slice(0, -1).join(' ') };
    });
  }

  const initials = g => g.split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join(' ');
  const fullName = a => a.org || [a.given, a.family].filter(Boolean).join(' ');
  const lastFirst = a => a.org || (a.given ? a.family + ', ' + a.given : a.family);

  function list(items, last, commaForTwo) { // "A", "A and B" ("A, and B" when A is inverted), "A, B, and C"
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return items[0] + (commaForTwo ? ', ' : ' ') + last + ' ' + items[1];
    return items.slice(0, -1).join(', ') + ', ' + last + ' ' + items[items.length - 1];
  }

  // Returns [{ s: text, i?: true }] so callers can italicise (Markdown / Word) or not.
  // meta: { authors, title, site, published, url, accessed }  style: 'apa' | 'mla' | 'chicago'
  function formatCitation(meta, style) {
    const authors = parseAuthors(meta.authors);
    const title = (meta.title || '').trim() || 'Untitled page';
    const site = (meta.site || '').trim();
    const d = parseDate(meta.published);
    const acc = parseDate(meta.accessed);
    const url = (meta.url || '').trim();
    const seg = [];
    const T = s => seg.push({ s });
    const I = s => seg.push({ s, i: true });
    const withDot = s => (/[.?!]$/.test(s) ? s : s + '.');
    const longDate = (x) => MONTHS[x.m - 1] + (x.d ? ' ' + x.d : '') + ', ' + x.y;

    if (style === 'mla') {
      if (authors.length) {
        const names = authors.length >= 3 ? [lastFirst(authors[0])] : authors.map((a, i) => (i === 0 ? lastFirst(a) : fullName(a)));
        T(withDot(authors.length >= 3 ? names[0] + ', et al' : list(names, 'and', true)) + ' ');
      }
      T('“' + withDot(title) + '” ');
      if (site) I(site);
      const parts = [];
      if (d) parts.push((d.d ? d.d + ' ' : '') + (d.m ? MLA_MONTHS[d.m - 1] + ' ' : '') + d.y);
      if (url) parts.push(url.replace(/^https?:\/\//i, ''));
      T((site ? ', ' : '') + parts.join(', ') + '.');
      if (acc) T(' Accessed ' + acc.d + ' ' + MLA_MONTHS[acc.m - 1] + ' ' + acc.y + '.');
      return seg;
    }

    if (style === 'chicago') {
      if (authors.length) {
        const names = authors.map((a, i) => (i === 0 ? lastFirst(a) : fullName(a)));
        T(withDot(authors.length > 10 ? names.slice(0, 7).join(', ') + ', et al' : list(names, 'and', true)) + ' ');
      }
      T('“' + withDot(title) + '” ');
      if (site) T(withDot(site) + ' ');
      if (d && d.m) T(longDate(d) + '. ');
      else if (d) T(d.y + '. ');
      else if (acc && acc.m) T('Accessed ' + longDate(acc) + '. ');
      if (url) T(url + '.');
      return seg;
    }

    // APA 7 (default)
    if (authors.length) {
      const names = authors.map(a => (a.org ? a.org : a.family + (a.given ? ', ' + initials(a.given) : '')));
      const joined = names.length === 1 ? names[0] : names.length <= 20 ? names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1] : names.slice(0, 19).join(', ') + ', … ' + names[names.length - 1];
      T(withDot(joined) + ' ');
    }
    const when = d ? (d.m ? '(' + d.y + ', ' + MONTHS[d.m - 1] + (d.d ? ' ' + d.d : '') + ')' : '(' + d.y + ')') : '(n.d.)';
    if (authors.length) T(when + '. ');
    I(withDot(title));
    T(' ');
    if (!authors.length) T(when + '. ');
    if (site && !authors.some(a => a.org === site)) T(withDot(site) + ' ');
    if (!d && acc && acc.m) T('Retrieved ' + longDate(acc) + ', from ');
    if (url) T(url);
    return seg;
  }

  function citationString(meta, style, mode) {
    return formatCitation(meta, style).map(p => (p.i && mode === 'md' ? '*' + p.s.replace(/\*/g, '\\*') + '*' : p.s)).join('').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
  }

  const STYLES = { apa: 'APA 7', mla: 'MLA 9', chicago: 'Chicago 17' };

  // ---------- Markdown ----------

  const esc = s => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/([*_`\[\]<>])/g, '\\$1');

  const sortItems = items => [...(items || [])].sort((a, b) => (a.pos == null ? 1e12 : a.pos) - (b.pos == null ? 1e12 : b.pos) || (isTime(a) && isTime(b) ? a.t - b.t : 0) || String(a.created).localeCompare(String(b.created)));

  function quoteBlock(text) {
    return text.split(/\n+/).map(l => '> ' + esc(l).replace(/^(\s*)([#+\-=~]|\d+[.)])(\s)/, '$1\\$2$3')).join('\n>\n');
  }

  const labelOf = it => (isTime(it) ? 'Video note' : LABELS[it.color] || 'Highlight');

  function itemMd(page, it, n, withHeading) {
    const L = [];
    if (isTime(it)) {
      L.push('### ' + (withHeading ? n + '. ' : n + ' · ') + '⏱ ' + fmtTime(it.t) + (it.media && it.media.title ? ' — ' + esc(it.media.title) : ''), '');
      if (it.note && it.note.trim()) L.push(it.note.trim(), '');
      const meta = [];
      if (it.tags && it.tags.length) meta.push(it.tags.map(t => '#' + t).join(' '));
      const link = it.media && it.media.src ? timeUrl(it.media.src, it.t) : '';
      if (link) meta.push('[Play at ' + fmtTime(it.t) + '](<' + link + '>)');
      if (meta.length) L.push(meta.join(' · '), '');
      return L;
    }
    if (withHeading) L.push('### ' + n + '. ' + labelOf(it), '');
    else L.push('### ' + n, '');
    L.push(quoteBlock(it.quote), '');
    if (it.orphan) L.push('*(This passage could no longer be found on the page when exported.)*', '');
    if (it.note && it.note.trim()) L.push(it.note.trim(), '');
    const meta = [];
    if (it.tags && it.tags.length) meta.push(it.tags.map(t => '#' + t).join(' '));
    if (!it.orphan) meta.push('[Open this passage](<' + passageUrl(page.url, it) + '>)');
    if (meta.length) L.push(meta.join(' · '), '');
    return L;
  }

  // opts: order 'page' | 'label'; citation 'apa' | 'mla' | 'chicago' | '' ; exportedAt Date
  function toMarkdown(page, opts = {}) {
    const when = (opts.exportedAt || new Date());
    const items = sortItems(page.items);
    const tags = [...new Set(items.flatMap(i => i.tags || []))];
    const title = (page.title || 'Untitled').replace(/\s+/g, ' ').trim();
    const L = ['---', 'title: ' + JSON.stringify(title), 'source: ' + JSON.stringify(page.url || '')];
    if (page.case) L.push('case: ' + JSON.stringify(page.case));
    L.push('exported: ' + when.toISOString(), 'highlights: ' + items.length);
    if (tags.length) L.push('tags: [' + tags.map(t => JSON.stringify(t)).join(', ') + ']');
    L.push('---', '', '# ' + esc(title), '');
    L.push('> Source: ' + (page.url ? '<' + page.url + '>' : '(unknown)') + ' · ' + items.length + ' highlight' + (items.length === 1 ? '' : 's') + ' · exported ' + when.toISOString().slice(0, 10) + (page.case ? ' · case: ' + esc(page.case) : ''), '');
    if (opts.citation && STYLES[opts.citation]) {
      const meta = { url: page.url, title: page.title, accessed: (page.created || when.toISOString()).slice(0, 10), ...(page.meta || {}) };
      L.push('## Citation (' + STYLES[opts.citation] + ')', '', citationString(meta, opts.citation, 'md'), '');
    }
    if (page.note && page.note.trim()) L.push('## Page note', '', page.note.trim(), '');
    if (items.length) {
      L.push('## Highlights', '');
      if (opts.order === 'label') {
        let n = 0;
        for (const color of COLORS) {
          const group = items.filter(i => !isTime(i) && i.color === color);
          if (!group.length) continue;
          L.push('## ' + LABELS[color], '');
          for (const it of group) L.push(...itemMd(page, it, ++n, false));
        }
        const times = items.filter(isTime);
        if (times.length) { L.push('## Video notes', ''); for (const it of times) L.push(...itemMd(page, it, ++n, false)); }
        const other = items.filter(i => !isTime(i) && !COLORS.includes(i.color));
        if (other.length) { L.push('## Other', ''); for (const it of other) L.push(...itemMd(page, it, ++n, false)); }
      } else {
        items.forEach((it, i) => L.push(...itemMd(page, it, i + 1, true)));
      }
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  }

  // The "All notes" index written next to a bundle of per-page files.
  function indexMd(entries, opts = {}) {
    const when = (opts.exportedAt || new Date()).toISOString().slice(0, 10);
    const L = ['# Notes index', '', 'Exported ' + when + ' · ' + entries.length + ' page' + (entries.length === 1 ? '' : 's'), ''];
    const cases = [...new Set(entries.map(e => e.case || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
    for (const c of cases) {
      if (cases.length > 1 || c) L.push('## ' + (c ? esc(c) : 'No case'), '');
      for (const e of entries.filter(x => (x.case || '') === c)) {
        L.push('- [' + esc(e.title) + '](<' + e.file + '>) — ' + e.count + ' highlight' + (e.count === 1 ? '' : 's') + (e.tags.length ? ' · ' + e.tags.map(t => '#' + t).join(' ') : ''));
      }
      L.push('');
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  }

  // ---------- Anki flashcards ----------

  const htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\t\r]+/g, ' ').replace(/\n/g, '<br>');

  // type 'basic': front = the highlight, back = your note (highlights without a note are skipped)
  // type 'cloze': the highlighted words are hidden inside their own sentence
  function toAnki(page, opts = {}) {
    const type = opts.type === 'cloze' ? 'cloze' : 'basic';
    const labels = opts.labels || new Set(['yellow', 'blue', 'green']);
    const items = sortItems(page.items).filter(i => !isTime(i) && labels.has(i.color));
    const title = (page.title || 'Notes').replace(/[\t\r\n]+/g, ' ').trim();
    const src = '<br><br><small><a href="' + htmlEsc(page.url || '') + '">' + htmlEsc(title) + '</a></small>';
    const rows = [];
    let skipped = 0;
    for (const it of items) {
      const tags = ['pagemate', 'label-' + LABELS[it.color].toLowerCase().replace(/\s+/g, '-'), ...(it.tags || [])].map(t => t.replace(/\s+/g, '_')).join(' ');
      const guid = 'kokoro-' + it.id;
      if (type === 'basic') {
        if (!(it.note || '').trim()) { skipped++; continue; }
        rows.push([htmlEsc(it.quote), htmlEsc(it.note.trim()) + src, tags, guid]);
      } else {
        const before = it.cb != null ? it.cb : it.prefix || '';
        const after = it.ca != null ? it.ca : it.suffix || '';
        const hidden = it.quote.replace(/}}/g, '} }');
        rows.push([htmlEsc(before) + (before && !/\s$/.test(before) ? ' ' : '') + '{{c1::' + htmlEsc(hidden) + '}}' + (after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '') + htmlEsc(after),
          ((it.note || '').trim() ? htmlEsc(it.note.trim()) : '') + src, tags, guid]);
      }
    }
    const head = ['#separator:tab', '#html:true', '#notetype:' + (type === 'cloze' ? 'Cloze' : 'Basic'), '#deck:' + (opts.deck || title).replace(/[:\t\r\n]+/g, ' ').slice(0, 80),
      '#guid column:4', '#tags column:3'];
    return { text: head.join('\n') + '\n' + rows.map(r => r.join('\t')).join('\n') + (rows.length ? '\n' : ''), count: rows.length, skipped, type };
  }

  // ---------- Word / PDF (document model shared with the Save page writers) ----------

  const paras = s => String(s || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  function toModel(page, opts = {}) {
    const items = sortItems(page.items);
    const blocks = [];
    if (page.case) blocks.push({ t: 'p', r: [{ x: 'Case: ', b: 1 }, { x: page.case }] });
    if (opts.citation && STYLES[opts.citation]) {
      const meta = { url: page.url, title: page.title, accessed: (page.created || new Date().toISOString()).slice(0, 10), ...(page.meta || {}) };
      blocks.push({ t: 'h', l: 2, r: [{ x: 'Citation (' + STYLES[opts.citation] + ')' }] });
      blocks.push({ t: 'p', r: formatCitation(meta, opts.citation).map(p => (p.i ? { x: p.s, i: 1 } : { x: p.s })) });
    }
    if ((page.note || '').trim()) {
      blocks.push({ t: 'h', l: 2, r: [{ x: 'Page note' }] });
      for (const p of paras(page.note)) blocks.push({ t: 'p', r: [{ x: p }] });
    }
    const one = (it, n, heading) => {
      const out = [];
      if (isTime(it)) {
        out.push({ t: 'h', l: 3, r: [{ x: n + '. ⏱ ' + fmtTime(it.t) + (it.media && it.media.title ? ' — ' + it.media.title : '') }] });
        if ((it.note || '').trim()) for (const p of paras(it.note)) out.push({ t: 'p', r: [{ x: p }] });
        const link = it.media && it.media.src ? timeUrl(it.media.src, it.t) : '';
        const meta = [];
        if (it.tags && it.tags.length) meta.push({ x: it.tags.map(t => '#' + t).join(' '), i: 1 });
        if (link) meta.push({ x: (meta.length ? '  ·  ' : '') + 'Play at ' + fmtTime(it.t), a: link });
        if (meta.length) out.push({ t: 'p', r: meta });
        return out;
      }
      out.push({ t: 'h', l: 3, r: [{ x: heading ? n + '. ' + labelOf(it) : n + '.' }] });
      out.push({ t: 'quote', b: [{ t: 'p', r: [{ x: it.quote }] }] });
      if (it.orphan) out.push({ t: 'p', r: [{ x: 'This passage could no longer be found on the page when exported.', i: 1 }] });
      if ((it.note || '').trim()) for (const p of paras(it.note)) out.push({ t: 'p', r: [{ x: p }] });
      const meta = [];
      if (it.tags && it.tags.length) meta.push({ x: it.tags.map(t => '#' + t).join(' '), i: 1 });
      if (!it.orphan) meta.push({ x: (meta.length ? '  ·  ' : '') + 'Open this passage', a: passageUrl(page.url, it) });
      if (meta.length) out.push({ t: 'p', r: meta });
      return out;
    };
    if (items.length) {
      blocks.push({ t: 'h', l: 2, r: [{ x: 'Highlights' }] });
      if (opts.order === 'label') {
        let n = 0;
        const groups = [...COLORS.map(c => [LABELS[c], items.filter(i => !isTime(i) && i.color === c)]), ['Video notes', items.filter(isTime)]];
        for (const [name, group] of groups) {
          if (!group.length) continue;
          blocks.push({ t: 'h', l: 2, r: [{ x: name }] });
          for (const it of group) blocks.push(...one(it, ++n, false));
        }
      } else {
        items.forEach((it, i) => blocks.push(...one(it, i + 1, true)));
      }
    }
    return { title: 'Notes: ' + (page.title || 'Untitled'), url: page.url, lang: '', blocks };
  }

  // ---------- reading notes aloud ----------

  // Plain sentences for the text-to-speech engine, one chunk per highlight.
  function toSpeech(page, opts = {}) {
    const out = [];
    const items = sortItems(page.items);
    out.push('Notes for ' + (page.title || 'this page') + '. ' + items.length + (items.length === 1 ? ' highlight.' : ' highlights.'));
    if ((page.note || '').trim()) out.push('Page note. ' + page.note.trim());
    items.forEach((it, i) => {
      if (isTime(it)) {
        const m = Math.floor(it.t / 60), s = Math.round(it.t % 60);
        out.push('Video note ' + (i + 1) + ', at ' + (m ? m + (m === 1 ? ' minute ' : ' minutes ') : '') + s + (s === 1 ? ' second' : ' seconds') + '. ' + (it.note || '').trim());
      } else {
        const lead = opts.readLabels === false ? 'Highlight ' + (i + 1) + '. ' : 'Highlight ' + (i + 1) + ', ' + LABELS[it.color] + '. ';
        out.push(lead + it.quote.replace(/\s+/g, ' ') + ((it.note || '').trim() ? ' Your note. ' + it.note.trim().replace(/\s+/g, ' ') : ''));
      }
    });
    return out;
  }

  const api = {
    LABELS, COLORS, CTX, STYLES, normalizeUrl, pageKey, makeSelectors, sentenceBounds, locate, dice, textFragment, passageUrl, cleanTag,
    isTime, fmtTime, timeUrl, parseAuthors, parseDate, formatCitation, citationString,
    toMarkdown, indexMd, toAnki, toModel, toSpeech, sortItems
  };
  root.KNCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
