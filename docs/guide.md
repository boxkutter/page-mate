# PageMate user guide

Everything PageMate can do, feature by feature. For installing and setting up, see the [README](../README.md).

## Use

- Click the icon (or Alt+Shift+R) to read the page from where you're scrolled. Click again to stop.
- With text selected, the icon / Alt+Shift+R reads just the selection. You can also right-click → **Read selection aloud**
  (works inside embedded frames and text boxes too).
- Alt+Shift+P pauses / resumes. Pausing for as long as you like is fine.
- Hold Alt and click a paragraph to jump there. If your desktop uses Alt+click to move windows (common on Linux),
  press the **⌖** button in the player and then click the paragraph instead. Esc cancels.
- Going to another page in the same tab (a "Next" button, a link, or a single-page-app route change) keeps reading
  on the new page. If you were paused, the new page opens paused. Turn this off in settings under **Reading**.
- The player can be dragged by its title bar. The speed button cycles 0.8×–2×; the settings page has a finer slider.

If the keyboard shortcuts don't work, set them at `brave://extensions/shortcuts`.

## Save a page as a document

Right-click the toolbar icon → **Save page as PDF / Word / Markdown…** (or Alt+Shift+S, the **Save page** button in the
player, or right-click on the page). A tab opens with a live preview and options:

- **What to save** – the whole page (menus, sidebars and cookie banners are left out) or just the text you selected.
- **Format** – **PDF** (opens your browser's print window: choose *Save as PDF*; text stays selectable and ♯ ♭ 日本語
  etc. come out right), **Word (.docx)** (editable: real headings, lists, tables, links and pictures) or
  **Markdown** (with images bundled in a `.zip`, or linked to their original addresses).
- **Images** and **videos** can be included or left out. A video in a document is a thumbnail plus a link; the video
  files themselves come from the *Download a video* tab.
- Paper size (Letter / A4) and whether to print the source address and date.

The first time, click **Allow** on that page: the extension needs access to the sites you save from (to read the page and
fetch its pictures) and to the Downloads folder. It still only touches a page when you ask it to.

## Notes: highlight, annotate, export as Markdown

Select text on any page, then right-click → **Highlight selection** (or **Highlight and add a note…**), or right-click the
toolbar icon → **Notes for this page**. A small bar appears next to selected text with four colors:
**Key term**, **Evidence**, **Question** and **Verify**, and a ✎ Note button.

- **The sidebar** lists every highlight on the page, in page order. Click one to jump to it; add a note and `#tags`,
  change its label, search or filter by label or tag, and write a note for the whole page at the top.
- **Highlights are anchored to the text, not to the page's layout.** Each one is remembered as the exact words plus a few
  words before and after, so it survives the page being rearranged, text being added above it, and small edits to the
  passage itself. If a passage is gone, its note stays, marked "isn't on the page right now"; you can re-attach it to new
  text. Nothing is ever deleted behind your back.
- **Highlights come back automatically** the next time you open that page (once you've allowed access under *Saving pages
  and videos*; the extension only checks whether you have notes for that exact address).
- **Export as Markdown** (the main export): the ⤓ button in the sidebar. The file has YAML front matter (title, source,
  tags), your page note, and each highlight as a quote with your note, `#tags`, and an **"Open this passage"** link that
  jumps straight back to the highlighted text in the browser. Order the file by position on the page, or grouped by label.
  It opens cleanly in Obsidian, Logseq, Typora, GitHub, etc. You can also **copy** the Markdown or save a **.json backup**.
- **My notes** (right-click the toolbar icon → *All my notes…*): every page with notes, searchable by text, note or tag;
  export one page, or several at once as a .zip (one file per page plus an index); backup and restore.
- Notes are stored **only in this browser** (no account, no upload). Back them up from *My notes*.
- Limits: highlights work in the page itself, not inside embedded frames or PDFs; the highlighted text must be selectable text.

### More you can do with notes

- **Cases / folders:** type a case name under the page note (e.g. *Harmony II / Exam 2*, or a matter name). *My notes* groups
  and filters by case, and exports list pages under their case.
- **Citations:** **Cite…** fills in author, title, site and date from the page's own details (you can correct them) and gives
  you **APA 7, MLA 9 or Chicago 17**, ready to copy. Choose a style in the ⤓ menu to add a *Citation* section to exports.
  Always check a generated citation against your style guide.
- **Video and audio notes:** on a page with a video, **⏱ Note at current time** adds a note at the playing position (or type a
  time like `12:35`). Click a video note to jump the video there. In Markdown/Word it appears with a **Play at 12:35** link to the
  video file. (Players inside embedded frames can't be controlled, but you can still type a time.)
- **Flashcards for Anki:** ⤓ → *highlight → note* (front = highlight, back = your note) or *fill-in-the-blank* (the highlighted
  words are hidden inside their own sentence). Import the `.txt` with Anki's *File → Import*; deck, card type and tags are set
  in the file, and re-importing updates cards instead of duplicating them.
- **Read my notes aloud:** the 🔊 button reads the page's highlights and notes with your Kokoro voice.
- **Word and PDF:** in *My notes*, choose *Word (.docx)* or *PDF* instead of Markdown (or ⤓ → *Word / PDF…* from the sidebar).
- **Highlights inside saved pages:** on the Save tab, **My highlights and notes** puts your highlights (with numbered references)
  and a notes list into the **PDF** and the **offline web page**. In the offline page, video notes link to the downloaded video.

## Capture & seal (evidence)

Save tab → **Capture (evidence)** makes a sealed record of a page for legal, investigative or research use. You get one .zip:
the page as the browser holds it (`capture.mhtml`), its readable text, your notes, and **manifest.json**, **SHA256SUMS** and
**chain-of-custody.md**: when it was captured (UTC), by whom, the address, the browser, the case, your note, and a SHA-256
fingerprint of every file. Check a package any time with `sha256sum -c SHA256SUMS` (a changed byte fails). The *My notes* page keeps
a **capture log** you can export as a spreadsheet.

**Know the limits.** The time is your computer's clock, not an independent authority, and the files are fingerprinted, not
digitally signed. Keep the *manifest fingerprint* shown after capture somewhere independent of the package (an email to yourself,
a case system, a notary) so you can later show it is unchanged. A snapshot may miss content that loads later or differs per visitor.
This is a careful record, not legal advice; ask your own counsel what a court will accept.

- Keyboard shortcuts for opening the sidebar and highlighting aren't set by default (the browser allows only four default
  shortcuts); set them at `brave://extensions/shortcuts` if you like.

## Web page with playable videos

In the Save tab choose **Web page with playable videos**. You get a folder in your Downloads (or one .zip) with
`index.html`, an `images/` folder and a `videos/` folder. Open `index.html` in any browser and the videos play inside
the page, offline. Streams are converted to MP4 so every browser can play them; subtitles come along. Videos that can't
be downloaded (DRM, or a site that needs the page's own login) stay as a thumbnail and link, and the status line says
which and why. The saved page contains no scripts and can't contact anyone.

## Download images

Right-click the toolbar icon → **Download images from this page…**, or right-click an image → **Save this image…**
(it jumps straight to that image). You get a gallery of everything on the page: normal images, `srcset` / `<picture>`
versions (the largest is used), lazy-loaded images, CSS background images and the page's preview image. Where a
thumbnail links to a full-size file (a lightbox), the **full-size** file is saved. Filter by size or by words in the
description / file name, tick the ones you want, and save them as separate files or one .zip. **Show on page**
highlights where an image came from.

## Download audio

Right-click the toolbar icon → **Download audio from this page…** (or right-click an audio player). It lists audio
players and links to audio files (.mp3, .m4a, .wav …). Every **video** on the page is also offered as **Save sound only**:
the original sound is saved as `.m4a` with no re-encoding, so nothing is lost. Handy for lectures you want to listen to.

## Download a video

Right-click the toolbar icon → **Download a video from this page…** (or Alt+Shift+V, the **Video** button in the player,
or right-click directly on a video → **Download this video…**, which jumps straight to that video in the list).

- The tab lists every video file and stream it can find on the page, including ones inside embedded players.
  **Show on page** highlights the one a row belongs to. Rename the file, pick a quality for streams, and press
  **Download**. Files go to `Downloads / PageMate Archive / <page title> /` (both names are changeable).
- Works with plain video files (MP4, WebM…) and HLS (`.m3u8`) streams, including ordinary encrypted HLS. Sites that
  only serve a video when it is requested "from the player page" are handled. Subtitles are saved too when the player
  has them.
- If you press play and nothing shows up, press **Rescan page**. If the video began playing before you allowed
  access, reload the page, press play, then rescan.
- **Streams are converted to MP4 automatically** (tick box on the Download tab). The video is re-wrapped, not
  re-encoded, so quality is exactly what was downloaded and it plays almost everywhere. If a video uses a format that
  can't be re-wrapped, the original `.ts` is saved instead and the row says why (`.ts` plays in VLC / mpv; convert with
  `ffmpeg -i video.ts -c copy video.mp4`). Some streams keep the sound in a separate file; the row tells you how to merge.
- **Convert .ts files you already have** with the button on the Download tab. Pick them and the MP4s land in your archive folder.
  Very large files (over about 1.5 GB) are too big to convert inside the browser; use the ffmpeg command for those.
- **Not supported:** videos protected with DRM (a licence-key system) are refused rather than worked around, DASH
  (`.mpd`) streams, and live streams. For DASH and other odd cases, **Copy yt-dlp command** gives you a command that
  reuses your browser's login.
- Only save videos you are entitled to keep, e.g. course material you're enrolled in, for your own use.

## Troubleshooting

- **"Can't reach your Kokoro server"**: check that the Kokoro server is running, that
  `http://<server-ip>:8880/web` opens in the browser, and that you're on the home network or VPN.
  Fix it, then press play in the player to retry.
- **Nothing happens on some pages / the icon shows a red "!"**: browsers don't let extensions run on built-in pages
  (`brave://…`, the Web Store, the PDF viewer). Everything else works.
- **It reads menus or misses text**: select the text you want and use **Read selection aloud**.
- **After updating the files**: click the reload arrow on the extension card in `brave://extensions`.
  Pages that were already open keep working; click the icon again to bring the player back.
- **Reading stopped after following a link to another site**: the extension only gets access to the site you
  started it on. Click the icon on the new site to keep going.

## Privacy

- Text is sent only to the server address you set. The extension asks permission for exactly that address
  (and drops the permission for an old address when you change it).
- It only reads a page when you click the icon, use the shortcut, or use the right-click menu — or, if you leave
  "keep reading" on, when you move to a new page in the tab you're already listening to.
- Settings (server address, voice, speed, save options) are stored in your browser.
- **Saving pages and videos** runs entirely inside your browser. Nothing is uploaded anywhere. If you allow access, the
  extension also notes the *addresses* of video files and streams each tab loads (in memory, for the current browser
  session only) so they can be offered for download. Turn that off in settings under **Saving pages and videos**.
  Pages are only read when you open the Save tab.
