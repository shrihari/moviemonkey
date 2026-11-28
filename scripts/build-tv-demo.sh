#!/usr/bin/env bash
# Builds the sample-films demo of the TV screens (src/tv/demo.ts) for
# getmoviemonkey.com/tv/, where the LG app's "Try with sample films" opens it.
#
#   npm run build:tv-demo [-- path/to/moviemonkey-website]
#
# Writes <website>/public/tv/ (index.html and its assets); commit and deploy
# the website to publish it.
set -euo pipefail
cd "$(dirname "$0")/.."
site="${1:-../moviemonkey-website}"
out="$site/public/tv"
if [ ! -d "$site/public" ]; then
  echo "No website at $site (pass its path)." >&2
  exit 1
fi
VITE_TV_DEMO=1 npx vite build --base /tv/ --outDir "$out" --emptyOutDir
mv "$out/tv.html" "$out/index.html"
echo "Built $out"
