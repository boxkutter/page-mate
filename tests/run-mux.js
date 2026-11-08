// Tests the vendored TS->MP4 converter: output must decode, keep duration, and keep every video frame bit-identical.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
require('../extension/vendor/ts2mp4.min.js');
const out = path.join(__dirname, 'out');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
// Compare DECODED output: TS packs H.264 with start codes and MP4 length-prefixed, so raw packet bytes always differ.
const videoHashes = f => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v:0', '-f', 'framemd5', '-'], { maxBuffer: 1 << 26 }).toString().split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').slice(-1)[0].trim());
const audioPcm = f => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:a:0', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
const dur = f => +JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', f])).format.duration;

(async () => {
  for (const [name, file] of [['plain TS', 'hls-plain.ts'], ['decrypted TS', 'hls-enc.ts'], ['fragmented MP4', 'hls-fmp4.mp4']]) {
    let prog = 0;
    const r = await KRMux.toMp4(new Blob([fs.readFileSync(path.join(out, file))]), { onProgress: p => { prog = p; } });
    const dst = path.join(out, 'conv-' + file.replace(/\.\w+$/, '.mp4'));
    fs.writeFileSync(dst, Buffer.from(await r.blob.arrayBuffer()));
    const src = path.join(out, file);
    check(name + ': converts, duration kept', Math.abs(dur(dst) - dur(src)) < 0.1, dur(src).toFixed(2) + 's -> ' + dur(dst).toFixed(2) + 's');
    check(name + ': progress reported to 100%', prog === 1);
    execFileSync('ffmpeg', ['-v', 'error', '-i', dst, '-f', 'null', '-']);
    check(name + ': decodes with no errors', true);
    const a = videoHashes(src), b = videoHashes(dst);
    check(name + ': every video frame identical (no re-encode, no quality loss)', a.length > 100 && a.length === b.length && a.every((x, i) => x === b[i]), a.length + ' frames');
    const pa = audioPcm(src), pb = audioPcm(dst);
    const n = Math.min(pa.length, pb.length), off = Math.abs(pa.length - pb.length);
    // AAC "priming" samples may be trimmed by the MP4's edit list; everything that remains must match exactly.
    let same = off <= 4096 * 4; for (let i = 0; same && i < n - off; i++) if (pa[pa.length - 1 - i] !== pb[pb.length - 1 - i]) same = false;
    check(name + ': decoded audio identical', pa.length > 0 && same, (pa.length / 4) + ' vs ' + (pb.length / 4) + ' samples');
    const head = fs.readFileSync(dst).subarray(0, 64).toString('latin1');
    check(name + ': standard MP4 (ftyp, not fragmented)', head.includes('ftyp') && !execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=major_brand', '-of', 'csv=p=0', dst]).toString().includes('dash'));
  }
  // audio only
  for (const file of ['hls-plain.ts', 'hls-fmp4.mp4']) {
    const r = await KRMux.toMp4(new Blob([fs.readFileSync(path.join(out, file))]), { audioOnly: true });
    const dst = path.join(out, 'audio-' + file.replace(/\.\w+$/, '.m4a'));
    fs.writeFileSync(dst, Buffer.from(await r.blob.arrayBuffer()));
    const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', dst])).streams;
    check(file + ' -> .m4a: only an AAC audio stream remains', streams.length === 1 && streams[0].codec_type === 'audio' && streams[0].codec_name === 'aac', JSON.stringify(streams));
    const pa = audioPcm(path.join(out, file)), pb = audioPcm(dst);
    const off = Math.abs(pa.length - pb.length); let same = off <= 16384;
    for (let i = 0; same && i < Math.min(pa.length, pb.length) - off; i++) if (pa[pa.length - 1 - i] !== pb[pb.length - 1 - i]) same = false;
    check(file + ' -> .m4a: decoded sound identical to the original (lossless)', same);
  }
  const silent = await KRMux.toMp4(new Blob([fs.readFileSync(path.join(__dirname, 'hls-fixture/silent.mp4'))]), { audioOnly: true }).then(() => null, e => e);
  check('a video with no sound track fails with a clear message', silent && silent.code === 'no-audio', silent && silent.message);
  const bad = await KRMux.toMp4(new Blob([Buffer.from('this is not a video at all, just text '.repeat(100))])).then(() => null, e => e);
  check('garbage input fails with an error (caller then keeps the .ts)', !!bad, bad && bad.message.slice(0, 70));
  const big = await KRMux.toMp4(new Blob([new Uint8Array(10)]), { maxBytes: 5 }).then(() => null, e => e);
  check('size guard refuses oversized files', big && big.code === 'too-big');
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
