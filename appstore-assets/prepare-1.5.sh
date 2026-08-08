#!/bin/bash
# Prepare 1.5 in App Store Connect. Run this once 1.4 has left review —
# Apple refuses to create a version while another is IN_REVIEW (409
# ENTITY_ERROR.RELATIONSHIP.INVALID, "You cannot create a new version of
# the App in the current state"), which is why this is a script and not
# something already done.
#
# It stops before submitting. `asc.py submit` needs --confirm and is
# Joey's call, deliberately, after walking the build on hardware.
set -euo pipefail

PY=/Users/joeyfarah/.appstoreconnect/tools/venv/bin/python3
ASC=/Users/joeyfarah/.appstoreconnect/tools/asc.py
APP=6792509326
NOTES="$(dirname "$0")/release-notes/1.5.txt"

# Which build to ship. Every push to main mints a new one, so a hardcoded
# UUID goes stale the next time anything lands — take the number instead
# and look the UUID up, defaulting to the newest that finished processing.
#
#   ./prepare-1.5.sh        # newest VALID build
#   ./prepare-1.5.sh 49     # the build actually walked on hardware
#
# Pass the number explicitly if any commit landed after the walk: "newest"
# is the right default only while the tested build is still the newest.
WANT_BUILD="${1:-}"

state=$("$PY" "$ASC" versions "$APP" | awk '$2=="1.4"{print $3}')
if [ "$state" != "READY_FOR_SALE" ]; then
  echo "1.4 is $state — wait for READY_FOR_SALE before preparing 1.5." >&2
  exit 1
fi

builds=$("$PY" "$ASC" builds "$APP")
if [ -n "$WANT_BUILD" ]; then
  row=$(echo "$builds" | awk -v n="$WANT_BUILD" '$3==n{print; exit}')
  [ -n "$row" ] || { echo "no build numbered $WANT_BUILD" >&2; exit 1; }
else
  row=$(echo "$builds" | awk '$4=="VALID"{print; exit}')
  [ -n "$row" ] || { echo "no VALID build to attach" >&2; exit 1; }
fi
BUILD_ID=$(echo "$row" | awk '{print $1}')
BUILD_NUM=$(echo "$row" | awk '{print $3}')
BUILD_STATE=$(echo "$row" | awk '{print $4}')
[ "$BUILD_STATE" = "VALID" ] || { echo "build $BUILD_NUM is $BUILD_STATE, not VALID" >&2; exit 1; }
echo "==> shipping build $BUILD_NUM ($BUILD_ID)"

echo "==> creating 1.5"
VERSION_ID=$("$PY" "$ASC" create-version "$APP" 1.5 | sed -n 's/.*id=//p')
echo "    version id: $VERSION_ID"

echo "==> locating the en-US localization"
LOC_ID=$("$PY" "$ASC" locale "$VERSION_ID" | awk '$2=="en-US"{print $1}')
echo "    localization id: $LOC_ID"

echo "==> setting what's-new"
"$PY" "$ASC" notes "$LOC_ID" "$NOTES"

echo "==> attaching build $BUILD_NUM"
"$PY" "$ASC" attach-build "$VERSION_ID" "$BUILD_ID"

cat <<EOF

1.5 is prepared and NOT submitted.

  version id : $VERSION_ID
  build      : $BUILD_NUM

Screenshots carry over from 1.4 unless the UI changed; recapture with
  npm run screenshots
and upload with
  $PY $ASC screenshots $LOC_ID appstore-assets/screenshots

To submit, after walking build $BUILD_NUM on a device:
  $PY $ASC submit $APP $VERSION_ID --confirm
EOF
