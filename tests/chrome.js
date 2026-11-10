// Finds a Chromium to drive. Set CHROME=/path/to/chrome to choose one.
// Note: branded Google Chrome 137+ ignores --load-extension, so use Chromium or "Chrome for Testing"
// (e.g. `npx playwright install chromium`, or `npx @puppeteer/browsers install chrome@stable`).
// Works on Linux, macOS and Windows.
const fs = require('fs'), os = require('os'), path = require('path');

// Where `npx playwright install chromium` puts it on each system: [cache folder, path inside a chromium-NNNN folder]
function playwrightLocations() {
  const home = os.homedir();
  if (process.platform === 'darwin') return [[path.join(home, 'Library', 'Caches', 'ms-playwright'), ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']], [path.join(home, 'Library', 'Caches', 'ms-playwright'), ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]];
  if (process.platform === 'win32') return [[path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright'), ['chrome-win', 'chrome.exe']]];
  return [[path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, '.cache', 'ms-playwright')), ['chrome-linux64', 'chrome']], [path.join(home, '.cache', 'ms-playwright'), ['chrome-linux', 'chrome']]];
}

function find() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const [cache, rest] of playwrightLocations()) {
    let dirs = [];
    try { dirs = fs.readdirSync(cache).filter(d => d.startsWith('chromium-')).sort().reverse(); } catch (_) {}
    for (const d of dirs) {
      const p = path.join(cache, d, ...rest);
      if (fs.existsSync(p)) return p;
    }
  }
  const fixed = process.platform === 'linux' ? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'] : [];
  for (const p of fixed) if (fs.existsSync(p)) return p;
  throw new Error('No Chromium found. Set CHROME=/path/to/chromium (see tests/chrome.js).');
}
module.exports = find();
