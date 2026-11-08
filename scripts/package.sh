#!/bin/bash
# Builds dist/pagemate-<version>.zip for distribution / Chrome Web Store upload.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
for f in extension/*.js; do node --check "$f"; done
mkdir -p dist
out="dist/pagemate-$version.zip"
rm -f "$out"
(cd extension && zip -qr "../$out" . -x '.*')
echo "Built $out"
