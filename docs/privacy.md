# Privacy and permissions

PageMate has no account, no analytics and no server of its own. This page says exactly what it reads, what leaves your browser, and why
it asks for each permission.

## What stays in your browser

- **Settings** (server address, voice, speed, save options) are kept in your browser's sync storage. If your browser sync is on, the browser
  itself may copy them to your other devices; PageMate does not.
- **Notes and highlights** are stored **only in this browser** (local storage). Back them up from *All my notes*.
- **Saving pages, downloads, screenshots, recordings, sealing and investigating** all run inside your browser. Nothing is uploaded.
- **Screenshots** filed to Notes are kept in this browser; a screenshot in the viewer is deleted when its tab closes.
- **Video and audio addresses** each tab loads are remembered in memory, for the current browser session only, so they can be offered for
  download. **Response headers** of each page are likewise remembered in memory (cookie values removed) for the site profile and evidence.
  Both can be turned off in Settings under *Saving pages and videos*.
- The **trail** (a log of pages you visit for a case) is off unless you switch it on, never records private windows, and stays in this browser.

## When PageMate reads a page

Only when you ask: the toolbar icon, a keyboard shortcut, or a right-click menu entry. If you leave *keep reading* on, it also reads the
next page in the tab you are already listening to. With the optional "all sites" access, it checks, on each page you open, only whether you
have notes for that exact address (to show your highlights again); pages without notes are left alone.

## What leaves your browser

| What | Where it goes | When |
|---|---|---|
| The text being read | **Only** the Kokoro server address you typed in Settings | While you listen |
| Lookups, archive and share buttons | The service whose link you click opens in a new tab, and learns what you searched for, as if you had typed it there | When you click |
| *List saved copies* / *Save now* | archive.org (the Internet Archive) | When you click them |
| A trusted timestamp | The time-stamping authority you chose receives **only the SHA-256 fingerprint** of the manifest, never the page | When you tick the option and seal |
| *Fetch* an image or video by address | The site that hosts it | When you click |
| Downloading a video, images or audio | The site that hosts them (as your browser would if you played or opened them) | When you download |

Nothing else is sent anywhere. There is no remote code, no telemetry and no update check of PageMate's own.

## Permissions

Required at install:

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Read the page you clicked on, and show the toolbox, player and notes sidebar there |
| `storage` | Remember your settings and notes |
| `contextMenus` | The right-click menu entries |
| `webRequest` | Notice the addresses of video files a tab loads, and each page's response headers (cookie values removed), for downloads, the site profile and evidence. Only works on sites you have allowed; kept in memory for the session |
| `declarativeNetRequestWithHostAccess` | Send the page's own address as the Referer while downloading a video, as the page's player would |
| `offscreen` (Chromium only) | A hidden page that plays the speech while the tab is in the background. Firefox plays it in its background page instead and doesn't need this |

Optional (asked for when you first need them, never at install):

| Permission | Asked for when | Why |
|---|---|---|
| All sites (`http://*/*`, `https://*/*`, `<all_urls>`) | You click **Allow** on the Save page, take a screenshot of a tab you didn't just click on, or want highlights to return automatically | Read the page and fetch its images and media; capture other tabs |
| `downloads` | You first save a file | Write files to your Downloads folder |
| `pageCapture` (Chromium only) | You first seal an evidence capture | Save the page as one MHTML file. Firefox keeps the page's HTML instead and doesn't need it |
| `tabs` | You switch on the **Trail** | Read the address and title of pages as they load, for the log |
| `clipboardWrite` | You tick **Copy each new screenshot automatically** | Put the picture on the clipboard |
| Your Kokoro server's address | You click **Connect** in Settings | Send it the text to read |
| A timestamp server, archive.org, a media host | You use that feature | Reach that one address |

Each optional permission can be removed at any time from the browser's extension settings. PageMate asks for exactly the address it needs
(for example, only your Kokoro server's), and drops the permission for an old server address when you change it.

## Questions or concerns

Ask in an [issue](https://github.com/boxkutter/page-mate/issues). To report a security or privacy problem, see [SECURITY.md](../SECURITY.md)
and do not post it publicly. The code is open: everything the extension does is in the `extension/` folder.
