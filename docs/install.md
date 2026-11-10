# Installing PageMate

PageMate is not in any browser's add-on store yet, so you install it from a download. This page has the details for every browser and
system. For the short version, see the [README](../README.md#install).

**Contents:** [Which package](#which-package) · [Chrome, Edge, Brave, Opera, Vivaldi](#chrome-edge-brave-opera-vivaldi) · [Firefox](#firefox) ·
[By system](#by-system) · [Updating](#updating) · [Uninstalling](#uninstalling) · [Building from source](#building-from-source) · [Problems](#problems)

## Which package

PageMate is built twice from the same code. The operating system doesn't matter; the browser does.

| Browser | Package | Minimum version |
|---|---|---|
| Chrome, Edge, Brave, Opera, Vivaldi, Arc and other Chromium browsers | `pagemate-<version>-chromium.zip` | 116 |
| Firefox, Firefox Developer Edition, Firefox ESR | `pagemate-<version>-firefox.zip`, or the signed `pagemate-<version>.xpi` | 128 |

Download from the [Releases page](https://github.com/boxkutter/page-mate/releases). Safari isn't supported.

Unzip a package into a folder you will keep (for example `Documents/PageMate`). Chromium browsers load the extension straight from that
folder, so moving or deleting it breaks PageMate.

## Chrome, Edge, Brave, Opera, Vivaldi

1. Open the extensions page:
   `chrome://extensions`, `edge://extensions`, `brave://extensions`, `opera://extensions` or `vivaldi://extensions`.
2. Turn on **Developer mode** (top right; in Edge it's at the bottom left).
3. Click **Load unpacked** and choose the unzipped folder (the one that contains `manifest.json`).
4. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to **PageMate**.
5. The settings page opens on first install. You can skip it unless you want reading aloud ([set it up](../README.md#set-up-reading-aloud)).

Chrome may show a "Disable developer mode extensions" notice at startup. That is Chrome's standard message for any extension loaded this way;
choosing *Keep* is fine. It goes away when PageMate is available from a store.

## Firefox

Regular Firefox only installs add-ons signed by Mozilla, and only keeps unsigned ones until you quit. You have three options.

**Signed `.xpi` (recommended).** Open `pagemate-<version>.xpi` from the Releases page in Firefox, or drag it onto a Firefox window, and
accept the prompt. It stays installed. It is signed by Mozilla but **not listed** in the add-ons store, so it does not update itself:
to update, install the newer `.xpi` over it.

**Temporary install (to try it).**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json` inside the unzipped firefox folder (or the `.zip` itself).
3. It stays until Firefox closes; repeat next time.

**Unsigned, permanent (Developer Edition, Nightly or unbranded/ESR builds only).** Set `xpinstall.signatures.required` to `false`
in `about:config`, then install the `.zip` from `about:addons` → ⚙ → *Install Add-on From File…*. Regular Firefox ignores that setting.

After installing, pin it: puzzle-piece (Extensions) icon → ⚙ next to PageMate → *Pin to Toolbar*.

**Permissions in Firefox.** Firefox treats "all sites" access as something you grant, not something an add-on has on install. PageMate
asks for it the first time a tool needs it (**Allow** on the Save page, a screenshot of another tab, and so on). You can also grant or
revoke it at `about:addons` → PageMate → *Permissions*.

**What differs in Firefox:**
- A sealed evidence capture holds `capture.html` (the page's HTML) instead of one MHTML file, because Firefox can't make those. The
  screenshot, text, details and fingerprints are the same, and the chain-of-custody record says which file you have.
- Screen recording can't include the computer's or a tab's sound in most setups. The microphone works.
- Keyboard shortcuts are set under *Add-ons Manager → ⚙ → Manage Extension Shortcuts*.

## By system

The packages are identical on Windows, macOS and Linux. What differs is around the edges.

**Windows**
- Saved files go to your browser's Downloads folder. File names are made safe for Windows (no `: * ? " < > |`, no reserved names such as `CON`).
- To check a sealed capture, open PowerShell in the unzipped folder and run `Get-FileHash <file> -Algorithm SHA256`, then compare with the
  line in `SHA256SUMS`. For signatures and timestamps you need `openssl` (it comes with Git for Windows, or install any OpenSSL build).

**macOS**
- <kbd>Alt</kbd> in this documentation is the <kbd>Option</kbd> (⌥) key, so reading is <kbd>⌥</kbd><kbd>Shift</kbd><kbd>R</kbd>.
- **Screen recording** needs your browser allowed under *System Settings → Privacy & Security → Screen Recording*; macOS asks the first time, and
  you then restart the browser.
- To check a sealed capture: `shasum -a 256 -c SHA256SUMS`. Checking a signature or timestamp needs `openssl`; the one built into macOS may lack the `ts` command used for timestamps, so if it says "Invalid command 'ts'", install a full one with `brew install openssl`.

**Linux**
- Some desktops use <kbd>Alt</kbd>+click to move windows. Use the ⌖ button in the reader instead of Alt+click to start reading from a paragraph.
- On Wayland (recent Fedora, Ubuntu), the desktop shows its own screen-share chooser before the browser's. Choose there, then in the browser.
- Recordings made in Chrome-family browsers play in GStreamer-based players (GNOME Videos) because PageMate clears a flag that those players
  trip over; see the [guide](guide.md#record-the-screen).
- To check a sealed capture: `sha256sum -c SHA256SUMS`.
- If the browser was installed as a Snap or Flatpak, it may not be able to read a folder outside its sandbox: unzip PageMate under your home folder.

## Updating

- **Chromium browsers:** unzip the newer package over the same folder (replace the files), then open the extensions page and press the
  **reload** arrow on PageMate's card. Pages already open keep working; open the toolbox and choose **Read aloud** to bring the player back.
- **Firefox, signed:** install the newer `.xpi` over the old one.
- **Firefox, temporary:** load the newer `manifest.json` again from `about:debugging`.

Your settings and notes are kept in the browser, so updating doesn't lose them. The version is shown on the extensions page, and each version's
changes are in the [changelog](../CHANGELOG.md).

## Uninstalling

Remove it from the extensions page (`chrome://extensions` → *Remove*, or Firefox `about:addons` → ⋯ → *Remove*). That deletes PageMate's
settings and **notes**, so export what you want to keep first (*All my notes* → backup). Files you saved or sealed are ordinary files in
your Downloads folder and are not touched.

## Building from source

You need only [Node.js](https://nodejs.org) 18 or newer, on Windows, macOS or Linux. No other tools.

```
git clone https://github.com/boxkutter/page-mate.git
cd page-mate
node scripts/build.js
```

This writes, in `dist/`: `pagemate-<version>-chromium.zip` and `pagemate-<version>-firefox.zip`, plus the same as unpacked folders
(`dist/chromium`, `dist/firefox`) you can load directly. `node scripts/build.js firefox` builds just one.

For development in a Chromium browser you can load the repository's `extension/` folder itself and skip building; Firefox needs the build,
because it needs a different manifest. Maintainers who sign for Firefox: see *Signing for Firefox* in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Problems

- **"Load unpacked" is missing:** Developer mode is off (step 2 above). On managed work or school computers an administrator may block it.
- **"Manifest file is missing or unreadable":** you chose the folder that holds the unzipped folder, not the one with `manifest.json` in it.
- **Firefox says the add-on "could not be verified":** use the signed `.xpi`, or the temporary install. Regular Firefox rejects unsigned `.zip` files.
- **The icon is hidden:** it is in the puzzle-piece menu; pin it.
- **The icon shows a red "!" on a page:** browsers don't let extensions run on their own pages (`chrome://…`, `about:…`, the web stores, the PDF viewer). Everything else works.
- More in the [user guide's troubleshooting](guide.md#troubleshooting). If you're stuck, [open an issue](https://github.com/boxkutter/page-mate/issues) with your browser, version, system and PageMate version.
