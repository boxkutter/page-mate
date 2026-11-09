// Screenshot viewer / editor. The picture is held in memory as an untouched original plus a list of marks;
// marks are drawn on top, so Undo is exact and the original can be sealed as evidence.
(function () {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const cv = $('cv'), ctx = cv.getContext('2d');
  const st = { shot: null, bmp: null, ops: [], tool: 'none', crop: null, drag: null, sha: '', original: null, savedSig: '[[],null]' };
  // "Unsaved edits": marks or a crop that have not been saved, copied, shared, filed or sealed since they last changed.
  const editSig = () => JSON.stringify([st.ops, st.crop]);
  const hasUnsavedEdits = () => (st.ops.length > 0 || !!st.crop) && editSig() !== st.savedSig;
  const markKept = () => { st.savedSig = editSig(); };
  window.addEventListener('beforeunload', e => { if (hasUnsavedEdits()) { e.preventDefault(); e.returnValue = ''; } });

  const setStatus = (el, t, k) => { el.textContent = t || ''; el.className = 'status' + (k ? ' ' + k : ''); };
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); e.append(...kids); return e; };

  // ---------- drawing ----------
  function outSize() { return st.crop ? { w: st.crop.w, h: st.crop.h } : { w: st.bmp.width, h: st.bmp.height }; }

  function drawOp(c, op) {
    c.save();
    c.lineWidth = op.lw; c.strokeStyle = op.color; c.fillStyle = op.color; c.lineJoin = 'round'; c.lineCap = 'round';
    if (op.type === 'box') c.strokeRect(op.x, op.y, op.w, op.h);
    else if (op.type === 'highlight') { c.globalAlpha = 0.38; c.fillStyle = '#ffe033'; c.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.type === 'redact') { c.fillStyle = '#000'; c.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.type === 'pixelate') {
      const size = Math.max(6, Math.round(Math.min(op.w, op.h) / 6), Math.round(st.bmp.width / 120));
      const sw = Math.max(1, Math.ceil(op.w / size)), sh = Math.max(1, Math.ceil(op.h / size));
      const tmp = new OffscreenCanvas(sw, sh);
      tmp.getContext('2d').drawImage(st.bmp, op.x, op.y, op.w, op.h, 0, 0, sw, sh);
      c.imageSmoothingEnabled = false;
      c.drawImage(tmp, 0, 0, sw, sh, op.x, op.y, sw * size, sh * size);
    } else if (op.type === 'arrow') {
      const a = Math.atan2(op.y2 - op.y1, op.x2 - op.x1), head = Math.max(14, op.lw * 4);
      c.beginPath(); c.moveTo(op.x1, op.y1); c.lineTo(op.x2, op.y2); c.stroke();
      c.beginPath(); c.moveTo(op.x2, op.y2); c.lineTo(op.x2 - head * Math.cos(a - 0.45), op.y2 - head * Math.sin(a - 0.45)); c.lineTo(op.x2 - head * Math.cos(a + 0.45), op.y2 - head * Math.sin(a + 0.45)); c.closePath(); c.fill();
    } else if (op.type === 'text') {
      c.font = '600 ' + op.size + 'px system-ui, sans-serif'; c.textBaseline = 'top';
      const w = c.measureText(op.text).width;
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(op.x - 4, op.y - 2, w + 8, op.size + 6);
      c.fillStyle = op.color; c.fillText(op.text, op.x, op.y);
    }
    c.restore();
  }

  // Draws the whole picture (original + marks) into any 2d context, in output coordinates.
  function paint(c, withCropGuide) {
    const { w, h } = outSize();
    c.save();
    if (st.crop) c.translate(-st.crop.x, -st.crop.y);
    c.drawImage(st.bmp, 0, 0);
    for (const op of st.ops) drawOp(c, op);
    c.restore();
    if (withCropGuide && st.drag && st.tool === 'crop') {
      const r = st.drag.rect;
      c.save(); c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, 0, w, h); c.clearRect(r.x, r.y, r.w, r.h); c.strokeStyle = '#3fbfb5'; c.lineWidth = 2; c.strokeRect(r.x, r.y, r.w, r.h); c.restore();
    }
  }

  function render() {
    if (!st.bmp) return;
    const { w, h } = outSize();
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    paint(ctx, true);
    if (st.drag && st.drag.live && st.tool !== 'crop') drawOp(ctx, st.drag.live);
    applyZoom();
    $('undo').disabled = !st.ops.length;
    $('reset').disabled = !st.ops.length && !st.crop;
    $('redactNote').hidden = !st.ops.some(o => o.type === 'redact' || o.type === 'pixelate') && !st.crop;
  }

  function applyZoom() {
    const z = $('zoom').value;
    const { w, h } = outSize();
    if (z === 'fit') { const avail = $('stage').clientWidth - 26; const f = Math.min(1, avail / w); cv.style.width = Math.round(w * f) + 'px'; cv.style.height = Math.round(h * f) + 'px'; }
    else { cv.style.width = Math.round(w * Number(z) / (st.shot.dpr > 1.2 ? st.shot.dpr : 1)) + 'px'; cv.style.height = Math.round(h * Number(z) / (st.shot.dpr > 1.2 ? st.shot.dpr : 1)) + 'px'; }
  }
  $('zoom').addEventListener('change', render);
  window.addEventListener('resize', () => { if (st.bmp && $('zoom').value === 'fit') applyZoom(); });

  // ---------- pointer handling ----------
  function pt(e) {
    const r = cv.getBoundingClientRect();
    const o = st.crop || { x: 0, y: 0 };
    return { x: (e.clientX - r.left) * cv.width / r.width + (st.crop ? 0 : 0), y: (e.clientY - r.top) * cv.height / r.height, ox: o.x, oy: o.y };
  }
  // marks are stored in ORIGINAL-image coordinates
  const toOrig = p => ({ x: p.x + (st.crop ? st.crop.x : 0), y: p.y + (st.crop ? st.crop.y : 0) });
  const lw = () => Math.max(3, Math.round(st.bmp.width / 400));

  cv.addEventListener('pointerdown', e => {
    if (st.tool === 'none' || !st.bmp) return;
    const p = pt(e);
    if (st.tool === 'text') {
      const t = prompt('Text to place here:');
      if (t && t.trim()) { const o = toOrig(p); st.ops.push({ type: 'text', x: o.x, y: o.y, text: t.trim().slice(0, 200), size: Math.max(18, Math.round(st.bmp.width / 60)), color: $('color').value, lw: 1 }); render(); }
      return;
    }
    cv.setPointerCapture(e.pointerId);
    st.drag = { a: p, b: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
  });
  cv.addEventListener('pointermove', e => {
    if (!st.drag) return;
    const p = pt(e);
    st.drag.b = p;
    const r = KOShot.rectFromPoints(st.drag.a, p, cv.width, cv.height);
    st.drag.rect = r;
    const o = toOrig({ x: r.x, y: r.y });
    const a = toOrig(st.drag.a), b = toOrig(p);
    st.drag.live = st.tool === 'arrow' ? { type: 'arrow', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: $('color').value, lw: lw() }
      : { type: st.tool, x: o.x, y: o.y, w: r.w, h: r.h, color: $('color').value, lw: lw() };
    render();
  });
  cv.addEventListener('pointerup', e => {
    if (!st.drag) return;
    const d = st.drag; st.drag = null;
    try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
    if (st.tool === 'crop') {
      if (d.rect.w > 8 && d.rect.h > 8) { const o = toOrig({ x: d.rect.x, y: d.rect.y }); st.crop = { x: Math.round(o.x), y: Math.round(o.y), w: Math.round(d.rect.w), h: Math.round(d.rect.h) }; setTool('none'); }
    } else if (d.live && (d.live.type === 'arrow' ? Math.hypot(d.live.x2 - d.live.x1, d.live.y2 - d.live.y1) > 8 : d.rect.w > 4 && d.rect.h > 4)) st.ops.push(d.live);
    render();
  });
  function setTool(t) {
    st.tool = t;
    for (const b of document.querySelectorAll('button.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    cv.style.cursor = t === 'none' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  }
  for (const b of document.querySelectorAll('button.tool')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('undo').addEventListener('click', () => { st.ops.pop(); render(); });
  $('reset').addEventListener('click', () => { st.ops = []; st.crop = null; render(); });
  window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); st.ops.pop(); render(); } });

  // ---------- output ----------
  async function flatten(type, quality) {
    const { w, h } = outSize();
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    paint(g, false);
    return c.convertToBlob({ type, quality });
  }
  const baseName = () => KOShot.fileBase(st.shot.title, new Date(st.shot.capturedAt));
  function download(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  async function copyBlob(blob) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); }

  $('savePng').addEventListener('click', async () => { download(await flatten('image/png'), baseName() + '.png'); markKept(); setStatus($('status'), 'Saved to your Downloads folder.', 'ok'); });
  $('saveJpg').addEventListener('click', async () => { download(await flatten('image/jpeg', 0.92), baseName() + '.jpg'); markKept(); setStatus($('status'), 'Saved to your Downloads folder.', 'ok'); });
  $('copyImg').addEventListener('click', async () => { try { await copyBlob(await flatten('image/png')); markKept(); setStatus($('status'), 'Copied. Paste it anywhere with Ctrl+V.', 'ok'); } catch (e) { setStatus($('status'), 'Couldn’t copy (' + (e.message || e) + '). Save it instead.', 'err'); } });

  // ---------- keep with my notes ----------
  $('toNotes').addEventListener('click', async () => {
    const out = $('notesStatus');
    $('toNotes').disabled = true;
    try {
      const marked = st.ops.length > 0 || !!st.crop;
      const blob = await flatten('image/png');
      const r = await KShotNotes.add(blob, { url: st.shot.url, title: st.shot.title, capturedAt: st.shot.capturedAt, mode: st.shot.mode, width: outSize().w, height: outSize().h, sha256: hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), marked, note: $('shotCaption').value.trim() });
      markKept();
      $('shotCaption').value = '';
      out.className = 'status ok';
      out.replaceChildren('Filed with your notes for this page (' + r.count + ' screenshot' + (r.count === 1 ? '' : 's') + ' there). ', el('a', { href: chrome.runtime.getURL('notes.html#shots=' + encodeURIComponent(r.key)), target: '_blank', textContent: 'Open my notes' }));
    } catch (e) { setStatus(out, 'Couldn’t file it: ' + (e && e.message || e), 'err'); }
    finally { $('toNotes').disabled = false; }
  });

  // ---------- copy automatically ----------
  $('autoCopy').addEventListener('change', async () => {
    $('autoCopy').checked = await krSetShotAutoCopy($('autoCopy').checked);
    setStatus($('status'), $('autoCopy').checked ? 'From now on each new screenshot is copied as soon as it is taken.' : 'Screenshots are no longer copied automatically.', $('autoCopy').checked ? 'ok' : '');
  });
  async function autoCopyIfWanted() {
    const s = await chrome.storage.sync.get({ shotAutoCopy: false });
    const have = await chrome.permissions.contains({ permissions: ['clipboardWrite'] }).catch(() => false);
    $('autoCopy').checked = !!s.shotAutoCopy && have;
    if (!$('autoCopy').checked) return;
    try { await copyBlob(st.original); markKept(); setStatus($('status'), 'Copied to your clipboard. Paste it anywhere with Ctrl+V.', 'ok'); }
    catch (e) { setStatus($('status'), 'Couldn’t copy it automatically (' + (e && e.message || e) + '). Use Copy image.', 'err'); }
  }

  // ---------- share ----------
  function renderSocial() {
    const box = $('social');
    box.replaceChildren();
    const url = st.shot.url && /^https?:/i.test(st.shot.url) ? st.shot.url : '';
    if (!url) { box.append(el('p', { className: 'hint', textContent: 'This screenshot has no web address to link to. Save it and attach it yourself.' })); return; }
    for (const w of KOsint.shareWarnings(url)) box.append(el('div', { className: 'warn', textContent: '⚠ ' + w }));
    chrome.storage.sync.get({ shareInstance: '', shareClean: true, shareHashtags: '' }).then(s => {
      const links = KOsint.shareLinks({ url, title: st.shot.title, hashtags: String(s.shareHashtags).split(',').map(x => x.trim()).filter(Boolean), instance: s.shareInstance, clean: s.shareClean !== false }, ['x', 'bluesky', 'mastodon', 'threads', 'reddit', 'linkedin', 'facebook', 'telegram', 'whatsapp', 'email']);
      for (const l of links) {
        if (!l.href) continue;
        const a = el('a', { className: 'pill', textContent: l.name, href: l.href, target: '_blank', rel: 'noopener noreferrer' });
        a.addEventListener('click', async e => {
          e.preventDefault();
          try { await copyBlob(await flatten('image/png')); markKept(); setStatus($('status'), 'Image copied: paste it into the post.', 'ok'); } catch (_) { setStatus($('status'), 'Couldn’t copy the image; save it and attach it yourself.', 'err'); }
          window.open(l.href, '_blank', 'noopener');
        });
        box.append(a);
      }
    });
    if (navigator.canShare) {
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'a.png', { type: 'image/png' });
      if (navigator.canShare({ files: [probe] })) $('nativeShare').hidden = false;
    }
  }
  $('nativeShare').addEventListener('click', async () => {
    try { const blob = await flatten('image/png'); await navigator.share({ files: [new File([blob], baseName() + '.png', { type: 'image/png' })], title: st.shot.title, url: st.shot.url }); markKept(); } catch (e) { if (e && e.name !== 'AbortError') setStatus($('status'), 'Couldn’t share: ' + (e.message || e), 'err'); }
  });

  // ---------- seal as evidence ----------
  async function initSeal() {
    const s = await chrome.storage.sync.get({ capBy: '', capSign: false, capTimestamp: false, tsaUrl: 'https://freetsa.org/tsr' });
    $('by').value = s.capBy; $('sign').checked = !!s.capSign; $('stamp').checked = !!s.capTimestamp;
    const sel = $('tsa');
    for (const t of KOTrust.TSA_PRESETS) sel.append(el('option', { value: t.url, textContent: t.name }));
    sel.append(el('option', { value: '', textContent: 'Another server…' }));
    const known = KOTrust.TSA_PRESETS.some(t => t.url === s.tsaUrl);
    sel.value = known ? s.tsaUrl : '';
    $('tsaCustom').value = known ? '' : s.tsaUrl;
    const sync = () => { $('tsaRow').hidden = !$('stamp').checked; $('tsaCustom').hidden = sel.value !== ''; };
    $('stamp').addEventListener('change', sync); sel.addEventListener('change', sync); sync();
    try {
      const idx = (await chrome.storage.local.get('kn:idx'))['kn:idx'] || {};
      $('cases').replaceChildren(...[...new Set(Object.values(idx).map(e => e.case).filter(Boolean))].map(c => el('option', { value: c })));
      const trail = (await chrome.storage.local.get('ko:trail'))['ko:trail'];
      if (trail && trail.case) $('case').value = trail.case;
    } catch (_) {}
  }
  const tsaUrl = () => ($('tsa').value || $('tsaCustom').value.trim());

  $('seal').addEventListener('click', async () => {
    const out = $('sealStatus');
    $('seal').disabled = true;
    try {
      // permission prompt must come straight from the click
      let tsa = null;
      if ($('stamp').checked) {
        tsa = tsaUrl();
        if (!/^https?:\/\//i.test(tsa)) throw new Error('Enter the timestamp server’s address.');
        if (!(await KNSeal.ensureOriginAccess(tsa))) throw new Error('Access to the timestamp server was not allowed.');
      }
      const by = $('by').value.trim().slice(0, 120), caseName = $('case').value.trim().slice(0, 120), note = $('note').value.trim().slice(0, 4000);
      chrome.storage.sync.set({ capBy: by, capSign: $('sign').checked, capTimestamp: $('stamp').checked, tsaUrl: tsa || undefined }).catch(() => {});
      setStatus(out, 'Preparing…');
      const when = new Date(st.shot.capturedAt);
      const files = [{ name: 'screenshot-original.png', data: st.original, description: 'The screenshot exactly as captured (PNG)' }];
      if (st.ops.length || st.crop) files.push({ name: 'screenshot-marked.png', data: await flatten('image/png'), description: 'The screenshot with your marks / crop applied' });
      const hdr = st.shot.sourceTab != null ? await chrome.runtime.sendMessage({ type: 'ko-get-headers', tabId: st.shot.sourceTab }).catch(() => null) : null;
      const record = hdr && hdr.record && hdr.record.url === st.shot.url ? hdr.record : null;
      files.push({ name: 'capture-info.json', data: JSON.stringify({ url: st.shot.url, title: st.shot.title, mode: st.shot.mode, pixel_size: { width: st.shot.width, height: st.shot.height }, device_pixel_ratio: st.shot.dpr || null, truncated: st.shot.truncated, page_height_css_px: st.shot.pageHeight || null, response: record ? { status: record.status, server_ip: record.ip, headers: record.headers } : null, marks: st.ops.map(o => o.type), cropped: st.crop }, null, 2) + '\n', description: 'What was captured, and the response headers noted at the time' });
      const key = $('sign').checked ? await KNSeal.getSigningKey(true) : null;
      const archives = ((await chrome.storage.local.get('ko:archives'))['ko:archives'] || {})[st.shot.url.split('#')[0]] || [];
      const info = { toolVersion: chrome.runtime.getManifest().version, case: caseName, capturedBy: by, capturedAt: when, url: st.shot.url, title: st.shot.title, userAgent: navigator.userAgent, highlights: 0, examinerNote: note, extra: { kind: 'screenshot', ...(archives.length ? { archives } : {}) } };
      const res = await KNSeal.build({ files, info, signing: key, tsaUrl: tsa, onStatus: t => setStatus(out, t) });
      const base = KOShot.fileBase(st.shot.title, when, 'Evidence screenshot');
      const zip = await KNSeal.zipEntries(base, res.entries, when);
      download(zip, base + '.zip');
      markKept();
      const log = (await chrome.storage.local.get('kn:seals'))['kn:seals'] || [];
      log.push(KNEvidence.logRow(info, res.manifestHash, base + '.zip'));
      await chrome.storage.local.set({ 'kn:seals': log.slice(-500) });
      setStatus(out, 'Sealed and saved to Downloads. Manifest fingerprint: ' + res.manifestHash + (res.warnings.length ? ' — ' + res.warnings.join(' ') : ''), res.warnings.length ? 'err' : 'ok');
    } catch (e) { setStatus(out, 'Couldn’t seal: ' + (e && e.message || e), 'err'); }
    finally { $('seal').disabled = false; }
  });

  // ---------- load ----------
  async function init() {
    if (!id) { $('source').textContent = 'No screenshot to show.'; return; }
    const rec = await KOShotStore.get(id).catch(() => null);
    if (!rec || !rec.blob) { $('source').textContent = 'This screenshot is no longer available. A screenshot is removed from the browser when its tab is closed (and anything left over after a day). Save it, copy it or file it with your notes before closing.'; return; }
    st.shot = rec;
    st.original = rec.blob;
    st.bmp = await createImageBitmap(rec.blob);
    st.sha = hex(await crypto.subtle.digest('SHA-256', await rec.blob.arrayBuffer()));
    document.title = 'Screenshot — ' + (rec.title || rec.url);
    $('source').textContent = (rec.title || '') + (rec.url ? ' — ' + rec.url : '');
    if (rec.truncated) { $('trunc').hidden = false; $('trunc').textContent = 'This page is taller than a browser can draw in one image, so only the top ' + rec.shownHeight + ' of ' + rec.pageHeight + ' pixels are included. Take a screenshot of the lower part separately.'; }
    const rows = [['Taken (UTC)', rec.capturedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')], ['Size', rec.width + ' × ' + rec.height + ' px'], ['Mode', { region: 'Selected area', visible: 'Visible part', full: 'Whole page' }[rec.mode] || rec.mode], ['SHA-256', st.sha]];
    $('meta').replaceChildren(...rows.map(r => { const tr = el('tr'); tr.append(el('th', { textContent: r[0] }), el('td', { textContent: r[1], className: r[0] === 'SHA-256' ? 'mono' : '' })); return tr; }));
    renderSocial();
    await initSeal();
    render();
    await autoCopyIfWanted();
  }
  init().catch(e => { $('source').textContent = 'Couldn’t open the screenshot: ' + (e && e.message || e); });
})();
