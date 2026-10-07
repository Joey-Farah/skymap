#!/bin/sh
# Renders card.html to card.pdf (2 pages, with bleed) and a preview PNG.
# Usage: sh render.sh
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=card.pdf "file://$PWD/card.html" 2>/dev/null
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=460,480 --screenshot=preview.png "file://$PWD/card.html" 2>/dev/null
echo "card.pdf preview.png"

node "$(dirname "$0")/make-print.mjs"   # card-print.pdf: font-free version for print shops
# Vistaprint's US card canvas is 3.61 x 2.11 in (0.055 in bleed, not our
# 0.125): trim 0.07 in (54 px at 768 dpi) off every edge, no scaling.
for s in front back; do sips -c 1620 2772 "$(dirname "$0")/print-$s.png" --out "$(dirname "$0")/vistaprint-$s.png" >/dev/null; done
