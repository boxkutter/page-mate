# Changelog

All notable changes to PageMate. (Versions before the rename were called "Kokoro Page Reader".)

## 1.7.0
- Changed: **clicking the toolbar icon now shows a floating toolbox** in the page instead of starting the reader. It is a small panel of icons
  (Read aloud, Notes, Save page, Video, Audio, Images, Screenshot, Record screen, Investigate, Look up, Archive, Share) that sits in the
  bottom-left corner, **can be dragged anywhere** (it remembers where), **stays in front** and stays open until you close it (×, Esc or the icon
  again), including when you go to another page in the tab. Where the browser doesn't allow that (browser pages, the web store) the same tools
  appear in a small window instead. **Alt+Shift+R still starts / stops reading** (it is now its own shortcut; if you had given the old
  icon-click shortcut a different key, that key now opens the toolbox instead, and you can set a new key for reading). Right-click the icon still
  lists the tools, now including *Read this page aloud*.
- New: **tools run inside the toolbox where they can.** **Screenshot** (selected area / visible part / whole page: the box hides while the
  picture is taken, then shows it as a card with **Copy, Save, Notes and Edit…**), **Record screen** (the icons are replaced by recorder
  controls: options, countdown, clock with Pause / Stop, then Save / Seal… / Discard; the back arrow returns to the icons), **Look up** (filled
  with your selected text), **Archive**, **Share** (quotes your selection) and **Shortcuts** all work in the box. The other tools open in their
  **own small window, not a browser tab** (Save page, Video / Audio / Images downloads, Investigate, the screenshot editor, All my notes);
  browser tabs are now used
  only for Settings and for the outside sites that lookups, archives and sharing open. The reader and Notes keep their own floating player /
  sidebar.
- New: **keyboard control of the toolbox.** Each icon shows its letter (R read aloud, N notes, S save page, V video, U audio, M images,
  C screenshot, E record, I investigate, L look up, A archive, H share, O all my notes); press it to start that tool. Arrow keys move between
  icons, Enter starts one, Esc goes back, then closes. The **keyboard** button (or ?) lists every letter and every browser-wide shortcut and opens
  the browser's shortcuts page to set them. Every tool now has a shortcut slot (including *Open the toolbox*), though browsers allow only four
  to come with a default key.
- New: **screenshots can be filed with your notes** (*Save to Notes*, with an optional caption). They appear under the page in *All my notes*
  (open, copy, save, delete) and are not part of the text backup.
- New: **copy each screenshot automatically** as soon as it is taken (off by default; in the viewer or Settings; asks for the clipboard permission).
- Changed: a screenshot is **deleted from the browser when its viewer tab is closed** (anything left over is swept after a day), and the viewer
  **warns before closing with marks or a crop you haven't saved, copied or filed**.
- Fixed: stopping the screen share during the recorder's countdown now cancels instead of recording nothing; closing the recorder with an unsaved
  recording asks first.
- New: **Investigate** (right-click → *Investigate this page…*, *Look up “…”*): **Look up** anything (address, domain, IP, email, hash, @handle,
  phone, coordinates, CVE, wallet, AS number, MAC, analytics id) in many services as plain links, with **defang / refang** and your own services;
  **Page entities** (everything on a page, CSV / Markdown); **Images & video** (EXIF / GPS / XMP / MP4 metadata, SHA-256, magnifier, error level
  analysis, reverse image search, video frames); **Archive** (Wayback Machine, archive.today); **Site profile** (headers, technologies,
  trackers, analytics ids, hidden text, comments); **Search operators** builder; **Trail** (optional log of pages visited for a case).
- New: **Screenshots**: selected area, visible part, or whole page (stitched), with box / arrow / highlight / text, **redact**, pixelate, crop,
  save PNG / JPEG, copy, share, or **seal as evidence**.
- New: **Record screen**: a whole screen, one window or one tab (and its sound, plus optional microphone) to a WebM or MP4 file, with pause,
  countdown, quality and frame-rate choices; save it or **seal it as evidence** (signed / trusted-timestamped like any capture). No new permission. It runs in the toolbox; a recording made
  there ends if you reload or leave the page (the browser asks first), so there is also a **Recorder window** for long, multi-page sessions.
  The Settings page has an **Allow** button for the timestamp server, which the toolbox's recorder needs before it can add a timestamp.
- New: **Share** to X, Bluesky, Mastodon, Threads, Reddit, LinkedIn, Facebook, Telegram, WhatsApp, Hacker News and email, with tracking codes
  removed, length limits respected and warnings for private-looking links. Nothing is posted for you.
- Evidence: sealed packages can now include a **full-page screenshot**, **response headers** (cookie values removed), **page details**,
  **entities**, the case's **trail**, and recorded **archive links**; and can be **signed** (ECDSA P-256) and given an independent **RFC 3161 trusted
  timestamp**. Both verify with plain `openssl`; commands are in `chain-of-custody.md`. A failed timestamp request is reported, never hidden.
- Fixed: the Save page's left-hand options card could be taller than the window with its button out of reach; it now scrolls.
- New optional permissions: `tabs` (only for the Trail) and, on request, archive.org, a timestamp server, or the site hosting a file you fetch.

## 1.6.0
- **Renamed to PageMate** (was "Kokoro Page Reader"). Reading aloud still uses your own Kokoro server.
- New: **Cases / folders** for notes; **citations** (APA, MLA, Chicago) from page details; **video and audio notes** with timestamps
  and jump-to; **Anki flashcards** (highlight → note, or fill-in-the-blank); **read my notes aloud**; **Word and PDF** export of notes;
  **highlights and notes inside the saved PDF and offline web page**.
- New: **Capture & seal**: a sealed evidence package with a page snapshot (MHTML), text, notes, SHA-256 manifest, `SHA256SUMS`
  and a chain-of-custody record, plus a capture log. Needs the optional "capture pages" permission, requested the first time.
- Fixed: saving a web page no longer produces console errors from images that were never meant to load.

## 1.5.0
- New: **Notes**: highlight text in four labelled colors, add notes and tags, jump between them in a sidebar, and
  export as **Markdown** (with links back to each passage), copy it, or save a .json backup. Highlights stay attached to
  their words when the page changes and reappear automatically on later visits. **My notes** page for search across pages,
  multi-page export (.zip) and backup / restore.

## 1.4.0
- New: **Web page with playable videos**: a folder (or .zip) with the page, images and the video files, playable offline.
- New: **Download images** tab (gallery, filters, full-size files, files or .zip) and **Download audio** tab
  (audio players and links, plus **sound only** from any video, lossless).
- New: right-click on an image or audio player; Downloads-folder setting shared by the video, image and audio tabs.
- Fixed: files saved from the Save tab could get the wrong extension (e.g. `.txt` for a page, `.mp4` for sound).

## 1.3.0
- New: HLS downloads are converted to **MP4** automatically, losslessly (no re-encoding). Falls back to the original
  `.ts` with an explanation when a file can't be converted.
- New: **Convert .ts files I already have** button on the Download tab.
- The converter is a bundled build of [Mediabunny](https://mediabunny.dev) (MPL-2.0; licence in `extension/vendor/`). Rebuild it
  with `scripts/build-vendor.sh`.

## 1.2.1
- Fixed: saving a page dropped images and text that the site reveals on scroll (they start hidden until scrolled to).
- Fixed: pictures inside buttons (click-to-enlarge thumbnails) were skipped.
- New: Kaltura "click to start" videos (no video element until played) are listed straight away.
- Fixed: images on pre-signed links (e.g. Amazon S3) failed to load.

## 1.2.0
- New: **Save a page** as PDF, Word (.docx) or Markdown, with a live preview and options to include images and videos,
  save only the selection, and choose paper size. Headings, lists, tables, links, code, quotes and captions are kept.
- New: **Download a video** for archiving: finds files and streams on the page (including in embedded players), saves
  MP4/WebM files and HLS streams (with decryption of ordinary encrypted HLS), quality picker, subtitles, resumable
  progress and cancel. Refuses DRM-protected and live streams.
- New: right-click menu on the toolbar icon, on pages, selections and videos; shortcuts Alt+Shift+S / Alt+Shift+V;
  **Save page** and **Video** buttons in the player.
- New permissions, all optional or warning-free: `downloads` and access to all sites are requested only when you click
  **Allow** (neither new always-on permission carries an install warning, so updating shouldn't ask you to re-approve the extension). `webRequest` (to notice video addresses) and
  `declarativeNetRequestWithHostAccess` (to send a video's own page as Referer while downloading) only work once you allow access.

## 1.1.0
- Fixed: pause → resume did nothing after a pause of more than ~30 seconds (the browser was shutting down the
  extension's background worker, and with it the record of which tab was reading).
- Fixed: Alt+click, next/previous and the pause shortcut being ignored for the same reason.
- Fixed: reading silently stopping (with the player still showing "playing") when the page navigated.
- New: keeps reading on the next page in the same tab (can be turned off).
- New: ⌖ "choose where to read from" button, for desktops where Alt+click is taken by the window manager.
- Fixed: "Read selection aloud" doing nothing for text selected inside frames or text boxes.
- Fixed: nothing being read on pages with an invalid `lang` attribute (e.g. `en_US`).
- Fixed: text sitting directly next to paragraphs (e.g. `<div>Intro <p>…</p></div>`), inside `display: contents`
  wrappers, or fading in on scroll was skipped. Pages hidden behind a cookie banner are now read too.
- Fixed: the extension stopping working on open pages after it was updated/reloaded.
- Fixed: speed changed in settings not applying until the next page; speeds like 1.25× cycling wrongly.
- Fixed: "Read again" after reading a selection read the whole page instead.
- Requests to the server now time out (90 s) and are retried once on network errors.
