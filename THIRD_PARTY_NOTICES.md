# Third-party notices

PageMate itself is MIT-licensed (see [LICENSE](LICENSE)). It bundles one third-party component:

| Component | Where | License |
|---|---|---|
| [Mediabunny](https://mediabunny.dev) 1.65.2 (tree-shaken, minified) | `extension/vendor/ts2mp4.min.js` | MPL-2.0 — full text in [`extension/vendor/LICENSE-mediabunny.txt`](extension/vendor/LICENSE-mediabunny.txt) |

Mediabunny is used to re-wrap downloaded video/audio streams into MP4/M4A without re-encoding. The MPL-2.0 applies to
that file only; it does not affect the license of the rest of PageMate. The unmodified upstream source is available from
the Mediabunny project, and `scripts/build-vendor.sh` rebuilds the bundled file from it reproducibly (pinned versions).

PageMate works with, but does not include, the [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech model
and the [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) server. You run those yourself under their own licenses.

**Development tools** (never shipped inside the extension): [puppeteer-core](https://pptr.dev) (Apache-2.0) drives the browser tests, and
[web-ext](https://github.com/mozilla/web-ext) (MPL-2.0) is run through `npx` only when a maintainer signs the Firefox build with Mozilla.
