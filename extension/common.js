// Shared helpers (used by background, offscreen and options pages).

const KR_DEFAULTS = {
  serverUrl: '', voice: 'af_heart', speed: 1.0, autoContinue: true,
  // Saving pages / videos
  sniffVideos: true, saveFolder: 'PageMate Archive',
  // Notes
  notesAuto: true, knOrder: 'page',
  // Investigate
  recordHeaders: true,            // remember each page's response headers (in memory) for the site profile / evidence
  customServices: '',             // JSON list of extra lookup links
  shareInstance: '', shareHashtags: '', shareClean: true,
  // Sealed captures
  capSign: false, capTimestamp: false, tsaUrl: 'https://freetsa.org/tsr', capShot: true,
  // Screenshots
  shotAutoCopy: false             // copy each new screenshot to the clipboard as soon as it is taken
};
// Turns "copy each new screenshot to the clipboard automatically" on or off. Switching it on asks for the optional
// clipboard permission, so call it straight from a click. -> the value now in force (false if the permission was refused).
async function krSetShotAutoCopy(on) {
  if (on) {
    let ok = false;
    try { ok = (await chrome.permissions.contains({ permissions: ['clipboardWrite'] })) || (await chrome.permissions.request({ permissions: ['clipboardWrite'] })); } catch (_) {}
    if (!ok) on = false;
  }
  await chrome.storage.sync.set({ shotAutoCopy: !!on });
  return !!on;
}
const KR_ALL_SITES = ['http://*/*', 'https://*/*'];
const KR_MIN_SPEED = 0.5;
const KR_MAX_SPEED = 2.0;
const KR_REQUEST_TIMEOUT_MS = 90000;

function krClampSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(KR_MAX_SPEED, Math.max(KR_MIN_SPEED, Math.round(n * 100) / 100));
}

// Accepts "192.168.1.50:8880", "http://host:8880", ".../v1" or ".../v1/audio/speech"
// and returns the API base, e.g. "http://192.168.1.50:8880/v1".
function krApiBase(raw) {
  let u = String(raw || '').trim();
  if (!u) throw new Error('No server address set');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error('Invalid server address');
  let path = parsed.pathname.replace(/\/+$/, '');
  path = path.replace(/\/audio\/(speech|voices)$/, '');
  if (!/\/v1$/.test(path)) path = path + '/v1';
  return parsed.origin + path;
}

function krOriginPattern(raw) {
  return new URL(krApiBase(raw)).origin + '/*';
}

function krParseVoices(json) {
  const list = Array.isArray(json) ? json : (json && (json.voices || json.data)) || [];
  return list
    .map(v => (typeof v === 'string' ? v : v && (v.id || v.name || v.voice_id)))
    .filter(Boolean);
}

function krIsNetworkError(e) {
  return /Failed to fetch|NetworkError|ERR_|Load failed/i.test((e && e.message) || '');
}

// Combines an optional caller signal with a timeout.
function krSignal(signal, ms = KR_REQUEST_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function krFetchVoices(base) {
  const res = await fetch(base + '/audio/voices', { signal: krSignal(null, 15000) });
  if (!res.ok) throw new Error(`Server replied ${res.status} at ${base}/audio/voices`);
  return krParseVoices(await res.json());
}

async function krSpeak(base, { text, voice, speed }, signal) {
  const res = await fetch(base + '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-needed' },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice,
      speed: krClampSpeed(speed),
      response_format: 'mp3',
      stream: false
    }),
    signal: krSignal(signal)
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 160); } catch (_) {}
    const err = new Error(`Server replied ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('Server returned empty audio');
  return blob;
}

// Friendly message for errors shown to the user.
function krErrorMessage(e) {
  if (!e) return 'Unknown error';
  if (e.name === 'TimeoutError') return 'Your Kokoro server took too long to answer.';
  if (krIsNetworkError(e)) return 'Can’t reach your Kokoro server. Is it running, and is the address right?';
  return e.message || String(e);
}
