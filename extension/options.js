const $ = id => document.getElementById(id);
const serverEl = $('server');
const connectBtn = $('connect');
const connStatus = $('connStatus');
const voiceSection = $('voiceSection');
const voiceEl = $('voice');
const speedEl = $('speed');
const speedVal = $('speedVal');
const voiceStatus = $('voiceStatus');
const previewBtn = $('preview');
const autoContinueEl = $('autoContinue');
const sniffEl = $('sniffVideos');
const folderEl = $('saveFolder');
const grantSaveBtn = $('grantSave');
const grantStatus = $('grantStatus');
const notesAutoEl = $('notesAuto');

let settings = { ...KR_DEFAULTS };
let previewAudio = null;
let connectToken = 0;

function status(el, text, kind = '') {
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function showSpeed(v) {
  const n = krClampSpeed(v);
  speedVal.textContent = (Number.isInteger(n) ? n.toFixed(1) : String(n)) + '×';
}

function fillVoices(list) {
  const current = settings.voice;
  voiceEl.innerHTML = '';
  const sorted = [...new Set(list)].sort((a, b) => a.localeCompare(b));
  for (const v of sorted) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    voiceEl.appendChild(opt);
  }
  // Keep the saved voice if the server still has it; otherwise pick a sensible default.
  const chosen = current && sorted.includes(current) ? current : (sorted.includes('af_heart') ? 'af_heart' : sorted[0]);
  voiceEl.value = chosen;
  if (chosen !== current) {
    settings.voice = chosen;
    chrome.storage.sync.set({ voice: chosen });
  }
}

async function connect({ interactive }) {
  const token = ++connectToken;
  const raw = serverEl.value.trim();
  if (!raw) { status(connStatus, 'Enter your server address first.', 'err'); return; }
  let pattern, base;
  try { base = krApiBase(raw); pattern = krOriginPattern(raw); }
  catch (_) { status(connStatus, 'That doesn’t look like a valid address.', 'err'); return; }

  // Must be requested straight from the click so the browser shows its prompt.
  let granted;
  try {
    granted = interactive
      ? await chrome.permissions.request({ origins: [pattern] })
      : await chrome.permissions.contains({ origins: [pattern] });
  } catch (e) {
    status(connStatus, e.message, 'err');
    return;
  }
  if (token !== connectToken) return;
  if (!granted) {
    voiceSection.classList.add('locked');
    status(connStatus, interactive
      ? 'Permission was declined, so the extension can’t reach your server.'
      : 'Click Connect to allow the extension to reach this server.', interactive ? 'err' : '');
    return;
  }

  connectBtn.disabled = true;
  status(connStatus, 'Connecting to ' + base + ' …');
  try {
    const voices = await krFetchVoices(base);
    if (token !== connectToken) return;
    if (!voices.length) throw new Error('Connected, but the server listed no voices.');
    const previousUrl = settings.serverUrl;
    settings.serverUrl = raw;
    await chrome.storage.sync.set({ serverUrl: raw });
    // Drop access to a server address we no longer use.
    try {
      if (previousUrl && krOriginPattern(previousUrl) !== pattern) {
        await chrome.permissions.remove({ origins: [krOriginPattern(previousUrl)] });
      }
    } catch (_) {}
    fillVoices(voices);
    voiceSection.classList.remove('locked');
    status(connStatus, `Connected — ${voices.length} voices available.`, 'ok');
  } catch (e) {
    if (token !== connectToken) return;
    voiceSection.classList.add('locked');
    const msg = krIsNetworkError(e)
      ? `Couldn’t reach ${base}. Check that the Kokoro container is running, the IP and port are right, and that this computer is on the same network (or VPN).`
      : e.name === 'TimeoutError' ? `${base} didn’t answer in time.` : e.message;
    status(connStatus, msg, 'err');
  } finally {
    if (token === connectToken) connectBtn.disabled = false;
  }
}

async function preview() {
  previewBtn.disabled = true;
  status(voiceStatus, 'Generating preview…');
  try {
    const blob = await krSpeak(krApiBase(settings.serverUrl), {
      text: 'Hi! This is how your pages will sound with this voice.',
      voice: settings.voice,
      speed: settings.speed
    });
    if (previewAudio) { previewAudio.pause(); URL.revokeObjectURL(previewAudio.src); }
    previewAudio = new Audio(URL.createObjectURL(blob));
    await previewAudio.play();
    status(voiceStatus, '');
  } catch (e) {
    status(voiceStatus, krErrorMessage(e), 'err');
  } finally {
    previewBtn.disabled = false;
  }
}

connectBtn.addEventListener('click', () => connect({ interactive: true }));
serverEl.addEventListener('keydown', e => { if (e.key === 'Enter') connect({ interactive: true }); });

voiceEl.addEventListener('change', () => {
  settings.voice = voiceEl.value;
  chrome.storage.sync.set({ voice: settings.voice });
});

speedEl.addEventListener('input', () => showSpeed(speedEl.value));
speedEl.addEventListener('change', () => {
  settings.speed = krClampSpeed(speedEl.value);
  chrome.storage.sync.set({ speed: settings.speed });
});

autoContinueEl.addEventListener('change', () => {
  settings.autoContinue = autoContinueEl.checked;
  chrome.storage.sync.set({ autoContinue: settings.autoContinue });
});

previewBtn.addEventListener('click', preview);

// ---------- saving pages / videos ----------

async function refreshSaveAccess() {
  let hosts = false, dl = false;
  try { hosts = await chrome.permissions.contains({ origins: KR_ALL_SITES }); } catch (_) {}
  try { dl = await chrome.permissions.contains({ permissions: ['downloads'] }); } catch (_) {}
  if (hosts && dl) { status(grantStatus, 'Allowed.', 'ok'); grantSaveBtn.textContent = 'Allowed'; grantSaveBtn.disabled = true; }
  else { status(grantStatus, ''); grantSaveBtn.textContent = 'Allow saving…'; grantSaveBtn.disabled = false; }
}

grantSaveBtn.addEventListener('click', async () => {
  try {
    const ok = await chrome.permissions.request({ permissions: ['downloads'], origins: KR_ALL_SITES });
    if (!ok) status(grantStatus, 'Not allowed. Saving pages and videos won’t work until you allow it.', 'err');
  } catch (e) { status(grantStatus, e.message, 'err'); }
  refreshSaveAccess();
});
sniffEl.addEventListener('change', () => { settings.sniffVideos = sniffEl.checked; chrome.storage.sync.set({ sniffVideos: sniffEl.checked }); });
folderEl.addEventListener('change', () => {
  settings.saveFolder = folderEl.value.trim() || 'PageMate Archive';
  folderEl.value = settings.saveFolder;
  chrome.storage.sync.set({ saveFolder: settings.saveFolder });
});
notesAutoEl.addEventListener('change', () => { settings.notesAuto = notesAutoEl.checked; chrome.storage.sync.set({ notesAuto: notesAutoEl.checked }); });
$('openNotes').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'kn-open-manager' }));
chrome.permissions.onAdded.addListener(refreshSaveAccess);
chrome.permissions.onRemoved.addListener(refreshSaveAccess);

// Keep this page in sync with changes made from the player.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.speed) {
    settings.speed = krClampSpeed(changes.speed.newValue);
    speedEl.value = settings.speed;
    showSpeed(settings.speed);
  }
  if (changes.voice && changes.voice.newValue !== voiceEl.value) {
    settings.voice = changes.voice.newValue;
    if ([...voiceEl.options].some(o => o.value === settings.voice)) voiceEl.value = settings.voice;
  }
  if (changes.autoContinue) {
    settings.autoContinue = !!changes.autoContinue.newValue;
    autoContinueEl.checked = settings.autoContinue;
  }
});

(async () => {
  settings = await chrome.storage.sync.get(KR_DEFAULTS);
  serverEl.value = settings.serverUrl || '';
  speedEl.value = krClampSpeed(settings.speed);
  showSpeed(settings.speed);
  autoContinueEl.checked = !!settings.autoContinue;
  sniffEl.checked = settings.sniffVideos !== false;
  notesAutoEl.checked = settings.notesAuto !== false;
  folderEl.value = settings.saveFolder || 'PageMate Archive';
  refreshSaveAccess();
  if (settings.serverUrl) connect({ interactive: false });
  else serverEl.focus();
})();
