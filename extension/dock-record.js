// The screen recorder, shown inside the floating toolbox in place of the tool icons.
// Same recording as the Record window (the browser's own "choose what to share" dialog -> MediaRecorder -> one file, nothing
// uploaded), but it runs in the page that holds the toolbox, because the browser only shows that dialog from a page you just clicked.
// So a page reload or leaving the page ends the recording; the toolbox says so, and asks before you leave.
//
// Needs record-core.js, zip.js, evidence.js, trust.js and seal.js loaded first (the background script injects them).
(function (root) {
  const R = root.KORecord;
  const PREF_KEY = 'ko:recOpts';
  const WARN_BYTES = 1.5 * 1024 * 1024 * 1024;
  const mb = n => n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + ' MB';
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const bin = atob(b), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };

  // box: the element to fill. api: { el, icon, kbd, send, exit }
  function mount(box, api) {
    const { el, icon, kbd, send } = api;
    const prefs = { sys: true, mic: false, count: true, quality: '', format: 'webm' };
    const S = { phase: 'idle', msg: '', msgKind: '', display: null, mic: null, ctx: null, rec: null, chunks: [], bytes: 0, clock: null, tick: null, count: 3, countTimer: null,
      blob: null, info: null, sha: '', fileName: '', startedAt: null, meta: null, warned: false, saved: false, confirmLeave: false, sealing: false };
    let ui = {};

    chrome.storage.local.get(PREF_KEY).then(r => { Object.assign(prefs, r[PREF_KEY] || {}); if (S.phase === 'idle') render(); }).catch(() => {});
    const savePrefs = () => { try { chrome.storage.local.set({ [PREF_KEY]: prefs }); } catch (_) {} };

    // ---- small view helpers
    const say = (text, kind) => { S.msg = text || ''; S.msgKind = kind || ''; if (ui.status) { ui.status.textContent = S.msg; ui.status.className = 'status' + (S.msgKind ? ' ' + S.msgKind : ''); } };
    const statusEl = () => { ui.status = el('div', { class: 'status', role: 'status', text: S.msg }); ui.status.className = 'status' + (S.msgKind ? ' ' + S.msgKind : ''); return ui.status; };
    const btn = (label, ic, fn, key, main) => el('button', { class: 'btn' + (main ? ' main' : ''), type: 'button', 'data-key': key || false, onclick: e => { if (e.isTrusted || api.fromKey()) fn(); } }, ic ? icon(ic) : null, label, key ? kbd(key.toUpperCase()) : null);
    const head = (title, withBack) => el('div', { class: 'ph' },
      withBack ? el('button', { class: 'ib', type: 'button', title: 'Back to the tools (Esc)', 'aria-label': 'Back to the tools', onclick: e => { if (e.isTrusted || api.fromKey()) leave(); } }, icon('back')) : null,
      el('span', { text: title }));
    const check = (key, label) => {
      const i = el('input', { type: 'checkbox' }); i.checked = !!prefs[key];
      i.addEventListener('change', () => { prefs[key] = i.checked; savePrefs(); });
      return el('label', { class: 'chk' }, i, el('span', { text: label }));
    };
    const select = (key, label, options) => {
      const s = el('select', { 'aria-label': label });
      for (const [v, t] of options) s.append(el('option', { value: v, text: t }));
      s.value = prefs[key];
      s.addEventListener('change', () => { prefs[key] = s.value; savePrefs(); });
      return el('label', { class: 'sel' }, label + ' ', s);
    };

    function setPhase(p, msg, kind) { S.phase = p; S.msg = msg || ''; S.msgKind = kind || ''; render(); }

    function render() {
      clearInterval(S.tick); S.tick = null;
      ui = {};
      ({ idle: viewIdle, choosing: viewChoosing, counting: viewCounting, recording: viewLive, paused: viewLive, done: viewDone })[S.phase]();
      if (S.phase === 'recording' || S.phase === 'paused') { updateLive(); S.tick = setInterval(updateLive, 250); }
      api.settle();
    }

    // ---- idle: options
    function viewIdle() {
      const can = root.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && root.MediaRecorder;
      box.replaceChildren(head('Record screen', true),
        el('p', { class: 'note', text: can ? 'You choose a screen, a window or a tab in the browser’s own dialog. Nothing is uploaded.' : 'This page can’t record the screen from here (the browser needs a secure https page). Use the recorder window instead.' }),
        can ? check('sys', 'Sound from the screen or tab') : null, can ? check('mic', 'Microphone') : null, can ? check('count', '3-second countdown') : null,
        can ? el('div', { class: 'row2' }, select('quality', 'Quality', [['', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max']]), select('format', 'Format', [['webm', 'WebM'], ['mp4', 'MP4']])) : null,
        el('div', { class: 'row' }, can ? btn('Start recording', 'record', begin, 'r', true) : null, btn('Recorder window', null, () => send({ type: 'ko-rec-window' }), 'w')),
        statusEl());
      const first = box.querySelector('.btn.main') || box.querySelector('.btn');
      if (first) first.focus();
    }

    function viewChoosing() {
      box.replaceChildren(head('Record screen', false), el('p', { class: 'note', text: 'Choose what to share in the browser’s dialog…' }),
        el('div', { class: 'row' }, btn('Cancel', null, () => { cleanup(); setPhase('idle'); }, 'c')), statusEl());
    }

    function viewCounting() {
      ui.count = el('div', { class: 'big', 'aria-live': 'polite', text: String(S.count) });
      box.replaceChildren(head('Get ready', false), ui.count, el('div', { class: 'row' }, btn('Cancel', null, () => { cleanup(); setPhase('idle', 'Cancelled.'); }, 'c')));
    }

    function viewLive() {
      const paused = S.phase === 'paused';
      ui.clock = el('div', { class: 'big', text: '0:00' });
      ui.size = el('div', { class: 'note', text: '' });
      box.replaceChildren(
        el('div', { class: 'ph' }, el('span', { class: 'rdot' + (paused ? ' paused' : '') }), el('span', { text: paused ? 'Paused' : 'Recording' })),
        ui.clock, ui.size,
        el('div', { class: 'row' }, btn(paused ? 'Resume' : 'Pause', paused ? 'play' : 'pause', togglePause, 'p'), btn('Stop', 'stop', stop, 's', true)),
        el('p', { class: 'note', text: 'Keeps recording while you scroll. Reloading or leaving this page stops it.' }), statusEl());
      const f = box.querySelector('.btn.main'); if (f) f.focus();
    }
    function updateLive() {
      if (!ui.clock || !S.clock) return;
      ui.clock.textContent = R.fmtClock(S.clock.activeMs(Date.now()));
      ui.size.textContent = mb(S.bytes) + ' so far';
    }

    // ---- done: summary, save, seal
    function viewDone() {
      if (S.sealing) return viewSeal();
      const i = S.info;
      box.replaceChildren(head('Recording done', true),
        el('div', { class: 'big', text: R.fmtClock(i.recorded_seconds * 1000) }),
        el('p', { class: 'note', text: mb(S.blob.size) + (i.video.width ? ' · ' + i.video.width + '×' + i.video.height : '') + ' · ' + (R.extFor(S.blob.type).toUpperCase()) + (i.pauses ? ' · ' + i.pauses + ' pause' + (i.pauses > 1 ? 's' : '') + ' left out' : '') + (i.audio.screen_or_tab_sound || i.audio.microphone ? '' : ' · no sound') }),
        S.confirmLeave
          ? el('div', null, el('p', { class: 'warn', text: 'You haven’t saved this recording. Throw it away?' }), el('div', { class: 'row' }, btn('Throw away', null, discard, 'd', true), btn('Keep it', null, () => { S.confirmLeave = false; render(); }, 'k')))
          : el('div', { class: 'row' }, btn('Save', 'download', save, 's', true), btn('Seal…', null, () => { S.sealing = true; render(); }, 'e'), btn('Discard', null, askDiscard, 'd'), btn('Record again', 'record', () => { clearTake(); setPhase('idle'); }, 'r')),
        el('p', { class: 'note', text: 'SHA-256: ' + S.sha.slice(0, 16) + '…' }), statusEl());
      const f = box.querySelector('.btn.main'); if (f) f.focus();
    }

    function viewSeal() {
      const f = { case: el('input', { type: 'text', placeholder: 'Case / matter (optional)', maxlength: '120', 'aria-label': 'Case' }), by: el('input', { type: 'text', placeholder: 'Captured by', maxlength: '120', 'aria-label': 'Captured by' }), note: el('input', { type: 'text', placeholder: 'Note (optional)', maxlength: '400', 'aria-label': 'Note' }),
        sign: el('input', { type: 'checkbox' }), stamp: el('input', { type: 'checkbox' }) };
      chrome.storage.sync.get({ capBy: '', capSign: false, capTimestamp: false }).then(s => { if (!f.by.value) f.by.value = s.capBy; f.sign.checked = !!s.capSign; f.stamp.checked = !!s.capTimestamp; }).catch(() => {});
      chrome.storage.local.get('ko:trail').then(r => { const t = r['ko:trail']; if (t && t.case && !f.case.value) f.case.value = t.case; }).catch(() => {});
      box.replaceChildren(head('Seal as evidence', true), f.case, f.by, f.note,
        el('label', { class: 'chk' }, f.sign, el('span', { text: 'Sign with this browser’s key' })),
        el('label', { class: 'chk' }, f.stamp, el('span', { text: 'Add a trusted timestamp' })),
        el('div', { class: 'row' }, btn('Seal and save .zip', null, () => seal(f), null, true), btn('Back', null, () => { S.sealing = false; render(); }, 'b')),
        statusEl(),
        el('p', { class: 'note', text: 'Makes a .zip with the recording, its details, a SHA-256 manifest and a chain-of-custody record. A timestamp needs the timestamp server allowed once in Settings.' }));
      f.by.focus();
    }

    // ---- leaving
    const busy = () => ['choosing', 'counting', 'recording', 'paused'].includes(S.phase);
    function leave() {
      if (busy()) return;
      if (S.phase === 'done' && !S.saved && !S.confirmLeave) { S.confirmLeave = true; S.sealing = false; render(); return; }
      if (S.phase === 'done') clearTake();
      S.phase = 'idle'; S.msg = ''; S.confirmLeave = false; S.sealing = false;
      api.exit();
    }
    const askDiscard = () => { if (!S.saved) { S.confirmLeave = true; render(); } else discard(); };
    function discard() { clearTake(); S.confirmLeave = false; setPhase('idle'); }
    function clearTake() { S.blob = null; S.info = null; S.sha = ''; S.saved = false; S.chunks = []; S.bytes = 0; S.sealing = false; S.confirmLeave = false; }

    // ---- recording
    function cleanup() {
      clearInterval(S.countTimer); S.countTimer = null;
      for (const s of [S.display, S.mic]) if (s) for (const t of s.getTracks()) { t.onended = null; t.stop(); }
      if (S.ctx) S.ctx.close().catch(() => {});
      S.display = S.mic = S.ctx = null;
    }

    async function begin() {
      const pick = R.pickMime(t => MediaRecorder.isTypeSupported(t), prefs.format);
      if (!pick) return say('This browser can’t record video here.', 'err');
      const note = pick.format !== prefs.format ? 'This browser can’t make ' + prefs.format.toUpperCase() + ' files, so it will make ' + pick.format.toUpperCase() + '.' : '';
      clearTake();
      setPhase('choosing');
      let display;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: !!prefs.sys });
      } catch (e) {
        setPhase('idle', e && e.name === 'NotAllowedError' ? 'Nothing was shared, so nothing is being recorded.' : 'Couldn’t start: ' + (e && e.message || e), e && e.name === 'NotAllowedError' ? '' : 'err');
        return;
      }
      let mic = null, micNote = '';
      if (prefs.mic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { micNote = 'The microphone wasn’t available (' + (e && e.message || e) + '); recording without it.'; }
      }
      S.display = display; S.mic = mic;
      const tracks = [...display.getVideoTracks()];
      const hasSys = display.getAudioTracks().length > 0;
      if (hasSys || mic) {
        S.ctx = new AudioContext();
        const dest = S.ctx.createMediaStreamDestination();
        if (hasSys) S.ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
        if (mic) S.ctx.createMediaStreamSource(mic).connect(dest);
        tracks.push(...dest.stream.getAudioTracks());
      }
      S.meta = { mime: pick.mime, hasSys, hasMic: !!mic, vs: display.getVideoTracks()[0].getSettings(), recStream: new MediaStream(tracks) };
      display.getVideoTracks()[0].onended = () => { if (S.phase === 'recording' || S.phase === 'paused') stop(); else if (S.phase === 'counting') { cleanup(); setPhase('idle', 'Sharing stopped, so nothing was recorded.'); } };
      S.msg = [note, micNote].filter(Boolean).join(' ');
      if (prefs.count) countdown(); else startRecording();
    }

    function countdown() {
      S.count = 3; setPhase('counting');
      S.countTimer = setInterval(() => {
        S.count--;
        if (S.count <= 0) { clearInterval(S.countTimer); S.countTimer = null; if (S.display && S.display.getVideoTracks()[0].readyState === 'live') startRecording(); else { cleanup(); setPhase('idle', 'Sharing stopped, so nothing was recorded.'); } }
        else if (ui.count) ui.count.textContent = String(S.count);
      }, 1000);
    }

    function startRecording() {
      const opts = { mimeType: S.meta.mime };
      const br = R.bitrateFor(prefs.quality);
      if (br) opts.videoBitsPerSecond = br;
      const rec = new MediaRecorder(S.meta.recStream, opts);
      S.rec = rec; S.chunks = []; S.bytes = 0; S.warned = false;
      rec.ondataavailable = e => {
        if (e.data && e.data.size) { S.chunks.push(e.data); S.bytes += e.data.size; }
        if (S.bytes > WARN_BYTES && !S.warned) { S.warned = true; say('This recording is over 1.5 GB and held in memory. Stop soon to be safe.', 'err'); }
      };
      rec.onstop = finish;
      rec.onerror = e => say('Recording error: ' + (e.error && e.error.message || 'unknown'), 'err');
      S.clock = R.clock(); S.clock.start(Date.now());
      rec.start(1000);
      setPhase('recording', S.msg);
    }

    function togglePause() {
      if (!S.rec) return;
      if (S.rec.state === 'recording') { S.rec.pause(); S.clock.pause(Date.now()); setPhase('paused'); }
      else if (S.rec.state === 'paused') { S.rec.resume(); S.clock.resume(Date.now()); setPhase('recording'); }
    }

    function stop() {
      if (!S.rec || S.rec.state === 'inactive') return;
      S.clock.stop(Date.now());
      S.rec.stop();
    }

    async function finish() {
      const ci = S.clock.info(), vs = S.meta.vs || {};
      const mime = S.rec.mimeType || S.meta.mime;
      S.blob = new Blob(S.chunks, { type: mime.split(';')[0] });
      S.startedAt = new Date(ci.startedAt);
      S.fileName = R.fileBase(document.title, S.startedAt) + '.' + R.extFor(mime);
      S.info = R.buildInfo({
        startedAt: ci.startedAt, stoppedAt: ci.stoppedAt, activeMs: S.clock.activeMs(ci.stoppedAt), pausedMs: ci.pausedMs, pauses: ci.pauses,
        fileName: S.fileName, mime, size: S.blob.size, width: vs.width, height: vs.height, frameRate: vs.frameRate ? Math.round(vs.frameRate) : null,
        bitrate: R.bitrateFor(prefs.quality) || null, surface: vs.displaySurface, pageUrl: location.href, pageTitle: document.title,
        systemAudio: S.meta.hasSys, microphone: S.meta.hasMic, userAgent: navigator.userAgent
      });
      cleanup();
      S.chunks = [];
      if (!S.blob.size) { setPhase('idle', 'Nothing was recorded.', 'err'); return; }
      S.saved = false;
      setPhase('done', 'Working out its fingerprint…');
      S.sha = hex(await crypto.subtle.digest('SHA-256', await S.blob.arrayBuffer()));
      if (S.phase === 'done') { S.msg = ''; render(); }
    }

    function download(blob, name) {
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    function save() { download(S.blob, S.fileName); S.saved = true; say('Saved to your Downloads folder.', 'ok'); }

    // The timestamp request goes through the background script (a page can't reach the authority itself).
    async function relayFetch(url, opts) {
      const r = await send({ type: 'ko-tsa', url, body: toB64(opts.body) });
      if (!r || !r.ok) throw new Error((r && r.error) || 'no answer from the extension');
      const out = fromB64(r.body);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, arrayBuffer: async () => out.buffer };
    }

    async function seal(f) {
      const out = ui.status;
      const hold = box.querySelectorAll('.btn'); hold.forEach(b => { b.disabled = true; });
      try {
        let tsa = null;
        if (f.stamp.checked) {
          tsa = (await chrome.storage.sync.get({ tsaUrl: 'https://freetsa.org/tsr' })).tsaUrl || 'https://freetsa.org/tsr';
          const has = await send({ type: 'ko-has-origin', url: tsa });
          if (!has || !has.has) throw new Error('Allow the timestamp server first: Settings → Investigating, screenshots and evidence → Allow.');
        }
        const by = f.by.value.trim().slice(0, 120), caseName = f.case.value.trim().slice(0, 120), note = f.note.value.trim().slice(0, 4000);
        chrome.storage.sync.set({ capBy: by, capSign: f.sign.checked, capTimestamp: f.stamp.checked }).catch(() => {});
        say('Preparing…');
        const files = [
          { name: S.fileName, data: S.blob, description: 'The screen recording exactly as the browser produced it' },
          { name: 'recording-info.json', data: JSON.stringify({ ...S.info, sha256_of_recording: S.sha }, null, 2) + '\n', description: 'When it started and stopped, how long, what was shared, whether sound was on' }
        ];
        const key = f.sign.checked ? await KNSeal.getSigningKey(true) : null;
        const info = { toolVersion: chrome.runtime.getManifest().version, case: caseName, capturedBy: by, capturedAt: S.startedAt, url: location.href, title: document.title || S.fileName, userAgent: navigator.userAgent, highlights: 0, examinerNote: note, extra: { kind: 'screen recording', recorded_seconds: S.info.recorded_seconds } };
        const res = await KNSeal.build({ files, info, signing: key, tsaUrl: tsa, onStatus: say, fetchImpl: tsa ? relayFetch : undefined });
        const base = R.fileBase(document.title, S.startedAt).replace(/^Recording/, 'Evidence recording');
        say('Packing the .zip…');
        download(await KNSeal.zipEntries(base, res.entries, S.startedAt), base + '.zip');
        S.saved = true;
        const log = (await chrome.storage.local.get('kn:seals'))['kn:seals'] || [];
        log.push(KNEvidence.logRow(info, res.manifestHash, base + '.zip'));
        await chrome.storage.local.set({ 'kn:seals': log.slice(-500) });
        say('Sealed and saved to Downloads. Manifest fingerprint: ' + res.manifestHash.slice(0, 16) + '…' + (res.warnings.length ? ' ' + res.warnings.join(' ') : ''), res.warnings.length ? 'err' : 'ok');
      } catch (e) { say('Couldn’t seal: ' + (e && e.message || e), 'err'); }
      finally { hold.forEach(b => { b.disabled = false; }); }
    }

    // Closing or reloading the page would lose the recording: ask first.
    window.addEventListener('beforeunload', e => { if (busy() && S.phase !== 'choosing' && S.phase !== 'counting' || (S.phase === 'done' && !S.saved)) { e.preventDefault(); e.returnValue = ''; } });

    return {
      show: () => render(),
      phase: () => S.phase,
      busy,
      leave,
      // Esc: go back when that is safe; never stops a recording by accident
      escape: () => { if (S.phase === 'done' && S.sealing) { S.sealing = false; render(); } else if (!busy()) leave(); },
      reset: () => { if (!busy() && S.phase !== 'done') { S.phase = 'idle'; S.msg = ''; } }
    };
  }

  root.KODockRecord = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
