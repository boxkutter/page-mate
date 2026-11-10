// Finds a Firefox to drive. Set FIREFOX=/path/to/firefox to choose one (a Developer Edition, Nightly or ESR 128+ also work).
const fs = require('fs'), path = require('path');

function find() {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Firefox.app/Contents/MacOS/firefox', '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox', '/Applications/Firefox Nightly.app/Contents/MacOS/firefox']
    : process.platform === 'win32'
      ? [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean).flatMap(p => [path.join(p, 'Mozilla Firefox', 'firefox.exe'), path.join(p, 'Firefox Developer Edition', 'firefox.exe')])
      : ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/snap/bin/firefox', '/usr/lib/firefox/firefox', '/usr/lib64/firefox/firefox', '/opt/firefox/firefox'];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error('No Firefox found. Set FIREFOX=/path/to/firefox (see tests/firefox.js).');
}
module.exports = find();
