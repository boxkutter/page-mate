// Document model -> Markdown (GitHub flavoured).
//
// toMarkdown(model, opts) -> { markdown, files }
//   opts.images   Map(src -> { name, bytes, mime })   images that were fetched; they are
//                 referenced as "images/<name>" and returned in `files` for bundling.
//                 An image missing from the map is linked by its original address.
//   opts.linkImages  true: never bundle, always link the original address.
//   opts.videos   'links' | 'none'
//   opts.meta     include the source line under the title
//   opts.savedAt  Date
(function (root) {
  function mdEscape(text) {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/([*_`\[\]<>|])/g, '\\$1')
      .replace(/&(?=[a-z#0-9]+;)/gi, '\\&');
  }

  function escLineStart(line) {
    return line
      .replace(/^(\s*)([#>+\-=~])/, '$1\\$2')
      .replace(/^(\s*)(\d+)([.)])(\s|$)/, '$1$2\\$3$4');
  }

  function codeSpan(text) {
    const t = text.replace(/\n/g, ' ');
    let fence = '`';
    while (t.includes(fence)) fence += '`';
    const pad = /^`|`$/.test(t) || /^ .* $/.test(t) ? ' ' : '';
    return fence + pad + t + pad + fence;
  }

  function linkTarget(url) {
    return '<' + url.replace(/[<>\s]/g, c => encodeURIComponent(c)) + '>';
  }

  // Wrap `inner` in a marker, keeping edge spaces outside it (Markdown ignores "** bold **").
  function wrap(inner, open, close) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (!m[2]) return inner;
    return m[1] + open + m[2] + close + m[3];
  }

  function runsToMd(runs, { table = false } = {}) {
    let out = '';
    for (const r of runs) {
      if (r.br) { out += table ? '<br>' : '  \n'; continue; }
      let t;
      if (r.c) t = codeSpan(r.x);
      else t = mdEscape(r.x).replace(/\n/g, table ? '<br>' : '  \n'); // mdEscape already escapes "|"
      if (table && r.c) t = t.replace(/\|/g, '\\|');
      if (!r.c) {
        if (r.sup) t = wrap(t, '<sup>', '</sup>');
        else if (r.sub) t = wrap(t, '<sub>', '</sub>');
        if (r.u && !r.a) t = wrap(t, '<u>', '</u>');
        if (r.s) t = wrap(t, '~~', '~~');
        if (r.b && r.i) t = wrap(t, '***', '***');
        else if (r.b) t = wrap(t, '**', '**');
        else if (r.i) t = wrap(t, '*', '*');
      } else {
        if (r.b) t = wrap(t, '**', '**');
        if (r.i) t = wrap(t, '*', '*');
      }
      if (r.a) t = wrap(t, '[', '](' + linkTarget(r.a) + ')');
      out += t;
    }
    return out;
  }

  function toMarkdown(model, opts = {}) {
    const images = opts.images || new Map();
    const files = [];
    const bundled = new Map(); // src -> relative path
    const includeVideos = opts.videos !== 'none';

    // Keep a single H1 (the title): shift headings down if the body has its own H1s.
    const hasH1 = JSON.stringify(model.blocks).includes('"t":"h","l":1');
    const shift = hasH1 ? 1 : 0;

    function imageRef(src) {
      if (opts.linkImages) return src;
      const img = images.get(src);
      if (!img) return src;
      if (!bundled.has(src)) {
        const rel = 'images/' + img.name;
        bundled.set(src, rel);
        files.push({ name: rel, data: img.bytes });
      }
      return bundled.get(src);
    }

    function imgMd(src, alt) {
      const a = mdEscape(alt || '').replace(/\n/g, ' ');
      const ref = imageRef(src);
      return '![' + a + '](' + (/^data:/.test(ref) ? ref : linkTarget(ref)) + ')';
    }

    function blocksMd(blocks, ctx) {
      const parts = [];
      for (const b of blocks) {
        const s = blockMd(b, ctx);
        if (s != null && s !== '') parts.push(s);
      }
      return parts.join('\n\n');
    }

    function blockMd(b, ctx) {
      switch (b.t) {
        case 'h': {
          const level = Math.min(6, b.l + shift + 0);
          return '#'.repeat(level) + ' ' + runsToMd(b.r).replace(/\s*\n\s*/g, ' ').trim();
        }
        case 'p': {
          let s = escLineStart(runsToMd(b.r)).replace(/\n(\s*)([#>+\-=~]|\d+[.)](\s|$))/g, '\n$1\\$2');
          if (b.cap) s = '*' + s.replace(/^\*+|\*+$/g, '') + '*';
          return s;
        }
        case 'quote': {
          const inner = blocksMd(b.b, ctx);
          return inner.split('\n').map(l => (l ? '> ' + l : '>')).join('\n');
        }
        case 'code': {
          let fence = '```';
          while (b.text.includes(fence)) fence += '`';
          return fence + (b.lang || '') + '\n' + b.text + '\n' + fence;
        }
        case 'hr': return '---';
        case 'img': return opts.noImages ? '' : imgMd(b.src, b.alt);
        case 'video': {
          if (!includeVideos) return '';
          const title = b.title || (b.audio ? 'Audio' : 'Video');
          const link = b.src ? '[' + (b.audio ? '🔊 ' : '▶ ') + mdEscape(title) + '](' + linkTarget(b.src) + ')'
            : (b.audio ? '🔊 ' : '▶ ') + mdEscape(title) + ' *(streamed video — no direct link)*';
          if (b.poster && !opts.noImages) {
            const thumb = imgMd(b.poster, title);
            return (b.src ? '[' + thumb + '](' + linkTarget(b.src) + ')' : thumb) + '\n\n' + link;
          }
          return link;
        }
        case 'list': return listMd(b, ctx);
        case 'table': return tableMd(b);
      }
      return '';
    }

    function listMd(list, ctx) {
      const lines = [];
      let n = list.start || 1;
      for (const item of list.items) {
        const marker = list.ordered ? (n++) + '.' : '-';
        const pad = ' '.repeat(marker.length + 1);
        const body = blocksMd(item, ctx);
        const bl = body.split('\n');
        lines.push(marker + ' ' + (bl[0] || ''));
        for (const l of bl.slice(1)) lines.push(l ? pad + l : '');
      }
      return lines.join('\n');
    }

    function tableMd(t) {
      const cols = Math.max(...t.rows.map(r => r.reduce((n, c) => n + c.cs, 0)));
      const rows = t.rows.map(r => {
        const cells = [];
        for (const c of r) {
          cells.push(runsToMd(c.r, { table: true }).replace(/\n/g, '<br>').trim());
          for (let i = 1; i < c.cs; i++) cells.push('');
        }
        while (cells.length < cols) cells.push('');
        return '| ' + cells.join(' | ') + ' |';
      });
      const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
      return [rows[0], sep, ...rows.slice(1)].join('\n');
    }

    const head = [];
    head.push('# ' + mdEscape(model.title || 'Untitled').replace(/\s+/g, ' '));
    if (opts.meta !== false) {
      const when = (opts.savedAt || new Date()).toISOString().slice(0, 10);
      head.push('> Source: ' + (model.url ? '<' + model.url + '>' : '(unknown)') + ' · Saved ' + when);
    }
    const body = blocksMd(model.blocks, {});
    const markdown = head.join('\n\n') + '\n\n' + body + '\n';
    return { markdown: markdown.replace(/\n{3,}/g, '\n\n'), files };
  }

  const api = { toMarkdown, runsToMd, mdEscape };
  root.KRMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
