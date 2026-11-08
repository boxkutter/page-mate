// Audio engine: fetches speech for each chunk from the Kokoro server,
// prefetches ahead so playback is gapless, and reports progress.
//
// Every reading session has an id. Events carry it so the page can ignore
// stale ones, and control messages for a session we don't have are answered
// with { ok: false } so the page can restart playback from its own copy of
// the text (e.g. after the browser closed this document while paused).

const PREFETCH_AHEAD = 3;

const audio = new Audio();
let session = null;
let chunks = [];
let idx = 0;
let base = '';
let voice = 'af_heart';
let speed = 1;
let paused = false;
let finished = false;
let playToken = 0;
const cache = new Map(); // index -> { promise, ctrl, url }

function emit(event) {
  if (!session) return;
  chrome.runtime.sendMessage({ target: 'sw', type: 'kr-event', session, event }).catch(() => {});
}

function dropEntry(i) {
  const e = cache.get(i);
  if (!e) return;
  cache.delete(i);
  e.ctrl.abort();
  e.promise.then(url => URL.revokeObjectURL(url), () => {});
}

function clearCache(keepUpTo = -1) {
  for (const i of [...cache.keys()]) if (i > keepUpTo) dropEntry(i);
}

function retryable(e) {
  if (!e || e.name === 'AbortError') return false;
  return e.name === 'TimeoutError' || krIsNetworkError(e) || (e.status >= 500 && e.status < 600) || e.status === 429;
}

async function synth(text, signal) {
  const req = { text, voice, speed };
  try {
    return await krSpeak(base, req, signal);
  } catch (e) {
    if (!retryable(e) || signal.aborted) throw e;
    await new Promise(r => setTimeout(r, 800));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return krSpeak(base, req, signal);
  }
}

function getAudio(i) {
  const hit = cache.get(i);
  if (hit) return hit.promise;
  const ctrl = new AbortController();
  const promise = synth(chunks[i], ctrl.signal).then(blob => URL.createObjectURL(blob));
  promise.catch(() => {});
  cache.set(i, { promise, ctrl });
  return promise;
}

function prefetch(from) {
  for (let i = from; i < Math.min(chunks.length, from + PREFETCH_AHEAD); i++) getAudio(i);
}

function setMediaState() {
  try {
    navigator.mediaSession.playbackState = !session ? 'none' : paused || finished ? 'paused' : 'playing';
  } catch (_) {}
}

async function playAt(i) {
  if (!session) return;
  if (i < 0) i = 0;
  const token = ++playToken;
  audio.pause();
  if (i >= chunks.length) {
    finished = true;
    idx = Math.max(0, chunks.length - 1);
    setMediaState();
    emit({ type: 'done' });
    return;
  }
  finished = false;
  idx = i;
  emit({ type: 'loading', index: i, total: chunks.length });
  try {
    const url = await getAudio(i);
    if (token !== playToken) return;
    audio.src = url;
    for (const k of [...cache.keys()]) if (k < i - 1) dropEntry(k);
    prefetch(i + 1);
    emit({ type: 'chunk', index: i, total: chunks.length, paused });
    setMediaState();
    if (!paused) await audio.play();
  } catch (e) {
    if (token !== playToken || e.name === 'AbortError') return;
    dropEntry(i);
    paused = true;
    setMediaState();
    emit({ type: 'error', index: i, message: krErrorMessage(e) });
  }
}

audio.addEventListener('ended', () => {
  if (session && !paused) playAt(idx + 1);
});

// Media decode failure (e.g. server returned something that isn't audio).
audio.addEventListener('error', () => {
  if (!session || !audio.getAttribute('src')) return;
  playToken++;
  dropEntry(idx);
  paused = true;
  setMediaState();
  emit({ type: 'error', index: idx, message: 'The server returned audio the browser could not play.' });
});

function currentChunkReady() {
  return !!audio.getAttribute('src') && !audio.ended && cache.has(idx) && !finished;
}

function doPause() {
  if (!session || paused) return;
  paused = true;
  audio.pause();
  setMediaState();
  emit({ type: 'paused' });
}

function doResume() {
  if (!session) return;
  paused = false;
  if (finished) { playAt(0); return; }
  if (currentChunkReady()) {
    audio.play().catch(e => { if (e.name !== 'AbortError') playAt(idx); });
  } else {
    playAt(idx);
  }
  setMediaState();
  emit({ type: 'resumed' });
}

function stopAll() {
  playToken++;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  clearCache();
  chunks = [];
  session = null;
  finished = false;
  setMediaState();
}

// Hardware media keys / the browser's media controls go through our logic,
// so the page's player never gets out of sync.
try {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', doResume);
  ms.setActionHandler('pause', doPause);
  ms.setActionHandler('stop', () => emit({ type: 'stop-request' }));
  ms.setActionHandler('nexttrack', () => session && playAt(idx + 1));
  ms.setActionHandler('previoustrack', () => session && playAt(idx - 1));
} catch (_) {}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;

  if (msg.type === 'start') {
    stopAll();
    session = msg.session;
    chunks = Array.isArray(msg.chunks) ? msg.chunks : [];
    base = msg.base;
    voice = msg.voice || voice;
    speed = krClampSpeed(msg.speed);
    paused = !!msg.paused;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: msg.title || 'PageMate', artist: 'PageMate' }); } catch (_) {}
    playAt(Number(msg.startIndex) || 0);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'stop') {
    if (!msg.session || msg.session === session) stopAll();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'speed' || msg.type === 'voice') {
    if (msg.type === 'speed') speed = krClampSpeed(msg.speed);
    else voice = msg.voice || voice;
    if (session) {
      clearCache(idx); // re-generate upcoming chunks with the new setting
      if (!finished) prefetch(idx + 1);
    }
    sendResponse({ ok: true });
    return;
  }

  // Everything below is a control for a specific session.
  if (!session || msg.session !== session) {
    sendResponse({ ok: false });
    return;
  }

  switch (msg.type) {
    case 'status':
      break;
    case 'pause':
      doPause();
      break;
    case 'resume':
      doResume();
      break;
    case 'next':
      playAt(idx + 1);
      break;
    case 'prev':
      playAt(finished || audio.currentTime > 2.5 ? idx : idx - 1);
      break;
    case 'jump':
      paused = false;
      playAt(Number(msg.index) || 0);
      break;
  }
  sendResponse({ ok: true, index: idx, paused, finished, total: chunks.length });
});
