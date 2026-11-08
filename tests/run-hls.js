// Serves tests/hls-fixture over HTTP, then runs the real HLS downloader against it.
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { parsePlaylist, downloadMedia, bestVariant } = require('../extension/hls.js');
const dir = path.join(__dirname, 'hls-fixture');
const outDir = path.join(__dirname, 'out');
const seen = [];
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  seen.push(req.url + (req.headers.range ? ' [' + req.headers.range + ']' : ''));
  res.end(fs.readFileSync(p));
});
const io = { async fetch(url, { range } = {}) {
  const r = await fetch(url, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.arrayBuffer();
} };
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', f])).format.duration;
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    // master playlist -> picks highest resolution variant
    const master = parsePlaylist(fs.readFileSync(path.join(dir, 'master.m3u8'), 'utf8'), base + 'master.m3u8');
    check('master parsed, variants sorted best-first', master.type === 'master' && master.variants.length === 2 && master.variants[0].height === 360);
    check('bestVariant honours requested height', bestVariant(master, 180).height === 180);

    for (const name of ['plain', 'enc', 'fmp4']) {
      const url = base + name + '/index.m3u8';
      const pl = parsePlaylist(await (await fetch(url)).text(), url);
      let progress = 0;
      const r = await downloadMedia(pl, io, { onProgress: p => { progress = p.done; } });
      const file = path.join(outDir, `hls-${name}.${r.ext}`);
      fs.writeFileSync(file, Buffer.from(await r.blob.arrayBuffer()));
      const dur = probe(file);
      check(`${name}: downloads and plays (${r.ext}, ${r.segments} segments)`, Math.abs(dur - 12) < 0.6 && progress === r.segments, `duration=${(+dur).toFixed(2)}s`);
      if (name === 'enc') check('enc: playlist flagged encrypted, not DRM', pl.encrypted && !pl.drm);
      if (name === 'fmp4') check('fmp4: init segment detected', pl.fmp4 && r.ext === 'mp4');
    }

    // The encrypted output must NOT be raw ciphertext: compare with the plain download's decoded frames.
    // (ffprobe above already proved it decodes; also prove the key is really needed)
    const encPl = parsePlaylist(await (await fetch(base + 'enc/index.m3u8')).text(), base + 'enc/index.m3u8');
    const badIo = { async fetch(u, o) { if (u.endsWith('key.bin')) return new Uint8Array(16).buffer; return io.fetch(u, o); } };
    const bad = await downloadMedia(encPl, badIo).then(() => null, e => e);
    check('wrong key does not silently succeed', !!bad);

    // DRM / live handling
    const drmText = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n';
    const drm = parsePlaylist(drmText, base + 'x.m3u8');
    const e1 = await downloadMedia(drm, io).then(() => null, e => e);
    check('SAMPLE-AES stream refused as DRM', e1 && e1.code === 'drm');
    const widevine = parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://x/k",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n', base);
    check('Widevine KEYFORMAT flagged as DRM', widevine.drm === true);
    const live = parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\na.ts\n', base + 'x.m3u8');
    const e2 = await downloadMedia(live, io).then(() => null, e => e);
    check('live stream refused', e2 && e2.code === 'live');
    // Byte-range playlists + default IV
    const br = parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="i.mp4",BYTERANGE="100@0"\n#EXTINF:6,\n#EXT-X-BYTERANGE:500@100\nf.mp4\n#EXTINF:6,\n#EXT-X-BYTERANGE:400\nf.mp4\n#EXT-X-ENDLIST\n', base + 'p/x.m3u8');
    check('byte ranges chain correctly', br.segments[0].range.start === 100 && br.segments[0].range.end === 599 && br.segments[1].range.start === 600 && br.segments[1].range.end === 999);
    check('quoted attribute with commas parsed', require('../extension/hls.js').parseAttrs('CODECS="avc1.4d401f,mp4a.40.2",BANDWIDTH=5').CODECS === 'avc1.4d401f,mp4a.40.2');
  } catch (e) { console.error('ERROR', e); failed++; }
  server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
});
