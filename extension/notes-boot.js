// Tiny script registered for all pages once the user has allowed access to sites. It only checks
// whether THIS page already has saved notes (a single local lookup); if so it asks the extension
// to load the notes script, which redraws the highlights. Pages without notes are left alone.
(() => {
  try {
    if (!self.KNCore) return;
    const key = KNCore.pageKey(location.href);
    if (key === 'kn:p:') return;
    chrome.storage.local.get(key).then(r => {
      if (r && r[key] && r[key].items && r[key].items.length) chrome.runtime.sendMessage({ type: 'kn-boot' }).catch(() => {});
    }).catch(() => {});
  } catch (_) {}
})();
