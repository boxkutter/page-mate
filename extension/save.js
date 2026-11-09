// The Save page: turns the page you came from into a PDF / Word / Markdown
// document, and downloads videos from it for your own archive.
(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab'));
  const M = KRMedia;

  const SAVE_DEFAULTS = {
    saveFormat: 'pdf', saveImages: true, saveVideos: true, saveMeta: true,
    savePaper: 'letter', saveMdImages: 'zip', saveByPage: true, saveConvert: true, savePackage: 'folder', saveImgPack: 'files'
  };

  const state = {
    tab: null,
    hosts: false,
    downloads: false,
    prefs: { ...SAVE_DEFAULTS },
    models: {},           // scope -> extracted result
    selectionChars: 0,
    images: new Map(),    // src -> prepared image | null (failed)
    buildToken: 0,
    built: null           // what the preview currently shows
  };

  // ---------- small helpers ----------

  function setStatus(el, text, kind = '') {
    el.textContent = text || '';
    el.className = el.className.replace(/\b(ok|err)\b/g, '').trim() + (kind ? ' ' + kind : '');
  }
  const docStatus = (t, k) => setStatus($('docStatus'), t, k);
  const vidStatus = (t, k) => setStatus($('vidStatus'), t, k);
  const audStatus = (t, k) => setStatus($('audStatus'), t, k);
  const imgStatus = (t, k) => setStatus($('imgStatus'), t, k);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Page-supplied text (addresses, titles) ends up in commands the user may paste into a
  // terminal, so quote it so that nothing in it can be interpreted (bash / zsh).
  const shQuote = v => "'" + String(v).replace(/'/g, "'\\''") + "'";

  function errText(e) {
    if (!e) return 'Unknown error';
    if (e.name === 'AbortError') return 'Cancelled.';
    return e.message || String(e);
  }

  async function savePref(patch) {
    Object.assign(state.prefs, patch);
    try { await chrome.storage.sync.set(patch); } catch (_) {}
  }

  // ---------- permissions ----------

  async function refreshPerms() {
    try { state.hosts = await chrome.permissions.contains({ origins: KR_ALL_SITES }); } catch (_) { state.hosts = false; }
    try { state.downloads = await chrome.permissions.contains({ permissions: ['downloads'] }); } catch (_) { state.downloads = false; }
    const need = !state.hosts || !state.downloads;
    $('access').classList.toggle('show', need);
  }

  async function requestAccess() {
    try {
      await chrome.permissions.request({ permissions: ['downloads'], origins: KR_ALL_SITES });
    } catch (e) {
      docStatus(errText(e), 'err');
    }
    await refreshPerms();
    if (state.hosts) {
      state.models = {};
      rebuild();
      scanVideos();
    }
  }

  // ---------- talking to the page ----------

  async function inject(allFrames) {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: !!allFrames }, files: ['extract.js'] });
  }

  function pageError(e) {
    const msg = errText(e);
    if (/cannot access|permission|extensions gallery|chrome:\/\/|No tab with id|showing error page/i.test(msg)) {
      return 'The extension can’t read that page. Allow access above, or the page may be a browser-internal page. (' + msg + ')';
    }
    return msg;
  }

  async function runExtract(scope) {
    await inject(false);
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: o => window.__krExtract.run(o),
      args: [{ scope }]
    });
    if (!res || !res.result) throw new Error('The page returned nothing.');
    return res.result;
  }

  async function probe() {
    await inject(false);
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__krExtract.probe() });
    return res && res.result;
  }

  // ---------- images ----------

  const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' };

  function sniffImage(b) {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return 'image/avif';
    if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    const head = new TextDecoder().decode(b.slice(0, 300)).trimStart().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
    return '';
  }

  async function fetchImageBlob(src) {
    if (/^data:/i.test(src)) return await (await fetch(src)).blob();
    for (const credentials of ['include', 'omit']) {
      // Pre-signed links (e.g. Amazon S3) answer with a wildcard CORS header, which browsers refuse
      // to combine with cookies, so retry without them.
      try {
        const res = await fetch(src, { credentials });
        if (res.ok) return await res.blob();
      } catch (_) {}
    }
    // Fall back to fetching from inside the page (its own cookies / same-origin rights).
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: u => window.__krExtract.fetchAsDataUrl(u), args: [src] });
      if (r && r.result) return await (await fetch(r.result)).blob();
    } catch (_) {}
    return null;
  }

  function measureImage(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 600, h: img.naturalHeight || 400, img });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function prepareImage(src) {
    const blob = await fetchImageBlob(src);
    if (!blob || blob.size > 40 * 1024 * 1024) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const declared = (blob.type || '').split(';')[0].toLowerCase();
    const mime = IMG_EXT[declared] ? declared : sniffImage(bytes);
    if (!mime) return null; // an error page, not a picture
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const m = await measureImage(url);
    if (!m) { URL.revokeObjectURL(url); return null; }
    return { bytes, mime, url, w: m.w, h: m.h, ext: IMG_EXT[mime], img: m.img };
  }

  // Word only embeds png / jpeg / gif reliably; convert the rest.
  async function docxImage(entry) {
    if (entry.docx) return entry.docx;
    if (['image/png', 'image/jpeg', 'image/gif'].includes(entry.mime)) {
      entry.docx = { bytes: entry.bytes, mime: entry.mime, w: entry.w, h: entry.h };
      return entry.docx;
    }
    const scale = Math.min(1, 2000 / entry.w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(entry.w * scale));
    canvas.height = Math.max(1, Math.round(entry.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(entry.img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise(r => canvas.toBlob(r, 'image/png'));
    entry.docx = { bytes: new Uint8Array(await png.arrayBuffer()), mime: 'image/png', w: entry.w, h: entry.h };
    return entry.docx;
  }

  function imageSources(model, wantVideos) {
    const set = new Set();
    const walk = blocks => {
      for (const b of blocks) {
        if (b.t === 'img') set.add(b.src);
        else if (b.t === 'video' && wantVideos && b.poster) set.add(b.poster);
        if (b.b) walk(b.b);
        if (b.items) b.items.forEach(walk);
      }
    };
    walk(model.blocks);
    return [...set];
  }

  async function loadImages(srcs, token) {
    const todo = srcs.filter(s => !state.images.has(s));
    // Sites that block hot-linking only serve an image when the request looks like it came from their page.
    if (todo.length && state.tab && state.tab.url) {
      await M.setReferers('doc', todo.filter(s => /^https?:/i.test(s)).map(url => ({ url, referer: state.tab.url })));
    }
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const src = todo[next++];
        let entry = null;
        try { entry = await prepareImage(src); } catch (_) {}
        state.images.set(src, entry);
        done++;
        if (token === state.buildToken) docStatus('Loading images ' + done + ' / ' + todo.length + '…');
      }
    };
    if (todo.length) await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  }

  // ---------- document: build + preview ----------

  function readOptions() {
    const checked = name => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;
    return {
      scope: checked('scope') || 'page',
      format: checked('format') || 'pdf',
      images: $('optImages').checked,
      videos: $('optVideos').checked ? 'links' : 'none',
      meta: $('optMeta').checked,
      paper: $('optPaper').value,
      mdImages: $('optMdImages').value,
      htmlVideos: $('optHtmlVideos').value,
      package: $('optPackage').value,
      notes: $('optNotes').checked && !!state.notesPage
    };
  }

  function syncOptionVisibility() {
    const o = readOptions();
    $('paperField').hidden = o.format === 'md' || o.format === 'html';
    $('mdImgField').hidden = !(o.format === 'md' && o.images);
    $('htmlField').hidden = o.format !== 'html';
    $('optHtmlVideos').disabled = o.videos === 'none';
    // A folder needs the Downloads permission; without it only a .zip is possible.
    const folderOpt = $('optPackage').querySelector('option[value="folder"]');
    folderOpt.disabled = !state.downloads;
    if (!state.downloads && $('optPackage').value === 'folder') $('optPackage').value = 'zip';
    $('download').textContent = { pdf: 'Save as PDF…', docx: 'Download Word file', md: 'Download Markdown', html: 'Save web page' }[o.format];
    $('pageSize').textContent = '@media print { @page { size: ' + (o.paper === 'a4' ? 'A4' : 'letter') + '; } }';
  }

  let rebuildTimer = null;
  function rebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(doRebuild, 60);
  }

  async function doRebuild() {
    const token = ++state.buildToken;
    const o = readOptions();
    syncOptionVisibility();
    $('stage').classList.add('loading');
    $('download').disabled = true;
    try {
      if (!state.models[o.scope]) {
        docStatus('Reading the page…');
        state.models[o.scope] = await runExtract(o.scope);
      }
      if (token !== state.buildToken) return;
      const result = state.models[o.scope];
      if (o.scope === 'selection' && result.scope !== 'selection') {
        docStatus('Nothing is selected on the page any more — showing the whole page.', 'err');
      }
      const model = result.model;
      await loadNotesFor(model.url);
      o.notes = $('optNotes').checked && !!state.notesPage; // the option only exists once the notes are known
      if (!model.blocks.length) {
        $('paper').replaceChildren(el('div', 'empty', 'No readable text was found on this page. Try selecting the text you want, then choose “Selected text only”.'));
        docStatus('');
        return;
      }
      if (o.images) await loadImages(imageSources(model, o.videos === 'links'), token);
      if (token !== state.buildToken) return;

      const preview = new Map();
      for (const [src, e] of state.images) if (e) preview.set(src, { url: e.url, w: 0, h: 0 });
      const article = KRRender.renderDocument(model, { images: o.images ? preview : null, videos: o.videos, meta: o.meta, savedAt: new Date() }, document);
      let notesNote = '';
      if (o.notes && (o.format === 'pdf' || o.format === 'html')) {
        const r = KNDom.applyNotes(article, state.notesPage, KNCore, { mediaLink: (src, t) => (src ? KNCore.timeUrl(src, t) : '') });
        notesNote = r.placed + ' of ' + r.total + ' highlights placed';
      }
      $('paper').replaceChildren(article);
      document.title = M.sanitizeName(model.title, 'Page') + ' – Save';
      state.built = { model, options: o };

      const srcs = o.images ? imageSources(model, o.videos === 'links') : [];
      const failed = srcs.filter(s => !state.images.get(s)).length;
      const stats = result.stats || {};
      const bits = [];
      if (o.images && !srcs.length && stats.pageImages) bits.push('The page has ' + stats.pageImages + ' image' + (stats.pageImages > 1 ? 's' : '') + ', but none looked like content (small icons, or outside the main text)');
      if (srcs.length) bits.push((srcs.length - failed) + ' of ' + srcs.length + ' images');
      if (o.videos === 'links' && stats.videos) bits.push(stats.videos + ' video' + (stats.videos > 1 ? 's' : '') + ' linked');
      if (notesNote) bits.push(notesNote);
      docStatus(bits.join(' · '), failed ? 'err' : '');
      if (failed) docStatus(bits.join(' · ') + ' — ' + failed + ' image' + (failed > 1 ? 's' : '') + ' couldn’t be loaded and will show a placeholder.', 'err');
    } catch (e) {
      if (token === state.buildToken) {
        $('paper').replaceChildren(el('div', 'empty', pageError(e)));
        docStatus('');
      }
    } finally {
      if (token === state.buildToken) {
        $('stage').classList.remove('loading');
        $('download').disabled = !state.built;
      }
    }
  }

  async function loadNotesFor(url) {
    state.notesPage = null;
    try {
      const key = KNCore.pageKey(url);
      if (key !== 'kn:p:') state.notesPage = (await chrome.storage.local.get(key))[key] || null;
    } catch (_) {}
    const has = !!(state.notesPage && state.notesPage.items && state.notesPage.items.length);
    if (!has) state.notesPage = null;
    $('notesLabel').hidden = !has;
    if (has) $('notesHint').textContent = state.notesPage.items.length + ' highlight' + (state.notesPage.items.length === 1 ? '' : 's') + '. PDF and web page only; for Word or Markdown use “My notes”.';
  }

  // ---------- document: export ----------

  function baseName() {
    return M.sanitizeName(state.built ? state.built.model.title : state.tab && state.tab.title, 'page', 90);
  }

  async function exportDocument() {
    if (!state.built) return;
    // What was built (scope / images / videos / meta) comes from the preview; how to save it
    // (format, paper, Markdown image mode) can change without a rebuild, so read those now.
    const { model } = state.built;
    const live = readOptions();
    const o = { ...state.built.options, format: live.format, paper: live.paper, mdImages: live.mdImages, htmlVideos: live.htmlVideos, package: live.package };
    const savedAt = new Date();
    const name = baseName();
    $('download').disabled = true;
    try {
      if (o.format === 'pdf') {
        await printPdf(name);
      } else if (o.format === 'html') {
        await exportHtml(model, o, name, savedAt);
      } else if (o.format === 'docx') {
        docStatus('Building the Word file…');
        const images = new Map();
        if (o.images) {
          for (const src of imageSources(model, o.videos === 'links')) {
            const e = state.images.get(src);
            if (e) { const d = await docxImage(e); images.set(src, d); }
          }
        }
        const blob = await KRDocx.toDocx(model, { images, videos: o.videos, meta: o.meta, paper: o.paper, savedAt });
        await M.saveBlob(blob, name + '.docx', { useDownloads: state.downloads });
        docStatus('Saved ' + name + '.docx', 'ok');
      } else {
        docStatus('Building the Markdown file…');
        const images = new Map();
        let n = 0;
        if (o.images && o.mdImages === 'zip') {
          for (const src of imageSources(model, o.videos === 'links')) {
            const e = state.images.get(src);
            if (e) images.set(src, { name: 'img-' + String(++n).padStart(3, '0') + '.' + e.ext, bytes: e.bytes, mime: e.mime });
          }
        }
        const md = KRMarkdown.toMarkdown(model, {
          images, videos: o.videos, meta: o.meta, savedAt,
          noImages: !o.images, linkImages: o.images && o.mdImages === 'link'
        });
        if (md.files.length) {
          const zip = await KRZip.createZip([{ name: name + '/' + name + '.md', data: md.markdown }, ...md.files.map(f => ({ name: name + '/' + f.name, data: f.data }))], { date: savedAt });
          await M.saveBlob(zip, name + '.zip', { useDownloads: state.downloads });
          docStatus('Saved ' + name + '.zip (Markdown + images folder)', 'ok');
        } else {
          await M.saveBlob(new Blob([md.markdown], { type: 'text/markdown' }), name + '.md', { useDownloads: state.downloads });
          docStatus('Saved ' + name + '.md', 'ok');
        }
      }
    } catch (e) {
      docStatus(e.name === 'AbortError' ? 'Cancelled.' : 'Couldn’t save: ' + errText(e), e.name === 'AbortError' ? '' : 'err');
    } finally {
      $('download').disabled = false;
      $('cancelDoc').hidden = true;
      state.exportCtrl = null;
    }
  }

  // ---------- web page with playable videos ----------

  const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const MEDIA_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac' };
  const FILE_TYPES = { ...MEDIA_TYPES, html: 'text/html;charset=utf-8', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', vtt: 'text/vtt' };
  const AUDIO_EXT = new Set(['mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'aac']);
  const MAX_ZIP_BYTES = 3.5 * 1024 * 1024 * 1024;

  function videoBlocks(model) {
    const out = [];
    const walk = blocks => { for (const b of blocks) { if (b.t === 'video') out.push(b); if (b.b) walk(b.b); if (b.items) b.items.forEach(walk); } };
    walk(model.blocks);
    return out;
  }

  const entryOf = url => (/entry_id[=/]([0-9a-z_]+)/i.exec(url || '') || [])[1] || '';

  // Which downloadable files belong to this video in the page? Best candidate first.
  function matchVideoItems(b) {
    const entry = (b.kaltura && b.kaltura.entry) || entryOf(b.src);
    const hits = items.filter(it => it.kind !== 'dash' && (
      (b.src && keyOf(it.url) === keyOf(b.src)) ||
      (entry && it.url.includes(entry)) ||
      (b.el && it.elementId === b.el && it.frameId === 0) ||
      (b.embed && b.src && it.frameUrl && keyOf(it.frameUrl) === keyOf(b.src))));
    const rank = it => (it.kind === 'file' ? 0 : it.from === 'guess' ? 2 : 1);
    return hits.sort((a, c) => rank(a) - rank(c) || (c.size || 0) - (a.size || 0));
  }

  async function ensureVideoItems() {
    while (scanning) await sleep(120);
    await scanVideos({ quiet: true });
  }

  // Downloads one candidate into a Blob a browser can play (MP4 / WebM / audio).
  async function getVideoBlob(it, signal, report) {
    if (it.kind === 'file') {
      const { blob, mime } = await M.fetchBlob(it.url, { signal, onProgress: p => report(p.total ? p.bytes / p.total : 0, M.fmtBytes(p.bytes)) });
      const ext = M.guessExt(it.url, mime || it.mime);
      if (!MEDIA_TYPES[ext]) throw new Error('not a playable file type (' + ext + ')');
      if (blob.size < 1024) throw new Error('the download was empty');
      return { blob, ext };
    }
    if (it.kind === 'hls') {
      let pl = KRHls.parsePlaylist(await M.fetchText(it.url, { signal }), it.url);
      if (pl.type === 'master') {
        if (pl.drm) throw new Error('it is DRM-protected');
        const v = pl.variants[0];
        if (!v) throw new Error('the stream lists no video qualities');
        if (KRHls.audioFor(pl, v)) throw new Error('its sound is a separate stream, which this version can’t combine yet');
        pl = KRHls.parsePlaylist(await M.fetchText(v.uri, { signal }), v.uri);
      }
      const io = { fetch: (u, o) => M.fetchBuffer(u, { ...o, signal }) };
      const r = await KRHls.downloadMedia(pl, io, { signal, onProgress: p => report(0.9 * p.done / p.total, M.fmtBytes(p.bytes)) });
      try {
        report(0.92, 'converting to MP4');
        return { blob: (await KRMux.toMp4(r.blob)).blob, ext: 'mp4' };
      } catch (e) {
        if (r.ext === 'mp4') return { blob: r.blob, ext: 'mp4' }; // already MP4, just fragmented
        throw new Error('it couldn’t be converted to MP4 (' + errText(e) + ')'); // browsers can't play raw .ts
      }
    }
    throw new Error('this kind of stream isn’t supported');
  }

  async function exportHtml(model, o, name, savedAt) {
    const ctrl = new AbortController();
    state.exportCtrl = ctrl;
    $('cancelDoc').hidden = false;
    const signal = ctrl.signal;
    const useFolder = o.package === 'folder' && state.downloads;
    const stamp = savedAt.toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    const dir = useFolder ? M.sanitizePath([$('folder').value.trim() || 'PageMate Archive', name + ' (web page ' + stamp + ')']) : '';
    const zipEntries = [];
    let fileCount = 0;
    const put = async (path, data) => {
      fileCount++;
      if (useFolder) {
        // The Blob needs its real type: with none, the browser decides the file is plain text and renames it ".txt".
        const type = FILE_TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
        await M.saveBlob(data instanceof Blob && data.type ? data : new Blob([data], { type }), dir + '/' + path, { useDownloads: true });
      } else zipEntries.push({ name: name + '/' + path, data });
    };
    const pad = (n, w) => String(n).padStart(w, '0');

    // images
    const imgMap = new Map();
    let imgCount = 0;
    if (o.images) {
      for (const src of imageSources(model, o.videos === 'links')) {
        const e = state.images.get(src);
        if (!e) continue;
        const path = 'images/img-' + pad(++imgCount, 3) + '.' + e.ext;
        await put(path, e.bytes);
        imgMap.set(src, { url: path });
      }
    }

    // videos
    const videoFiles = new Map();
    const failed = [];
    const blocks = o.videos === 'none' || o.htmlVideos !== 'embed' ? [] : videoBlocks(model);
    let totalBytes = 0;
    if (blocks.length) {
      docStatus('Looking for the video files…');
      await ensureVideoItems();
    }
    for (const [i, b] of blocks.entries()) {
      const label = 'Video ' + (i + 1) + ' of ' + blocks.length;
      const title = b.title || 'Video ' + (i + 1);
      const cands = matchVideoItems(b);
      let lastErr = '';
      for (const it of cands) {
        try {
          docStatus(label + ': downloading…');
          const { blob, ext } = await getVideoBlob(it, signal, (frac, txt) => docStatus(label + ': downloading ' + Math.round(frac * 100) + '% (' + txt + ')'));
          if (!useFolder && totalBytes + blob.size > MAX_ZIP_BYTES) throw new Error('too big for one .zip — choose “A folder in Downloads”');
          totalBytes += blob.size;
          const vpath = 'videos/' + pad(i + 1, 2) + '-' + M.sanitizeName(title, 'video', 60) + '.' + ext;
          await put(vpath, blob);
          const tracks = [];
          for (const t of it.tracks || []) {
            if (!/^(subtitles|captions)$/.test(t.kind || 'subtitles')) continue;
            try {
              const text = await M.fetchText(t.src, { signal });
              if (/^\uFEFF?WEBVTT/.test(text)) tracks.push({ src: 'data:text/vtt;charset=utf-8,' + encodeURIComponent(text), lang: t.lang, label: t.label });
            } catch (e) { if (e.name === 'AbortError') throw e; }
          }
          videoFiles.set(b, { path: vpath, type: MEDIA_TYPES[ext], audio: AUDIO_EXT.has(ext) || !!b.audio, tracks });
          lastErr = '';
          break;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          lastErr = /Failed to fetch|NetworkError|Load failed/i.test(e.message || '') ? 'the video server couldn’t be reached, or it needs the page’s own login (play it on the page, then “Re-read the page”)' : errText(e);
        }
      }
      if (!videoFiles.has(b)) failed.push(title + ' — ' + (lastErr || 'no downloadable file found (play it on the page, then use “Re-read the page”)'));
    }

    // the page itself
    docStatus('Writing the page…');
    // An inert document: relative image / video paths in it must not be fetched from this extension page.
    const inert = document.implementation.createHTMLDocument('');
    const article = KRRender.renderDocument(model, { images: o.images ? imgMap : null, videos: o.videos, videoFiles, meta: o.meta, savedAt }, inert);
    let notesPlaced = null;
    if (o.notes) {
      // Time notes link to the local copy of the video when it was downloaded.
      const mediaLink = (src, t) => {
        if (!src) return '';
        for (const [b, f] of videoFiles) if (b.src && keyOf(b.src) === keyOf(src)) return f.path + '#t=' + Math.floor(t);
        return KNCore.timeUrl(src, t);
      };
      notesPlaced = KNDom.applyNotes(article, state.notesPage, KNCore, { mediaLink });
    }
    const css = await (await fetch(chrome.runtime.getURL('doc.css'))).text();
    const lang = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(model.lang || '') ? model.lang : 'en';
    // The saved page can't run scripts or contact anyone: it only reads its own images and videos.
    const csp = "default-src 'none'; img-src 'self' data:; media-src 'self' data:; style-src 'unsafe-inline'";
    const html = '<!doctype html>\n<html lang="' + lang + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '"><title>' + escHtml(model.title || 'Saved page') + '</title><style>' + css +
      '\nbody{margin:0;background:#eef1f1}.kr-page{max-width:8.5in;margin:0 auto;padding:.7in .8in;background:#fff;min-height:100vh;box-sizing:border-box}' +
      '@media(max-width:700px){.kr-page{padding:.4in .25in}}</style></head><body><main class="kr-page">' + article.outerHTML + '</main></body></html>\n';
    await put('index.html', html);

    let where;
    if (useFolder) {
      where = 'Downloads / ' + dir;
    } else {
      docStatus('Packing the .zip…');
      const zip = await KRZip.createZip(zipEntries, { date: savedAt });
      await M.saveBlob(zip, name + '.zip', { useDownloads: state.downloads });
      where = name + '.zip';
    }
    const parts = [fileCount + ' files', imgCount + ' image' + (imgCount === 1 ? '' : 's')];
    if (notesPlaced) parts.push(notesPlaced.placed + ' of ' + notesPlaced.total + ' highlights marked');
    if (blocks.length) parts.push(videoFiles.size + ' of ' + blocks.length + ' video' + (blocks.length === 1 ? '' : 's') + ' playable (' + M.fmtBytes(totalBytes) + ')');
    docStatus('Saved to ' + where + ' — ' + parts.join(', ') + '. Open index.html.' +
      (failed.length ? ' Kept as links: ' + failed.join('; ') : ''), failed.length ? 'err' : 'ok');
  }

  async function printPdf(name) {
    const article = $('paper').firstElementChild;
    if (!article || !article.classList.contains('kr-doc')) throw new Error('Nothing to print yet.');
    const root = $('printRoot');
    const copy = article.cloneNode(true);
    root.replaceChildren(copy);
    await Promise.all([...copy.querySelectorAll('img')].map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    const oldTitle = document.title;
    document.title = name; // becomes the suggested PDF file name
    const restore = () => { document.title = oldTitle; root.replaceChildren(); window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    docStatus('In the print window, set Destination to “Save as PDF”.');
    await sleep(50);
    window.print();
  }

  // ---------- videos ----------

  const MEDIA_KEY = 'krMedia';
  const rowMaps = { video: new Map(), audio: new Map() };   // item key -> row, per tab
  const AUDIO_URL = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
  const isAudioItem = it => !!it.audio || /^audio\//i.test(it.mime || '') || AUDIO_URL.test(it.url);
  let items = [];
  let lastFrames = [];
  let scanning = false;
  let braveName = 'chrome';

  const keyOf = url => url.split('#')[0];
  const kalturaManifest = k => 'https://cdnapisec.kaltura.com/p/' + k.pid + '/sp/' + k.pid + '00/playManifest/entryId/' + encodeURIComponent(k.entry) + '/format/applehttp/protocol/https/a.m3u8';

  function buildItems(frames, sniffed, tab) {
    const map = new Map();
    const add = it => {
      const k = keyOf(it.url);
      const ex = map.get(k);
      if (!ex) { map.set(k, { ...it, tracks: it.tracks || [] }); return; }
      for (const f of ['poster', 'title', 'duration', 'elementId', 'size', 'mime', 'referer', 'at', 'kaltura']) if (!ex[f] && it[f]) ex[f] = it[f];
      if (ex.frameId == null && it.frameId != null) ex.frameId = it.frameId;
      if (it.tracks && it.tracks.length && !ex.tracks.length) ex.tracks = it.tracks;
    };
    const pageTitle = (tab && tab.title) || '';
    const blobVideos = []; // elements with no direct address (MSE / blob:)

    for (const f of frames) {
      for (const v of f.videos) {
        const urls = [...new Set([v.current, ...v.sources.map(s => s.src)].filter(Boolean))];
        for (const u of urls) {
          const type = (v.sources.find(s => s.src === u) || {}).type || '';
          add({ url: u, kind: M.kindOfUrl(u, type), mime: type, title: v.label || f.title || pageTitle, poster: v.poster, duration: v.duration,
            frameId: f.frameId, frameUrl: f.url, elementId: v.id, audio: v.audio, tracks: v.tracks, from: 'page' });
        }
        if (!urls.length) blobVideos.push({ f, v });
      }
    }
    for (const f of frames) {
      for (const l of f.audioLinks || []) {
        add({ url: l.url, kind: 'file', mime: '', title: l.text || f.title || pageTitle, frameId: f.frameId, frameUrl: f.url, elementId: l.id, audio: true, from: 'page' });
      }
    }
    for (const s of sniffed) {
      add({ url: s.url, kind: s.kind, size: s.size, mime: s.mime, frameId: s.frameId, referer: s.referer, at: s.at, title: '', from: 'network' });
    }
    // Kaltura "click to start" players have no <video> until played. The public play-manifest address
    // for the entry usually works, so offer it up front; a stream actually seen on the network replaces it.
    for (const f of frames) {
      for (const k of f.kaltura || []) {
        if ([...map.values()].some(it => it.from === 'network' && it.url.includes(k.entry))) continue;
        add({ url: kalturaManifest(k), kind: 'hls', title: k.title || f.title || pageTitle, poster: k.poster, frameId: f.frameId,
          frameUrl: f.url, elementId: k.id, kaltura: true, from: 'guess' });
      }
    }
    // A video that plays from a blob: has no address of its own; pair it with the streams seen in its frame.
    for (const { f, v } of blobVideos) {
      const mine = [...map.values()].filter(it => it.frameId === f.frameId && !it.elementId);
      for (const it of mine) {
        it.elementId = v.id; it.poster = it.poster || v.poster; it.duration = it.duration || v.duration;
        it.title = it.title || v.label || f.title; it.tracks = it.tracks.length ? it.tracks : v.tracks;
        it.frameUrl = f.url; it.audio = v.audio;
      }
    }
    // The tab may itself be a bare media file.
    if (tab && tab.url && /\.(mp4|m4v|webm|mov|mp3|m4a)(\?|#|$)/i.test(tab.url)) {
      add({ url: tab.url, kind: 'file', title: tab.title, frameId: 0, frameUrl: tab.url, from: 'page' });
    }

    const list = [...map.values()];
    list.forEach(it => {
      it.title = (it.title || '').trim() || pageTitle || 'video';
      it.referer = it.referer || it.frameUrl || (tab && tab.url) || '';
      try {
        const r = new URL(it.referer);
        // Only an origin ("https://host") is known: use the page address instead when it is the same site.
        if ((r.pathname === '/' || r.pathname === '') && !r.search && tab && tab.url && new URL(tab.url).origin === r.origin) it.referer = tab.url;
      } catch (_) {}
    });
    // Things on the page first, then streams newest-first.
    list.sort((a, b) => (b.elementId ? 1 : 0) - (a.elementId ? 1 : 0) || (b.at || 0) - (a.at || 0));
    return list;
  }

  async function readSniffed() {
    try {
      const r = await chrome.storage.session.get(MEDIA_KEY);
      return ((r[MEDIA_KEY] || {})[tabId]) || [];
    } catch (_) { return []; }
  }

  async function scanVideos({ quiet = false } = {}) {
    if (scanning) return;
    scanning = true;
    $('rescan').disabled = true; $('rescanAudio').disabled = true;
    if (!quiet) { vidStatus('Looking for videos…'); audStatus('Looking for audio…'); }
    let problem = '';
    try {
      await inject(true);
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => window.__krExtract.scanVideos() });
      lastFrames = results.filter(r => r && r.result).map(r => ({ frameId: r.frameId, ...r.result }));
    } catch (e) {
      problem = pageError(e);
      lastFrames = [];
    }
    scanning = false;
    $('rescan').disabled = false; $('rescanAudio').disabled = false;
    await refreshItems(problem);
  }

  async function refreshItems(problem = '') {
    const sniffed = await readSniffed();
    items = buildItems(lastFrames, sniffed, state.tab);
    await setupReferers();
    renderItems();
    const vids = items.filter(it => !isAudioItem(it)).length;
    const auds = items.filter(isAudioItem).length;
    if (problem && !items.length) { vidStatus(problem, 'err'); audStatus(problem, 'err'); }
    else {
      vidStatus(vids ? vids + ' video file' + (vids > 1 ? 's' : '') + '/stream' + (vids > 1 ? 's' : '') + ' found.' : '');
      audStatus(auds ? auds + ' audio file' + (auds > 1 ? 's' : '') + ' found' + (vids ? ', plus ' + vids + ' video' + (vids > 1 ? 's' : '') + ' you can save as sound only.' : '.')
        : vids ? 'No separate audio files found — but you can save the sound from ' + (vids > 1 ? 'any of these ' + vids + ' videos.' : 'this video.') : '');
    }
    renderTip($('vidTip'), vids, !!problem, 'video');
    renderTip($('audTip'), items.length, !!problem, 'audio');
  }

  function renderTip(tip, n, problem, noun) {
    tip.replaceChildren();
    if (n) return;
    const intro = el('div', '', problem ? 'Couldn’t scan the page. ' : 'No downloadable ' + noun + ' found yet.');
    const ul = el('ul');
    const li = t => { const x = el('li'); x.textContent = t; ul.appendChild(x); };
    li('Press play on the ' + noun + ', wait a few seconds, then press “Rescan page”. Players load the file only once you start it.');
    if (!state.hosts) li('Click Allow above — without it the extension can’t see the page’s video requests.');
    else li('If it started playing before access was allowed, reload the page, press play, and rescan.');
    li('Media protected with DRM (a licence-key system, used by some paid streaming services) can’t be saved by this tool.');
    tip.append(intro, ul);
  }

  async function setupReferers() {
    await M.setReferers('media', items.map(it => ({ url: it.url, referer: it.referer })));
  }

  function folderPath(it) {
    const base = $('folder').value.trim() || 'PageMate Archive';
    const parts = [base];
    if ($('byPage').checked) parts.push((state.tab && state.tab.title) || 'page');
    return M.sanitizePath(parts);
  }

  function renderItems() {
    const vids = items.filter(it => !isAudioItem(it));
    // Audio tab: real audio files first, then every video (offered as "sound only").
    renderList('video', $('vlist'), vids);
    renderList('audio', $('alist'), [...items.filter(isAudioItem), ...vids]);
    if (params.get('src')) markTarget();
  }

  function renderList(mode, container, list) {
    const map = rowMaps[mode];
    const want = new Set();
    for (const it of list) {
      const k = keyOf(it.url);
      want.add(k);
      let row = map.get(k);
      if (!row) { row = makeRow(it, mode); map.set(k, row); }
      else row.update(it);
      container.appendChild(row.el); // appending an existing node moves it: keeps order, keeps state
    }
    for (const [k, row] of map) {
      if (!want.has(k) && !row.busy) { row.el.remove(); map.delete(k); }
    }
  }

  function markTarget() {
    const view = params.get('view');
    if (view === 'image') return;
    const map = view === 'audio' ? rowMaps.audio : rowMaps.video;
    const src = params.get('src');
    const frame = params.get('frame');
    let hit = null;
    for (const [k, row] of map) {
      row.el.classList.remove('target');
      if (src && k === keyOf(src)) hit = hit || row;
    }
    if (!hit && frame != null) {
      for (const row of map.values()) if (String(row.item.frameId) === frame) { hit = row; break; }
    }
    if (hit) { hit.el.classList.add('target'); hit.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  function typeLabel(it, mode) {
    const audio = isAudioItem(it);
    if (mode === 'audio' && !audio) return it.kind === 'hls' ? 'Video stream → sound only' : 'Video → sound only';
    return it.kind === 'hls' ? (audio ? 'Audio stream (HLS)' : 'Stream (HLS)') : it.kind === 'dash' ? 'Stream (DASH)' : (audio ? 'Audio file' : 'Video file');
  }

  function hostOf(u) { try { return new URL(u).hostname; } catch (_) { return ''; } }

  function makeRow(initial, mode = 'video') {
    let it = initial;
    const extract = () => mode === 'audio' && !isAudioItem(it); // pull the sound out of a video
    const root = el('div', 'card vrow');
    const thumb = el('div', 'thumb', mode === 'audio' ? '🔊' : '▶');
    const main = el('div', 'vmain');
    const name = el('input'); name.type = 'text'; name.spellcheck = false;
    name.setAttribute('aria-label', 'File name');
    const meta = el('div', 'vmeta');
    const btns = el('div', 'vbtns');
    const quality = el('select'); quality.hidden = true; quality.setAttribute('aria-label', 'Quality');
    const dl = el('button', '', 'Download');
    const cancel = el('button', 'ghost small', 'Cancel'); cancel.hidden = true;
    const locate = el('button', 'ghost small', 'Show on page');
    const copy = el('button', 'ghost small', 'Copy link');
    const ytdlp = el('button', 'ghost small', 'Copy yt-dlp command');
    const subsLabel = el('label', 'choice'); const subs = el('input'); subs.type = 'checkbox'; subs.checked = true;
    subsLabel.append(subs, el('span', '', 'Also save subtitles'));
    subsLabel.hidden = true; subsLabel.style.padding = '0';
    const bar = el('div', 'bar'); const fill = el('div'); bar.appendChild(fill);
    const note = el('div', 'vnote');
    btns.append(dl, quality, cancel, locate, copy, ytdlp, subsLabel);
    main.append(name, meta, btns, bar, note);
    root.append(thumb, main);

    const row = { el: root, item: it, busy: false, hls: null, ctrl: null };

    const setNote = (t, kind = '') => { note.textContent = ''; note.className = 'vnote' + (kind ? ' ' + kind : ''); if (t) note.append(...[].concat(t)); };
    const progress = frac => { bar.classList.add('on'); fill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; };
    const busy = on => {
      row.busy = on; dl.disabled = on; cancel.hidden = !on; quality.disabled = on; name.disabled = on;
      if (!on) bar.classList.remove('on');
    };

    row.update = next => {
      it = row.item = next;
      if (!name.value) name.value = M.sanitizeName(it.title, 'video');
      if (it.poster && !thumb.firstChild.tagName) { const img = el('img'); img.src = it.poster; img.alt = ''; img.referrerPolicy = 'no-referrer'; thumb.replaceChildren(img); }
      thumb.title = it.title;
      const tags = [];
      meta.replaceChildren();
      const tag = t => { const s = el('span', 'tag', t); meta.appendChild(s); };
      tag(typeLabel(it, mode));
      if (it.duration) tag(M.fmtDuration(it.duration));
      if (it.size) tag(M.fmtBytes(it.size));
      if (row.hls && row.hls.duration) tag(M.fmtDuration(row.hls.duration));
      meta.append(hostOf(it.url));
      subsLabel.hidden = mode === 'audio' || !(it.tracks && it.tracks.length);
      if (it.kind !== 'dash') dl.textContent = extract() ? 'Save sound only (.m4a)' : 'Download';
      locate.hidden = !(it.elementId && it.frameId != null);
      ytdlp.hidden = false;
      if (it.kind === 'dash') { dl.disabled = true; dl.textContent = 'Not supported'; }
    };
    row.update(it);

    locate.addEventListener('click', async () => {
      try {
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [it.frameId] }, func: id => window.__krExtract && window.__krExtract.locate(id), args: [it.elementId] });
        await chrome.tabs.update(tabId, { active: true });
      } catch (e) { setNote('Couldn’t find it on the page: ' + errText(e), 'err'); }
    });
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(it.url); setNote('Link copied.', 'ok'); } catch (e) { setNote(errText(e), 'err'); } });
    ytdlp.addEventListener('click', async () => {
      const cmd = 'yt-dlp' + (mode === 'audio' ? ' -x' : '') + ' --cookies-from-browser ' + braveName + (it.referer ? ' --referer ' + shQuote(it.referer) : '') + ' ' + shQuote(it.url);
      try { await navigator.clipboard.writeText(cmd); setNote(['Copied. Run it in a terminal with ', el('code', '', 'yt-dlp'), ' installed (it reuses your browser’s login).'], 'ok'); }
      catch (e) { setNote(errText(e), 'err'); }
    });
    cancel.addEventListener('click', () => { if (row.ctrl) row.ctrl.abort(); });

    // HLS: read the playlist now so we can show qualities, length and DRM status up front.
    const loadHls = async () => {
      try {
        const text = await M.fetchText(it.url);
        const pl = KRHls.parsePlaylist(text, it.url);
        row.hls = pl;
        if (pl.type === 'master') {
          quality.replaceChildren();
          for (const [i, v] of pl.variants.entries()) {
            const o = el('option', '', (v.height ? v.height + 'p' : 'Stream ' + (i + 1)) + (v.bandwidth ? ' · ' + Math.round(v.bandwidth / 1000) + ' kbps' : ''));
            o.value = String(i); quality.appendChild(o);
          }
          quality.hidden = mode === 'audio' || pl.variants.length < 2;
        } else {
          row.hls.duration = pl.duration;
        }
        if (pl.drm) { setNote('This stream is DRM-protected, so it can’t be saved here.', 'err'); dl.disabled = true; }
        else if (pl.type === 'media' && !pl.endList) setNote('This looks like a live stream that hasn’t ended.', 'err');
        row.update(it);
      } catch (e) {
        if (it.kaltura) setNote('Kaltura wouldn’t give out this video’s address without the page’s own session. Click play on the video in the page, wait a few seconds, then press “Rescan page” — the real address is picked up while it plays (needs access allowed above).', 'err');
        else setNote('Couldn’t read the stream’s playlist (' + errText(e) + '). You can still try Download.', 'err');
      }
    };
    if (it.kind === 'hls') loadHls();
    if (it.kind === 'dash') setNote(['This is a DASH stream (.mpd), which this version can’t assemble. Use “Copy yt-dlp command” instead.'], '');

    dl.addEventListener('click', async () => {
      row.ctrl = new AbortController();
      busy(true);
      setNote('Starting…');
      progress(0);
      try {
        const base = M.sanitizeName(name.value, 'video');
        const dir = folderPath(it);
        const opts = { audioOnly: extract(), audioMode: mode === 'audio' };
        const out = it.kind === 'hls' ? await downloadHls(it, row, base, dir, quality, row.ctrl.signal, { progress, setNote }, opts)
          : await downloadFile(it, base, dir, row.ctrl.signal, { progress, setNote }, opts);
        if (mode !== 'audio' && subs.checked && it.tracks.length) await downloadTracks(it, base, dir, row.ctrl.signal);
        setNote(out + (state.downloads ? ' — in your Downloads folder.' : ''), 'ok');
        progress(1);
      } catch (e) {
        setNote(errText(e), e.name === 'AbortError' ? '' : 'err');
      } finally {
        busy(false);
        row.ctrl = null;
      }
    });

    return row;
  }

  async function downloadFile(it, base, dir, signal, ui, opts = {}) {
    if (opts.audioOnly) {
      // Take the sound track out of a video file, without re-encoding it.
      const { blob } = await M.fetchBlob(it.url, { signal, onProgress: p => { if (p.total) ui.progress(0.8 * p.bytes / p.total); ui.setNote('Downloading… ' + M.fmtBytes(p.bytes) + (p.total ? ' of ' + M.fmtBytes(p.total) : '')); } });
      ui.setNote('Extracting the sound…');
      const r = await KRMux.toMp4(blob, { audioOnly: true, onProgress: p => ui.progress(0.8 + 0.2 * p) });
      await M.saveBlob(r.blob, dir + '/' + base + '.m4a', { useDownloads: state.downloads });
      return 'Saved ' + base + '.m4a (sound only, no quality change)';
    }
    const ext = M.guessExt(it.url, it.mime);
    const filename = dir + '/' + base + '.' + ext;
    if (state.downloads) {
      try {
        ui.setNote('Downloading…');
        await M.downloadUrl(it.url, filename, { signal, onProgress: p => { if (p.total) { ui.progress(p.bytes / p.total); ui.setNote('Downloading… ' + M.fmtBytes(p.bytes) + ' of ' + M.fmtBytes(p.total)); } else ui.setNote('Downloading… ' + M.fmtBytes(p.bytes)); } });
        return 'Saved ' + base + '.' + ext;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        ui.setNote('The browser’s own download failed (' + errText(e) + '). Trying another way…');
      }
    }
    const { blob, mime } = await M.fetchBlob(it.url, { signal, onProgress: p => { if (p.total) ui.progress(p.bytes / p.total); ui.setNote('Downloading… ' + M.fmtBytes(p.bytes) + (p.total ? ' of ' + M.fmtBytes(p.total) : '')); } });
    const ext2 = M.guessExt(it.url, mime || it.mime);
    await M.saveBlob(blob, dir + '/' + base + '.' + ext2, { useDownloads: state.downloads });
    return 'Saved ' + base + '.' + ext2;
  }

  async function downloadHls(it, row, base, dir, qualitySelect, signal, ui, opts = {}) {
    const audioOnly = !!opts.audioOnly;
    const convertOn = () => audioOnly || $('convert').checked;
    let pl = row.hls;
    if (!pl) pl = KRHls.parsePlaylist(await M.fetchText(it.url, { signal }), it.url);
    let audio = null;
    let mediaPl = pl;
    let label = '';
    if (pl.type === 'master') {
      if (pl.drm) throw new KRHls.HlsError('This stream is DRM-protected, so it can’t be saved here.', 'drm');
      const v = pl.variants[Number(qualitySelect.value) || 0] || pl.variants[0];
      if (!v) throw new Error('The stream lists no video qualities.');
      audio = KRHls.audioFor(pl, v);
      if (audioOnly && audio) {
        // The stream keeps its sound separately: fetch only that, not the video.
        mediaPl = KRHls.parsePlaylist(await M.fetchText(audio.uri, { signal }), audio.uri);
        audio = null;
      } else {
        mediaPl = KRHls.parsePlaylist(await M.fetchText(v.uri, { signal }), v.uri);
        label = v.height ? ' (' + v.height + 'p)' : '';
      }
    }
    const io = { fetch: (u, o) => M.fetchBuffer(u, { ...o, signal }) };
    const part = async (playlist, suffix, from, to, what) => {
      const span = to - from;
      const dlShare = convertOn() ? 0.8 : 1; // leave room for the conversion step
      const r = await KRHls.downloadMedia(playlist, io, {
        signal,
        onProgress: p => { ui.progress(from + span * dlShare * (p.done / p.total)); ui.setNote(what + ': piece ' + p.done + ' of ' + p.total + ' · ' + M.fmtBytes(p.bytes)); }
      });
      let blob = r.blob, ext = r.ext, converted = false, why = '';
      if (convertOn()) {
        try {
          ui.setNote(audioOnly ? 'Extracting the sound…' : 'Converting to MP4…');
          blob = (await KRMux.toMp4(r.blob, { audioOnly, onProgress: p => ui.progress(from + span * (dlShare + (1 - dlShare) * p)) })).blob;
          ext = audioOnly ? 'm4a' : 'mp4'; converted = true;
        } catch (e) {
          if (audioOnly) throw e;    // no point saving the whole video when only sound was asked for
          why = errText(e);          // otherwise keep the original download
        }
      }
      await M.saveBlob(blob, dir + '/' + base + suffix + '.' + ext, { useDownloads: state.downloads });
      return { ext, converted, why };
    };
    const video = await part(mediaPl, '', 0, audio ? 0.85 : 1, 'Downloading');
    let msg = 'Saved ' + base + label + '.' + video.ext + (video.converted ? (audioOnly ? ' (sound only, no quality change)' : ' (converted to MP4, no quality change)') : '');
    if (video.why) msg += ' — couldn’t convert to MP4: ' + video.why;
    if (audio) {
      const aPl = KRHls.parsePlaylist(await M.fetchText(audio.uri, { signal }), audio.uri);
      const a = await part(aPl, ' (audio)', 0.85, 1, 'Downloading audio');
      msg += ' and ' + base + ' (audio).' + a.ext + ' — this stream keeps sound in a separate file; combine them with: ffmpeg -i ' +
        shQuote(base + '.' + video.ext) + ' -i ' + shQuote(base + ' (audio).' + a.ext) + ' -c copy ' + shQuote(base + ' merged.mp4');
    } else if (video.ext === 'ts') {
      msg += ' (a .ts file plays in VLC / mpv; to convert: ffmpeg -i ' + shQuote(base + '.ts') + ' -c copy ' + shQuote(base + '.mp4') + ')';
    }
    return msg;
  }

  async function downloadTracks(it, base, dir, signal) {
    let n = 0;
    for (const t of it.tracks) {
      try {
        const text = await M.fetchText(t.src, { signal });
        const lang = M.sanitizeName(t.lang || t.label || String(++n), 'sub', 20);
        await M.saveBlob(new Blob([text], { type: 'text/vtt' }), dir + '/' + base + '.' + lang + '.vtt', { useDownloads: state.downloads });
      } catch (e) { if (e.name === 'AbortError') throw e; }
    }
  }

  // ---------- images tab ----------

  const imgState = { items: [], tiles: new Map(), selected: new Set(), scanned: false, ctrl: null, busy: false };
  const THUMB_CONCURRENCY = 4;
  let thumbActive = 0;
  const thumbQueue = [];

  function runThumb(fn) {
    return new Promise(resolve => {
      const go = async () => { thumbActive++; try { resolve(await fn()); } catch (_) { resolve(null); } finally { thumbActive--; if (thumbQueue.length) thumbQueue.shift()(); } };
      thumbActive < THUMB_CONCURRENCY ? go() : thumbQueue.push(go);
    });
  }

  const widthOf = im => im.mw || im.w || im.rw || 0;
  const fileBase = im => {
    if (im.alt) return M.sanitizeName(im.alt, 'image', 50);
    try { return M.sanitizeName(decodeURIComponent(new URL(im.dl).pathname.split('/').pop()).replace(/\.[a-z0-9]{2,5}$/i, ''), 'image', 50); } catch (_) { return 'image'; }
  };

  async function scanImagesTab() {
    $('rescanImg').disabled = true;
    imgStatus('Looking for images…');
    let frames = [];
    let problem = '';
    try {
      await inject(true);
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => window.__krExtract.scanImages() });
      frames = results.filter(r => r && r.result).map(r => ({ frameId: r.frameId, ...r.result }));
    } catch (e) { problem = pageError(e); }

    const map = new Map();
    for (const f of frames) {
      for (const im of f.images) {
        const ex = map.get(im.url);
        if (!ex) { map.set(im.url, { ...im, frameId: f.frameId, frameUrl: f.url }); continue; }
        if (!ex.full && im.full) ex.full = im.full;
        if (!ex.alt && im.alt) ex.alt = im.alt;
        if ((im.w || 0) > (ex.w || 0)) { ex.w = im.w; ex.h = im.h; }
        if (!ex.id && im.id) { ex.id = im.id; ex.frameId = f.frameId; }
      }
    }
    imgState.items = [...map.values()].map(im => ({ ...im, dl: im.full || im.url, referer: im.frameUrl || (state.tab && state.tab.url) || '' }));
    const pairs = [];
    for (const im of imgState.items) for (const u of [im.url, im.full]) if (u && /^https?:/i.test(u)) pairs.push({ url: u, referer: im.referer });
    await M.setReferers('images', pairs);
    $('rescanImg').disabled = false;
    renderImages(problem);
  }

  function renderImages(problem = '') {
    const grid = $('igrid');
    const want = new Set();
    for (const im of imgState.items) {
      want.add(im.url);
      let tile = imgState.tiles.get(im.url);
      if (!tile) { tile = makeTile(im); imgState.tiles.set(im.url, tile); }
      grid.appendChild(tile.el);
    }
    for (const [u, tile] of imgState.tiles) if (!want.has(u)) { tile.el.remove(); imgState.tiles.delete(u); imgState.selected.delete(u); }
    applyImageFilter();
    const tip = $('imgTip');
    tip.replaceChildren();
    if (!imgState.items.length) {
      imgStatus(problem || '', problem ? 'err' : '');
      tip.textContent = problem ? 'Couldn’t scan the page.' : 'No images found on this page.';
    }
    if (params.get('view') === 'image' && params.get('src')) markImageTarget();
  }

  function applyImageFilter() {
    const min = Number($('imgMin').value) || 0;
    const q = $('imgFilter').value.trim().toLowerCase();
    let shown = 0;
    for (const tile of imgState.tiles.values()) {
      const im = tile.item;
      const w = widthOf(im);
      const small = min && w && w < min;
      const miss = q && !((im.alt || '') + ' ' + im.dl).toLowerCase().includes(q);
      tile.el.hidden = !!(small || miss);
      if (!tile.el.hidden) shown++;
    }
    if (imgState.items.length) imgStatus(shown + ' of ' + imgState.items.length + ' image' + (imgState.items.length === 1 ? '' : 's') + ' shown.' +
      (min && shown < imgState.items.length ? ' Smaller ones are hidden: change “Show images at least”.' : ''));
    updateImageSelection();
  }

  function updateImageSelection() {
    const n = [...imgState.selected].filter(u => imgState.tiles.get(u) && !imgState.tiles.get(u).el.hidden).length;
    $('imgSave').textContent = 'Download selected (' + n + ')';
    $('imgSave').disabled = !n || imgState.busy;
  }

  const imgObserver = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { imgObserver.unobserve(e.target); const t = imgState.tiles.get(e.target.dataset.url); if (t) t.load(); } }, { rootMargin: '300px' })
    : null;

  function makeTile(im) {
    const tile = { item: im, entry: null };
    const root = el('div', 'itile');
    root.dataset.url = im.url;
    const thumb = el('div', 'ithumb', 'Loading…');
    const cb = el('input'); cb.type = 'checkbox'; cb.setAttribute('aria-label', 'Select ' + (im.alt || 'image'));
    const meta = el('div', 'imeta');
    const btns = el('div', 'ibtns');
    const save = el('button', 'small', 'Save');
    const locate = el('button', 'ghost small', 'Show on page');
    locate.hidden = !im.id;
    btns.append(save, locate);
    root.append(thumb, meta, btns);

    const describe = () => {
      meta.replaceChildren();
      const dims = tile.entry ? tile.entry.w + ' × ' + tile.entry.h : (im.w ? im.w + ' × ' + im.h : '');
      const kind = im.full ? 'full size available' : im.kind === 'bg' ? 'background' : im.kind === 'meta' ? 'preview image' : '';
      const b = el('b', '', fileBase(im));
      meta.append(b, el('br'), [dims, tile.entry ? tile.entry.ext.toUpperCase() : '', tile.entry ? M.fmtBytes(tile.entry.bytes.length) : '', kind].filter(Boolean).join(' · '));
    };
    describe();

    const setSelected = on => {
      cb.checked = on;
      root.classList.toggle('sel', on);
      on ? imgState.selected.add(im.url) : imgState.selected.delete(im.url);
      updateImageSelection();
    };
    tile.setSelected = setSelected;
    thumb.append(cb);
    thumb.addEventListener('click', e => { if (e.target !== cb) cb.checked = !cb.checked; setSelected(cb.checked); });
    cb.addEventListener('change', () => setSelected(cb.checked));

    tile.load = () => runThumb(async () => {
      if (tile.entry) return;
      const entry = await prepareImage(im.url);
      if (!entry) { thumb.firstChild.textContent = 'Couldn’t load'; return; }
      tile.entry = entry.bytes.length <= 8 * 1024 * 1024 ? entry : { ...entry, bytes: new Uint8Array(0) };
      tile.fullBytes = entry.bytes.length <= 8 * 1024 * 1024;
      im.mw = entry.w; im.mh = entry.h;
      const img = document.createElement('img');
      img.src = entry.url; img.alt = im.alt || '';
      thumb.firstChild.replaceWith(img);
      describe();
      applyImageFilter();
    });
    if (imgObserver) imgObserver.observe(root); else tile.load();

    save.addEventListener('click', () => saveImages([im]));
    locate.addEventListener('click', async () => {
      try {
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [im.frameId] }, func: id => window.__krExtract && window.__krExtract.locate(id), args: [im.id] });
        await chrome.tabs.update(tabId, { active: true });
      } catch (e) { imgStatus('Couldn’t find it on the page: ' + errText(e), 'err'); }
    });
    tile.el = root;
    return tile;
  }

  function markImageTarget() {
    const src = params.get('src');
    for (const tile of imgState.tiles.values()) {
      tile.el.classList.remove('target');
      if (tile.item.url === src || tile.item.dl === src) {
        $('imgMin').value = '0'; applyImageFilter();
        tile.el.classList.add('target'); tile.setSelected(true);
        tile.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
  }

  // The full-size file if the page has one, otherwise the picture as shown.
  async function imageFile(im) {
    for (const src of [...new Set([im.dl, im.url])]) {
      if (src === im.url) { const t = imgState.tiles.get(im.url); if (t && t.entry && t.fullBytes) return { entry: t.entry, own: false }; }
      try { const entry = await prepareImage(src); if (entry) return { entry, own: true }; } catch (_) {}
    }
    return null;
  }

  async function saveImages(list) {
    if (imgState.busy || !list.length) return;
    imgState.busy = true; imgState.ctrl = new AbortController();
    $('imgCancel').hidden = false; updateImageSelection();
    const zip = $('imgPack').value === 'zip' || !state.downloads;
    const dir = folderPath();
    const pageName = M.sanitizeName((state.tab && state.tab.title) || 'page', 'page', 60);
    const entries = [];
    const failed = [];
    const used = new Set();
    let ok = 0;
    try {
      for (const [i, im] of list.entries()) {
        if (imgState.ctrl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        imgStatus('Saving ' + (i + 1) + ' of ' + list.length + '…');
        const got = await imageFile(im);
        if (!got) { failed.push(fileBase(im)); continue; }
        const { entry, own } = got;
        let file = String(i + 1).padStart(3, '0') + '-' + fileBase(im) + '.' + entry.ext;
        while (used.has(file)) file = '_' + file;
        used.add(file);
        // Typed Blob: without the real type the browser may rename the file ".txt".
        const data = new Blob([entry.bytes], { type: entry.mime });
        if (zip) entries.push({ name: pageName + ' images/' + file, data });
        else await M.saveBlob(data, dir + '/' + file, { useDownloads: true });
        ok++;
        if (own) URL.revokeObjectURL(entry.url);
      }
      if (zip && entries.length) {
        const z = await KRZip.createZip(entries, { date: new Date() });
        await M.saveBlob(z, pageName + ' images.zip', { useDownloads: state.downloads });
      }
      imgStatus('Saved ' + ok + ' image' + (ok === 1 ? '' : 's') + (zip ? ' in ' + pageName + ' images.zip' : ' to Downloads / ' + dir) + '.' + (failed.length ? ' Couldn’t load: ' + failed.join(', ') + '.' : ''), failed.length ? 'err' : 'ok');
    } catch (e) {
      imgStatus(e.name === 'AbortError' ? 'Cancelled.' : 'Couldn’t save: ' + errText(e), e.name === 'AbortError' ? '' : 'err');
    } finally {
      imgState.busy = false; imgState.ctrl = null; $('imgCancel').hidden = true; updateImageSelection();
    }
  }


  // ---------- capture & seal (evidence) ----------

  function modelToText(model) {
    const runs = r => r.map(x => (x.br ? '\n' : x.x || '')).join('');
    const out = [];
    const walk = (blocks, pre) => {
      for (const b of blocks) {
        if (b.t === 'h' || b.t === 'p') out.push(pre + runs(b.r));
        else if (b.t === 'quote') walk(b.b, '> ');
        else if (b.t === 'code') out.push(b.text);
        else if (b.t === 'list') b.items.forEach((it, i) => { const start = out.length; walk(it, pre); if (out[start] != null) out[start] = pre + (b.ordered ? (b.start + i) + '. ' : '- ') + out[start].slice(pre.length); });
        else if (b.t === 'table') b.rows.forEach(row => out.push(row.map(c => runs(c.r)).join(' | ')));
        else if (b.t === 'img') out.push('[image: ' + (b.alt || b.src) + ']');
        else if (b.t === 'video') out.push('[video: ' + (b.title || b.src || 'streamed') + ']');
        else if (b.t === 'hr') out.push('----');
        out.push('');
      }
    };
    walk(model.blocks, '');
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  let capturePrepared = false;
  async function prepareCapture() {
    if (capturePrepared) return;
    capturePrepared = true;
    try {
      const prefs = await chrome.storage.sync.get({ capBy: '' });
      $('capBy').value = prefs.capBy;
      const idx = (await chrome.storage.local.get('kn:idx'))['kn:idx'] || {};
      $('capCases').replaceChildren(...[...new Set(Object.values(idx).map(e => e.case).filter(Boolean))].map(c => { const o = el('option'); o.value = c; return o; }));
      if (state.tab && state.tab.url) {
        const key = KNCore.pageKey(state.tab.url);
        const rec = (await chrome.storage.local.get(key))[key];
        if (rec && rec.case) $('capCase').value = rec.case;
        $('capNotes').disabled = !(rec && rec.items && rec.items.length);
        if ($('capNotes').disabled) $('capNotes').checked = false;
      }
    } catch (_) {}
    try { await prepareCaptureExtras(); } catch (_) {}
  }

  const tsaChoice = () => ($('capTsa').value || $('capTsaCustom').value.trim());

  async function prepareCaptureExtras() {
    const prefs = await chrome.storage.sync.get({ capSign: false, capTimestamp: false, tsaUrl: 'https://freetsa.org/tsr', capShot: true });
    $('capSign').checked = !!prefs.capSign; $('capStamp').checked = !!prefs.capTimestamp; $('capShot').checked = prefs.capShot !== false;
    const sel = $('capTsa');
    sel.replaceChildren(...KOTrust.TSA_PRESETS.map(t => { const o = el('option'); o.value = t.url; o.textContent = t.name; return o; }));
    const other = el('option'); other.value = ''; other.textContent = 'Another server…'; sel.append(other);
    const known = KOTrust.TSA_PRESETS.some(t => t.url === prefs.tsaUrl);
    sel.value = known ? prefs.tsaUrl : ''; $('capTsaCustom').value = known ? '' : prefs.tsaUrl;
    const sync = () => { $('capTsaRow').hidden = !$('capStamp').checked; $('capTsaCustom').hidden = sel.value !== ''; };
    $('capStamp').addEventListener('change', sync); sel.addEventListener('change', sync); sync();
    // trail for the case
    const showTrail = async () => {
      const log = (await chrome.storage.local.get('ko:trailLog'))['ko:trailLog'] || [];
      const c = $('capCase').value.trim();
      const rows = c ? log.filter(r => r.case === c) : [];
      $('capTrailRow').hidden = !rows.length;
      $('capTrailInfo').textContent = rows.length + ' page' + (rows.length === 1 ? '' : 's') + ' noted for “' + c + '”';
    };
    $('capCase').addEventListener('input', showTrail); showTrail();
  }

  // A permission request has to come straight from the click, and asking once is friendlier than asking three times.
  async function requestCapturePermissions({ stamp, shot }) {
    const permissions = [], origins = [];
    if (!(await chrome.permissions.contains({ permissions: ['pageCapture'] }).catch(() => false))) permissions.push('pageCapture');
    if (stamp) { const o = new URL(stamp).origin + '/*'; if (!(await chrome.permissions.contains({ origins: [o] }).catch(() => false))) origins.push(o); }
    // a screenshot of a tab that is not the one the user just clicked on needs "all sites" in the form <all_urls>
    if (shot && !(await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false))) origins.push('<all_urls>');
    if (!permissions.length && !origins.length) return true;
    return chrome.permissions.request({ ...(permissions.length ? { permissions } : {}), ...(origins.length ? { origins } : {}) });
  }

  async function pageDetails() {
    const r = await chrome.scripting.executeScript({ target: { tabId }, func: KOPage.collect, args: [{}] });
    const page = r && r[0] && r[0].result;
    if (!page) throw new Error('empty');
    let hdr = null;
    try { const resp = await chrome.runtime.sendMessage({ type: 'ko-get-headers', tabId }); hdr = resp && resp.record; } catch (_) {}
    if (hdr && hdr.url !== page.url) hdr = null;   // it is a different page now
    const K = KOsint;
    const headers = hdr ? hdr.headers : {};
    const ent = K.extract([page.title, page.text, Object.values(page.metas).join('\n'), page.comments.join('\n'), page.hidden.map(x => x.text).join('\n')].join('\n'), { links: page.links });
    const ids = K.extract(page.inline + '\n' + page.scripts.join('\n') + '\n' + page.resources.join('\n')).analyticsId;
    if (ids) ent.analyticsId = ids;
    const details = {
      url: page.url, canonical: page.canonical, title: page.title, language: page.lang, charset: page.charset, referrer: page.referrer, captured_at_utc: page.at,
      response: hdr ? { status: hdr.status, server_ip: hdr.ip, from_cache: hdr.fromCache } : null,
      technologies: K.detectTech({ headers, metas: page.metas, scripts: page.scripts, links: page.styles }),
      security_headers: hdr ? K.securityHeaders(headers) : null,
      other_sites_loaded_from: K.externalHosts(page.url, [...page.scripts, ...page.styles, ...page.frames, ...page.images.map(i => i.src), ...page.resources]),
      metadata: page.metas, structured_data: page.jsonld, forms: page.forms, password_fields: page.passwordFields, cookie_names_readable_by_page: page.cookieNames,
      hidden_text: page.hidden, html_comments: page.comments, link_count: page.links.length, image_count: page.images.length
    };
    return { details, headers: hdr ? { url: hdr.url, status: hdr.status, server_ip: hdr.ip, note: 'Cookie values and credentials are removed.', headers } : null, entitiesCsv: K.entitiesCsv(ent, { url: page.url, title: page.title }), page };
  }

  async function sealCapture() {
    const status = (t, k) => setStatus($('capStatus'), t, k);
    $('capGo').disabled = true;
    $('capResult').hidden = true;
    try {
      const wantStamp = $('capStamp').checked, wantSign = $('capSign').checked, wantShot = $('capShot').checked, wantDetails = $('capDetails').checked;
      const tsa = wantStamp ? tsaChoice() : null;
      if (wantStamp && !/^https?:\/\//i.test(tsa)) throw new Error('Enter the timestamp server’s address.');
      const granted = await requestCapturePermissions({ stamp: tsa, shot: wantShot });
      if (!granted) throw new Error('Permission was not given. Untick the options that need it, or allow it when asked.');
      const warnings = [];
      status('Capturing the page…');
      const when = new Date();
      const mhtml = await chrome.pageCapture.saveAsMHTML({ tabId });
      if (!mhtml || !mhtml.size) throw new Error('The browser returned an empty capture (it can’t capture this kind of page).');

      status('Reading the page text…');
      const extracted = await runExtract('page');
      const model = extracted.model;
      const caseName = $('capCase').value.trim().slice(0, 120);
      const by = $('capBy').value.trim().slice(0, 120);
      const note = $('capNote').value.trim().slice(0, 4000);
      try { chrome.storage.sync.set({ capBy: by, capSign: wantSign, capTimestamp: wantStamp, capShot: wantShot, ...(tsa ? { tsaUrl: tsa } : {}) }); } catch (_) {}

      const files = [
        { name: 'capture.mhtml', data: mhtml, description: 'The page as the browser had it (MHTML single file)' },
        { name: 'page-text.txt', data: 'Source: ' + model.url + '\nTitle: ' + model.title + '\nCaptured (UTC): ' + when.toISOString() + '\n\n' + modelToText(model), description: 'Readable text of the page' }
      ];
      let highlights = 0;
      if ($('capNotes').checked) {
        const key = KNCore.pageKey(model.url);
        const rec = (await chrome.storage.local.get(key))[key];
        if (rec && rec.items && rec.items.length) {
          highlights = rec.items.length;
          const withCase = { ...rec, case: caseName || rec.case || '' };
          files.push({ name: 'notes.md', data: KNCore.toMarkdown(withCase, { exportedAt: when, citation: 'apa' }), description: 'My highlights and notes (Markdown)' });
          files.push({ name: 'notes.json', data: JSON.stringify({ format: 'kokoro-notes', version: 1, exported: when.toISOString(), pages: [rec] }, null, 2), description: 'My highlights and notes (backup format)' });
        }
      }
      if (wantDetails) {
        status('Reading the page’s details…');
        try {
          const d = await pageDetails();
          files.push({ name: 'page-details.json', data: JSON.stringify(d.details, null, 2) + '\n', description: 'Metadata, technologies, other sites loaded from, hidden text, comments' });
          if (d.headers) files.push({ name: 'headers.json', data: JSON.stringify(d.headers, null, 2) + '\n', description: 'Response headers the page was served with (cookie values removed)' });
          else warnings.push('No response headers were noted for this page (reload it with access to sites allowed to get them).');
          files.push({ name: 'entities.csv', data: d.entitiesCsv, description: 'Emails, phone numbers, domains, IPs, handles, hashes… found in the page' });
        } catch (e) { warnings.push('Page details could not be read (' + errText(e) + ').'); }
      }
      if (wantShot) {
        status('Taking a full-page screenshot…');
        try {
          const r = await chrome.runtime.sendMessage({ type: 'ko-shot-evidence', tabId, returnTabId: (await chrome.tabs.getCurrent()).id });
          if (!r || !r.ok) throw new Error((r && r.error) || 'no answer');
          const rec = await KOShotStore.get(r.id);
          await KOShotStore.del(r.id).catch(() => {});
          if (!rec || !rec.blob) throw new Error('the picture was lost');
          files.push({ name: 'screenshot.png', data: rec.blob, description: 'Full-page screenshot as the browser showed it' + (r.truncated ? ' (cut off: the page is taller than a browser can draw)' : '') });
          if (r.truncated) warnings.push('The page is taller than a browser can draw in one image, so the screenshot is cut off.');
        } catch (e) { warnings.push('No screenshot (' + errText(e) + ').'); }
      }
      const archives = ((await chrome.storage.local.get('ko:archives'))['ko:archives'] || {})[model.url.split('#')[0]] || [];
      if ($('capTrail') && $('capTrail').checked && !$('capTrailRow').hidden) {
        const log = (await chrome.storage.local.get('ko:trailLog'))['ko:trailLog'] || [];
        const rows = log.filter(r => r.case === caseName);
        const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        files.push({ name: 'trail.csv', data: 'visited_at_utc,case,url,title\n' + rows.map(r => [r.at, r.case, r.url, r.title].map(cell).join(',')).join('\n') + '\n', description: 'Pages visited for this case (the trail kept in this browser)' });
      }
      const info = { toolVersion: chrome.runtime.getManifest().version, case: caseName, capturedBy: by, capturedAt: when, url: model.url, title: model.title, userAgent: navigator.userAgent, highlights, examinerNote: note, extra: { kind: 'page', ...(archives.length ? { archives } : {}) } };
      const key = wantSign ? await KNSeal.getSigningKey(true) : null;
      const res = await KNSeal.build({ files, info, signing: key, tsaUrl: tsa, onStatus: status });
      warnings.push(...res.warnings);

      const stamp = KNEvidence.utcStamp(when);
      const base = M.sanitizeName('Evidence – ' + (model.title || 'page') + ' – ' + stamp, 'Evidence', 110);
      status('Packing the .zip…');
      const zip = await KNSeal.zipEntries(base, res.entries, when);
      const dir = M.sanitizePath([$('folder').value.trim() || 'PageMate Archive', 'Evidence']);
      await M.saveBlob(zip, dir + '/' + base + '.zip', { useDownloads: state.downloads });

      // running log, kept in this browser
      const log = (await chrome.storage.local.get('kn:seals'))['kn:seals'] || [];
      log.push(KNEvidence.logRow(info, res.manifestHash, base + '.zip'));
      await chrome.storage.local.set({ 'kn:seals': log.slice(-500) });

      $('capHash').textContent = res.manifestHash;
      $('capResult').hidden = false;
      status('Sealed ' + when.toISOString().slice(0, 19) + 'Z' + (res.plan.timestamp ? ' (trusted time ' + res.plan.timestamp.genTime + ')' : '') + (res.plan.signed ? ', signed' : '') + ' — saved ' + (state.downloads ? 'to Downloads / ' + dir + ' / ' : '') + base + '.zip' + (warnings.length ? '. Note: ' + warnings.join(' ') : ''), warnings.length ? 'err' : 'ok');
    } catch (e) {
      status('Couldn’t capture: ' + errText(e), 'err');
    } finally {
      $('capGo').disabled = false;
    }
  }

  $('capGo').addEventListener('click', sealCapture);
  $('capCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('capHash').textContent); $('capCopy').textContent = 'Copied'; setTimeout(() => { $('capCopy').textContent = 'Copy fingerprint'; }, 1500); } catch (_) {} });

  // ---------- tabs / wiring ----------

  const TABS = ['doc', 'video', 'image', 'audio', 'capture'];

  function showTab(which) {
    for (const t of TABS) {
      $('panel-' + t).hidden = t !== which;
      $('tab-' + t).setAttribute('aria-selected', String(t === which));
    }
    $('locBar').hidden = which === 'doc';
    if ((which === 'video' || which === 'audio') && !state.videosScanned) { state.videosScanned = true; scanVideos(); }
    if (which === 'image' && !imgState.scanned) { imgState.scanned = true; scanImagesTab(); }
    if (which === 'capture') prepareCapture();
  }

  async function init() {
    const stored = await chrome.storage.sync.get({ ...SAVE_DEFAULTS, ...KR_DEFAULTS }).catch(() => ({ ...SAVE_DEFAULTS, ...KR_DEFAULTS }));
    state.prefs = { ...SAVE_DEFAULTS, ...stored };
    document.querySelector('input[name="format"][value="' + state.prefs.saveFormat + '"]').checked = true;
    $('optImages').checked = !!state.prefs.saveImages;
    $('optVideos').checked = !!state.prefs.saveVideos;
    $('optMeta').checked = !!state.prefs.saveMeta;
    $('optPaper').value = state.prefs.savePaper;
    $('optMdImages').value = state.prefs.saveMdImages;
    $('optPackage').value = state.prefs.savePackage;
    $('imgPack').value = state.prefs.saveImgPack;
    $('folder').value = stored.saveFolder || 'PageMate Archive';
    $('byPage').checked = !!state.prefs.saveByPage;
    $('convert').checked = !!state.prefs.saveConvert;
    try { if (navigator.brave && (await navigator.brave.isBrave())) braveName = 'brave'; } catch (_) {}

    await M.clearStaleRules();
    await refreshPerms();
    $('imgPack').querySelector('option[value="files"]').disabled = !state.downloads;
    if (!state.downloads) $('imgPack').value = 'zip';

    if (!Number.isInteger(tabId)) { $('source').textContent = 'Open this from the page you want to save (right-click the extension icon, or use the right-click menu on the page).'; return; }
    try {
      state.tab = await chrome.tabs.get(tabId);
      $('source').textContent = (state.tab.title || '') + ' — ' + (state.tab.url || '');
    } catch (_) {
      $('source').textContent = 'The page you came from has been closed. Open the page again and use the extension from there.';
      $('paper').replaceChildren(el('div', 'empty', 'The original page is closed.'));
      return;
    }

    if (params.get('scope') === 'selection') document.querySelector('input[name="scope"][value="selection"]').checked = true;
    try {
      const p = await probe();
      state.selectionChars = (p && p.selectionChars) || 0;
    } catch (_) {}
    const selOk = state.selectionChars > 0;
    $('scopeSelLabel').classList.toggle('disabled', !selOk);
    document.querySelector('input[name="scope"][value="selection"]').disabled = !selOk;
    $('selHint').textContent = selOk ? state.selectionChars.toLocaleString() + ' characters selected' : 'Select text on the page first, then re-read the page';
    if (!selOk) document.querySelector('input[name="scope"][value="page"]').checked = true;

    syncOptionVisibility();
    const view = params.get('view');
    if (TABS.includes(view) && view !== 'doc') showTab(view);
    rebuild();
  }

  // events
  $('tab-doc').addEventListener('click', () => showTab('doc'));
  $('tab-video').addEventListener('click', () => showTab('video'));
  $('tab-image').addEventListener('click', () => showTab('image'));
  $('tab-audio').addEventListener('click', () => showTab('audio'));
  $('tab-capture').addEventListener('click', () => showTab('capture'));
  $('grant').addEventListener('click', requestAccess);
  $('download').addEventListener('click', exportDocument);
  $('cancelDoc').addEventListener('click', () => { if (state.exportCtrl) state.exportCtrl.abort(); });
  $('optHtmlVideos').addEventListener('change', syncOptionVisibility);
  $('optPackage').addEventListener('change', () => savePref({ savePackage: $('optPackage').value }));
  $('rescan').addEventListener('click', () => scanVideos());
  $('rescanAudio').addEventListener('click', () => scanVideos());
  $('rescanImg').addEventListener('click', () => scanImagesTab());
  $('imgMin').addEventListener('change', applyImageFilter);
  $('imgFilter').addEventListener('input', applyImageFilter);
  $('imgAll').addEventListener('click', () => { for (const t of imgState.tiles.values()) if (!t.el.hidden) t.setSelected(true); });
  $('imgNone').addEventListener('click', () => { for (const t of imgState.tiles.values()) t.setSelected(false); });
  $('imgSave').addEventListener('click', () => saveImages(imgState.items.filter(im => imgState.selected.has(im.url) && !imgState.tiles.get(im.url).el.hidden)));
  $('imgCancel').addEventListener('click', () => { if (imgState.ctrl) imgState.ctrl.abort(); });
  $('imgPack').addEventListener('change', () => savePref({ saveImgPack: $('imgPack').value }));
  $('refresh').addEventListener('click', async e => {
    e.preventDefault();
    state.models = {};
    try {
      const p = await probe();
      state.selectionChars = (p && p.selectionChars) || 0;
      const selOk = state.selectionChars > 0;
      $('scopeSelLabel').classList.toggle('disabled', !selOk);
      document.querySelector('input[name="scope"][value="selection"]').disabled = !selOk;
      $('selHint').textContent = selOk ? state.selectionChars.toLocaleString() + ' characters selected' : 'Select text on the page first, then re-read the page';
    } catch (_) {}
    rebuild();
  });

  $('optNotes').addEventListener('change', rebuild);
  const optMap = { optImages: 'saveImages', optVideos: 'saveVideos', optMeta: 'saveMeta' };
  for (const id of Object.keys(optMap)) {
    $(id).addEventListener('change', () => { savePref({ [optMap[id]]: $(id).checked }); rebuild(); });
  }
  $('optPaper').addEventListener('change', () => { savePref({ savePaper: $('optPaper').value }); syncOptionVisibility(); });
  $('optMdImages').addEventListener('change', () => savePref({ saveMdImages: $('optMdImages').value }));
  for (const r of document.querySelectorAll('input[name="format"]')) r.addEventListener('change', () => { savePref({ saveFormat: readOptions().format }); syncOptionVisibility(); });
  for (const r of document.querySelectorAll('input[name="scope"]')) r.addEventListener('change', rebuild);
  $('folder').addEventListener('change', () => { try { chrome.storage.sync.set({ saveFolder: $('folder').value.trim() || 'PageMate Archive' }); } catch (_) {} });
  $('byPage').addEventListener('change', () => savePref({ saveByPage: $('byPage').checked }));
  $('convert').addEventListener('change', () => savePref({ saveConvert: $('convert').checked }));

  // Convert video files that are already on disk (e.g. .ts files from an earlier download).
  $('convertFiles').addEventListener('click', () => $('convertPicker').click());
  $('convertPicker').addEventListener('change', async () => {
    const files = [...$('convertPicker').files];
    $('convertPicker').value = '';
    if (!files.length) return;
    const dir = M.sanitizePath([$('folder').value.trim() || 'PageMate Archive']);
    $('convertFiles').disabled = true;
    let ok = 0;
    const failures = [];
    for (const [i, f] of files.entries()) {
      const prefix = '(' + (i + 1) + '/' + files.length + ') ' + f.name + ': ';
      try {
        vidStatus(prefix + 'converting…');
        const { blob } = await KRMux.toMp4(f, { onProgress: p => vidStatus(prefix + 'converting… ' + Math.round(p * 100) + '%') });
        const name = M.sanitizeName(f.name.replace(/\.[^.]+$/, ''), 'video');
        await M.saveBlob(blob, dir + '/' + name + '.mp4', { useDownloads: state.downloads });
        ok++;
      } catch (e) {
        failures.push(f.name + ' (' + errText(e) + ')');
      }
    }
    $('convertFiles').disabled = false;
    vidStatus((ok ? 'Converted ' + ok + ' file' + (ok > 1 ? 's' : '') + (state.downloads ? ' — saved in Downloads / ' + dir + '.' : '.') : '') + (failures.length ? ' Couldn’t convert: ' + failures.join('; ') : ''), failures.length ? 'err' : 'ok');
  });

  // New streams noticed in the background show up without pressing Rescan.
  let liveTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[MEDIA_KEY] || ($('panel-video').hidden && $('panel-audio').hidden)) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if (!scanning) refreshItems(); }, 700);
  });
  chrome.permissions.onAdded.addListener(refreshPerms);
  chrome.permissions.onRemoved.addListener(refreshPerms);
  window.addEventListener('pagehide', () => { M.clearReferers(); });

  init();
})();
