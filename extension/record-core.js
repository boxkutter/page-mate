// Screen recording helpers: pure logic (format choice, pause-aware clock, the record that goes with a recording).
(function (root) {
  const CANDIDATES = {
    webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
    mp4: ['video/mp4;codecs=avc1.64001F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']
  };
  // isSupported: MediaRecorder.isTypeSupported. -> { mime, format } or null if neither format works.
  function pickMime(isSupported, want = 'webm') {
    for (const fmt of want === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4']) {
      const m = CANDIDATES[fmt].find(t => { try { return isSupported(t); } catch (_) { return false; } });
      if (m) return { mime: m, format: fmt };
    }
    return null;
  }
  const extFor = mime => (/mp4/.test(mime) ? 'mp4' : 'webm');

  const BITRATES = { low: 1_000_000, medium: 2_500_000, high: 5_000_000, max: 8_000_000 };
  const bitrateFor = preset => BITRATES[preset] || 0;   // 0 = let the browser decide

  // Tracks wall-clock time and how much of it was spent paused.
  function clock() {
    let start = null, pausedAt = null, paused = 0, pauses = 0, stopped = null;
    return {
      start(now) { start = now; },
      pause(now) { if (start != null && pausedAt == null && stopped == null) { pausedAt = now; pauses++; } },
      resume(now) { if (pausedAt != null) { paused += now - pausedAt; pausedAt = null; } },
      stop(now) { if (pausedAt != null) { paused += now - pausedAt; pausedAt = null; } stopped = now; },
      activeMs(now) { if (start == null) return 0; const end = stopped != null ? stopped : now; return Math.max(0, end - start - paused - (pausedAt != null ? end - pausedAt : 0)); },
      info() { return { startedAt: start, stoppedAt: stopped, pausedMs: paused, pauses }; }
    };
  }

  function fmtClock(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
  }

  function fileBase(title, at) {
    const t = String(title || 'recording').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'recording';
    return 'Recording - ' + t + ' - ' + at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }

  const SURFACES = { monitor: 'A whole screen', window: 'One window', browser: 'A browser tab' };

  // The facts stored next to a recording. Everything here is what the browser reported; nothing is guessed.
  function buildInfo(x) {
    return {
      started_at_utc: new Date(x.startedAt).toISOString(),
      stopped_at_utc: new Date(x.stoppedAt).toISOString(),
      recorded_seconds: Math.round(x.activeMs / 100) / 10,
      paused_seconds: Math.round((x.pausedMs || 0) / 100) / 10,
      pauses: x.pauses || 0,
      file: { name: x.fileName, type: x.mime, bytes: x.size },
      video: { width: x.width || null, height: x.height || null, frame_rate: x.frameRate || null, bits_per_second: x.bitrate || null },
      source: { kind: SURFACES[x.surface] || x.surface || 'not reported', started_from_page: x.pageUrl || '', page_title: x.pageTitle || '' },
      audio: { screen_or_tab_sound: !!x.systemAudio, microphone: !!x.microphone },
      note: 'Recorded in the browser with MediaRecorder; the file is exactly what the browser produced (no re-encoding). WebM files from browsers often lack a duration header, so some players show no length or cannot jump around; the recorded duration above is measured.',
      browser: x.userAgent || ''
    };
  }

  const api = { pickMime, extFor, bitrateFor, clock, fmtClock, fileBase, buildInfo, SURFACES, CANDIDATES };
  root.KORecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
