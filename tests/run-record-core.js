const R = require('../extension/record-core.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

check('pickMime prefers WebM/VP9 by default', R.pickMime(() => true).mime === 'video/webm;codecs=vp9,opus' && R.pickMime(() => true).format === 'webm');
check('pickMime asks for MP4 when wanted and available', R.pickMime(t => /mp4/.test(t), 'mp4').format === 'mp4');
check('pickMime falls back to the other format, and to null if nothing works', R.pickMime(t => /^video\/webm$/.test(t), 'mp4').format === 'webm' && R.pickMime(() => false) === null && R.pickMime(() => { throw new Error('x'); }) === null);
check('extFor / bitrateFor', R.extFor('video/mp4;codecs=avc1') === 'mp4' && R.extFor('video/webm') === 'webm' && R.bitrateFor('high') === 5_000_000 && R.bitrateFor('auto') === 0);

const c = R.clock();
check('clock before start is zero', c.activeMs(1000) === 0);
c.start(1000); c.pause(4000); c.resume(7000); c.pause(8000);
check('clock: running 3s, paused 3s, running 1s, now paused → 4s active', c.activeMs(10000) === 4000, String(c.activeMs(10000)));
c.resume(11000); c.stop(13000);
check('clock stop: ran 3s + 1s + 2s = 6s active, 2 pauses of 3s = 6s paused, frozen after stop', c.activeMs(99999) === 6000 && c.info().pauses === 2 && c.info().pausedMs === 6000, JSON.stringify(c.info()));
const c2 = R.clock(); c2.start(0); c2.pause(1000); c2.stop(5000);
check('stopping while paused counts the pause', c2.activeMs(9999) === 1000 && c2.info().pausedMs === 4000);
check('fmtClock', R.fmtClock(0) === '0:00' && R.fmtClock(65000) === '1:05' && R.fmtClock(3725000) === '1:02:05');
check('fileBase is safe and stamped', R.fileBase('A/B: "C"?', new Date('2026-11-09T10:11:12.345Z')) === 'Recording - A B C - 20261109T101112Z' && R.fileBase('', new Date(0)).startsWith('Recording - recording'));
const info = R.buildInfo({ startedAt: Date.parse('2026-11-09T10:00:00Z'), stoppedAt: Date.parse('2026-11-09T10:01:05Z'), activeMs: 62500, pausedMs: 2500, pauses: 1, fileName: 'r.webm', mime: 'video/webm', size: 1234, width: 1280, height: 720, frameRate: 30, bitrate: 2500000, surface: 'browser', pageUrl: 'https://x.test/', pageTitle: 'T', systemAudio: true, microphone: false, userAgent: 'UA' });
check('recording info: times, durations, source and audio as reported', info.started_at_utc === '2026-11-09T10:00:00.000Z' && info.recorded_seconds === 62.5 && info.paused_seconds === 2.5 && info.source.kind === 'A browser tab' && info.audio.screen_or_tab_sound === true && info.audio.microphone === false && /no re-encoding/.test(info.note) && R.buildInfo({ startedAt: 0, stoppedAt: 1, activeMs: 1 }).source.kind === 'not reported');
// ---- the "has alpha" flag Linux players choke on ----
const buf = (...parts) => Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
const size = n => n < 127 ? Buffer.from([0x80 | n]) : Buffer.from([0x40 | (n >> 8), n & 255]);
const el = (id, body) => buf(id, size(body.length), body);
const webmHeader = ({ alpha = 1, clusterBytes = [0x53, 0xc0, 0x81, 0x01], trackExtra = [] } = {}) => {
  const video = el([0xe0], buf(el([0xb0], [0x07, 0x80]), el([0xba], [0x04, 0x38]), alpha === null ? Buffer.alloc(0) : el([0x53, 0xc0], [alpha])));
  const entry = el([0xae], buf(el([0xd7], [1]), el([0x86], 'V_VP9'), ...trackExtra, video));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], entry);
  const segment = buf([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])), tracks,
    el([0x1f, 0x43, 0xb6, 0x75], buf(el([0xe7], [0]), el([0xa3], clusterBytes))));
  return buf(el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], 'webm')), segment);
};
const w1 = webmHeader();
const at1 = R.findAlphaMode(new Uint8Array(w1));
check('findAlphaMode finds the AlphaMode=1 byte inside Segment > Tracks > TrackEntry > Video (unknown-size Segment, like MediaRecorder writes)', at1 > 0 && w1[at1] === 1 && w1[at1 - 1] === 0x81 && w1[at1 - 3] === 0x53 && w1[at1 - 2] === 0xc0, String(at1));
check('…and nothing when the flag is 0 or absent', R.findAlphaMode(new Uint8Array(webmHeader({ alpha: 0 }))) === -1 && R.findAlphaMode(new Uint8Array(webmHeader({ alpha: null }))) === -1);
check('look-alike bytes in a Cluster (53 C0 81 01) are not mistaken for it', R.findAlphaMode(new Uint8Array(webmHeader({ alpha: null }))) === -1 && R.findAlphaMode(new Uint8Array(webmHeader({ alpha: 0 }))) === -1);
check('garbage, empty and truncated input are safe', R.findAlphaMode(new Uint8Array(0)) === -1 && R.findAlphaMode(new Uint8Array([1, 2, 3, 4, 5])) === -1 && R.findAlphaMode(new Uint8Array(w1.subarray(0, 30))) === -1 && R.findAlphaMode(new Uint8Array(200).fill(0xff)) === -1);
(async () => {
  const blob = new Blob([w1, Buffer.alloc(20000, 7)], { type: 'video/webm' });
  const fixed = await R.fixWebm(blob);
  const out = Buffer.from(await fixed.blob.arrayBuffer());
  const diff = []; for (let i = 0; i < out.length; i++) if (out[i] !== (i < w1.length ? w1[i] : 7)) diff.push(i);
  check('fixWebm changes exactly one byte (the flag), keeps the size and the type, and says what it did', diff.length === 1 && diff[0] === at1 && out[at1] === 0 && out.length === blob.size && fixed.blob.type === 'video/webm' && fixed.adjustments.length === 1 && /AlphaMode/.test(fixed.adjustments[0].what) && fixed.adjustments[0].picture_and_sound_data === 'untouched');
  const again = await R.fixWebm(fixed.blob);
  check('running it twice does nothing the second time', again.adjustments.length === 0 && again.blob === fixed.blob);
  const mp4 = new Blob([w1], { type: 'video/mp4' });
  check('MP4 and non-video blobs are returned untouched', (await R.fixWebm(mp4)).blob === mp4 && (await R.fixWebm(null)).blob === null);
  const big = new Blob([w1, Buffer.alloc(300000, 9)], { type: 'video/webm;codecs=vp9' });
  const bf = await R.fixWebm(big);
  check('a WebM type with a codecs parameter is handled; the rest of a large file is not rewritten (same size)', bf.adjustments.length === 1 && bf.blob.size === big.size);
  const i2 = R.buildInfo({ startedAt: 0, stoppedAt: 1, activeMs: 1, adjustments: fixed.adjustments });
  check('recording info lists the adjustment and the note says so (and the plain note is unchanged without one)', i2.adjustments.length === 1 && /except for the header adjustment/.test(i2.note) && R.buildInfo({ startedAt: 0, stoppedAt: 1, activeMs: 1 }).adjustments.length === 0 && /no re-encoding\)\./.test(R.buildInfo({ startedAt: 0, stoppedAt: 1, activeMs: 1 }).note));
  console.log(failed ? '\n' + failed + ' FAILED' : '\nAll record-core tests passed');
  process.exit(failed ? 1 : 0);
})();
