// Runs INSIDE the page when you ask for it (Investigate / Capture): gathers what the analysis tabs need.
// Passed to chrome.scripting.executeScript as `func`, so `collect` must stay self-contained (no outside variables).
// Page text is untrusted: this only reads and returns plain data; nothing from the page is executed or inserted.
(function (root) {
  function collect(opts) {
    const LIMIT_TEXT = 2_000_000, LIMIT_LIST = 3000;
    const doc = document;
    const out = {
      url: location.href, title: doc.title || '', at: new Date().toISOString(), lang: doc.documentElement.lang || '', charset: doc.characterSet || '',
      referrer: doc.referrer || '', canonical: '', selection: '', text: '', links: [], images: [], videos: [], metas: {}, jsonld: [], scripts: [], styles: [], frames: [],
      forms: 0, passwordFields: 0, comments: [], hidden: [], cookieNames: [], inline: '', resources: [], truncated: false
    };
    try { out.selection = String(window.getSelection() || '').slice(0, 20000); } catch (_) {}
    try { out.text = (doc.body ? doc.body.innerText : '').slice(0, LIMIT_TEXT); out.truncated = (doc.body && doc.body.innerText.length > LIMIT_TEXT) || false; } catch (_) {}
    const can = doc.querySelector('link[rel~="canonical" i]');
    if (can && can.href) out.canonical = can.href;
    for (const m of doc.querySelectorAll('meta[name], meta[property], meta[http-equiv]')) {
      const k = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      if (k && m.content && Object.keys(out.metas).length < 200) out.metas[k] = m.content.slice(0, 500);
    }
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) { if (out.jsonld.length < 10) out.jsonld.push((s.textContent || '').trim().slice(0, 20000)); }
    for (const a of doc.querySelectorAll('a[href]')) {
      if (out.links.length >= LIMIT_LIST) break;
      let href = a.href;
      const raw = a.getAttribute('href') || '';
      if (/^(mailto|tel):/i.test(raw)) href = raw;
      out.links.push({ href: href, text: (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().slice(0, 120), rel: a.rel || '' });
    }
    for (const im of doc.querySelectorAll('img')) {
      if (out.images.length >= LIMIT_LIST) break;
      const src = im.currentSrc || im.src;
      if (src) out.images.push({ src: src, alt: (im.alt || '').slice(0, 200), w: im.naturalWidth || 0, h: im.naturalHeight || 0 });
    }
    for (const v of doc.querySelectorAll('video')) {
      const src = v.currentSrc || v.src || (v.querySelector('source') || {}).src || '';
      out.videos.push({ src: src, poster: v.poster || '', duration: isFinite(v.duration) ? v.duration : 0, w: v.videoWidth || 0, h: v.videoHeight || 0 });
    }
    for (const s of doc.querySelectorAll('script[src]')) if (out.scripts.length < LIMIT_LIST) out.scripts.push(s.src);
    for (const l of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) if (out.styles.length < LIMIT_LIST) out.styles.push(l.href);
    for (const f of doc.querySelectorAll('iframe[src]')) if (out.frames.length < 200) out.frames.push(f.src);
    out.forms = doc.forms.length;
    out.passwordFields = doc.querySelectorAll('input[type="password"]').length;
    // Inline scripts: only to look for ids (analytics, ad accounts). Capped.
    let inl = '';
    for (const s of doc.querySelectorAll('script:not([src])')) { if (inl.length > 400000) break; const t = s.textContent || ''; if (!/ld\+json/.test(s.type || '')) inl += t.slice(0, 40000) + '\n'; }
    out.inline = inl;
    // HTML comments (developers leave notes in them)
    try {
      const w = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
      let n;
      while ((n = w.nextNode()) && out.comments.length < 50) { const t = (n.nodeValue || '').trim(); if (t.length > 2 && !/^\[if |^<!\[endif/.test(t)) out.comments.push(t.slice(0, 300)); }
    } catch (_) {}
    // Text a visitor cannot see but is in the page
    try {
      let seen = 0;
      for (const el of doc.body ? doc.body.querySelectorAll('*') : []) {
        if (++seen > 6000 || out.hidden.length >= 30) break;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK|OPTION|SVG|PATH)$/.test(el.tagName)) continue;
        const own = Array.prototype.filter.call(el.childNodes, function (c) { return c.nodeType === 3; }).map(function (c) { return c.nodeValue; }).join(' ').trim();
        if (own.length < 4) continue;
        const cs = getComputedStyle(el);
        const hid = cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.fontSize) === 0 || parseFloat(cs.opacity) === 0 || (parseInt(cs.textIndent, 10) < -500) || (cs.position === 'absolute' && (parseInt(cs.left, 10) < -3000 || parseInt(cs.top, 10) < -3000));
        if (hid && !el.closest('[aria-hidden="true"], [hidden], dialog, details, .modal, .dropdown, nav')) out.hidden.push({ tag: el.tagName.toLowerCase(), text: own.slice(0, 200) });
      }
    } catch (_) {}
    try { out.cookieNames = doc.cookie ? doc.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); }).filter(Boolean).slice(0, 100) : []; } catch (_) {}
    // Everything the page loaded, as seen by the browser (addresses only)
    try { out.resources = performance.getEntriesByType('resource').slice(0, 1500).map(function (r) { return r.name; }); } catch (_) {}
    return out;
  }
  root.KOPage = { collect: collect };
})(typeof self !== 'undefined' ? self : globalThis);
