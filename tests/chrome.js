// Finds a Chromium to drive. Set CHROME=/path/to/chrome to choose one.
// Note: branded Google Chrome 137+ ignores --load-extension, so use Chromium or "Chrome for Testing"
// (e.g. `npx playwright install chromium`, or `npx @puppeteer/browsers install chrome@stable`).
const fs = require('fs'), os = require('os'), path = require('path');

function find() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(cache).filter(d => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const p = path.join(cache, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']) if (fs.existsSync(p)) return p;
  throw new Error('No Chromium found. Set CHROME=/path/to/chromium (see tests/chrome.js).');
}
module.exports = find();
