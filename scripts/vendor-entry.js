// Entry point for the vendored converter (extension/vendor/ts2mp4.min.js).
// Rebuild with scripts/build-vendor.sh. Uses the Mediabunny library (MPL-2.0).
import { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, MPEG_TS, MP4 } from 'mediabunny';

const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024 * 1024; // the finished MP4 is assembled in memory

// Re-wraps an MPEG-TS (or fragmented MP4) video as a standard MP4 WITHOUT re-encoding, so quality is untouched.
// Throws rather than silently dropping a video/audio track.
// audioOnly: drop the picture and keep just the sound (saved as .m4a), still without re-encoding.
async function toMp4(blob, { onProgress, maxBytes = DEFAULT_MAX_BYTES, audioOnly = false } = {}) {
  if (blob.size > maxBytes) {
    const e = new Error('This file is too large to convert inside the browser.');
    e.code = 'too-big';
    throw e;
  }
  const input = new Input({ source: new BlobSource(blob), formats: [MPEG_TS, MP4] });
  try {
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const conversion = await Conversion.init(audioOnly ? { input, output, video: { discard: true } } : { input, output });
    const lost = conversion.discardedTracks.filter(t => (t.track.type === 'video' || t.track.type === 'audio') && t.reason !== 'discarded_by_user');
    if (audioOnly && !conversion.utilizedTracks.some(t => t.type === 'audio')) {
      const e = new Error('This video has no sound track to extract.');
      e.code = 'no-audio';
      throw e;
    }
    if (!conversion.isValid || lost.length) {
      const e = new Error('The video uses a format that can’t be re-wrapped as MP4 without re-encoding (' +
        (lost.map(t => t.track.type + ': ' + t.reason).join(', ') || 'no usable tracks') + ').');
      e.code = 'unsupported';
      throw e;
    }
    if (onProgress) conversion.onProgress = p => onProgress(p);
    await conversion.execute();
    return { blob: new Blob([output.target.buffer], { type: audioOnly ? 'audio/mp4' : 'video/mp4' }) };
  } finally {
    try { input.dispose(); } catch (_) {}
  }
}

globalThis.KRMux = { toMp4 };
