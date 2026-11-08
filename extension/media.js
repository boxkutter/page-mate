// Helpers shared by the Save page: file names, "looks like it came from the
// player page" request headers, fetching with progress, and saving files.
(function (root) {
  const RULE_BASE = 1000000; // our declarativeNetRequest session-rule ids start here

  // ---- names ----

  function sanitizeName(raw, fallback = 'untitled', max = 110) {
    let s = String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')       // no hidden files or ".."
      .replace(/[. ]+$/, '');    // Windows dislikes trailing dots/spaces
    if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
    return s || fallback;
  }

  // "PageMate Archive/Week 3" - every part sanitised, never absolute, never "..".
  function sanitizePath(parts) {
    return parts.map(p => sanitizeName(p, '')).filter(Boolean).join('/');
  }

  const MIME_EXT = {
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv',
    'video/x-m4v': 'm4v', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'weba',
    'audio/wav': 'wav', 'audio/flac': 'flac'
  };

  function guessExt(url, mime) {
    try {
      const m = /\.([a-z0-9]{2,4})$/i.exec(new URL(url).pathname);
      if (m && /^(mp4|m4v|webm|mov|mkv|ogv|mp3|m4a|aac|ogg|wav|flac|opus)$/i.test(m[1])) return m[1].toLowerCase();
    } catch (_) {}
    const base = String(mime || '').split(';')[0].trim().toLowerCase();
    return MIME_EXT[base] || 'mp4';
  }

  function kindOfUrl(url, mime) {
    const m = String(mime || '').toLowerCase();
    if (/\.m3u8(\?|#|$)/i.test(url) || /mpegurl/.test(m)) return 'hls';
    if (/\.mpd(\?|#|$)/i.test(url) || /dash\+xml/.test(m)) return 'dash';
    return 'file';
  }

  function fmtBytes(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i >= 2 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }

  function fmtDuration(sec) {
    sec = Math.round(sec);
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  // ---- request headers ----
  // Many hosts only serve media to requests that look like they came from the
  // player page (Referer / Origin). Browsers don't let pages set those, but an
  // extension can, for its own requests to specific hosts, while a download runs.

  // Several parts of the Save page (document images, the media list, the image gallery) each need
  // headers for some hosts. They register their wishes under an owner name and ONE merged rule set is
  // kept: per host the first registration wins, so two parts can never install competing rules
  // (Chrome's choice between equal-priority rules is undefined).
  const refererOwners = new Map();   // owner -> [{ url, referer }]
  let activeRuleIds = [];
  let syncChain = Promise.resolve();

  function setReferers(owner, pairs) {
    refererOwners.set(owner, pairs || []);
    syncChain = syncChain.then(syncReferers).catch(() => {});
    return syncChain;
  }

  function clearReferers() {
    refererOwners.clear();
    syncChain = syncChain.then(syncReferers).catch(() => {});
    return syncChain;
  }

  async function syncReferers() {
    if (!chrome.declarativeNetRequest) return;
    const byHost = new Map();
    for (const pairs of refererOwners.values()) {
      for (const { url, referer } of pairs) {
        let host, origin;
        try { host = new URL(url).hostname; origin = new URL(referer).origin; } catch (_) { continue; }
        if (!/^https?:/.test(referer) || byHost.has(host)) continue;
        byHost.set(host, { referer, origin });
      }
    }
    const rules = [];
    let id = RULE_BASE + Math.floor(Math.random() * 1e8);
    for (const [host, { referer, origin }] of byHost) {
      const action = {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'referer', operation: 'set', value: referer },
          { header: 'origin', operation: 'set', value: origin }
        ]
      };
      const types = ['xmlhttprequest', 'media', 'image', 'other', 'main_frame', 'sub_frame'];
      // Requests made by this extension's own pages...
      rules.push({ id: id++, priority: 1, action, condition: { requestDomains: [host], initiatorDomains: [chrome.runtime.id], resourceTypes: types } });
      // ...and by the downloads manager (not attached to any tab).
      rules.push({ id: id++, priority: 1, action, condition: { requestDomains: [host], tabIds: [-1], resourceTypes: types } });
    }
    try {
      // One call: the new rules replace the old ones with no gap in between.
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules, removeRuleIds: activeRuleIds });
      activeRuleIds = rules.map(r => r.id);
    } catch (e) {
      console.warn('PageMate: couldn’t set request headers:', e.message);
    }
  }

  async function removeRules(ids) {
    if (!ids || !ids.length || !chrome.declarativeNetRequest) return;
    try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }); } catch (_) {}
  }

  // Rules left behind by a crashed page.
  async function clearStaleRules() {
    if (!chrome.declarativeNetRequest) return;
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      await removeRules(rules.filter(r => r.id >= RULE_BASE).map(r => r.id));
    } catch (_) {}
  }

  // ---- fetching ----

  class HttpError extends Error {
    constructor(status, url) {
      super(status === 401 || status === 403
        ? 'The site refused the request (' + status + '). The link may have expired — reload the page, play the video, and rescan.'
        : status === 404 ? 'The file wasn’t found (404). The link may have expired.' : 'The server replied ' + status + '.');
      this.status = status;
      this.url = url;
    }
  }

  async function fetchBuffer(url, { range, signal } = {}) {
    const headers = {};
    if (range) headers.Range = 'bytes=' + range.start + '-' + range.end;
    const res = await fetch(url, { credentials: 'include', headers, signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.arrayBuffer();
  }

  async function fetchText(url, opts = {}) {
    const res = await fetch(url, { credentials: 'include', signal: opts.signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.text();
  }

  // Streams a (possibly huge) file into disk-backed Blob parts, reporting progress.
  async function fetchBlob(url, { signal, onProgress } = {}) {
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) throw new HttpError(res.status, url);
    const total = parseInt(res.headers.get('content-length'), 10) || 0;
    const mime = (res.headers.get('content-type') || '').split(';')[0];
    if (!res.body) {
      const blob = await res.blob();
      if (onProgress) onProgress({ bytes: blob.size, total: blob.size });
      return { blob, mime };
    }
    const reader = res.body.getReader();
    const parts = [];
    let pending = [];
    let pendingBytes = 0;
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(value);
      pendingBytes += value.length;
      bytes += value.length;
      // Hand data to the browser's blob store regularly so it can spill to disk.
      if (pendingBytes >= 8 * 1024 * 1024) { parts.push(new Blob(pending)); pending = []; pendingBytes = 0; }
      if (onProgress) onProgress({ bytes, total });
    }
    if (pending.length) parts.push(new Blob(pending));
    return { blob: new Blob(parts, { type: mime }), mime };
  }

  // ---- saving ----

  // Saves via the downloads API (lets us pick a sub-folder) when permitted;
  // otherwise falls back to an ordinary "download" link.
  async function saveBlob(blob, filename, { useDownloads = true } = {}) {
    const url = URL.createObjectURL(blob);
    const cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
    try {
      if (useDownloads && chrome.downloads) {
        const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
        cleanup();
        return { id };
      }
    } catch (e) {
      console.warn('downloads API refused, using link fallback:', e.message);
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    cleanup();
    return { id: null };
  }

  // Starts a download of a URL by the browser itself (best for very large files),
  // resolves when it completes. onProgress({bytes,total}).
  function downloadUrl(url, filename, { onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      let id = null;
      let timer = null;
      const finish = (fn, v) => { clearInterval(timer); chrome.downloads.onChanged.removeListener(onChanged); if (signal) signal.removeEventListener('abort', onAbort); fn(v); };
      const onAbort = () => { if (id != null) chrome.downloads.cancel(id).catch(() => {}); finish(reject, new DOMException('Cancelled', 'AbortError')); };
      const onChanged = delta => {
        if (delta.id !== id) return;
        if (delta.state && delta.state.current === 'complete') finish(resolve, { id });
        else if (delta.state && delta.state.current === 'interrupted') {
          const err = new Error('The browser couldn’t download this file' + (delta.error ? ' (' + delta.error.current + ')' : '') + '.');
          err.code = delta.error ? delta.error.current : 'INTERRUPTED';
          finish(reject, err);
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort); }
      chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }).then(newId => {
        id = newId;
        timer = setInterval(async () => {
          try {
            const [d] = await chrome.downloads.search({ id });
            if (!d) return;
            if (onProgress) onProgress({ bytes: d.bytesReceived, total: d.totalBytes > 0 ? d.totalBytes : 0 });
            if (d.state === 'complete') finish(resolve, { id });
            else if (d.state === 'interrupted') onChanged({ id, state: { current: 'interrupted' }, error: { current: d.error } });
          } catch (_) {}
        }, 500);
      }, e => finish(reject, e));
    });
  }

  const api = { sanitizeName, sanitizePath, guessExt, kindOfUrl, fmtBytes, fmtDuration, setReferers, clearReferers, removeRules, clearStaleRules, fetchBuffer, fetchText, fetchBlob, saveBlob, downloadUrl, HttpError };
  root.KRMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
