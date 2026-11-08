# Changelog

All notable changes to PageMate. (Versions before the rename were called "Kokoro Page Reader".)

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
