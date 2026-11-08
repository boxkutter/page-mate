// Capture & seal: builds the records that go with a sealed page capture.
//
// A sealed package is a .zip holding the captured page, its notes, and:
//   manifest.json          what was captured, when, by whom, and the SHA-256 of every file
//   SHA256SUMS             the same hashes in the standard format: `sha256sum -c SHA256SUMS`
//   chain-of-custody.md    a human-readable record
//
// Honest limits (also written into every record): the time comes from this computer's clock, and
// nothing here is digitally signed or stamped by an outside authority. The hashes prove the files
// have not changed since they were sealed; they don't prove when, by themselves.
(function (root) {
  const LIMITS = [
    'The capture time is read from the computer’s clock when the capture was made. It has not been verified by an independent time authority.',
    'The files are hashed (SHA-256) but not digitally signed. Anyone with the package could rebuild it with different content and new hashes; keep a copy of the manifest hash (below) somewhere independent to show the package is unchanged.',
    'The capture is a snapshot of the page as this browser rendered it at that moment. Content that loads later, requires interaction, or differs per visitor may not be included.'
  ];

  async function sha256Hex(data) {
    let bytes;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else if (data instanceof Uint8Array) bytes = data;
    else bytes = new Uint8Array(await data.arrayBuffer()); // Blob
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const sizeOf = d => (typeof d === 'string' ? new TextEncoder().encode(d).length : d.size != null ? d.size : d.length);

  // files: [{ name, data: string | Uint8Array | Blob, description }]  ->  [{ name, size, sha256, description }]
  async function describeFiles(files) {
    const out = [];
    for (const f of files) out.push({ name: f.name, size: sizeOf(f.data), sha256: await sha256Hex(f.data), description: f.description || '' });
    return out;
  }

  function utcStamp(date) { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

  function offsetText(date) {
    const off = -date.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return 'UTC' + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  }

  // info: { toolVersion, case, capturedBy, capturedAt: Date, url, title, userAgent, highlights, examinerNote }
  function buildManifest(info, described) {
    return {
      format: 'kokoro-evidence',
      version: 1,
      tool: 'PageMate',
      tool_version: info.toolVersion || '',
      case: info.case || '',
      captured_by: info.capturedBy || '',
      captured_at_utc: info.capturedAt.toISOString(),
      local_utc_offset: offsetText(info.capturedAt),
      url: info.url,
      title: info.title || '',
      user_agent: info.userAgent || '',
      highlights_in_notes: info.highlights || 0,
      examiner_note: info.examinerNote || '',
      files: described,
      limitations: LIMITS
    };
  }

  // Standard `sha256sum` format: "<hex>  <name>". The manifest line is included so one command checks everything.
  function sumsFile(described) {
    return described.map(f => f.sha256 + '  ' + f.name).join('\n') + '\n';
  }

  const mdCell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

  function custodyMarkdown(info, described, manifestSha256) {
    const L = ['# Chain of custody — web page capture', ''];
    L.push('| | |', '|---|---|');
    L.push('| **Case** | ' + mdCell(info.case || '(none)') + ' |');
    L.push('| **Captured by** | ' + mdCell(info.capturedBy || '(not recorded)') + ' |');
    L.push('| **Captured at (UTC)** | ' + info.capturedAt.toISOString() + ' |');
    L.push('| **Local time zone** | ' + offsetText(info.capturedAt) + ' (' + info.capturedAt.toString().replace(/\s*\(.*\)$/, '') + ') |');
    L.push('| **Page address** | ' + mdCell(info.url) + ' |');
    L.push('| **Page title** | ' + mdCell(info.title || '') + ' |');
    L.push('| **Browser** | ' + mdCell(info.userAgent || '') + ' |');
    L.push('| **Tool** | PageMate ' + (info.toolVersion || '') + ' |');
    L.push('| **Highlights in the attached notes** | ' + (info.highlights || 0) + ' |', '');
    if (info.examinerNote) L.push('## Examiner’s note', '', info.examinerNote, '');
    L.push('## Files and SHA-256 hashes', '', '| File | Size (bytes) | SHA-256 | What it is |', '|---|---:|---|---|');
    for (const f of described) L.push('| ' + mdCell(f.name) + ' | ' + f.size + ' | `' + f.sha256 + '` | ' + mdCell(f.description) + ' |');
    L.push('', '`manifest.json` itself:', '', '**SHA-256 of manifest.json: `' + manifestSha256 + '`**', '',
      'Record that value somewhere independent of this package (an email to yourself, a case-management system, a notary). If it matches, the manifest — and through it every file above — is unchanged.', '');
    L.push('## How to verify', '', 'In a terminal, inside the unzipped folder:', '', '```', 'sha256sum -c SHA256SUMS', '```', '',
      'Every line should say `OK`. (On macOS use `shasum -a 256 -c SHA256SUMS`; on Windows PowerShell use `Get-FileHash <file>` and compare.)', '');
    L.push('## Limits of this record', '', ...LIMITS.map(l => '- ' + l), '');
    return L.join('\n');
  }

  // One row per capture, kept in the browser so there is a running log (exportable as CSV).
  function logRow(info, manifestSha256, packageName) {
    return { at: info.capturedAt.toISOString(), case: info.case || '', url: info.url, title: info.title || '', manifestSha256, package: packageName };
  }

  const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  function logCsv(rows) {
    const head = ['captured_at_utc', 'case', 'url', 'title', 'manifest_sha256', 'package'];
    return head.join(',') + '\n' + rows.map(r => [r.at, r.case, r.url, r.title, r.manifestSha256, r.package].map(csvCell).join(',')).join('\n') + '\n';
  }

  const api = { LIMITS, sha256Hex, describeFiles, utcStamp, offsetText, buildManifest, sumsFile, custodyMarkdown, logRow, logCsv };
  root.KNEvidence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
