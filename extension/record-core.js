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

  // ---- playable on Linux players ----
  // Chrome-family browsers mark every WebM they record as "may contain an alpha channel" (a one-byte flag, AlphaMode = 1, in the
  // video track's header), even for screen capture, whose frames have none. GStreamer, which GNOME's Videos / Showtime use, then sends the
  // stream to its alpha decoder, which fails with "Cannot handle streams without an initial alpha buffer", and the player says it
  // lacks a codec. Clearing that one byte fixes playback and changes nothing else (the picture and sound data are untouched).
  const ID = { SEGMENT: 0x18538067, TRACKS: 0x1654AE6B, TRACK_ENTRY: 0xAE, VIDEO: 0xE0, CLUSTER: 0x1F43B675, ALPHA_MODE: 0x53C0 };
  const WALK_INTO = new Set([ID.SEGMENT, ID.TRACKS, ID.TRACK_ENTRY, ID.VIDEO]);

  // Reads an EBML variable-length number at pos. keepMarker: element ids keep their length marker, sizes lose it.
  function vint(u8, pos, keepMarker) {
    if (pos >= u8.length || u8[pos] === 0) return null;
    const first = u8[pos];
    let len = 1, mask = 0x80;
    while (!(first & mask)) { mask >>= 1; len++; }
    if (pos + len > u8.length) return null;
    let value = keepMarker ? first : (first & (mask - 1));
    let ones = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < len; i++) { value = value * 256 + u8[pos + i]; if (u8[pos + i] !== 0xff) ones = false; }
    return { value, len, unknown: !keepMarker && ones };
  }

  // -> the index of the AlphaMode value byte when it is set to 1 inside Segment > Tracks > TrackEntry > Video; otherwise -1.
  // Only the file's header is read (it ends at the first Cluster); look-alike bytes anywhere else are never touched.
  function findAlphaMode(u8) {
    let budget = 400;
    let done = false;
    function walk(start, stop, parent) {
      let p = start;
      while (p < stop && !done && budget-- > 0) {
        const id = vint(u8, p, true);
        const sz = id && vint(u8, p + id.len, false);
        if (!id || !sz) { done = true; return -1; }
        const body = p + id.len + sz.len;
        const end = sz.unknown ? stop : Math.min(stop, body + sz.value);
        if (id.value === ID.CLUSTER) { done = true; return -1; }
        if (id.value === ID.ALPHA_MODE && parent === ID.VIDEO) { done = true; return sz.value === 1 && body < u8.length && u8[body] === 1 ? body : -1; }
        if (WALK_INTO.has(id.value)) { const r = walk(body, end, id.value); if (done) return r; }
        p = end;
      }
      return -1;
    }
    // top level: the EBML header, then the Segment
    return walk(0, u8.length, 0);
  }

  // blob: what MediaRecorder made. -> { blob, adjustments: [] } (the same blob when nothing needed changing).
  // Only the first 8 KB is read and rewritten; the rest of the file is referenced, not copied.
  async function fixWebm(blob, limit = 8192) {
    if (!blob || !/webm/.test(blob.type || '') || typeof blob.slice !== 'function') return { blob, adjustments: [] };
    const head = new Uint8Array(await blob.slice(0, limit).arrayBuffer());
    const at = findAlphaMode(head);
    if (at < 0) return { blob, adjustments: [] };
    head[at] = 0;
    return {
      blob: new Blob([head, blob.slice(limit)], { type: blob.type }),
      adjustments: [{ what: 'AlphaMode flag in the video track header changed from 1 to 0 (one byte, at offset ' + at + ')', why: 'so Linux players that use GStreamer (GNOME Videos / Showtime) can open it', picture_and_sound_data: 'untouched' }]
    };
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
      adjustments: x.adjustments || [],
      note: 'Recorded in the browser with MediaRecorder; the file is what the browser produced (no re-encoding)' + ((x.adjustments || []).length ? ', except for the header adjustment listed above, which leaves the picture and sound data untouched' : '') + '. WebM files from browsers often lack a duration header, so some players show no length or cannot jump around; the recorded duration above is measured.',
      browser: x.userAgent || ''
    };
  }

  const api = { pickMime, extFor, bitrateFor, clock, fmtClock, fileBase, buildInfo, findAlphaMode, fixWebm, SURFACES, CANDIDATES };
  root.KORecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
