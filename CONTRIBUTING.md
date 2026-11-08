# Contributing to PageMate

Thanks for helping. PageMate is a small project, so the process is light. This page covers how to report things, how to
work on the code, and the few rules that keep the project trustworthy.

## Reporting a bug

Open an issue and include:

- your browser and version (e.g. Brave 1.8x / Chromium 1xx) and operating system
- the PageMate version (shown on `chrome://extensions`)
- what you did, what you expected, and what happened
- the page address if it's public, or a description of the page if it isn't (**never paste private links, login tokens
  or signed URLs**, such as ones with `Signature=` or `token=` in them)
- errors from the console: the extension card → **service worker** (background) or the page's DevTools console

If PageMate can't read, save or download from a specific site, say so and what kind of player or page it is; those reports
are the most useful kind.

**Security problems:** don't open a public issue; see [SECURITY.md](SECURITY.md).

## Suggesting a feature

Open an issue first and describe the problem you're trying to solve, not only the solution. PageMate aims to stay small and
quick to use every day, so features are weighed against that. Something that helps students, researchers, investigators or
people who listen to long articles is a good fit; something that needs an account or a server of ours is not.

## Working on the code

1. Fork the repository and create a branch: `git checkout -b fix/short-description`.
2. Load the `extension/` folder as an unpacked extension (see the [README](README.md#install)). After editing, press the
   reload arrow on the extension card.
3. Make your change, and **add or update a test** for it where practical.
4. Run the tests (below) and make sure they pass.
5. Open a pull request against `main`. Say what changed and why, and how you tested it. Keep it focused: one fix or feature
   per pull request makes review quick.

### Running the tests

```bash
npm install
npm run test:unit      # no browser needed
npm run test:browser   # needs Chromium that allows --load-extension; set CHROME=/path/to/chromium if it isn't found
```

Browser tests occasionally fail to start the extension's service worker on the first try ("No SW"); rerun before
assuming your change broke something. If a test is flaky, that's worth an issue of its own.

### Code style and design rules

- **Plain JavaScript, no build step, no framework, no bundler** for the extension itself. Files under `extension/` are what
  ships. The one exception is the vendored converter in `extension/vendor/`, rebuilt with `scripts/build-vendor.sh`.
- **No new runtime dependencies** without discussion. If one is truly needed, it must be vendored with its license and listed
  in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Keep the pure logic (parsing, writers, anchoring, citations) separate from browser APIs so it can be unit tested in Node.
  See how `notes-core.js` and `hls.js` are structured.
- Match the surrounding style: 2-space indent, semicolons, single quotes, short comments that explain *why*.
- Anything that handles page content or imported files must treat it as **untrusted**: build DOM with `textContent` / `createElement`, never `innerHTML` with page data.
- Be honest in the UI: if something can't be done, say what and why in plain words.

### Privacy and permissions are part of the design

Please don't add features that:

- send page text, notes, URLs or file contents anywhere other than the user's own Kokoro server address,
- add analytics, telemetry or remote code,
- request broader permissions than needed (new permissions should be **optional** and asked for at the moment of use).

A change that adds a permission must update the permission table in the README.

### Things that need special care

- **DRM:** PageMate refuses DRM-protected video and will not accept changes that circumvent it.
- **Site-specific code:** general fixes beat per-site hacks. If a site needs special handling, keep it small, isolated, and
  covered by a fixture in `tests/`.
- **Test fixtures:** never commit real course material, signed URLs, cookies or personal data. Use the fake pages in `tests/`.

## Pull request checklist

- [ ] Tests pass (`npm test`), and new behavior has a test
- [ ] No private URLs, tokens or personal data in code, tests or screenshots
- [ ] README / `docs/guide.md` updated if behavior or permissions changed
- [ ] `CHANGELOG.md` has a line under the next version

## Releasing (maintainers)

1. Bump `version` in `extension/manifest.json` and `package.json`; update `tests/run-shipped.js` if it pins the version.
2. Add the entry to `CHANGELOG.md`.
3. `npm test && npm run package`.
4. Tag (`git tag v1.x.y && git push --tags`) and attach `dist/pagemate-<version>.zip` to a GitHub release.

## Conduct

Be kind and assume good faith. Harassment or personal attacks aren't tolerated, and maintainers may remove comments, close
issues or block people who do that. Keep discussion about the work.

## License of contributions

By submitting a contribution you agree that it is licensed under the project's [MIT license](LICENSE).
