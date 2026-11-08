# Security policy

PageMate reads the pages you open, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security tab → "Report a vulnerability"** on <https://github.com/boxkutter/page-mate>.

Include what you found, how to reproduce it, and the browser/version. You'll get a reply as soon as the maintainer can
manage; this is a small volunteer project, so please allow a few days.

## What is in scope

- Anything that makes the extension send page text, notes or file contents somewhere other than the Kokoro server address
  the user entered.
- Script injection into pages or into the extension's own pages (for example through a crafted page title, note, or an
  imported notes backup).
- Permissions being used beyond what the user granted or asked for.
- Bugs in saved files (offline web page, evidence packages) that could run code or leak data when they are opened.

## Supported versions

Only the latest release receives fixes.
