#!/usr/bin/env node
// Builds the Firefox package and has Mozilla sign it as an UNLISTED add-on: it is not shown in the add-ons store, and you get back
// a signed .xpi that installs permanently in normal Firefox (drag it onto a Firefox window, or open it from about:addons).
//
//   AMO_JWT_ISSUER=user:12345:67 AMO_JWT_SECRET=... node scripts/sign-firefox.js
//
// Get the two values (free) at https://addons.mozilla.org/developers/addon/api/key/ while signed in to a Firefox account.
// Keep them secret: never put them in a file in this repository. The signed file lands in dist/signed/.
// Mozilla refuses a version number it has already signed, so bump "version" in extension/manifest.json for each new signing.
'use strict';
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const { build } = require('./build.js');

const WEB_EXT = 'web-ext@10.8.0';   // pinned: this tool handles your keys
const issuer = process.env.AMO_JWT_ISSUER, secret = process.env.AMO_JWT_SECRET;
if (!issuer || !secret) {
  console.error('Set AMO_JWT_ISSUER and AMO_JWT_SECRET (API keys from https://addons.mozilla.org/developers/addon/api/key/).');
  process.exit(2);
}

const built = build('firefox');
const out = path.join(__dirname, '..', 'dist', 'signed');
fs.mkdirSync(out, { recursive: true });
// The keys go in through the environment, not the command line, so they don't show up in process lists or logs.
const r = spawnSync('npx', ['--yes', WEB_EXT, 'sign', '--channel=unlisted', '--source-dir', built.dir, '--artifacts-dir', out, '--approval-timeout', '900000'], {
  stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret }
});
if (r.status !== 0) process.exit(r.status || 1);
const xpi = fs.readdirSync(out).filter(f => f.endsWith('.xpi')).sort().pop();
console.log(xpi ? `\nSigned: dist/signed/${xpi}` : '\nNo .xpi was produced; see the messages above.');
