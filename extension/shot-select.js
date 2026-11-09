// Injected when you choose "Screenshot → Selected area": a drag-to-select overlay.
// Reports the rectangle (css px, relative to the viewport) back to the extension, then removes itself.
// Esc cancels. Nothing from the page is read.
(function () {
  if (window.__koSelect) { window.__koSelect.cancel(); }
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = '.dim{position:fixed;inset:0;background:rgba(0,0,0,.35)}.box{position:fixed;border:2px solid #3fbfb5;box-shadow:0 0 0 9999px rgba(0,0,0,.45);background:transparent;display:none}.tip{position:fixed;left:50%;top:14px;transform:translateX(-50%);background:#16201f;color:#e8efee;font:13px system-ui,sans-serif;padding:8px 14px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.4)}.size{position:fixed;background:#16201f;color:#e8efee;font:12px ui-monospace,monospace;padding:2px 6px;border-radius:5px;display:none}';
  const dim = document.createElement('div'); dim.className = 'dim';
  const box = document.createElement('div'); box.className = 'box';
  const size = document.createElement('div'); size.className = 'size';
  const tip = document.createElement('div'); tip.className = 'tip'; tip.textContent = 'Drag to choose the area to capture. Esc to cancel.';
  shadow.append(style, dim, box, size, tip);
  document.documentElement.appendChild(host);

  let start = null;
  function finish(rect) {
    cleanup();
    chrome.runtime.sendMessage({ type: 'ko-region', rect: rect, dpr: window.devicePixelRatio || 1 }).catch(function () {});
  }
  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    delete window.__koSelect;
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); chrome.runtime.sendMessage({ type: 'ko-region', cancelled: true }).catch(function () {}); } }
  function rectOf(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
  host.addEventListener('mousedown', function (e) { e.preventDefault(); start = { x: e.clientX, y: e.clientY }; dim.style.display = 'none'; tip.style.display = 'none'; box.style.display = 'block'; });
  host.addEventListener('mousemove', function (e) {
    if (!start) return;
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    box.style.left = r.x + 'px'; box.style.top = r.y + 'px'; box.style.width = r.w + 'px'; box.style.height = r.h + 'px';
    size.style.display = 'block'; size.style.left = r.x + 'px'; size.style.top = Math.max(0, r.y - 24) + 'px'; size.textContent = Math.round(r.w) + ' × ' + Math.round(r.h);
  });
  host.addEventListener('mouseup', function (e) {
    if (!start) return;
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    start = null;
    if (r.w < 6 || r.h < 6) { box.style.display = 'none'; size.style.display = 'none'; dim.style.display = 'block'; tip.style.display = 'block'; return; }
    // let the overlay disappear before the browser takes the picture
    host.style.display = 'none';
    setTimeout(function () { finish(r); }, 120);
  });
  window.addEventListener('keydown', onKey, true);
  window.__koSelect = { cancel: cleanup };
})();
