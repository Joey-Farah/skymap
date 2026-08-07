#!/bin/bash
# Prepare 1.4 in App Store Connect. Run this once 1.3 has left review —
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
BUILD_45=dc8df4e1-6539-4d4f-b4c0-72e1929ee37b   # build 45, from commit 4ab17b2
NOTES="$(dirname "$0")/release-notes/1.4.txt"

state=$("$PY" "$ASC" versions "$APP" | awk '$2=="1.3"{print $3}')
if [ "$state" != "READY_FOR_SALE" ]; then
  echo "1.3 is $state — wait for READY_FOR_SALE before preparing 1.4." >&2
  exit 1
fi

echo "==> creating 1.4"
VERSION_ID=$("$PY" "$ASC" create-version "$APP" 1.4 | sed -n 's/.*id=//p')
echo "    version id: $VERSION_ID"

echo "==> locating the en-US localization"
LOC_ID=$("$PY" "$ASC" locale "$VERSION_ID" | awk '$2=="en-US"{print $1}')
echo "    localization id: $LOC_ID"

echo "==> setting what's-new"
"$PY" "$ASC" notes "$LOC_ID" "$NOTES"

echo "==> attaching build 45"
"$PY" "$ASC" attach-build "$VERSION_ID" "$BUILD_45"

cat <<EOF

1.4 is prepared and NOT submitted.

  version id : $VERSION_ID
  build      : 45 (commit 4ab17b2)

Screenshots carry over from 1.3 unless the UI changed; recapture with
  npm run screenshots
and upload with
  $PY $ASC screenshots $LOC_ID appstore-assets/screenshots

To submit, after walking build 45 on a device:
  $PY $ASC submit $APP $VERSION_ID --confirm
EOF
