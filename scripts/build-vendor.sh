#!/bin/bash
# Rebuilds extension/vendor/ts2mp4.min.js (a tree-shaken bundle of Mediabunny).
# Needs network + node. Pinned so the result is reproducible.
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp scripts/vendor-entry.js "$work/entry.js"
(cd "$work" && npm init -y >/dev/null && npm i --silent mediabunny@1.65.2 esbuild@0.25.0 >/dev/null \
  && npx esbuild entry.js --bundle --minify --format=iife --target=chrome116 --legal-comments=none --outfile=ts2mp4.min.js)
mkdir -p extension/vendor
cp "$work/ts2mp4.min.js" extension/vendor/ts2mp4.min.js
cp "$work/node_modules/mediabunny/LICENSE" extension/vendor/LICENSE-mediabunny.txt
echo "Built extension/vendor/ts2mp4.min.js ($(wc -c < extension/vendor/ts2mp4.min.js) bytes)"
