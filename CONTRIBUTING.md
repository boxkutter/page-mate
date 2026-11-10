# Contributing to PageMate

Thanks for helping. PageMate is a small project, so the process is light. This page covers how to report things, how to
work on the code, and the few rules that keep the project trustworthy.

## Reporting a bug

Open an issue and include:

- your browser and version (e.g. Brave 1.8x / Chromium 1xx / Firefox 13x) and operating system (Windows, macOS or Linux)
- the PageMate version (shown on `chrome://extensions`, or `about:addons` in Firefox) and which package you installed (`-chromium` or `-firefox`)
- what you did, what you expected, and what happened
- the page address if it's public, or a description of the page if it isn't (**never paste private links, login tokens
  or signed URLs**, such as ones with `Signature=` or `token=` in them)
- errors from the console: the extension card → **service worker** (background; in Firefox `about:debugging` → *Inspect* on PageMate) or the page's DevTools console

If PageMate can't read, save or download from a specific site, say so and what kind of player or page it is; those reports
are the most useful kind.

**Security problems:** don't open a public issue; see [SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue first and describe the problem you're trying to solve, not only the solution. PageMate aims to stay small and
quick to use every day, so features are weighed against that. Something that helps students, researchers, investigators or
people who listen to long articles is a good fit; something that needs an account or a server of ours is not.

## Project layout

```
extension/    the extension itself (manifest.json, background.js, content scripts, Save page, Notes, vendor/)
docs/         user documentation: guide.md, install.md, privacy.md
scripts/      build.js (the Chromium and Firefox packages), sign-firefox.js (unlisted AMO signing), build-vendor.sh (the MP4 converter)
tests/        unit and browser tests, and fixtures
.github/      CI: builds and unit tests on Windows, macOS and Linux, browser tests, releases
```

`extension/` is plain JavaScript that Chromium loads as it stands; `scripts/build.js` writes each browser's manifest and zips the result
(see [docs/install.md](docs/install.md#building-from-source)).

## Working on the code

1. Fork the repository and create a branch: `git checkout -b fix/short-description`.
2. Load the `extension/` folder as an unpacked extension in Chromium, or run `node scripts/build.js` and load `dist/firefox` as a temporary add-on
   in Firefox (see [docs/install.md](docs/install.md)). After editing, press the reload arrow on the extension card (rebuild first for Firefox).
3. Make your change, and **add or update a test** for it where practical.
4. Run the tests (below) and make sure they pass.
5. Open a pull request against `main`. Say what changed and why, and how you tested it. Keep it focused: one fix or feature
   per pull request makes review quick.

### Running the tests

```bash
npm install
npm run test:unit      # no browser needed
npm run test:browser   # needs Chromium that allows --load-extension; set CHROME=/path/to/chromium if it isn't found
npm run test:firefox   # builds the Firefox package and drives it in Firefox 128+; set FIREFOX=/path/to/firefox if it isn't found
```

Browser tests occasionally fail to start the extension's service worker on the first try ("No SW"); rerun before
assuming your change broke something. If a test is flaky, that's worth an issue of its own.

### Code style and design rules

- **Plain JavaScript, no framework, no bundler** for the extension itself. Files under `extension/` are what ships;
  `scripts/build.js` only writes each browser's manifest and zips them. The one exception is the vendored converter in `extension/vendor/`, rebuilt with `scripts/build-vendor.sh`.
- **No new runtime dependencies** without discussion. If one is truly needed, it must be vendored with its license and listed
  in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Keep the pure logic (parsing, writers, anchoring, citations) separate from browser APIs so it can be unit tested in Node.
  See how `notes-core.js` and `hls.js` are structured.
- Match the surrounding style: 2-space indent, semicolons, single quotes, short comments that explain *why*.
- Anything that handles page content or imported files must treat it as **untrusted**: build DOM with `textContent` / `createElement`, never `innerHTML` with page data.
- Be honest in the UI: if something can't be done, say what and why in plain words.
- **One code base, several browsers.** Use the `chrome.*` namespace everywhere (Firefox accepts it, with promises). Don't call an API that only one browser has without checking it exists first (`chrome.offscreen`, `chrome.pageCapture` and `chrome.commands.openShortcutSettings` are the current examples) and give the other browser a working fallback or an honest message. Browser differences live in `scripts/build.js` (manifests) and a few clearly commented `if (!chrome.x)` / `KR_FIREFOX` branches; keep it that way. Check anything that touches the background script or a browser API in both `npm run test:browser` and `npm run test:firefox`.
- **Windows, macOS and Linux:** don't build file paths by hand in extension code (use the `/`-separated paths the downloads API takes and `sanitizeName`), and don't write shell-only instructions without the Windows and macOS equivalents.

### Privacy and permissions are part of the design

Please don't add features that:

- send page text, notes, URLs or file contents anywhere other than the user's own Kokoro server address,
- add analytics, telemetry or remote code,
- request broader permissions than needed (new permissions should be **optional** and asked for at the moment of use).

A change that adds a permission must update the permission tables in [docs/privacy.md](docs/privacy.md).

### Things that need special care

- **DRM:** PageMate refuses DRM-protected video and will not accept changes that circumvent it.
- **Site-specific code:** general fixes beat per-site hacks. If a site needs special handling, keep it small, isolated, and
  covered by a fixture in `tests/`.
- **Test fixtures:** never commit real course material, signed URLs, cookies or personal data. Use the fake pages in `tests/`.

## Pull request checklist

- [ ] Tests pass (`npm test`), and new behavior has a test
- [ ] No private URLs, tokens or personal data in code, tests or screenshots
- [ ] README / `docs/guide.md` / `docs/privacy.md` / `docs/install.md` updated if behavior, install steps or permissions changed
- [ ] `CHANGELOG.md` has a line under the next version

## Releasing (maintainers)

1. Bump `version` in `extension/manifest.json`, `package.json` and `package-lock.json`.
2. Add the entry to `CHANGELOG.md`.
3. `npm test && npm run test:firefox && npm run build`.
4. Tag (`git tag v1.x.y && git push --tags`). CI builds both packages and attaches `dist/pagemate-<version>-chromium.zip` and `-firefox.zip` to a GitHub release.
5. For a store: upload the Chromium zip to the Chrome Web Store / Edge Add-ons; for addons.mozilla.org upload the Firefox zip, and when asked for source code give this repository at the tag (`extension/vendor/ts2mp4.min.js` is built from `scripts/vendor-entry.js` with `scripts/build-vendor.sh`; every other file ships as written). The Firefox add-on id in `scripts/build.js` (`GECKO_ID`) must never change once published.

### Signing for Firefox (unlisted)

Regular Firefox only installs add-ons signed by Mozilla. An **unlisted** signing is free, automatic (no human review, usually a minute or two) and
gives a `.xpi` that installs permanently, without appearing in the add-ons store.

1. Sign in at <https://addons.mozilla.org/developers/> with a Firefox account and open *Manage API Keys* (<https://addons.mozilla.org/developers/addon/api/key/>). Generate credentials: a **JWT issuer** (looks like `user:12345:67`) and a **JWT secret**.
2. Locally: `AMO_JWT_ISSUER=... AMO_JWT_SECRET=... npm run sign:firefox` (on Windows PowerShell: `$env:AMO_JWT_ISSUER='...'; $env:AMO_JWT_SECRET='...'; npm run sign:firefox`). The signed file is `dist/signed/*.xpi`.
3. Or in CI: add the same two values as repository secrets named `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. A pushed `v*` tag then signs the Firefox build and attaches the `.xpi` to the release; without the secrets that step is skipped.
4. Mozilla refuses a version it has already signed, so bump the version for every signing. Never commit the keys. The add-on id (`GECKO_ID` in `scripts/build.js`) is registered with Mozilla on the first signing and can't change afterwards.

## Conduct

Be kind and assume good faith. Harassment or personal attacks aren't tolerated, and maintainers may remove comments, close
issues or block people who do that. Keep discussion about the work.

## License of contributions

By submitting a contribution you agree that it is licensed under the project's [MIT license](LICENSE).
