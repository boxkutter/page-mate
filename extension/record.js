// Screen recorder: getDisplayMedia (the browser's own picker) -> MediaRecorder -> one file.
// No extra permission is needed, nothing is uploaded, and the file is exactly what the browser produced.
(function () {
  const R = KORecord;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab')) || null;
  const WARN_BYTES = 1.5 * 1024 * 1024 * 1024;
  const st = { stream: null, mic: null, ctx: null, rec: null, chunks: [], bytes: 0, clock: null, timer: null, blob: null, meta: null, url: '', sha: '', countTimer: null, source: { url: '', title: '' } };

  const setStatus = (t, k) => { $('status').textContent = t || ''; $('status').className = 'status' + (k ? ' ' + k : ''); };
  const mb = n => n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + ' MB';
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const show = which => { for (const id of ['idle', 'counting', 'live', 'done']) $(id).hidden = id !== which; $('optCard').hidden = which === 'live' || which === 'counting'; $('sealCard').hidden = which !== 'done'; $('infoCard').hidden = which !== 'done'; };

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function cleanupStreams() {
    for (const s of [st.stream, st.mic]) if (s) for (const t of s.getTracks()) { t.onended = null; t.stop(); }
    if (st.ctx) st.ctx.close().catch(() => {});
    st.stream = st.mic = st.ctx = null;
  }

  async function begin() {
    $('start').disabled = true;
    setStatus('');
    const want = $('format').value;
    const pick = R.pickMime(t => MediaRecorder.isTypeSupported(t), want);
    if (!pick) { setStatus('This browser can’t record video here.', 'err'); $('start').disabled = false; return; }
    if (pick.format !== want) setStatus('This browser can’t make ' + want.toUpperCase() + ' files, so it will make ' + pick.format.toUpperCase() + '.');
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: Number($('fps').value) } }, audio: $('sysAudio').checked });
    } catch (e) {
      setStatus(e && e.name === 'NotAllowedError' ? 'Nothing was shared, so nothing is being recorded.' : 'Couldn’t start: ' + (e && e.message || e), e && e.name === 'NotAllowedError' ? '' : 'err');
      $('start').disabled = false; return;
    }
    let mic = null;
    if ($('mic').checked) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { setStatus('The microphone wasn’t available (' + (e && e.message || e) + '); recording without it.', 'err'); }
    }
    st.stream = display; st.mic = mic;

    // one audio track: screen sound and microphone mixed
    const tracks = [...display.getVideoTracks()];
    const hasSys = display.getAudioTracks().length > 0;
    if (hasSys || mic) {
      st.ctx = new AudioContext();
      const dest = st.ctx.createMediaStreamDestination();
      if (hasSys) st.ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
      if (mic) st.ctx.createMediaStreamSource(mic).connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    }
    st.meta = { mime: pick.mime, hasSys, hasMic: !!mic, vs: display.getVideoTracks()[0].getSettings() };
    st.recStream = new MediaStream(tracks);
    st.display = display;
    $('start').disabled = false;

    if ($('countdown').checked) await countdown(); else startRecording();
  }

  function countdown() {
    return new Promise(resolve => {
      show('counting');
      let n = 3; $('count').textContent = n;
      st.countTimer = setInterval(() => {
        n--;
        if (n <= 0) { clearInterval(st.countTimer); st.countTimer = null; startRecording(); resolve(); }
        else $('count').textContent = n;
      }, 1000);
      st.cancelCount = () => { clearInterval(st.countTimer); st.countTimer = null; cleanupStreams(); show('idle'); setStatus('Cancelled.'); resolve(); };
    });
  }
  $('cancelCount').addEventListener('click', () => st.cancelCount && st.cancelCount());

  function startRecording() {
    const opts = { mimeType: st.meta.mime };
    const br = R.bitrateFor($('quality').value);
    if (br) opts.videoBitsPerSecond = br;
    const rec = new MediaRecorder(st.recStream, opts);
    st.rec = rec; st.chunks = []; st.bytes = 0;
    rec.ondataavailable = e => {
      if (e.data && e.data.size) { st.chunks.push(e.data); st.bytes += e.data.size; }
      $('liveSize').textContent = mb(st.bytes) + ' so far';
      if (st.bytes > WARN_BYTES && !st.warned) { st.warned = true; setStatus('This recording is over 1.5 GB and held in memory. Stop soon to be safe.', 'err'); }
    };
    rec.onstop = finish;
    rec.onerror = e => setStatus('Recording error: ' + (e.error && e.error.message || 'unknown'), 'err');
    // sharing stopped from the browser's own bar
    st.display.getVideoTracks()[0].onended = () => { if (st.rec && st.rec.state !== 'inactive') stop(); };
    st.clock = R.clock(); st.clock.start(Date.now()); st.warned = false;
    rec.start(1000);
    show('live');
    $('pause').textContent = 'Pause'; $('dot').className = 'dot';
    st.timer = setInterval(() => { $('clock').textContent = R.fmtClock(st.clock.activeMs(Date.now())); }, 250);
    document.title = '● Recording';
  }

  function togglePause() {
    if (!st.rec) return;
    if (st.rec.state === 'recording') { st.rec.pause(); st.clock.pause(Date.now()); $('pause').textContent = 'Resume'; $('dot').className = 'dot paused'; document.title = '❚❚ Paused'; }
    else if (st.rec.state === 'paused') { st.rec.resume(); st.clock.resume(Date.now()); $('pause').textContent = 'Pause'; $('dot').className = 'dot'; document.title = '● Recording'; }
  }

  function stop() {
    if (!st.rec || st.rec.state === 'inactive') return;
    st.clock.stop(Date.now());
    clearInterval(st.timer);
    st.rec.stop();
  }

  async function finish() {
    const ci = st.clock.info();
    const vs = st.meta.vs || {};
    const mime = st.rec.mimeType || st.meta.mime;
    st.blob = new Blob(st.chunks, { type: mime.split(';')[0] });
    const startedAt = new Date(ci.startedAt);
    const fileName = R.fileBase(st.source.title, startedAt) + '.' + R.extFor(mime);
    st.info = R.buildInfo({
      startedAt: ci.startedAt, stoppedAt: ci.stoppedAt, activeMs: st.clock.activeMs(ci.stoppedAt), pausedMs: ci.pausedMs, pauses: ci.pauses,
      fileName, mime, size: st.blob.size, width: vs.width, height: vs.height, frameRate: vs.frameRate ? Math.round(vs.frameRate) : null,
      bitrate: R.bitrateFor($('quality').value) || null, surface: vs.displaySurface, pageUrl: st.source.url, pageTitle: st.source.title,
      systemAudio: st.meta.hasSys, microphone: st.meta.hasMic, userAgent: navigator.userAgent
    });
    st.fileName = fileName; st.startedAt = startedAt;
    cleanupStreams();
    document.title = 'Recording done';
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(st.blob);
    $('player').src = st.url;
    show('done');
    if (!st.blob.size) { setStatus('Nothing was recorded.', 'err'); return; }
    setStatus('');
    st.sha = hex(await crypto.subtle.digest('SHA-256', await st.blob.arrayBuffer()));
    const rows = [['Recorded', st.info.started_at_utc.replace('T', ' ').replace(/\.\d+Z$/, 'Z')], ['Length', R.fmtClock(st.info.recorded_seconds * 1000) + (st.info.pauses ? ' (' + st.info.pauses + ' pause' + (st.info.pauses > 1 ? 's' : '') + ' left out)' : '')],
      ['Size', mb(st.blob.size) + ' · ' + (vs.width ? vs.width + '×' + vs.height : '') + (st.info.video.frame_rate ? ' · ' + st.info.video.frame_rate + ' fps' : '')], ['Shared', st.info.source.kind], ['Sound', [st.info.audio.screen_or_tab_sound ? 'screen / tab' : '', st.info.audio.microphone ? 'microphone' : ''].filter(Boolean).join(' + ') || 'none'], ['Type', mime], ['SHA-256', st.sha]];
    $('info').replaceChildren(...rows.map(r => { const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td'); th.textContent = r[0]; td.textContent = r[1]; if (r[0] === 'SHA-256') td.className = 'mono'; tr.append(th, td); return tr; }));
  }

  $('start').addEventListener('click', begin);
  $('pause').addEventListener('click', togglePause);
  $('stop').addEventListener('click', stop);
  $('save').addEventListener('click', () => { download(st.blob, st.fileName); setStatus('Saved to your Downloads folder.', 'ok'); });
  $('again').addEventListener('click', () => { if (st.url) URL.revokeObjectURL(st.url); st.url = ''; st.blob = null; $('player').removeAttribute('src'); show('idle'); setStatus(''); });
  $('discard').addEventListener('click', () => { if (confirm('Throw this recording away?')) $('again').click(); });
  window.addEventListener('beforeunload', e => { if (st.rec && st.rec.state !== 'inactive') { e.preventDefault(); e.returnValue = ''; } else if (st.blob && !st.saved) { /* quiet: user may have saved */ } });

  // ---------- seal ----------
  async function initSeal() {
    const s = await chrome.storage.sync.get({ capBy: '', capSign: false, capTimestamp: false, tsaUrl: 'https://freetsa.org/tsr' });
    $('by').value = s.capBy; $('sign').checked = !!s.capSign; $('stamp').checked = !!s.capTimestamp;
    const sel = $('tsa');
    for (const t of KOTrust.TSA_PRESETS) { const o = document.createElement('option'); o.value = t.url; o.textContent = t.name; sel.append(o); }
    const other = document.createElement('option'); other.value = ''; other.textContent = 'Another server…'; sel.append(other);
    const known = KOTrust.TSA_PRESETS.some(t => t.url === s.tsaUrl);
    sel.value = known ? s.tsaUrl : ''; $('tsaCustom').value = known ? '' : s.tsaUrl;
    const sync = () => { $('tsaRow').hidden = !$('stamp').checked; $('tsaCustom').hidden = sel.value !== ''; };
    $('stamp').addEventListener('change', sync); sel.addEventListener('change', sync); sync();
    try {
      const idx = (await chrome.storage.local.get('kn:idx'))['kn:idx'] || {};
      $('cases').replaceChildren(...[...new Set(Object.values(idx).map(e => e.case).filter(Boolean))].map(c => { const o = document.createElement('option'); o.value = c; return o; }));
      const trail = (await chrome.storage.local.get('ko:trail'))['ko:trail'];
      if (trail && trail.case) $('case').value = trail.case;
    } catch (_) {}
  }

  $('seal').addEventListener('click', async () => {
    const out = $('sealStatus'), say = (t, k) => { out.textContent = t; out.className = 'status' + (k ? ' ' + k : ''); };
    $('seal').disabled = true;
    try {
      let tsa = null;
      if ($('stamp').checked) {
        tsa = $('tsa').value || $('tsaCustom').value.trim();
        if (!/^https?:\/\//i.test(tsa)) throw new Error('Enter the timestamp server’s address.');
        if (!(await KNSeal.ensureOriginAccess(tsa))) throw new Error('Access to the timestamp server was not allowed.');
      }
      const by = $('by').value.trim().slice(0, 120), caseName = $('case').value.trim().slice(0, 120), note = $('note').value.trim().slice(0, 4000);
      chrome.storage.sync.set({ capBy: by, capSign: $('sign').checked, capTimestamp: $('stamp').checked, ...(tsa ? { tsaUrl: tsa } : {}) }).catch(() => {});
      say('Preparing…');
      const files = [
        { name: st.fileName, data: st.blob, description: 'The screen recording exactly as the browser produced it' },
        { name: 'recording-info.json', data: JSON.stringify({ ...st.info, sha256_of_recording: st.sha }, null, 2) + '\n', description: 'When it started and stopped, how long, what was shared, whether sound was on' }
      ];
      const key = $('sign').checked ? await KNSeal.getSigningKey(true) : null;
      const info = { toolVersion: chrome.runtime.getManifest().version, case: caseName, capturedBy: by, capturedAt: st.startedAt, url: st.source.url, title: st.source.title || st.fileName, userAgent: navigator.userAgent, highlights: 0, examinerNote: note, extra: { kind: 'screen recording', recorded_seconds: st.info.recorded_seconds } };
      const res = await KNSeal.build({ files, info, signing: key, tsaUrl: tsa, onStatus: say });
      const base = R.fileBase(st.source.title, st.startedAt).replace(/^Recording/, 'Evidence recording');
      say('Packing the .zip…');
      const zip = await KNSeal.zipEntries(base, res.entries, st.startedAt);
      download(zip, base + '.zip');
      const log = (await chrome.storage.local.get('kn:seals'))['kn:seals'] || [];
      log.push(KNEvidence.logRow(info, res.manifestHash, base + '.zip'));
      await chrome.storage.local.set({ 'kn:seals': log.slice(-500) });
      say('Sealed and saved to Downloads. Manifest fingerprint: ' + res.manifestHash + (res.warnings.length ? ' — ' + res.warnings.join(' ') : ''), res.warnings.length ? 'err' : 'ok');
    } catch (e) { say('Couldn’t seal: ' + (e && e.message || e), 'err'); }
    finally { $('seal').disabled = false; }
  });

  (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { $('start').disabled = true; $('startHint').textContent = 'This browser can’t record the screen.'; }
    if (tabId) { try { const t = await chrome.tabs.get(tabId); st.source = { url: t.url || '', title: t.title || '' }; } catch (_) {} }
    await initSeal();
  })();
})();
