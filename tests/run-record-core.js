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
console.log(failed ? '\n' + failed + ' FAILED' : '\nAll record-core tests passed');
process.exit(failed ? 1 : 0);
