// Screenshot planning: pure maths, so the fiddly parts (tiling a tall page, cropping a selection) are unit tested.
(function (root) {
  const MAX_SIDE = 16384;              // browsers cap a canvas side here
  const MAX_AREA = 268435456;          // ...and the total pixel count here

  // Full-page capture is a stack of viewport-sized tiles. The last tile is scrolled only as far as the page allows,
  // so it overlaps the one before it; `srcY` says how far down inside the capture to start drawing from.
  // All outputs are in device pixels (css px x dpr). Inputs are css px.
  function planFullPage({ pageHeight, viewHeight, viewWidth, dpr = 1 }) {
    pageHeight = Math.max(1, Math.round(pageHeight)); viewHeight = Math.max(1, Math.round(viewHeight)); viewWidth = Math.max(1, Math.round(viewWidth));
    const wDev = Math.round(viewWidth * dpr);
    const maxH = Math.min(MAX_SIDE, Math.floor(MAX_AREA / Math.max(1, wDev)));
    let cssLimit = Math.floor(maxH / dpr);
    const truncated = pageHeight > cssLimit;
    const useHeight = truncated ? cssLimit : pageHeight;
    const tiles = [];
    for (let y = 0; y < useHeight; y += viewHeight) {
      const scrollY = Math.min(y, Math.max(0, pageHeight - viewHeight));
      const h = Math.min(viewHeight, useHeight - y);
      // round the EDGES, not the heights, so tiles never drift apart by a pixel
      const top = Math.round(y * dpr), bottom = Math.round((y + h) * dpr);
      tiles.push({ scrollY, destY: top, srcY: Math.round((y - scrollY) * dpr), h: bottom - top });
    }
    return { width: wDev, height: Math.round(useHeight * dpr), tiles, truncated, pageHeight, shownHeight: useHeight };
  }

  // A selection rectangle (css px, relative to the viewport) -> integer device-pixel crop inside a capture of the given size.
  function cropRect(rect, dpr, imgW, imgH) {
    const x = Math.max(0, Math.round(rect.x * dpr)), y = Math.max(0, Math.round(rect.y * dpr));
    const w = Math.min(imgW - x, Math.round(rect.w * dpr)), h = Math.min(imgH - y, Math.round(rect.h * dpr));
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  // Normalises two drag points into a rectangle (any direction), clamped to the box.
  function rectFromPoints(a, b, maxW = Infinity, maxH = Infinity) {
    const x1 = Math.max(0, Math.min(a.x, b.x)), y1 = Math.max(0, Math.min(a.y, b.y));
    const x2 = Math.min(maxW, Math.max(a.x, b.x)), y2 = Math.min(maxH, Math.max(a.y, b.y));
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }

  // Minimum time between captureVisibleTab calls (the browser allows about two a second).
  const CAPTURE_GAP_MS = 600;

  function fileBase(title, at, kind) {
    const t = String(title || 'page').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'page';
    return (kind || 'Screenshot') + ' - ' + t + ' - ' + at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }

  const api = { planFullPage, cropRect, rectFromPoints, fileBase, CAPTURE_GAP_MS, MAX_SIDE, MAX_AREA };
  root.KOShot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
