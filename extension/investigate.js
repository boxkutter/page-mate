// Investigate page: lookups, entities, media checks, archives, site profile, search operators, sharing, trail.
// Pure logic lives in osint-core.js / meta-core.js. Everything from the page or the network is treated as untrusted text:
// DOM is built with textContent/createElement only.
(function () {
  const K = KOsint;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab')) || null;
  const VIEWS = ['lookup', 'entities', 'media', 'archive', 'site', 'search', 'share', 'trail'];
  const state = { tab: null, page: null, headers: null, entities: null, entityFilter: '', entityType: '', custom: [], settings: null };

  // ---------- small helpers ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'href' || k === 'src') e.setAttribute(k, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const clear = el => { el.replaceChildren(); return el; };
  const status = (el, text, kind) => { el.textContent = text || ''; el.className = 'status' + (kind ? ' ' + kind : ''); };
  const link = (text, href, cls) => h('a', { class: 'pill' + (cls ? ' ' + cls : ''), href, target: '_blank', rel: 'noopener noreferrer', text });
  const safeHttp = u => /^https?:\/\//i.test(u || '') ? u : '';
  async function copy(text, el) {
    try { await navigator.clipboard.writeText(text); if (el) { const old = el.textContent; el.textContent = 'Copied'; setTimeout(() => { el.textContent = old; }, 1200); } return true; } catch (_) { return false; }
  }
  function saveText(name, text, type = 'text/plain') {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  // ---------- reading the page we were opened from ----------
  function showBanner(text, withButton) { $('bannerText').textContent = text; $('bannerAllow').hidden = !withButton; $('banner').classList.add('show'); }
  $('bannerAllow').addEventListener('click', async () => {
    try { const ok = await chrome.permissions.request({ origins: KR_ALL_SITES }); if (ok) { $('banner').classList.remove('show'); state.page = null; refreshCurrent(); } } catch (_) {}
  });

  async function getPage(force) {
    if (state.page && !force) return state.page;
    if (!tabId) throw new Error('This page was opened without a page to read. Use PageMate from the page you want to investigate.');
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: KOPage.collect, args: [{}] });
      if (!r || !r[0] || !r[0].result) throw new Error('empty');
      state.page = r[0].result;
      $('banner').classList.remove('show');
      return state.page;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/cannot access|permission|extensions gallery|chrome:\/\/|No tab with id|showing error page|empty/i.test(msg)) {
        showBanner(/No tab with id/i.test(msg) ? 'The page you opened this from has been closed.' : 'PageMate can’t read that page. It can read pages you open it from; for other pages, or after the page has changed address, allow access to sites.', !/No tab with id/i.test(msg));
        throw new Error('Can’t read the page.');
      }
      throw e;
    }
  }
  async function getHeaders() {
    if (state.headers !== null) return state.headers;
    try { const r = await chrome.runtime.sendMessage({ type: 'ko-get-headers', tabId }); state.headers = (r && r.record) || false; } catch (_) { state.headers = false; }
    return state.headers;
  }

  // ---------- LOOKUP ----------
  const KIND = { url: 'a web address', email: 'an email address', domain: 'a domain name', ipv4: 'an IPv4 address', ipv6: 'an IPv6 address', md5: 'an MD5 hash', sha1: 'a SHA-1 hash', sha256: 'a SHA-256 hash', cve: 'a vulnerability id (CVE)', btc: 'a Bitcoin address', eth: 'an Ethereum address', asn: 'an AS number', mac: 'a MAC address', latlon: 'map coordinates', handle: 'an @handle', username: 'a username', phone: 'a phone number', analyticsId: 'an analytics / ad-account id', text: 'text' };

  function renderLookup() {
    const q = $('luInput').value;
    const out = clear($('luResults'));
    if (!q.trim()) { status($('luKind'), ''); return; }
    const res = K.pivots(q, state.custom);
    $('luKind').textContent = 'Looks like ' + (KIND[res.detected.type] || res.detected.type) + (res.detected.value && res.detected.value !== q.trim() ? ' → ' + res.detected.value : '') + '.';
    for (const g of res.groups) {
      const card = h('div', { class: 'card' }, h('h2', { text: g === res.groups[0] ? 'Look up' : 'Also look up the ' + (KIND[g.type] || g.type).replace(/^an? /, '') + ' ' + g.value }));
      const cats = new Map();
      for (const it of g.items) { if (!cats.has(it.cat)) cats.set(it.cat, []); cats.get(it.cat).push(it); }
      for (const [cat, items] of cats) card.append(h('div', {}, h('b', { text: cat + ': ', style: 'font-size:13px;color:var(--muted)' }), items.map(it => link(it.name, it.url, it.custom ? 'custom' : ''))));
      out.append(card);
    }
  }
  $('luInput').addEventListener('input', renderLookup);
  $('luDefang').addEventListener('click', () => { $('luInput').value = K.defang($('luInput').value); renderLookup(); });
  $('luRefang').addEventListener('click', () => { $('luInput').value = K.refang($('luInput').value); renderLookup(); });
  $('luCopy').addEventListener('click', e => copy($('luInput').value, e.target));
  function gotoLookup(q) { $('luInput').value = q; showView('lookup'); renderLookup(); }

  // ---------- ENTITIES ----------
  function analyticsIds(page) {
    const bag = new Map();
    const add = list => { for (const e of list || []) bag.set(e.value, e); };
    add(K.extract(page.inline + '\n' + page.scripts.join('\n') + '\n' + page.resources.join('\n') + '\n' + page.frames.join('\n')).analyticsId);
    return [...bag.values()];
  }

  async function scanEntities() {
    status($('enStatus'), 'Reading the page…');
    try {
      const page = await getPage(true);
      const onlySel = $('enSel').checked && page.selection.trim();
      const metaText = Object.values(page.metas).join('\n');
      const text = onlySel ? page.selection : [page.title, page.text, metaText, page.comments.join('\n'), page.hidden.map(x => x.text).join('\n')].join('\n');
      const ent = K.extract(text, { links: onlySel ? [] : page.links });
      if (!onlySel) { const ids = analyticsIds(page); if (ids.length) ent.analyticsId = ids; }
      state.entities = ent;
      state.entityType = '';
      renderEntities();
      const n = Object.values(ent).reduce((a, l) => a + l.length, 0);
      status($('enStatus'), n ? n + ' items found' + (onlySel ? ' in your selection' : '') + (page.truncated ? ' (the page was very long; only the first part was read)' : '') + '.' : 'Nothing recognisable found.', n ? 'ok' : '');
    } catch (e) { status($('enStatus'), e.message, 'err'); }
  }

  function entityText() {
    const f = $('enFilter').value.trim().toLowerCase();
    const lines = [];
    for (const type of K.TYPE_ORDER) for (const e of (state.entities || {})[type] || []) if ((!state.entityType || state.entityType === type) && (!f || e.value.toLowerCase().includes(f))) lines.push($('enDefang').checked ? K.defang(e.value) : e.value);
    return lines.join('\n');
  }

  function renderEntities() {
    const ent = state.entities;
    const chips = clear($('enChips')), list = clear($('enList'));
    if (!ent) return;
    const f = $('enFilter').value.trim().toLowerCase();
    chips.append(h('button', { class: 'chip', 'aria-pressed': String(!state.entityType), text: 'All', on: { click: () => { state.entityType = ''; renderEntities(); } } }));
    for (const type of K.TYPE_ORDER) if (ent[type]) chips.append(h('button', { class: 'chip', 'aria-pressed': String(state.entityType === type), text: K.TYPE_LABEL[type] + ' ' + ent[type].length, on: { click: () => { state.entityType = type; renderEntities(); } } }));
    const defangShown = $('enDefang').checked;
    for (const type of K.TYPE_ORDER) {
      if (!ent[type] || (state.entityType && state.entityType !== type)) continue;
      const rows = ent[type].filter(e => !f || e.value.toLowerCase().includes(f));
      if (!rows.length) continue;
      const card = h('div', { class: 'card' }, h('h2', { text: K.TYPE_LABEL[type] + ' (' + rows.length + ')' }));
      for (const e of rows.slice(0, 300)) {
        const c = h('code', { text: defangShown ? K.defang(e.value) : e.value });
        const row = h('div', { class: 'ent' }, c, h('span', { class: 'n', text: (e.count > 1 ? '×' + e.count + ' ' : '') + (e.sources.includes('link') || e.sources.includes('mailto') || e.sources.includes('tel') ? 'in links' : '') }),
          h('button', { class: 'ghost small', text: 'Look up', on: { click: () => gotoLookup(e.value) } }),
          h('button', { class: 'ghost small', text: 'Copy', on: { click: ev => copy(defangShown ? K.defang(e.value) : e.value, ev.target) } }));
        card.append(row);
      }
      if (rows.length > 300) card.append(h('p', { class: 'hint', text: rows.length - 300 + ' more not shown; use the filter or save the CSV for the full list.' }));
      list.append(card);
    }
  }
  $('enScan').addEventListener('click', scanEntities);
  $('enFilter').addEventListener('input', renderEntities);
  $('enDefang').addEventListener('change', renderEntities);
  $('enCopy').addEventListener('click', e => copy(entityText(), e.target));
  const entPage = () => ({ url: state.page && state.page.url, title: state.page && state.page.title, at: new Date().toISOString() });
  $('enCsv').addEventListener('click', () => { if (state.entities) saveText('Entities - ' + stamp() + '.csv', K.entitiesCsv(state.entities, entPage(), { defang: $('enDefang').checked }), 'text/csv'); });
  $('enMd').addEventListener('click', () => { if (state.entities) saveText('Entities - ' + stamp() + '.md', K.entitiesMarkdown(state.entities, entPage(), { defang: $('enDefang').checked }), 'text/markdown'); });

  // ---------- MEDIA ----------
  let loaded = null;   // { bytes, name, url, type, objectUrl }

  async function ensureHostAccess(url) {
    let origin;
    try { origin = new URL(url).origin + '/*'; } catch (_) { return false; }
    if (await chrome.permissions.contains({ origins: [origin] }).catch(() => false)) return true;
    try { return await chrome.permissions.request({ origins: [origin] }); } catch (_) { return false; }
  }

  async function fetchBytes(url, max = 400 * 1024 * 1024) {
    if (!(await ensureHostAccess(url))) throw new Error('Access to that site was not allowed.');
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('The site answered ' + res.status + '.');
    const len = Number(res.headers.get('content-length')) || 0;
    if (len > max) throw new Error('That file is too big to inspect here.');
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
  }

  async function inspectBytes(bytes, name, url, type) {
    if (loaded && loaded.objectUrl) URL.revokeObjectURL(loaded.objectUrl);
    const isVideo = /^video\//.test(type) || /\.(mp4|m4v|mov|webm)(\?|$)/i.test(name || '');
    const blob = new Blob([bytes], { type: type || '' });
    loaded = { bytes, name, url, type, objectUrl: URL.createObjectURL(blob), blob, isVideo };
    const desc = KMeta.describe(bytes);
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    const sha1 = hex(await crypto.subtle.digest('SHA-1', bytes));
    const out = clear($('mdResult'));
    out.append(h('h3', { text: name || 'File' }));

    const preview = h('div', { class: 'preview', id: 'mdPreview' });
    if (isVideo) preview.append(h('video', { src: loaded.objectUrl, controls: true, style: 'max-width:100%;max-height:420px' }));
    else preview.append(h('img', { src: loaded.objectUrl, id: 'mdImg', alt: '', style: 'max-width:100%' }));
    out.append(preview);

    if (!isVideo) {
      const tools = h('div', { class: 'row', style: 'margin:8px 0' },
        h('label', {}, 'Zoom ', h('select', { id: 'tlZoom', on: { change: applyTools } }, ['fit', '100%', '200%', '400%'].map(z => h('option', { value: z, text: z })))),
        h('label', { class: 'row', style: 'gap:4px' }, h('input', { type: 'checkbox', id: 'tlFlip', on: { change: applyTools } }), 'Mirror'),
        h('label', { class: 'row', style: 'gap:4px' }, h('input', { type: 'checkbox', id: 'tlInvert', on: { change: applyTools } }), 'Invert'),
        h('label', {}, 'Contrast ', h('input', { type: 'range', id: 'tlContrast', min: '50', max: '300', value: '100', on: { input: applyTools } })),
        h('label', {}, 'Brightness ', h('input', { type: 'range', id: 'tlBright', min: '30', max: '300', value: '100', on: { input: applyTools } })),
        h('button', { class: 'ghost small', id: 'tlEla', text: 'Error level analysis', on: { click: runEla } }));
      out.append(tools, h('div', { id: 'elaOut' }));
    }

    const rows = (g) => desc.fields.filter(f => f.group === g);
    const groups = [...new Set(desc.fields.map(f => f.group))];
    const tbl = h('table', {}, h('tbody', {}, h('tr', {}, h('th', { text: 'SHA-256' }), h('td', { class: 'mono', text: sha256 })), h('tr', {}, h('th', { text: 'SHA-1' }), h('td', { class: 'mono', text: sha1 }))));
    out.append(h('h3', { text: 'Fingerprints' }), tbl);
    for (const g of groups) {
      const t = h('tbody', {}, rows(g).map(f => h('tr', {}, h('th', { text: f.name }), h('td', { text: f.value }))));
      out.append(h('h3', { text: g }), h('table', {}, t));
    }
    if (desc.gps) {
      const v = desc.gps.lat + ',' + desc.gps.lon;
      out.append(h('div', { style: 'margin-top:8px' }, h('b', { text: 'Location in the file: ' }), K.pivots(v).groups[0].items.filter(i => ['gmaps', 'osm', 'gearth', 'sentinel'].includes(i.id)).map(i => link(i.name, i.url))));
    }
    for (const n of desc.notes) out.append(h('div', { class: 'note' + (n.level === 'warn' ? ' warn' : ''), text: n.text }));
    const report = ['File: ' + (name || ''), url ? 'Address: ' + url : '', 'SHA-256: ' + sha256, 'SHA-1: ' + sha1, '', ...desc.fields.map(f => f.group + ' / ' + f.name + ': ' + f.value), '', ...desc.notes.map(n => '- ' + n.text)].filter(x => x !== undefined).join('\n');
    out.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'ghost small', text: 'Copy report', on: { click: e => copy(report, e.target) } }), h('button', { class: 'ghost small', text: 'Save report', on: { click: () => saveText('Metadata - ' + stamp() + '.txt', report) } })));
    if (!isVideo && url && /^https?:/i.test(url)) out.append(h('div', { style: 'margin-top:8px' }, h('b', { text: 'Reverse image search: ' }), K.REVERSE_IMAGE.map(e => link(e.name, K.reverseImageUrl(e.id, url)))));
    else if (!isVideo) out.append(reverseUploadRow(() => loaded.blob));
    applyTools();
  }

  function reverseUploadRow(getBlob) {
    return h('div', { style: 'margin-top:8px' }, h('b', { text: 'Reverse image search (copies the picture; paste it there with Ctrl+V): ' }),
      K.REVERSE_IMAGE_UPLOAD.map(e => h('button', { class: 'ghost small', style: 'margin-right:6px', text: e.name, on: { click: async ev => { const ok = await copyImage(getBlob()); if (!ok) status($('mdStatus'), 'Couldn’t copy the picture; save it and upload it there.', 'err'); window.open(e.url, '_blank', 'noopener'); void ev; } } })));
  }

  async function copyImage(blob) {
    try {
      let b = blob;
      if (b.type !== 'image/png') { const bmp = await createImageBitmap(b); const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); b = await c.convertToBlob({ type: 'image/png' }); }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      return true;
    } catch (_) { return false; }
  }

  function applyTools() {
    const img = $('mdImg');
    if (!img) return;
    const z = $('tlZoom').value;
    img.style.maxWidth = z === 'fit' ? '100%' : 'none';
    img.style.width = z === 'fit' ? '' : (parseInt(z, 10) / 100) * (img.naturalWidth || 0) + 'px';
    const flt = [];
    if ($('tlInvert').checked) flt.push('invert(1)');
    flt.push('contrast(' + $('tlContrast').value + '%)', 'brightness(' + $('tlBright').value + '%)');
    img.style.filter = flt.join(' ');
    img.style.transform = $('tlFlip').checked ? 'scaleX(-1)' : '';
  }

  // Error level analysis: re-save as JPEG at a known quality and show how much each area changed.
  // Regions that were edited or pasted in often respond differently from the rest, but so do sharp edges and
  // anything already recompressed. It is a hint to look closer, never a verdict.
  async function runEla() {
    const out = clear($('elaOut'));
    try {
      const bmp = await createImageBitmap(loaded.blob);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
      const a = new OffscreenCanvas(w, hgt), ctxA = a.getContext('2d');
      ctxA.drawImage(bmp, 0, 0, w, hgt);
      const re = await createImageBitmap(await a.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
      const b = new OffscreenCanvas(w, hgt), ctxB = b.getContext('2d');
      ctxB.drawImage(re, 0, 0);
      const da = ctxA.getImageData(0, 0, w, hgt), db = ctxB.getImageData(0, 0, w, hgt);
      for (let i = 0; i < da.data.length; i += 4) for (let k = 0; k < 3; k++) da.data[i + k] = Math.min(255, Math.abs(da.data[i + k] - db.data[i + k]) * 20);
      ctxA.putImageData(da, 0, 0);
      const c = h('canvas', { width: String(w), height: String(hgt), style: 'max-width:100%;border:1px solid var(--line);border-radius:8px' });
      c.getContext('2d').drawImage(a, 0, 0);
      out.append(h('p', { class: 'hint', text: 'Error level analysis (JPEG quality 90, ×20). Bright areas changed more when re-saved. Sharp edges are always bright; already-recompressed images look uniformly noisy. Use it to decide where to look, not to decide anything.' }), c);
    } catch (e) { out.append(h('p', { class: 'status err', text: 'Couldn’t analyse this file: ' + (e && e.message || e) })); }
  }

  async function loadFile(file) {
    status($('mdStatus'), 'Reading…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await inspectBytes(bytes, file.name, '', file.type);
      status($('mdStatus'), '');
    } catch (e) { status($('mdStatus'), 'Couldn’t read that file: ' + (e.message || e), 'err'); }
  }
  async function loadUrl(url) {
    status($('mdStatus'), 'Fetching…');
    try {
      const { bytes, type } = await fetchBytes(url);
      let name = 'file';
      try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'file'); } catch (_) {}
      await inspectBytes(bytes, name, url, type);
      status($('mdStatus'), '');
      $('mdResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { status($('mdStatus'), 'Couldn’t fetch it: ' + (e.message || e), 'err'); }
  }
  $('mdFile').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  $('mdFetch').addEventListener('click', () => { const u = $('mdUrl').value.trim(); if (/^https?:\/\//i.test(u)) loadUrl(u); else status($('mdStatus'), 'Enter a web address starting with https://', 'err'); });
  $('mdUrl').addEventListener('keydown', e => { if (e.key === 'Enter') $('mdFetch').click(); });
  const drop = $('mdDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  async function renderMediaPage() {
    const grid = clear($('mdGrid'));
    try {
      const page = await getPage();
      const imgs = [], seen = new Set();
      for (const im of page.images) { if (!seen.has(im.src) && /^https?:|^data:image/i.test(im.src) && (im.w * im.h >= 2000 || !im.w)) { seen.add(im.src); imgs.push(im); } }
      status($('mdPageStatus'), imgs.length ? imgs.length + ' images' + (imgs.length > 60 ? ' (first 60 shown)' : '') + '. Tiny icons are left out.' : 'No images found on this page.');
      for (const im of imgs.slice(0, 60)) {
        const web = /^https?:/i.test(im.src);
        const tile = h('div', { class: 'itile' },
          h('div', { class: 'ithumb' }, h('img', { src: im.src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
          h('div', { class: 'imeta', text: (im.w ? im.w + ' × ' + im.h + ' · ' : '') + (im.alt ? im.alt.slice(0, 60) : (web ? new URL(im.src).hostname : 'embedded image')) }),
          h('div', { class: 'ibtns' },
            web ? h('button', { class: 'ghost small', text: 'Metadata', on: { click: () => loadUrl(im.src) } }) : null,
            web ? h('details', {}, h('summary', { text: 'Reverse search', style: 'cursor:pointer;font-size:13px;color:var(--accent);font-weight:600' }), K.REVERSE_IMAGE.map(e => link(e.name, K.reverseImageUrl(e.id, im.src)))) : null));
        grid.append(tile);
      }
      const sel = $('kfSource');
      for (const v of page.videos) if (/^https?:/i.test(v.src)) sel.append(h('option', { value: v.src, text: (v.w ? v.w + '×' + v.h + ' · ' : '') + v.src.slice(0, 90) }));
      if (!page.videos.some(v => /^https?:/i.test(v.src))) sel.firstChild.textContent = page.videos.length ? 'This page’s videos use protected or streamed sources: choose a file instead' : 'No video found on this page: choose a file instead';
    } catch (e) { status($('mdPageStatus'), e.message, 'err'); $('mdPageCard').querySelector('h2').textContent = 'Images on this page'; }
  }

  // Video frames
  async function grabFrames() {
    const out = clear($('kfFrames'));
    const file = $('kfFile').files[0];
    const src = $('kfSource').value;
    if (!file && !src) { status($('kfStatus'), 'Choose a video first.', 'err'); return; }
    status($('kfStatus'), 'Loading the video…');
    let objectUrl;
    try {
      if (file) objectUrl = URL.createObjectURL(file);
      else { const { bytes, type } = await fetchBytes(src, 1.5 * 1024 * 1024 * 1024); objectUrl = URL.createObjectURL(new Blob([bytes], { type: type || 'video/mp4' })); }
      const v = h('video', { muted: true, preload: 'auto', playsinline: true });
      v.src = objectUrl;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('The browser can’t play this video.')); setTimeout(() => rej(new Error('Timed out loading the video.')), 60000); });
      const n = Number($('kfCount').value) || 9, dur = v.duration;
      if (!isFinite(dur) || dur <= 0) throw new Error('Can’t tell how long this video is.');
      for (let i = 0; i < n; i++) {
        const t = Math.min(dur - 0.05, (dur * (i + 0.5)) / n);
        await new Promise(res => { v.onseeked = res; v.currentTime = t; });
        const c = h('canvas', { width: String(v.videoWidth), height: String(v.videoHeight) });
        c.getContext('2d').drawImage(v, 0, 0);
        const label = new Date(t * 1000).toISOString().slice(11, 22);
        out.append(h('div', {}, c, h('div', { class: 'row', style: 'margin-top:4px' }, h('span', { class: 'mono', text: label }),
          h('button', { class: 'ghost small', text: 'Save', on: { click: () => c.toBlob(b => { const a = h('a', { href: URL.createObjectURL(b), download: 'frame-' + label.replace(/[:.]/g, '-') + '.png' }); document.body.append(a); a.click(); a.remove(); }) } }),
          h('button', { class: 'ghost small', text: 'Copy', on: { click: ev => c.toBlob(async b => { const ok = await copyImage(b); ev.target.textContent = ok ? 'Copied' : 'Failed'; setTimeout(() => { ev.target.textContent = 'Copy'; }, 1200); }) } }))));
      }
      status($('kfStatus'), n + ' frames. Copy one, then open a reverse image search below and paste.', 'ok');
      out.after && !$('kfSearch') && $('kfFrames').insertAdjacentElement('afterend', h('div', { id: 'kfSearch', style: 'margin-top:8px' }, K.REVERSE_IMAGE_UPLOAD.map(e => link(e.name, e.url))));
    } catch (e) { status($('kfStatus'), e.message || String(e), 'err'); }
    finally { if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); }
  }
  $('kfGo').addEventListener('click', grabFrames);

  // ---------- ARCHIVE ----------
  const ARCH_KEY = 'ko:archives';
  async function recordedArchives() { return (await chrome.storage.local.get(ARCH_KEY))[ARCH_KEY] || {}; }
  function pageKeyOf(u) { try { const x = new URL(u); x.hash = ''; return x.href; } catch (_) { return u; } }

  async function renderArchive() {
    const url = $('arUrl').value.trim();
    const row = clear($('arLinks'));
    if (!/^https?:\/\//i.test(url)) return;
    const L = K.archiveLinks(url);
    row.append(link('Wayback: all copies', L.waybackAll), link('Wayback: newest', L.waybackNewest), link('Wayback: save now (opens)', L.waybackSave), link('archive.today: newest', L.archiveTodayNewest), link('archive.today: save (opens)', L.archiveTodaySave), link('Ghostarchive', L.ghostarchive));
    const rec = (await recordedArchives())[pageKeyOf(url)] || [];
    $('arRecordedCard').hidden = !rec.length;
    const box = clear($('arRecorded'));
    for (const r of rec) box.append(h('div', { class: 'ent' }, h('span', { class: 'badge', text: r.service }), h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.url, class: 'mono' }), h('span', { class: 'n', text: r.at || '' })));
  }
  async function recordArchive(pageUrl, entry) {
    const all = await recordedArchives();
    const k = pageKeyOf(pageUrl);
    const list = all[k] || [];
    if (!list.some(x => x.url === entry.url)) list.push(entry);
    all[k] = list.slice(-20);
    await chrome.storage.local.set({ [ARCH_KEY]: all });
    renderArchive();
  }
  $('arUrl').addEventListener('change', renderArchive);

  $('arList').addEventListener('click', async () => {
    const url = $('arUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { status($('arStatus'), 'Enter a web address first.', 'err'); return; }
    status($('arStatus'), 'Asking the Internet Archive…');
    try {
      if (!(await ensureHostAccess('https://web.archive.org/'))) throw new Error('Access to archive.org was not allowed.');
      const res = await fetch(K.cdxUrl(url), { credentials: 'omit', signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('archive.org answered ' + res.status + '.');
      const text = await res.text();
      const snaps = text.trim() ? K.parseCdx(JSON.parse(text)) : [];
      $('arResultCard').hidden = false;
      const box = clear($('arResult'));
      status($('arStatus'), snaps.length ? snaps.length + ' distinct copies found (identical copies are merged).' : 'The Internet Archive has no copy of that exact address.', snaps.length ? 'ok' : '');
      if (!snaps.length) { $('arResultCard').hidden = true; return; }
      const shown = snaps.slice(0, 100);
      box.append(h('table', {}, h('tbody', {}, shown.map(s => h('tr', {}, h('td', { text: s.date.replace('T', ' ').replace('Z', ' UTC') }), h('td', { text: s.status || '' }), h('td', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open' }), ' ', h('button', { class: 'ghost small', text: 'Record for captures', on: { click: ev => { recordArchive(url, { service: 'Wayback Machine', url: s.url, at: s.date }); ev.target.textContent = 'Recorded'; } } })))))));
      if (snaps.length > 100) box.append(h('p', { class: 'hint', text: snaps.length - 100 + ' older copies not shown.' }));
    } catch (e) { status($('arStatus'), 'Couldn’t list copies: ' + (e.message || e), 'err'); }
  });

  $('arSave').addEventListener('click', async () => {
    const url = $('arUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { status($('arStatus'), 'Enter a web address first.', 'err'); return; }
    status($('arStatus'), 'Asking the Internet Archive to save the page… this can take a minute.');
    $('arSave').disabled = true;
    try {
      if (!(await ensureHostAccess('https://web.archive.org/'))) throw new Error('Access to archive.org was not allowed.');
      const res = await fetch(K.archiveLinks(url).waybackSave, { credentials: 'omit', signal: AbortSignal.timeout(150000) });
      const m = /^https:\/\/web\.archive\.org\/web\/(\d{8,14})\//.exec(res.url || '');
      if (!res.ok && !m) throw new Error('archive.org answered ' + res.status + '. Some pages block archiving.');
      if (!m) throw new Error('archive.org did not say where the copy is. Try “Wayback: save now (opens)”.');
      const snap = { service: 'Wayback Machine', url: res.url, at: K.wbDate(m[1]) };
      await recordArchive(url, snap);
      status($('arStatus'), 'Saved: ' + snap.url, 'ok');
    } catch (e) { status($('arStatus'), 'Couldn’t save: ' + (e.message || e), 'err'); }
    finally { $('arSave').disabled = false; }
  });

  // ---------- SITE PROFILE ----------
  async function scanSite() {
    const out = clear($('stOut'));
    status($('stStatus'), 'Reading…');
    try {
      const page = await getPage(true);
      state.headers = null;
      const hdr = await getHeaders();
      const headers = hdr ? hdr.headers : {};
      const host = K.hostOf(page.url);
      const facts = { headers, metas: page.metas, scripts: page.scripts, links: page.styles };
      const tech = K.detectTech(facts);
      const sec = hdr ? K.securityHeaders(headers) : null;
      const third = K.externalHosts(page.url, [...page.scripts, ...page.styles, ...page.frames, ...page.images.map(i => i.src), ...page.resources]);
      const ids = analyticsIds(page);

      const kv = (rows) => h('table', {}, h('tbody', {}, rows.filter(r => r[1] !== '' && r[1] != null).map(r => h('tr', {}, h('th', { text: r[0] }), h('td', {}, r[1].nodeType ? r[1] : String(r[1]))))));
      out.append(h('div', { class: 'card' }, h('h2', { text: 'This page' }), kv([
        ['Address', page.url], ['Canonical address', page.canonical && page.canonical !== page.url ? page.canonical : ''], ['Title', page.title], ['Language', page.lang], ['Character set', page.charset], ['Came from', page.referrer],
        ['Served by IP', hdr && hdr.ip], ['Status', hdr && hdr.status], ['Forms / password fields', page.forms + ' / ' + page.passwordFields], ['Cookies readable by the page', page.cookieNames.join(', ')]
      ]), h('div', { style: 'margin-top:8px' }, host ? link('Look up ' + host, '#', '') : null)));
      const lookupLinks = out.querySelector('a.pill[href="#"]');
      if (lookupLinks) lookupLinks.addEventListener('click', e => { e.preventDefault(); gotoLookup(page.url); });
      if (hdr && hdr.ip) out.firstChild.append(h('div', { style: 'margin-top:6px' }, h('button', { class: 'ghost small', text: 'Look up the server IP ' + hdr.ip, on: { click: () => gotoLookup(hdr.ip) } })));

      if (!hdr) out.append(h('div', { class: 'card' }, h('p', { class: 'hint', text: 'No response headers were noted for this page. They are recorded as pages load when access to sites is allowed and “note response headers” is on in settings; reload the page and scan again.' })));
      else {
        out.append(h('div', { class: 'card' }, h('h2', { text: 'Technology (from headers, metadata and files the page loads)' }),
          tech.length ? kv(tech.map(t => [t.name + '  ·  ' + t.cat, t.evidence])) : h('p', { class: 'hint', text: 'Nothing recognised from the small built-in list.' }),
          h('p', { class: 'hint', text: 'A short built-in list, matched on visible clues. It can miss things and can be fooled; it is a starting point for a proper check.' })));
        out.append(h('div', { class: 'card' }, h('h2', { text: 'Security headers' }),
          h('table', {}, h('tbody', {}, sec.map(s => h('tr', {}, h('th', {}, h('span', { class: 'badge ' + (s.present ? 'good' : 'warn'), text: s.present ? 'present' : 'missing' }), s.name), h('td', { text: s.present ? (s.value || '').slice(0, 160) : s.why }))))),
          h('details', { style: 'margin-top:8px' }, h('summary', { text: 'All response headers', style: 'cursor:pointer' }), kv(Object.entries(headers).sort().map(([k, v]) => [k, v.slice(0, 400)])))));
      }
      if (ids.length) out.append(h('div', { class: 'card' }, h('h2', { text: 'Analytics and ad-account ids' }), h('p', { class: 'hint', text: 'Sites that share an id are often run by the same people. Look the id up to find others.' }), ids.map(i => h('div', { class: 'ent' }, h('code', { text: i.value }), h('button', { class: 'ghost small', text: 'Find other sites', on: { click: () => gotoLookup(i.value) } })))));
      out.append(h('div', { class: 'card' }, h('h2', { text: 'Other sites this page loads from (' + third.length + ')' }),
        third.length ? h('table', {}, h('tbody', {}, third.slice(0, 60).map(t => h('tr', {}, h('th', {}, t.tracker ? h('span', { class: 'badge warn', text: 'tracker' }) : null, t.domain), h('td', {}, t.count + ' request' + (t.count === 1 ? '' : 's') + ' · ', h('button', { class: 'ghost small', text: 'Look up', on: { click: () => gotoLookup(t.domain) } })))))) : h('p', { class: 'hint', text: 'Nothing from other sites was recorded.' }),
        h('p', { class: 'hint', text: 'Counted from what the browser had loaded when you scanned. “Tracker” is a match against a short list of well-known analytics and advertising domains.' })));
      const metaRows = Object.entries(page.metas).filter(([k]) => /^(description|author|generator|keywords|robots|og:|twitter:|article:|referrer|theme-color|application-name|publisher|date|dc\.)/i.test(k)).slice(0, 40).map(([k, v]) => [k, v.slice(0, 300)]);
      if (metaRows.length) out.append(h('div', { class: 'card' }, h('h2', { text: 'Metadata the page declares' }), kv(metaRows)));
      if (page.jsonld.length) out.append(h('div', { class: 'card' }, h('h2', { text: 'Structured data (JSON-LD)' }), page.jsonld.map(j => h('pre', { class: 'mono', style: 'white-space:pre-wrap;max-height:200px;overflow:auto;margin:0 0 8px', text: j.slice(0, 3000) }))));
      if (page.hidden.length) out.append(h('div', { class: 'card' }, h('h2', { text: 'Text in the page that visitors can’t see (' + page.hidden.length + (page.hidden.length >= 30 ? '+' : '') + ')' }), h('p', { class: 'hint', text: 'Often menus or accessibility labels, but sometimes keyword stuffing or hidden messages.' }), page.hidden.map(x => h('div', { class: 'ent' }, h('span', { class: 'badge', text: x.tag }), h('span', { text: x.text })))));
      if (page.comments.length) out.append(h('div', { class: 'card' }, h('h2', { text: 'Comments left in the page’s HTML (' + page.comments.length + ')' }), page.comments.map(c => h('div', { class: 'ent' }, h('code', { text: c })))));
      status($('stStatus'), 'Done.', 'ok');
    } catch (e) { status($('stStatus'), e.message, 'err'); }
  }
  $('stScan').addEventListener('click', scanSite);

  // ---------- SEARCH OPERATORS ----------
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  function dorkFromForm() {
    return K.dork({ all: $('dkAll').value, exact: $('dkExact').value, any: list($('dkAny').value), none: list($('dkNone').value), site: $('dkSite').value, filetype: $('dkType').value, inurl: $('dkInurl').value, intitle: $('dkTitle').value, after: $('dkAfter').value, before: $('dkBefore').value });
  }
  function renderDorkLinks() {
    const q = $('dkOut').value.trim();
    const row = clear($('dkEngines'));
    if (!q) return;
    for (const e of K.SEARCH_ENGINES) row.append(link('Search ' + e.name, K.searchUrl(e.id, q)));
    row.append(h('button', { class: 'ghost small', text: 'Copy', on: { click: ev => copy(q, ev.target) } }));
  }
  for (const id of ['dkAll', 'dkExact', 'dkAny', 'dkNone', 'dkSite', 'dkType', 'dkInurl', 'dkTitle', 'dkAfter', 'dkBefore']) $(id).addEventListener('input', () => { $('dkOut').value = dorkFromForm(); renderDorkLinks(); });
  $('dkOut').addEventListener('input', renderDorkLinks);
  function renderPresets() {
    const subj = $('dkSubject').value.trim();
    const box = clear($('dkPresets'));
    for (const p of K.DORK_PRESETS) {
      const isSite = p.needs === 'site' || p.needs === 'site+word';
      const ok = subj && (!isSite || K.isDomain(subj.replace(/^https?:\/\//, '').replace(/\/.*$/, '')) || p.needs === 'word');
      const siteArg = subj.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      box.append(h('button', { class: 'ghost small', style: 'margin:3px 6px 3px 0', disabled: !ok, text: p.name, on: { click: () => { $('dkOut').value = p.needs === 'word' ? p.build(subj) : p.needs === 'site' ? p.build(siteArg) : p.build(siteArg, subj); renderDorkLinks(); } } }));
    }
  }
  $('dkSubject').addEventListener('input', renderPresets);

  // ---------- SHARE ----------
  async function initShare() {
    const s = state.settings;
    let page = null;
    try { page = await getPage(); } catch (_) {}
    if (!$('shUrl').value) $('shUrl').value = (page && page.url) || (state.tab && state.tab.url) || '';
    if (!$('shTitle').value) $('shTitle').value = (page && page.title) || (state.tab && state.tab.title) || '';
    if (!$('shQuote').value) $('shQuote').value = params.get('quote') || (page && page.selection ? page.selection.trim().slice(0, 600) : '');
    if (!$('shTags').value) $('shTags').value = s.shareHashtags || '';
    if (!$('shInstance').value) $('shInstance').value = s.shareInstance || '';
    $('shClean').checked = s.shareClean !== false;
    renderShare();
  }
  function renderShare() {
    const url = $('shUrl').value.trim();
    const warns = clear($('shWarn'));
    if (url) for (const w of K.shareWarnings(url)) warns.append(h('div', { class: 'banner show', style: 'margin-bottom:10px' }, h('p', { text: '⚠ ' + w })));
    const instance = K.mastodonInstance($('shInstance').value);
    const links = K.shareLinks({ url, title: $('shTitle').value.trim(), note: $('shNote').value, quote: $('shQuote').value, hashtags: list($('shTags').value), instance, clean: $('shClean').checked });
    const box = clear($('shChannels'));
    if (!/^https?:\/\//i.test(url)) { box.append(h('p', { class: 'hint', text: 'Enter a web address (http or https) to share.' })); return; }
    for (const l of links) {
      if (l.needs) { box.append(h('button', { class: 'pill ghost', style: 'cursor:pointer', text: l.name + ' (enter your server above)', disabled: true })); continue; }
      const a = link(l.name + (l.over ? ' (too long, will be cut)' : ''), l.href);
      if (l.over) a.classList.add('over-limit');
      box.append(a);
    }
    $('shNative').hidden = !navigator.share;
  }
  for (const id of ['shUrl', 'shTitle', 'shNote', 'shQuote', 'shTags', 'shInstance', 'shClean']) $(id).addEventListener('input', renderShare);
  function shareParts() {
    const url = $('shClean').checked ? K.cleanUrl($('shUrl').value.trim()) : $('shUrl').value.trim();
    return { url, text: K.composeText({ title: $('shTitle').value.trim(), note: $('shNote').value, quote: $('shQuote').value, hashtags: list($('shTags').value) }) };
  }
  $('shCopyLink').addEventListener('click', e => copy(shareParts().url, e.target));
  $('shCopyText').addEventListener('click', e => { const p = shareParts(); copy((p.text ? p.text + '\n' : '') + p.url, e.target); });
  $('shNative').addEventListener('click', async () => { const p = shareParts(); try { await navigator.share({ title: $('shTitle').value, text: p.text, url: p.url }); } catch (_) {} });
  $('shInstance').addEventListener('change', () => chrome.storage.sync.set({ shareInstance: K.mastodonInstance($('shInstance').value) }).catch(() => {}));
  $('shTags').addEventListener('change', () => chrome.storage.sync.set({ shareHashtags: $('shTags').value }).catch(() => {}));
  $('shClean').addEventListener('change', () => chrome.storage.sync.set({ shareClean: $('shClean').checked }).catch(() => {}));

  // ---------- TRAIL ----------
  const TRAIL = 'ko:trail', TRAIL_LOG = 'ko:trailLog';
  async function renderTrail() {
    const cfg = (await chrome.storage.local.get(TRAIL))[TRAIL] || { on: false, case: '' };
    $('trOn').checked = !!cfg.on;
    if (!$('trCase').value) $('trCase').value = cfg.case || '';
    const log = (await chrome.storage.local.get(TRAIL_LOG))[TRAIL_LOG] || [];
    const f = $('trFilter').value.trim().toLowerCase();
    const rows = log.filter(r => !f || (r.url + ' ' + r.title + ' ' + r.case).toLowerCase().includes(f));
    $('trCount').textContent = log.length + ' page' + (log.length === 1 ? '' : 's') + ' recorded' + (f ? ' · ' + rows.length + ' shown' : '');
    const box = clear($('trList'));
    box.append(h('table', {}, h('tbody', {}, rows.slice(-300).reverse().map(r => h('tr', {}, h('td', { class: 'mono', text: r.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z'), style: 'white-space:nowrap' }), h('td', {}, h('div', { text: r.title || '' }), h('a', { href: safeHttp(r.url), target: '_blank', rel: 'noopener noreferrer', class: 'mono', text: r.url })), h('td', { text: r.case || '' }))))));
  }
  async function saveTrailCfg() {
    const on = $('trOn').checked;
    if (on) {
      let have = false;
      try { have = await chrome.permissions.contains({ permissions: ['tabs'] }); } catch (_) {}
      if (!have) {
        let ok = false;
        try { ok = await chrome.permissions.request({ permissions: ['tabs'] }); } catch (_) {}
        if (!ok) { $('trOn').checked = false; status($('trStatus'), 'The trail needs the “tabs” permission; it was not given, so it stays off.', 'err'); return; }
      }
    }
    await chrome.storage.local.set({ [TRAIL]: { on: $('trOn').checked, case: $('trCase').value.trim().slice(0, 120) } });
    status($('trStatus'), $('trOn').checked ? 'Recording pages you open.' : 'Not recording.', $('trOn').checked ? 'ok' : '');
  }
  $('trOn').addEventListener('change', saveTrailCfg);
  $('trCase').addEventListener('change', saveTrailCfg);
  $('trFilter').addEventListener('input', renderTrail);
  $('trClear').addEventListener('click', async () => { if (confirm('Delete the whole trail from this browser?')) { await chrome.storage.local.remove(TRAIL_LOG); renderTrail(); } });
  $('trCsv').addEventListener('click', async () => {
    const log = (await chrome.storage.local.get(TRAIL_LOG))[TRAIL_LOG] || [];
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    saveText('Trail - ' + stamp() + '.csv', 'visited_at_utc,case,url,title\n' + log.map(r => [r.at, r.case, r.url, r.title].map(cell).join(',')).join('\n') + '\n', 'text/csv');
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[TRAIL_LOG] && !$('panel-trail').hidden) renderTrail(); });

  // ---------- tabs ----------
  const inited = {};
  function refreshCurrent() { const v = VIEWS.find(x => !$('panel-' + x).hidden); if (v) { delete inited[v]; showView(v); } }
  function showView(v) {
    if (!VIEWS.includes(v)) v = 'entities';
    for (const t of VIEWS) { $('panel-' + t).hidden = t !== v; $('tab-' + t).setAttribute('aria-selected', String(t === v)); }
    history.replaceState(null, '', '?' + new URLSearchParams({ ...Object.fromEntries(params), view: v }));
    if (inited[v]) return;
    inited[v] = true;
    if (v === 'entities') scanEntities();
    else if (v === 'media') { renderMediaPage(); const img = params.get('img'); if (img) { params.delete('img'); loadUrl(img); } else if (params.get('embedded')) { params.delete('embedded'); status($('mdStatus'), 'That picture is embedded in the page rather than a web address, so it can’t be sent to a search engine by link. Save it, then drop it here, or use the copy-and-paste search below it.'); } }
    else if (v === 'archive') { if (!$('arUrl').value) $('arUrl').value = (state.tab && state.tab.url) || ''; renderArchive(); }
    else if (v === 'search') { renderPresets(); }
    else if (v === 'share') initShare();
    else if (v === 'trail') renderTrail();
    else if (v === 'site') scanSite();
  }
  for (const t of VIEWS) $('tab-' + t).addEventListener('click', () => showView(t));

  async function init() {
    state.settings = await chrome.storage.sync.get(KR_DEFAULTS).catch(() => ({ ...KR_DEFAULTS }));
    state.custom = K.parseCustomServices(state.settings.customServices || '[]').services;
    if (tabId) {
      try { state.tab = await chrome.tabs.get(tabId); $('source').textContent = (state.tab.title || '') + ' — ' + (state.tab.url || ''); }
      catch (_) { $('source').textContent = 'The page this was opened from is gone.'; }
    } else $('source').textContent = 'Not opened from a page: you can still look things up, check files and use the search builder.';
    const view = params.get('view') || 'entities';
    const q = params.get('q');
    if (q) { $('luInput').value = q; }
    showView(view);
    if (view === 'lookup') renderLookup();
  }
  init();
})();
