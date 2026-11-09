# PageMate

**Read it, save it, annotate it.** PageMate is a browser extension for Brave, Chrome and other Chromium browsers that turns
any web page into something you can listen to, keep, and study from. It has no account, no cloud and no tracking.

- 🔊 **Read aloud** with natural voices from your own [Kokoro](https://github.com/remsky/Kokoro-FastAPI) text-to-speech server
- 📄 **Save a page** as a clean **PDF**, editable **Word (.docx)**, **Markdown**, or an **offline web page with playable videos**
- 🎬 **Download videos, images and audio** from pages you're entitled to keep (course material, lectures, your own content)
- 🖍️ **Highlight and take notes** that stay attached to the exact words, with Markdown export, citations, Anki flashcards and video timestamps
- 🔒 **Capture & seal** a page into a SHA-256 fingerprinted evidence package with a chain-of-custody record, optionally **signed** and with an independent **trusted timestamp** you can verify with `openssl`
- 🔎 **Investigate**: look up any address, IP, email, hash, handle or coordinate in one click; list everything on a page; check images and video (EXIF/GPS, reverse search, keyframes); see archived copies; profile a site
- 📸 **Screenshots and screen recording**: selected area, visible part or whole page (mark up, redact, save, copy, share or seal), or record a screen, window or tab with sound
- 📣 **Share** a page or quote to X, Bluesky, Mastodon, Reddit and more, with tracking codes removed (nothing is posted for you)

> **Status:** version 1.8.0, not yet in the Chrome Web Store, so you install it from this repository (below).
> Its logic is covered by automated tests, and the whole extension is driven end-to-end in Chromium. It has had limited
> real-world use, so please [report anything odd](https://github.com/boxkutter/page-mate/issues).

## Contents

[Install](#install) · [Set up reading aloud](#set-up-reading-aloud) · [Using PageMate](#using-pagemate) · [Privacy and permissions](#privacy-and-permissions) ·
[Responsible use](#responsible-use) · [Limitations](#limitations) · [Development](#development) · [Contributing](#contributing) · [License](#license)

## Install

Requires Brave, Chrome, Edge or another Chromium browser, version 116 or newer.

1. Get the code: `git clone https://github.com/boxkutter/page-mate.git` (or use **Code → Download ZIP** and unzip it somewhere permanent; the browser loads the extension from that folder, so don't delete it).
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the **`extension`** folder inside the repository.
5. Pin it: puzzle-piece icon in the toolbar → pin **PageMate**.

To update later: `git pull`, then press the reload arrow on PageMate's card in the extensions page.

Saving pages, media and notes works without any server. Only **reading aloud** needs one.

## Set up reading aloud

PageMate sends the text it reads to a [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) server that you run, on your own
computer or home server. For example, with Docker (see that project's README for the current image names, GPU versions, and options):

```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

Then open PageMate's settings page (it opens on install, or right-click the toolbar icon → *Options*), type your server's
address, such as `http://192.168.1.50:8880` or `http://localhost:8880`, and click **Connect**. Allow access when the browser
asks, pick a voice, press **Preview**, and set the speed.

## Using PageMate

| I want to… | Do this |
|---|---|
| Pick a tool | Click the toolbar icon: a small **floating toolbox** appears in the page (drag it anywhere; it stays in front until you close it) with an icon for each tool: Read aloud, Notes, Save page, Video, Audio, Images, Screenshot, Record screen, Investigate, Look up, Archive, Share. Each icon has a letter: press it. The keyboard button lists them, and the browser-wide shortcut of every tool. |
| Read the page aloud | Click the icon → **Read aloud**, or press **Alt+Shift+R**. Select text first to read just that. Press it again (or choose **Close reader**) to stop. |
| Pause / resume | **Alt+Shift+P** |
| Start reading from a paragraph | Hold **Alt** and click it (or use the ⌖ button in the player) |
| Save a page as PDF / Word / Markdown / web page | Right-click the icon → **Save page…** (**Alt+Shift+S**) |
| Download a video | Right-click the icon → **Download a video…** (**Alt+Shift+V**), or right-click the video itself |
| Download images or audio | Right-click the icon → **Download images…** / **Download audio…** |
| Highlight and annotate | Select text → right-click → **Highlight selection**, or right-click the icon → **Notes for this page** |
| Export notes | The ⤓ button in the notes sidebar (Markdown is the main format), or **All my notes…** for everything |
| Capture an evidence copy of a page | Save page → **Capture (evidence)** tab |
| Look something up (address, IP, email, hash, @handle, coordinates…) | Select it → right-click → **Look up “…”** |
| List the emails, phones, domains, IPs on a page | Right-click the page → **Investigate this page…** |
| Reverse-search an image, or read its metadata | Right-click the image → **Reverse image search** / **Image metadata and checks…** |
| See or save an archived copy | Right-click → **Archive this page** |
| Take a screenshot | Right-click → **Screenshot** → selected area / visible / whole page |
| Record the screen | Right-click → **Record screen…** |
| Share a page or a quote | Right-click → **Share…** |

Keyboard shortcuts can be changed at `brave://extensions/shortcuts`. Notes shortcuts have no default keys, because browsers allow only four.

**The full feature guide is in [docs/guide.md](docs/guide.md)**: saving options, the video/image/audio tabs, the notes system
(anchoring, cases, citations, Anki, video notes), the offline web page format, and evidence capture.

## Privacy and permissions

- Page text goes **only to the server address you enter**. There is no PageMate server, no account, no analytics.
- Settings are in your browser's sync storage. Notes are stored **only in this browser**; back them up from *My notes*.
- PageMate reads a page only when you ask it to (icon, shortcut, right-click menu), or, if you leave "keep reading" on, when
  you move to a new page in the tab you're already listening to.

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Read the page you clicked on and show the player / notes sidebar |
| `storage` | Remember settings and your notes |
| `offscreen` | Play audio while the page is in the background |
| `contextMenus` | The right-click menu entries |
| `webRequest` (needs your approval) | Notice the addresses of video files a tab loads, so they can be offered for download, and each page's response headers (cookie values removed) for the site profile and evidence. Kept in memory for the session; each can be turned off in settings |
| `declarativeNetRequestWithHostAccess` | Send the page's own address as the Referer while downloading a video, as the player would |
| *Optional:* all sites | Asked for when you click **Allow** on the Save page: to fetch images and media and to bring highlights back automatically |
| *Optional:* `downloads` | Asked for when you first save a file |
| *Optional:* `pageCapture` | Asked for when you first seal an evidence capture |
| *Optional:* `tabs` | Asked only if you switch on the **Trail** (a log of pages you visit for a case) |
| *Optional:* a timestamp server | Asked when you tick "Add a trusted timestamp"; only the manifest's SHA-256 is sent |
| *Optional:* archive.org, a media host | Asked when you list/save archived copies or fetch an image or video by address |

## Responsible use

- **Only save what you are entitled to keep**: your own courses, lectures and files, or material whose terms allow it. You are
  responsible for following the site's terms and the law where you live.
- PageMate **refuses DRM-protected video** (it does not try to get around it) and live streams.
- PageMate is an independent project. It is not affiliated with, or endorsed by, any website, course platform or video host it can work with.
- **Investigate is for lawful, proportionate research** (journalism, verification, security, academic work). PageMate gives you links and local analysis; it does not scrape social networks, search breached-credential lists, identify faces or help you hide. Lookups tell the service you open what you searched for. Information found about private individuals deserves care; before you **share**, think about sources, victims and privacy.
- Metadata and *error level analysis* are leads to check, never proof; missing metadata proves nothing; automated matches (phone numbers, handles) can be wrong.
- **Capture & seal** produces a careful, checkable record. It is not legal advice and not a guarantee of what a court will accept: unless you add a trusted timestamp the time comes from your computer's clock, and unless you sign it the files are fingerprinted, not digitally signed.
- Citations are generated from page details and can be wrong. Check them against your style guide.

## Limitations

- Developed and tested against Chromium; day-to-day use in Brave and Chrome is the intended target. Firefox and Safari are not supported.
- Highlights and notes work in the page itself, not in embedded frames or PDFs.
- Video: plain files and HLS (`.m3u8`) streams. Not supported: DRM, live streams, DASH (`.mpd`). Streams with a separate audio track can't be combined in the offline web page.
- Files over about 1.5 GB are too big to convert to MP4 inside the browser.
- Screen recordings are held in memory until saved (closing the recorder tab discards them), are not re-encoded, and WebM files often lack a duration header.
- Whole-page screenshots are cut off at about 16,000 pixels tall (the browser's canvas limit), and don't scroll panels *inside* a page.
- The technology list in the site profile is short and matched on visible clues; reverse-image links and lookup services are third-party addresses that can change.
- The Anki export follows Anki's documented import format but hasn't been opened in Anki itself; try one small export first.

## Development

No build step: the extension is plain JavaScript loaded straight from `extension/`.

```
extension/    the extension (manifest.json, background.js, content scripts, Save page, Notes, vendor/)
docs/         user guide
scripts/      package.sh (builds dist/pagemate-<version>.zip), build-vendor.sh (rebuilds the MP4 converter)
tests/        unit and browser tests + fixtures
```

```bash
npm install                  # installs puppeteer-core, used by the browser tests
npm run test:unit            # pure-logic tests: fast, no browser needed
npm run test:browser         # drives the real extension in Chromium
npm run package              # dist/pagemate-<version>.zip
```

The browser tests need a Chromium that allows `--load-extension` (Chromium or "Chrome for Testing"; branded Chrome 137+ does not).
They look for Playwright's Chromium and common system paths, or you can set `CHROME=/path/to/chromium`. Some tests also use
`ffmpeg`/`ffprobe`, `sha256sum`, `openssl` (to check signatures and timestamps independently) and LibreOffice when present.
Run Chromium with a UTF-8 locale (`LANG=C.UTF-8`); without one, Chromium refuses file names containing characters like "–".

## Contributing

Contributions are welcome: bug reports, fixes, tests, docs, and new ideas. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.
Security problems: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). The bundled MP4 converter ([Mediabunny](https://mediabunny.dev)) is MPL-2.0; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

Ideas and checks for the Investigate tools come from the open-source-intelligence community's long practice, including
[Bellingcat's Online Investigations Toolkit](https://bellingcat.gitbook.io/toolkit) and the [InVID-WeVerify](https://www.invid-project.eu/tools-and-services/invid-verification-plugin/) verification plugin. PageMate is not affiliated with them or with any service it links to.

Voices by [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) and [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI);
MP4 re-wrapping by [Mediabunny](https://mediabunny.dev).
