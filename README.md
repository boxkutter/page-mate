# PageMate

**Read it, save it, annotate it.** PageMate is a free, open-source browser extension that turns any web page into something you can
listen to, keep and study from, and gives researchers and investigators a careful set of tools for checking what they find.

It runs in **Firefox** and in **Chrome, Edge, Brave** and other Chromium browsers, on **Windows, macOS and Linux**.
There is no account, no cloud service and no tracking: everything happens in your browser.

> **Status:** version 1.9.2. PageMate is not in any browser's add-on store yet, so you install it from a download
> ([steps below](#install)). It is covered by automated tests and has had limited real-world use, so if something
> looks odd, please [tell us](https://github.com/boxkutter/page-mate/issues).

## What it does

| | |
|---|---|
| 🔊 **Read aloud** | Natural voices from a [Kokoro](https://github.com/remsky/Kokoro-FastAPI) text-to-speech server that you run yourself. Start from any paragraph, pause, change speed. |
| 📄 **Save pages** | A clean **PDF**, an editable **Word** file, **Markdown**, or an **offline web page with playable videos**. Menus and cookie banners are left out. |
| 🎬 **Download media** | Videos (including HLS streams, converted to MP4), audio and images from pages you are entitled to keep: your courses, lectures and own content. |
| 🖍️ **Notes** | Highlight text and add notes that stay attached to the exact words. Export to Markdown, Word or PDF, with citations (APA, MLA, Chicago), Anki flashcards and video timestamps. |
| 📸 **Screenshots & recording** | Capture an area, what you see, or the whole page; mark up, redact, crop, copy or save. Record a screen, window or tab. |
| 🔎 **Investigate** | Look up an address, IP, email, hash, handle or coordinate in many services in one click; list everything on a page; read image and video metadata; see archived copies; profile a site. |
| 🔒 **Capture & seal** | Package a page, screenshot or recording with a SHA-256 fingerprint of every file and a chain-of-custody record, optionally **signed** and with an independent **trusted timestamp** that anyone can check with `openssl`. |
| 📣 **Share** | Send a page or quote to X, Bluesky, Mastodon, Reddit and more, with tracking codes removed. Nothing is posted for you. |

Everything except reading aloud works with no server and no setup.

## Quick start

**1. Install it** (about two minutes). Download the package for your browser from the
[Releases page](https://github.com/boxkutter/page-mate/releases), then follow the short steps for
[Chrome, Edge and Brave](#chrome-edge-brave-opera-vivaldi) or [Firefox](#firefox).

**2. Pin the icon and click it.** A small floating **toolbox** appears on the page, with one icon for each tool. Drag it
anywhere; it stays in front until you close it (**×** or **Esc**). Each icon shows a letter: press it to start that tool.

**3. Try three things that need no setup:**

- **Highlight:** select some text on any page, right-click, choose **Highlight selection**. Open the toolbox → **Notes** to see your
  highlights, add a note, or export them as Markdown.
- **Save a page:** toolbox → **Save page**. Choose PDF, Word or Markdown and press the button. The first time, click **Allow** so
  PageMate can fetch the page's pictures.
- **Take a screenshot:** toolbox → **Screenshot** → *Selected area*. Drag a box; a card appears with **Copy**, **Save**, **Notes** and **Edit…**.

**4. Optional: reading aloud.** This is the one feature that needs a server. Start a Kokoro server, for example with Docker:

```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

Then open PageMate's **Settings** (it opens when you install; or right-click the toolbar icon → *Options*), type the server address
(such as `http://localhost:8880`), click **Connect**, pick a voice and press **Preview**. After that, press
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> on any page to start reading. More in [Set up reading aloud](#set-up-reading-aloud).

## Install

PageMate comes as two packages built from the same code. The operating system doesn't matter; pick by browser.

| Browser | Download | Needs version |
|---|---|---|
| **Chrome, Edge, Brave, Opera, Vivaldi**, Arc and other Chromium browsers | `pagemate-<version>-chromium.zip` | 116 or newer |
| **Firefox** (also Developer Edition and ESR) | `pagemate-<version>-firefox.zip` or the signed `.xpi` | 128 or newer |

Get them from the [Releases page](https://github.com/boxkutter/page-mate/releases), or build them yourself with only Node.js 18+
(`git clone`, then `node scripts/build.js`). Safari is not supported yet.

Unzip the package somewhere you will keep it: the browser loads the extension from that folder, so don't delete it afterwards.

### Chrome, Edge, Brave, Opera, Vivaldi

1. Open the extensions page: `chrome://extensions` (or `edge://extensions`, `brave://extensions`, `opera://extensions`, `vivaldi://extensions`).
2. Turn on **Developer mode** (top right; bottom left in Edge).
3. Click **Load unpacked** and choose the unzipped folder.
4. Click the puzzle-piece icon in the toolbar and **pin PageMate**.

### Firefox

- **Easiest, permanent:** if the release has a signed **`pagemate-<version>.xpi`**, open it in Firefox (or drag it onto a Firefox window) and
  accept the prompt. It stays installed and updates by installing the next `.xpi` over it.
- **Just trying it:** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json` in the unzipped
  firefox folder. It lasts until you close Firefox.

Then pin it: puzzle-piece (Extensions) icon → ⚙ next to PageMate → *Pin to Toolbar*.

Updating, uninstalling, per-system notes (macOS screen-recording permission, Linux and Wayland, Windows) and
unsigned-install options for Firefox Developer Edition are in **[docs/install.md](docs/install.md)**.

## Set up reading aloud

PageMate sends the text it reads to a [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) server that you run on your own
computer or home server (see that project for current images, GPU versions and options). Then, in PageMate's Settings:

1. Type the server's address, such as `http://192.168.1.50:8880` or `http://localhost:8880`, and click **Connect**.
2. Allow access when the browser asks. PageMate asks for that one address only.
3. Pick a voice, press **Preview**, and set the speed.

Page text goes **only to that address**: there is no PageMate server.

## Everyday use

| I want to… | Do this |
|---|---|
| Pick a tool | Click the toolbar icon for the floating toolbox, then click an icon or press its letter (the **keyboard** button lists them). |
| Read the page aloud | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>, or toolbox → **Read aloud**. Select text first to read just that. Press again to stop. |
| Pause / resume | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> |
| Start reading from a paragraph | Hold <kbd>Alt</kbd> and click it, or use the ⌖ button in the player. |
| Save a page as PDF / Word / Markdown | Toolbox → **Save page**, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>. |
| Download a video, audio or images | Toolbox → **Video** / **Audio** / **Images**, or right-click the video or image itself. |
| Highlight and annotate | Select text → right-click → **Highlight selection**; toolbox → **Notes** for the sidebar. |
| Look something up | Select an address, IP, email, hash, @handle or coordinates → right-click → **Look up “…”**. |
| Investigate a page | Toolbox → **Investigate** (emails, phones, domains, IPs, hashes, hidden text, site details). |
| Screenshot or record | Toolbox → **Screenshot** or **Record screen**. |
| Capture an evidence copy | Toolbox → **Save page** → **Capture (evidence)**. |
| Share a page or quote | Toolbox → **Share**. |

On a Mac, <kbd>Alt</kbd> is the <kbd>Option</kbd> (⌥) key. Every tool can have its own browser-wide shortcut; set them at
`chrome://extensions/shortcuts` (`edge://`, `brave://`…), or in Firefox under *Add-ons Manager → ⚙ → Manage Extension Shortcuts*.
Browsers allow only four default keys, so only reading, pausing, saving a page and saving a video come with one.

## Documentation

| | |
|---|---|
| **[User guide](docs/guide.md)** | Every feature in detail: saving, downloads, notes, evidence, investigating, screenshots, recording, sharing, troubleshooting. |
| **[Installing](docs/install.md)** | All browsers and systems, updating, uninstalling, unsigned Firefox, building from source. |
| **[Privacy and permissions](docs/privacy.md)** | What PageMate reads, what leaves your browser, and why each permission is asked for. |
| [Changelog](CHANGELOG.md) | What changed in each version. |
| [Contributing](CONTRIBUTING.md) | Reporting bugs, running the tests, the rules of the project, releasing. |
| [Security](SECURITY.md) | How to report a vulnerability. |

## Privacy in short

- Page text goes **only to the Kokoro server address you enter**. No PageMate server, no account, no analytics.
- Notes and settings stay in your browser. Saving, screenshots, recording, investigating and sealing all happen locally.
- PageMate reads a page only when you ask (icon, shortcut or right-click menu).
- Lookups, archives and share buttons are links you click: the service you open learns what you asked, as if you had typed it there.

The full picture, with a table of every permission, is in [docs/privacy.md](docs/privacy.md).

## Responsible use

- **Only save what you are entitled to keep**: your own courses, lectures and files, or material whose terms allow it. You are
  responsible for following the site's terms and the law where you live.
- PageMate **refuses DRM-protected video** (it does not try to get around it) and live streams.
- PageMate is an independent project. It is not affiliated with, or endorsed by, any website, course platform or video host it can work with.
- **Investigate is for lawful, proportionate research** (journalism, verification, security, academic work). PageMate gives you links and local
  analysis; it does not scrape social networks, search breached-credential lists, identify faces or help you hide. Information found about
  private individuals deserves care; before you share, think about sources, victims and privacy.
- Metadata and *error level analysis* are leads to check, never proof; missing metadata proves nothing; automated matches (phone numbers, handles) can be wrong.
- **Capture & seal** produces a careful, checkable record. It is not legal advice and not a guarantee of what a court will accept: unless you
  add a trusted timestamp the time comes from your computer's clock, and unless you sign it the files are fingerprinted, not digitally signed.
- Citations are generated from page details and can be wrong. Check them against your style guide.
- Only record screens, calls and windows you are entitled to record; consent and privacy laws vary.

## Known limits

- **Not yet in any add-on store**, so browsers show "developer mode" warnings, and Firefox needs the signed `.xpi` or a temporary install.
- **Tested mostly on Linux.** The browser tests run against Chromium and Firefox on Linux; the build and unit tests also run on Windows and
  macOS in CI, but nobody has used PageMate by hand there yet.
- **Firefox:** a sealed capture holds the page's HTML (`capture.html`) instead of a single-file MHTML, and screen recording can't include the
  computer's or a tab's sound in most setups (the microphone works).
- **Safari** isn't supported: it needs a conversion with Xcode on a Mac that hasn't been tried.
- Highlights work in the page itself, not in embedded frames or PDFs.
- Video: plain files and HLS (`.m3u8`) streams. Not supported: DRM, live streams, DASH (`.mpd`). Files over about 1.5 GB are too big to convert to MP4 in the browser.
- Screen recordings are held in memory until saved. Whole-page screenshots are cut off at about 16,000 pixels tall.
- The Anki export follows Anki's documented format but hasn't been opened in Anki itself; try one small export first.

The user guide lists more small limits next to each feature.

## Contributing

Bug reports, fixes, tests, docs and ideas are all welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first; it also explains how to
run the tests (`npm run test:unit`, `npm run test:browser`, `npm run test:firefox`) and build the packages.
Security problems: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). The bundled MP4 converter ([Mediabunny](https://mediabunny.dev)) is MPL-2.0; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgements

Ideas and checks for the Investigate tools come from the open-source-intelligence community's long practice, including
[Bellingcat's Online Investigations Toolkit](https://bellingcat.gitbook.io/toolkit) and the [InVID-WeVerify](https://www.invid-project.eu/tools-and-services/invid-verification-plugin/) verification plugin. PageMate is not affiliated with them or with any service it links to.

Voices by [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) and [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI);
MP4 re-wrapping by [Mediabunny](https://mediabunny.dev).
