// A tiny IndexedDB box for screenshots in transit: the service worker captures, the viewer page picks it up.
// (Too big for message passing or storage.session, and a service worker can't make blob: URLs.)
(function (root) {
  const DB = 'pagemate-shots', STORE = 'shots';
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
  const api = {
    put: (id, value) => tx('readwrite', s => s.put(value, id)),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id)),
    // drop anything older than a day (abandoned captures)
    async sweep() {
      const db = await open();
      try {
        await new Promise(resolve => {
          const t = db.transaction(STORE, 'readwrite'); const s = t.objectStore(STORE); const c = s.openCursor();
          c.onsuccess = () => { const cur = c.result; if (!cur) return; if (cur.value && cur.value.at && Date.now() - cur.value.at > 86400000) cur.delete(); cur.continue(); };
          t.oncomplete = t.onerror = t.onabort = () => resolve();
        });
      } finally { db.close(); }
    }
  };
  root.KOShotStore = api;
})(typeof self !== 'undefined' ? self : globalThis);
