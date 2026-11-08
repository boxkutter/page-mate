// Document model -> clean, print-ready HTML (DOM nodes).
//
// Used for the on-screen preview and for "Save as PDF" (the browser prints this
// element). Everything is built with createElement / textContent, never
// innerHTML, so nothing from the page can inject markup into the extension page.
(function (root) {
  const SAFE_LINK = /^(https?|mailto|tel):/i;

  // opts: { images: Map(src -> { url }) | null  (null = images off),
  //         videos: 'links' | 'none', meta: bool, savedAt: Date,
  //         videoFiles: Map(video block -> { path, type, audio, tracks:[{src,lang,label}] }) | null }
  function renderDocument(model, opts, doc) {
    doc = doc || document;
    const images = opts.images;
    const includeVideos = opts.videos !== 'none';
    const el = (tag, cls, text) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };

    function runsInto(parent, runs) {
      for (const r of runs) {
        if (r.br) { parent.appendChild(doc.createElement('br')); continue; }
        let node = doc.createTextNode(r.x);
        const wrapWith = tag => { const w = doc.createElement(tag); w.appendChild(node); node = w; };
        if (r.c) wrapWith('code');
        if (r.b) wrapWith('strong');
        if (r.i) wrapWith('em');
        if (r.u && !r.a) wrapWith('u');
        if (r.s) wrapWith('s');
        if (r.sup) wrapWith('sup');
        if (r.sub) wrapWith('sub');
        if (r.a && SAFE_LINK.test(r.a)) {
          const a = doc.createElement('a');
          a.href = r.a;
          a.rel = 'noreferrer noopener';
          a.target = '_blank';
          a.appendChild(node);
          node = a;
        }
        parent.appendChild(node);
      }
      return parent;
    }

    function imageNode(src, alt, cls) {
      if (!images) return null;
      const entry = images.get(src);
      if (!entry || !entry.url) {
        const ph = el('p', 'kr-missing', alt ? '[Image not available: ' + alt + ']' : '[Image not available]');
        return ph;
      }
      const fig = el('figure', cls || 'kr-fig');
      const img = doc.createElement('img');
      img.src = entry.url;
      img.alt = alt || '';
      if (entry.w && entry.h) { img.width = entry.w; img.height = entry.h; }
      fig.appendChild(img);
      return fig;
    }

    function blocksInto(parent, blocks) {
      for (const b of blocks) {
        const n = blockNode(b);
        if (n) parent.appendChild(n);
      }
      return parent;
    }

    function blockNode(b) {
      switch (b.t) {
        case 'h': return runsInto(el('h' + Math.min(6, Math.max(1, b.l))), b.r);
        case 'p': return runsInto(el('p', b.cap ? 'kr-caption' : ''), b.r);
        case 'quote': return blocksInto(el('blockquote'), b.b);
        case 'code': {
          const pre = el('pre');
          pre.appendChild(el('code', '', b.text));
          return pre;
        }
        case 'hr': return el('hr');
        case 'img': return imageNode(b.src, b.alt);
        case 'video': {
          if (!includeVideos) return null;
          // A downloaded copy sits next to the saved page: play it right there.
          const file = opts.videoFiles && opts.videoFiles.get(b);
          if (file) {
            const fig = el('figure', 'kr-embedded');
            const media = doc.createElement(file.audio ? 'audio' : 'video');
            media.controls = true;
            media.preload = 'metadata';
            if (!file.audio && b.poster && images && images.get(b.poster) && images.get(b.poster).url) media.poster = images.get(b.poster).url;
            const source = doc.createElement('source');
            source.src = file.path;
            if (file.type) source.type = file.type;
            media.appendChild(source);
            for (const t of file.tracks || []) {
              const track = doc.createElement('track');
              track.kind = 'subtitles';
              track.src = t.src;
              if (t.lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(t.lang)) track.srclang = t.lang;
              track.label = t.label || t.lang || 'Subtitles';
              media.appendChild(track);
            }
            fig.appendChild(media);
            fig.appendChild(el('figcaption', '', (file.audio ? '🔊 ' : '▶ ') + (b.title || (file.audio ? 'Audio' : 'Video'))));
            return fig;
          }
          const box = el('div', 'kr-video');
          if (b.poster && images) {
            const thumb = imageNode(b.poster, b.title, 'kr-fig kr-poster');
            if (thumb) box.appendChild(thumb);
          }
          const line = el('p', 'kr-video-line');
          line.appendChild(el('span', 'kr-play', b.audio ? '🔊 Audio: ' : '▶ Video: '));
          const title = b.title || (b.audio ? 'Audio' : 'Video');
          if (b.src && SAFE_LINK.test(b.src)) {
            const a = el('a', '', title);
            a.href = b.src; a.rel = 'noreferrer noopener'; a.target = '_blank';
            line.appendChild(a);
          } else {
            line.appendChild(doc.createTextNode(title));
            line.appendChild(el('em', 'kr-note', ' (streamed — no direct link)'));
          }
          box.appendChild(line);
          return box;
        }
        case 'list': {
          const list = el(b.ordered ? 'ol' : 'ul');
          if (b.ordered && b.start && b.start !== 1) list.start = b.start;
          for (const item of b.items) list.appendChild(blocksInto(el('li'), item));
          return list;
        }
        case 'table': {
          const table = el('table');
          const hasHead = b.rows[0] && b.rows[0].every(c => c.h);
          const thead = hasHead ? doc.createElement('thead') : null;
          const tbody = doc.createElement('tbody');
          b.rows.forEach((row, i) => {
            const tr = doc.createElement('tr');
            for (const c of row) {
              const td = el(c.h ? 'th' : 'td');
              if (c.cs > 1) td.colSpan = c.cs;
              runsInto(td, c.r);
              tr.appendChild(td);
            }
            (hasHead && i === 0 ? thead : tbody).appendChild(tr);
          });
          if (thead) table.appendChild(thead);
          table.appendChild(tbody);
          return table;
        }
      }
      return null;
    }

    const article = el('article', 'kr-doc');
    if (model.lang && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(model.lang)) article.lang = model.lang;
    article.appendChild(el('h1', 'kr-title', model.title || 'Untitled'));
    if (opts.meta !== false) {
      const meta = el('p', 'kr-meta');
      meta.appendChild(doc.createTextNode('Source: '));
      if (model.url && SAFE_LINK.test(model.url)) {
        const a = el('a', '', model.url);
        a.href = model.url; a.rel = 'noreferrer noopener'; a.target = '_blank';
        meta.appendChild(a);
      }
      const when = (opts.savedAt || new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      meta.appendChild(doc.createTextNode(' · Saved ' + when));
      article.appendChild(meta);
    }
    blocksInto(article, model.blocks);
    return article;
  }

  const api = { renderDocument };
  root.KRRender = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
