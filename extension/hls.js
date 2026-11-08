// HLS (.m3u8) support: parse playlists and download a stream into one file.
//
// Supported: master + media playlists, EXT-X-BYTERANGE, EXT-X-MAP (fragmented
// MP4), AES-128 encryption with a key the server hands out (the ordinary
// "clear key" case, decrypted here with WebCrypto).
// Not supported, on purpose: DRM (SAMPLE-AES, FairPlay, Widevine, PlayReady)
// and live streams. Those are reported with a clear error instead.
(function (root) {
  class HlsError extends Error {
    constructor(message, code) { super(message); this.name = 'HlsError'; this.code = code || 'hls'; }
  }

  // ---- parsing ----

  function parseAttrs(str) {
    const out = {};
    const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
    let m;
    while ((m = re.exec(str))) out[m[1]] = m[3] != null ? m[3] : m[2];
    return out;
  }

  function resolve(uri, base) {
    return new URL(uri, base).href;
  }

  function parseByteRange(v, prevEnd) {
    const m = /^(\d+)(?:@(\d+))?$/.exec(String(v || '').trim());
    if (!m) return null;
    const len = +m[1];
    const start = m[2] != null ? +m[2] : prevEnd;
    return { start, end: start + len - 1 };
  }

  function parsePlaylist(text, baseUrl) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim());
    if (!lines.length || !lines[0].startsWith('#EXTM3U')) throw new HlsError('That address is not an HLS playlist.', 'not-hls');

    const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));
    if (isMaster) return parseMaster(lines, baseUrl);
    return parseMedia(lines, baseUrl);
  }

  function parseMaster(lines, baseUrl) {
    const variants = [];
    const audios = [];
    const subtitles = [];
    let pending = null;
    let drm = false;
    for (const line of lines) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        pending = parseAttrs(line.slice(18));
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        const a = parseAttrs(line.slice(13));
        if (a.URI) {
          const item = { group: a['GROUP-ID'] || '', name: a.NAME || '', lang: a.LANGUAGE || '', def: a.DEFAULT === 'YES', uri: resolve(a.URI, baseUrl) };
          if (a.TYPE === 'AUDIO') audios.push(item);
          else if (a.TYPE === 'SUBTITLES') subtitles.push(item);
        }
      } else if (line.startsWith('#EXT-X-SESSION-KEY:') || line.startsWith('#EXT-X-KEY:')) {
        if (keyIsDrm(parseAttrs(line.slice(line.indexOf(':') + 1)))) drm = true;
      } else if (pending && line && !line.startsWith('#')) {
        const res = /^(\d+)x(\d+)$/.exec(pending.RESOLUTION || '');
        variants.push({
          uri: resolve(line, baseUrl),
          bandwidth: parseInt(pending.BANDWIDTH || pending['AVERAGE-BANDWIDTH'], 10) || 0,
          width: res ? +res[1] : 0,
          height: res ? +res[2] : 0,
          codecs: pending.CODECS || '',
          audioGroup: pending.AUDIO || ''
        });
        pending = null;
      }
    }
    variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
    return { type: 'master', variants, audios, subtitles, drm };
  }

  function keyIsDrm(a) {
    const method = (a.METHOD || 'NONE').toUpperCase();
    if (method === 'NONE') return false;
    if (method !== 'AES-128') return true; // SAMPLE-AES and friends
    const fmt = (a.KEYFORMAT || 'identity').toLowerCase();
    return fmt !== 'identity';
  }

  function parseMedia(lines, baseUrl) {
    const segments = [];
    let seq = 0;
    let key = null;         // current key { uri, iv }
    let map = null;         // current init segment { uri, range }
    let duration = 0;
    let range = null;
    let prevEnd = 0;
    let endList = false;
    let drm = false;
    let encrypted = false;
    let target = 0;
    let discontinuities = 0;

    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = parseInt(line.slice(22), 10) || 0;
      else if (line.startsWith('#EXT-X-TARGETDURATION:')) target = parseInt(line.slice(22), 10) || 0;
      else if (line.startsWith('#EXT-X-ENDLIST')) endList = true;
      else if (line.startsWith('#EXT-X-DISCONTINUITY')) discontinuities++;
      else if (line.startsWith('#EXTINF:')) duration = parseFloat(line.slice(8)) || 0;
      else if (line.startsWith('#EXT-X-BYTERANGE:')) range = parseByteRange(line.slice(17), prevEnd);
      else if (line.startsWith('#EXT-X-KEY:')) {
        const a = parseAttrs(line.slice(11));
        if (keyIsDrm(a)) { drm = true; key = null; }
        else if ((a.METHOD || 'NONE').toUpperCase() === 'AES-128' && a.URI) {
          key = { uri: resolve(a.URI, baseUrl), iv: a.IV || '' };
          encrypted = true;
        } else key = null;
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const a = parseAttrs(line.slice(11));
        if (a.URI) {
          const br = a.BYTERANGE ? parseByteRange(a.BYTERANGE, 0) : null;
          map = { uri: resolve(a.URI, baseUrl), range: br };
        }
      } else if (!line.startsWith('#')) {
        segments.push({ uri: resolve(line, baseUrl), duration, range, key, seq: seq + segments.length, map });
        if (range) prevEnd = range.end + 1;
        range = null;
        duration = 0;
      }
    }
    const total = segments.reduce((n, s) => n + s.duration, 0);
    return { type: 'media', segments, drm, encrypted, endList, target, duration: total, discontinuities, fmp4: !!map || segments.some(s => /\.(m4s|mp4|cmfv|cmfa)(\?|$)/i.test(s.uri)) };
  }

  // ---- decryption ----

  function ivFor(segment) {
    if (segment.key && segment.key.iv) {
      const hex = segment.key.iv.replace(/^0x/i, '').padStart(32, '0');
      const iv = new Uint8Array(16);
      for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16);
      return iv;
    }
    // Default IV: the media sequence number as a 128-bit big-endian integer.
    const iv = new Uint8Array(16);
    let n = segment.seq;
    for (let i = 15; i >= 8 && n > 0; i--) { iv[i] = n % 256; n = Math.floor(n / 256); }
    return iv;
  }

  async function decrypt(data, keyBytes, iv) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
  }

  // ---- downloading ----

  // io: { fetch(url, { range, signal }) -> Promise<ArrayBuffer> }
  // Returns { blob, ext, segments, bytes }.
  async function downloadMedia(playlist, io, { signal, onProgress, concurrency = 5 } = {}) {
    if (playlist.drm) throw new HlsError('This stream is DRM-protected (encrypted with a licence key). It can’t be saved.', 'drm');
    if (!playlist.endList) throw new HlsError('This looks like a live stream that hasn’t ended. Try again when it’s over.', 'live');
    if (!playlist.segments.length) throw new HlsError('The playlist has no video segments.', 'empty');

    const segs = playlist.segments;
    const keys = new Map();
    const getKey = async uri => {
      if (!keys.has(uri)) {
        keys.set(uri, io.fetch(uri, { signal }).then(b => {
          if (b.byteLength !== 16) throw new HlsError('The decryption key wasn’t what was expected (the site may be protecting it).', 'key');
          return new Uint8Array(b);
        }));
      }
      return keys.get(uri);
    };

    const parts = new Array(segs.length);
    let done = 0;
    let bytes = 0;

    // fMP4 streams start with an initialisation segment.
    let initBlob = null;
    const firstMap = segs.find(s => s.map);
    if (firstMap) {
      const b = await io.fetch(firstMap.map.uri, { range: firstMap.map.range, signal });
      initBlob = new Blob([b]);
      bytes += b.byteLength;
    }

    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= segs.length) return;
        const s = segs[i];
        let attempt = 0;
        for (;;) {
          try {
            let data = await io.fetch(s.uri, { range: s.range, signal });
            if (s.key) data = (await decrypt(data, await getKey(s.key.uri), ivFor(s))).buffer;
            parts[i] = new Blob([data]);
            bytes += data.byteLength;
            break;
          } catch (e) {
            if ((signal && signal.aborted) || e.name === 'AbortError' || e.code === 'key' || ++attempt >= 3) throw e;
            await new Promise(r => setTimeout(r, 400 * attempt));
          }
        }
        done++;
        if (onProgress) onProgress({ done, total: segs.length, bytes });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, segs.length) }, worker));

    const ext = playlist.fmp4 ? 'mp4' : 'ts';
    const blob = new Blob(initBlob ? [initBlob, ...parts] : parts, { type: ext === 'mp4' ? 'video/mp4' : 'video/mp2t' });
    return { blob, ext, segments: segs.length, bytes };
  }

  // Picks the entry matching a chosen quality, or the best one.
  function bestVariant(master, height) {
    if (!master.variants.length) return null;
    if (height) {
      const exact = master.variants.find(v => v.height === height);
      if (exact) return exact;
    }
    return master.variants[0];
  }

  // The separate audio playlist a variant needs, if its audio isn't muxed in.
  function audioFor(master, variant) {
    if (!variant || !variant.audioGroup) return null;
    const group = master.audios.filter(a => a.group === variant.audioGroup);
    return group.find(a => a.def) || group[0] || null;
  }

  const api = { HlsError, parsePlaylist, parseAttrs, downloadMedia, bestVariant, audioFor, ivFor, keyIsDrm };
  root.KRHls = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
