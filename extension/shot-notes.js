// Screenshots kept with a page's notes.
//
// The picture itself goes in IndexedDB (a PNG is far too big for chrome.storage.local, which is capped at 10 MB);
// the page's notes record (kn:p:<address>) gets a small entry in `shots` saying what it is and where the picture is.
// Nothing here changes `items`, so highlights, exports and the page highlighter are unaffected.
// Needs notes-core.js (KNCore) loaded first.
(function (root) {
  const DB = 'pagemate-note-shots', STORE = 'images';

  function open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const res = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(res && res.result);
        t.onerror = t.onabort = () => reject(t.error);
      });
    } finally { db.close(); }
  }
  const putImage = (id, blob) => tx('readwrite', s => s.put(blob, id));
  const getImage = id => tx('readonly', s => s.get(id));
  const delImage = id => tx('readwrite', s => s.delete(id));

  const newId = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
  const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

  // Files a screenshot under the notes for `meta.url`.
  // meta: { url, title, capturedAt, mode, width, height, sha256, marked, note }
  // -> { id, key, count }   (throws a readable Error if the picture has no web address to file it under)
  async function add(blob, meta) {
    const K = root.KNCore;
    const key = K.pageKey(meta.url);
    if (key === 'kn:p:') throw new Error('This screenshot has no web address to file it under. Save it as a file instead.');
    const id = newId();
    await putImage(id, blob);
    try {
      const got = await chrome.storage.local.get([key, 'kn:idx']);
      const idx = got['kn:idx'] || {};
      const now = new Date().toISOString();
      const page = got[key] || { url: K.normalizeUrl(meta.url), title: str(meta.title, 300), note: '', case: '', items: [], created: now };
      page.items = page.items || [];
      page.shots = Array.isArray(page.shots) ? page.shots : [];
      page.shots.push({
        id, at: str(meta.capturedAt, 40) || now, saved: now, mode: str(meta.mode, 20), w: Number(meta.width) || 0, h: Number(meta.height) || 0,
        bytes: blob.size, sha256: str(meta.sha256, 64), marked: !!meta.marked, note: str(meta.note, 2000), type: blob.type || 'image/png'
      });
      page.updated = now;
      if (!page.title) page.title = str(meta.title, 300);
      idx[key] = { ...(idx[key] || {}), url: page.url, title: page.title, count: page.items.length, shots: page.shots.length, updated: now, tags: [...new Set(page.items.flatMap(i => i.tags || []))], case: page.case || '' };
      await chrome.storage.local.set({ [key]: page, 'kn:idx': idx });
      return { id, key, count: page.shots.length };
    } catch (e) {
      await delImage(id).catch(() => {});
      throw e;
    }
  }

  // Removes one screenshot from a page's notes (record and picture). Drops the record if nothing else is left in it.
  async function remove(key, id) {
    const got = await chrome.storage.local.get([key, 'kn:idx']);
    const page = got[key], idx = got['kn:idx'] || {};
    if (page && Array.isArray(page.shots)) {
      page.shots = page.shots.filter(s => s.id !== id);
      page.updated = new Date().toISOString();
      if (!page.items.length && !(page.note || '').trim() && !page.shots.length) { await chrome.storage.local.remove(key); delete idx[key]; }
      else { await chrome.storage.local.set({ [key]: page }); if (idx[key]) idx[key] = { ...idx[key], shots: page.shots.length, updated: page.updated }; }
      await chrome.storage.local.set({ 'kn:idx': idx });
    }
    await delImage(id).catch(() => {});
  }

  // Deletes the pictures of a page whose notes are being deleted.
  async function removeImagesOf(page) {
    for (const s of (page && page.shots) || []) await delImage(s.id).catch(() => {});
  }

  const api = { add, remove, removeImagesOf, getImage, putImage, delImage };
  root.KShotNotes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
