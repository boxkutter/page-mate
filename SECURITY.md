# Security policy

PageMate reads the pages you open, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security tab → "Report a vulnerability"** on <https://github.com/boxkutter/page-mate>.

Include what you found, how to reproduce it, and the browser, version and operating system (Firefox or Chromium package). You'll get a reply as soon as the maintainer can
manage; this is a small volunteer project, so please allow a few days.

## What is in scope

- Anything that makes the extension send page text, notes or file contents somewhere other than the Kokoro server address
  the user entered.
- Script injection into pages or into the extension's own pages (for example through a crafted page title, note, or an
  imported notes backup).
- Permissions being used beyond what the user granted or asked for.
- Bugs in saved files (offline web page, evidence packages) that could run code or leak data when they are opened.

## Supported versions

Only the latest release receives fixes, for both the Chromium and the Firefox package. Installing a fix means installing the newer package (see [docs/install.md](docs/install.md#updating)); there is no automatic update yet.

What PageMate reads and sends is described in [docs/privacy.md](docs/privacy.md); a mismatch between that page and the code's behavior is itself worth reporting.
