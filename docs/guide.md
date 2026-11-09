# PageMate user guide

Everything PageMate can do, feature by feature. For installing and setting up, see the [README](../README.md).

## Use

- Click the toolbar icon to show the **toolbox**: a small panel of icons, one for each thing PageMate does (Read aloud, Notes, Save page,
  Video, Audio, Images, Screenshot, Record screen, Investigate, Look up, Archive, Share). It floats in the corner of the page, **drag its title
  bar to move it** (it remembers where), it stays in front and stays open (even when you go to another page in the tab) until you close it
  with **×**, **Esc**, or by clicking the toolbar icon again. On browser pages that extensions can't touch, the same tools open in a small window.
  Right-clicking the icon lists the same tools as a menu.
- **Inside the toolbox:** *Screenshot* (area / visible / whole page, then Copy / Save / Notes / Edit… on the card it shows), *Look up*, *Archive*,
  *Share*, **Record screen** (its controls replace the icons until you go back) and the shortcut list work right in the box. The other tools open
  in their **own small window** (not a browser tab): Save page, Video / Audio / Images downloads, Investigate, the screenshot editor and
  All my notes. Read aloud and Notes use their own
  floating player and sidebar.
- **From the keyboard:** each icon shows a letter; press it to start that tool (R read aloud, N notes, S save page, V video, U audio,
  M images, C screenshot then A / V / W for area / visible / whole page, E record, I investigate, L look up, A archive, H share,
  O all my notes). Arrow keys move between icons, Enter starts one, Esc goes back and then closes. The **keyboard** button (or ?) lists them all.
- **Shortcuts that work anywhere:** every tool, and the toolbox itself, has a slot at `brave://extensions/shortcuts` (the keyboard panel's
  button opens it). Alt+Shift+R (read), P (pause), S (save page) and V (video) come ready-made; browsers allow only four defaults, so set the
  rest yourself. A good pattern: give the toolbox one key, then press a letter.
- **Read aloud** (or Alt+Shift+R, which skips the toolbox) reads the page from where you're scrolled. Choosing it again, or pressing
  Alt+Shift+R again, closes the reader.
- With text selected, Read aloud / Alt+Shift+R reads just the selection. You can also right-click → **Read selection aloud**
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

Choose what goes in:

| Option | Adds | Notes |
|---|---|---|
| Full-page screenshot | `screenshot.png` | Switches to the page for a moment, scrolls and stitches. Needs "all sites" access. |
| Page details | `page-details.json`, `headers.json`, `entities.csv` | How the page was served (server, IP, security headers; **cookie values and credentials are removed**), its metadata, technologies, other sites it loads from, hidden text, HTML comments, and every email, phone, domain, IP, handle and hash on it. |
| My trail for this case | `trail.csv` | Pages you visited for this case, if you turned the [Trail](#investigate) on. |
| Sign with this browser's key | `manifest.sig`, `signer-public-key.pem` | An ECDSA P-256 signature over `manifest.json`. Proves the manifest is unchanged and came from the holder of that key. The key is made on first use and stays in this browser; note its fingerprint (Settings) with the person it belongs to. |
| Trusted timestamp (RFC 3161) | `timestamp.tsr`, `timestamp.tsq` | An independent time-stamping authority (FreeTSA, DigiCert, Sectigo, or your own) signs the manifest's fingerprint. **Only that fingerprint is sent, not the page.** This replaces "the time is my computer's clock" with the authority's time. |

Signatures and timestamps are checked with plain `openssl`; the exact commands are written into `chain-of-custody.md`:

```bash
sha256sum -c SHA256SUMS
openssl dgst -sha256 -verify signer-public-key.pem -signature manifest.sig manifest.json      # Verified OK
openssl ts -verify -data manifest.json -in timestamp.tsr -CAfile <authority-root.pem>        # Verification: OK
```

If the timestamp server can't be reached, the capture is still sealed, and the chain-of-custody record says plainly that a
timestamp was requested and not obtained.

**Know the limits.** Without a trusted timestamp the time is your computer's clock; without a signature the files are
fingerprinted, not signed. Even with both, they show *the manifest existed then, from that key*, not that the page looked the same
to everyone else. Keep the *manifest fingerprint* shown after capture somewhere independent of the package (an email to yourself,
a case system, a notary). A snapshot may miss content that loads later or differs per visitor. This is a careful record, not legal
advice; ask your own counsel what a court will accept.

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

## Investigate

Open it from the right-click menu (**Investigate this page…**, **Look up “…”**, **Reverse image search**, **Archive this page**, **Share…**),
from the toolbar icon's right-click menu, or with a shortcut you set at `brave://extensions/shortcuts`. It has tabs:

- **Look up**: paste or select anything: a web address, domain, IP, email, file hash, `@handle`, phone number, map coordinates,
  CVE, Bitcoin/Ethereum address, AS number, MAC address or analytics id. PageMate recognises it and lists matching places to look
  it up (search engines, VirusTotal, urlscan, crt.sh, RDAP/WHOIS, Shodan/Censys, AbuseIPDB, blockchain explorers, maps, profile pages…).
  They are **plain links that open in a new tab**; PageMate sends nothing itself. Addresses written as `hxxps://evil[.]example[.]com`
  are understood, and **Defang / Refang** convert between that form and a real link. Add your own services in Settings.
- **Page entities**: reads the page and lists every email, phone number, handle, link, domain, IP, hash, CVE, crypto address,
  coordinate and analytics id on it (including in `mailto:`/`tel:` links, metadata, comments and hidden text). Filter, look one up,
  copy, or save as CSV / Markdown. Everything happens in your browser.
- **Images & video**: *Inspect a file* (drop one in, choose one, or fetch by address) shows its **SHA-256**, and its **metadata**: camera,
  time, software, serial numbers, **GPS position** (with map links), XMP/edit history, PNG text, MP4 creation time and location. Notes
  explain what stands out, and remind you that **missing metadata proves nothing** (most platforms strip it) and **present metadata is easy
  to fake**. Also: a magnifier with mirror / invert / contrast / brightness, **error level analysis** (a pointer for where to look, never a
  verdict), **reverse image search** on Google Lens, Bing, Yandex, TinEye and Baidu (by address, or copy-and-paste for files and video
  frames), and **frames from a video** at even intervals.
- **Archive**: links to the Wayback Machine and archive.today for the address; **List saved copies** (asks archive.org); **Save now and
  record the link** (asks the Internet Archive to fetch the page; recorded links are added to your sealed captures of that page).
- **Site profile**: server, IP, status, security headers present / missing, a short list of recognised technologies, analytics and ad-account
  ids (sites sharing one are often run by the same people), other sites the page loads from with known trackers marked, declared metadata and
  JSON-LD, text visitors can't see, and comments left in the HTML. The technology list is deliberately small and can miss things.
- **Search operators**: a form that builds `site:`, `filetype:`, `intitle:`, exact-phrase, `after:` / `before:` searches and opens them in
  Google, Bing, DuckDuckGo, Yandex or Brave, plus ready-made searches (documents on a site, subdomains, mentions elsewhere, a person on professional networks).
- **Share**: see below.
- **Trail**: when switched on for a case, each page you finish loading is noted (time, address, title) in this browser, so you can show what
  you looked at and when. Off by default; needs the optional "tabs" permission; never records private windows; export as CSV. It is a log, not proof on its own.

What it deliberately does not do: scrape social networks, look people up in bulk, identify faces, search breached-credential lists, or hide that
you are a browser. Lookups are links you open yourself. Check what you find: automated matching has false positives.

## Screenshots

Right-click → **Screenshot** (or the toolbar icon's menu, or a shortcut you set for "Screenshot: select an area"):

- **Selected area**: drag a rectangle; Esc cancels.
- **Visible part of the page**.
- **Whole page**: scrolls and stitches. Sticky headers appear once, at the top; the page is put back as it was. Pages taller than a browser can
  draw in one image (about 16,000 pixels) are cut off, and the viewer says so. Scrolling areas *inside* a page (single-page apps with their own
  scrollbars) are captured as shown, not scrolled.

The screenshot opens in a viewer where you can **mark it up** (box, arrow, highlighter, text), **Redact** (solid black) or **Pixelate**, **crop**,
undo, then **save as PNG or JPEG**, **copy** it, **share** it, or **seal it as evidence**. Marks are drawn on top of an untouched original; saved
and copied images have them burned in, so a redaction really removes what is under it. A sealed screenshot package holds the original, the marked
version if you made one, the page address and headers, and the usual manifest, fingerprints and chain of custody, with the optional signature and
trusted timestamp.

**What happens to a screenshot.** Nothing is saved or copied until you choose. Save PNG / JPEG writes a file to Downloads; **Copy image**
puts it on the clipboard to paste with Ctrl+V (tick **Copy each new screenshot automatically**, here or in Settings, to have that done for you
the moment it is taken); **Save to Notes** files it (with an optional caption) under that page in *All my notes*, where you can open, copy,
save or delete it later. Pictures filed there live in this browser and are not part of the text backup or the Markdown / Word export.
The viewer keeps the picture only while its tab is open: **closing the tab deletes it** (leftovers, for example after a crash, are swept
after a day), and it **warns before you close with marks or a crop that haven't been saved, copied, shared, filed or sealed**.
Reloading the viewer is fine.

## Record the screen

Choose the **Record** icon in the toolbox (or press **E** in it, or use the right-click menu / a shortcut). The icons are **replaced by the
recorder, right in the small box**: tick the options, press **Start recording**, and the browser's own picker asks what to share: a whole
screen, one window or one tab. Pick a **tab** to capture its sound too. Options: screen/tab sound, **microphone** (mixed into the same track;
the browser asks permission), a 3-second countdown, a quality level, and **WebM** (most reliable) or **MP4** where your browser can make it.
The back arrow (or Esc) returns to the tool icons; neither ever stops a recording by accident.

While recording the box shows a clock and the size so far, with **Pause** (P) and **Stop** (S); paused time is left out of the length. You
can scroll and use the page, and the browser's own "Stop sharing" bar also ends it. **Reloading or leaving the page ends the recording**,
because the box is part of that page, so the browser asks before you leave. For a recording that must survive page changes, use **Recorder
window** (a button in the box; it is also what opens on browser pages, where the box can't appear), which records from its own window.
When it stops, the box shows the length and size with **Save**, **Seal…** (a small form: case, your name, signing, a trusted timestamp)
and **Discard**; an unsaved recording asks before it is thrown away. A **sealed** package holds the recording exactly as the browser made it, a `recording-info.json` (when it started and stopped, how long, what kind of
surface was shared, whether sound and microphone were on, the browser), the SHA-256 manifest and chain of custody, and the optional signature
and trusted timestamp, like any other sealed capture.

**Playing it on Linux.** Chrome-family browsers mark every WebM recording "may contain alpha", and GStreamer-based players (GNOME Videos /
Showtime on Fedora, Ubuntu…) then refuse it with a "missing codec" message. PageMate clears that one header flag when a recording finishes
(the picture and sound are untouched; `recording-info.json` lists the change), so new recordings open normally. For a recording made by an
older version, either open it in VLC or mpv (not GStreamer-based), or make a playable copy (the original is not touched):

```
python3 -c "import sys;b=bytearray(open(sys.argv[1],'rb').read());i=b[:4096].find(b'\\x53\\xc0\\x81\\x01');assert i>=0,'flag not found';b[i+3]=0;open(sys.argv[2],'wb').write(b)" "My recording.webm" "My recording (playable).webm"
```

Things to know: the file is **not re-encoded** (apart from that one flag byte). WebM files from browsers usually have no duration header, so some players show no length or
can't jump around; the length PageMate shows is measured. The recording is held in memory until you save it (it warns past 1.5 GB), and
**closing the page (or the recorder window) discards it**. Nothing is uploaded, and no extra permission is needed. A trusted timestamp from the box needs the timestamp server allowed once (Settings → *Allow*). Only record what you're entitled to: other
people's calls, windows and private messages may be covered by consent and privacy laws where you live.

## Share

Right-click → **Share…** (or the **Share** tab). Edit the link, a comment and a quote (your selection is filled in), choose hashtags, and
click a service: **X, Bluesky, Mastodon** (your own server), **Threads, Reddit, LinkedIn, Facebook, Telegram, WhatsApp, Hacker News, email**.
Each opens that service's own sharing window with the text filled in; you still press Post there. PageMate has no accounts, posts nothing and
keeps nothing. It **removes tracking codes** (`utm_…`, `fbclid`, `gclid` …) from the link, keeps the text inside each service's length limit,
and **warns** when a link looks private: a signed or token address, a local address, a sign-in or account page. **Share image…** in the
screenshot viewer uses your device's share sheet where available; elsewhere the social buttons copy the picture first so you can paste it into the post.
Think before sharing anything that could identify a source, a victim or a private person.

## Troubleshooting

- **"Can't reach your Kokoro server"**: check that the Kokoro server is running, that
  `http://<server-ip>:8880/web` opens in the browser, and that you're on the home network or VPN.
  Fix it, then press play in the player to retry.
- **Nothing happens on some pages / the icon shows a red "!"**: browsers don't let extensions run on built-in pages
  (`brave://…`, the Web Store, the PDF viewer). Everything else works.
- **It reads menus or misses text**: select the text you want and use **Read selection aloud**.
- **After updating the files**: click the reload arrow on the extension card in `brave://extensions`.
  Pages that were already open keep working; open the toolbox and choose **Read aloud** (or press Alt+Shift+R) to bring the player back.
- **Reading stopped after following a link to another site**: the extension only gets access to the site you
  started it on. Choose **Read aloud** (or press Alt+Shift+R) on the new site to keep going.

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
- **Investigate, screenshots and sharing** run in your browser. Lookups, archives and share buttons are links you click: the service you
  open learns what you asked, as if you had typed it there. Three actions contact a service directly, and only when you click them:
  *List saved copies* / *Save now* (archive.org), a **trusted timestamp** (the SHA-256 of the manifest goes to the authority you chose),
  and *Fetch* of an image or video by address (to the site that hosts it). With access to sites allowed, PageMate notes each page's response
  headers (memory only, per tab, cookie values removed); turn that off in settings. The **trail** is off unless you switch it on.
