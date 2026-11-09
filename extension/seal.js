// Builds a sealed evidence package from a list of files. Shared by "Capture (evidence)" and the screenshot tool.
// Needs evidence.js, trust.js and zip.js to be loaded first.
(function (root) {
  const README = 'This is a sealed capture made with PageMate.\n\nTo check that nothing has changed since it was sealed, unzip it and run, inside the folder:\n\n    sha256sum -c SHA256SUMS\n\nEvery line should say OK. Read chain-of-custody.md for the details and the limits of this record.\n';

  // opts: {
  //   files:   [{ name, data, description }]    what was captured
  //   info:    see KNEvidence.buildManifest     (capturedAt: Date, url, title, case, capturedBy, ...)
  //   signing: { privateJwk, publicJwk } | null  sign manifest.json
  //   tsaUrl:  string | null                     ask this RFC 3161 authority to timestamp manifest.json
  //   onStatus(text)
  //   fetchImpl:  optional replacement for fetch() when asking the timestamp authority (a page can't, because of CORS)
  // }
  // -> { base, entries: [{name, data}], manifestHash, warnings: [], plan }
  async function build(opts) {
    const { files, info, signing, tsaUrl, onStatus, fetchImpl } = opts;
    const E = root.KNEvidence, T = root.KOTrust;
    const say = t => { try { onStatus && onStatus(t); } catch (_) {} };
    const warnings = [];
    const described = await E.describeFiles(files);
    const plan = { signed: false, requested: { signature: !!signing, timestamp: tsaUrl || null } };

    const manifestJson = JSON.stringify(E.buildManifest(info, described, plan), null, 2) + '\n';
    const manifestHash = await E.sha256Hex(manifestJson);
    const extraFiles = [];

    if (signing) {
      say('Signing the manifest…');
      try {
        const pub = await T.publicKeyInfo(signing.publicJwk);
        const sig = await T.sign(signing.privateJwk, manifestJson);
        extraFiles.push({ name: 'manifest.sig', data: sig }, { name: 'signer-public-key.pem', data: pub.pem });
        plan.signed = true;
        plan.keyFingerprint = pub.fingerprint;
      } catch (e) { warnings.push('Not signed: ' + (e && e.message || e)); }
    }
    if (tsaUrl) {
      say('Asking the timestamp authority…');
      try {
        const got = await T.requestTimestamp(tsaUrl, manifestHash, fetchImpl ? { fetchImpl } : undefined);
        extraFiles.push({ name: 'timestamp.tsr', data: got.tsr }, { name: 'timestamp.tsq', data: got.tsq });
        plan.timestamp = { tsa: tsaUrl, genTime: got.info.genTime };
      } catch (e) { plan.timestampFailed = String(e && e.message || e).replace(/\.$/, ''); warnings.push('No trusted timestamp: ' + plan.timestampFailed + '.'); }
    }

    const custody = E.custodyMarkdown(info, described, manifestHash, plan);
    const sums = E.sumsFile([
      { name: 'manifest.json', sha256: manifestHash },
      ...described,
      ...(await Promise.all(extraFiles.map(async f => ({ name: f.name, sha256: await E.sha256Hex(f.data) })))),
      { name: 'chain-of-custody.md', sha256: await E.sha256Hex(custody) },
      { name: 'README.txt', sha256: await E.sha256Hex(README) }
    ]);
    const entries = [...files.map(f => ({ name: f.name, data: f.data })), { name: 'manifest.json', data: manifestJson }, ...extraFiles,
      { name: 'chain-of-custody.md', data: custody }, { name: 'README.txt', data: README }, { name: 'SHA256SUMS', data: sums }];
    return { entries, manifestHash, warnings, plan };
  }

  // Wraps entries in a folder and zips them.
  async function zipEntries(base, entries, date) {
    return root.KRZip.createZip(entries.map(e => ({ ...e, name: base + '/' + e.name })), { date });
  }

  // ---- browser-only helpers (extension pages) ----
  const KEY_STORE = 'ko:signkey';
  // The signing key lives in this browser's extension storage. Anyone who can read the profile can use it; say so in the UI.
  async function getSigningKey(create = true) {
    const got = (await chrome.storage.local.get(KEY_STORE))[KEY_STORE];
    if (got && got.privateJwk) return got;
    if (!create) return null;
    const k = await root.KOTrust.generateSigningKey();
    await chrome.storage.local.set({ [KEY_STORE]: k });
    return k;
  }
  async function forgetSigningKey() { await chrome.storage.local.remove(KEY_STORE); }
  // Must be called straight from a click so the browser can show its prompt.
  async function ensureOriginAccess(url) {
    let origin;
    try { origin = new URL(url).origin + '/*'; } catch (_) { throw new Error('That isn’t a valid address: ' + url); }
    if (await chrome.permissions.contains({ origins: [origin] }).catch(() => false)) return true;
    return chrome.permissions.request({ origins: [origin] });
  }

  const api = { build, zipEntries, README, getSigningKey, forgetSigningKey, ensureOriginAccess };
  root.KNSeal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
