#!/bin/sh
# Builds the app, installs it on an iPhone simulator and runs the UI tests —
# no clicking. Prints the banner timeline from the walk test at the end.
#   sh ios/UITests/run.sh              # first available iPhone simulator
#   SIM_ID=<udid> sh ios/UITests/run.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
OUT="${TMPDIR:-/tmp}/skymap-uitests"
# A booted iPhone if there is one, else the newest-listed iPhone.
pick_sim() {
  list="$(xcrun simctl list devices available | grep -E 'iPhone' || true)"
  { echo "$list" | grep Booted; echo "$list" | tail -r; } | grep -m1 -oE '[0-9A-F-]{36}' || true
}
SIM_ID="${SIM_ID:-$(pick_sim)}"
[ -n "$SIM_ID" ] || { echo "no iPhone simulator found"; exit 1; }

cd "$ROOT"
npm run build --silent >/dev/null
npx cap sync ios >/dev/null
xcrun simctl boot "$SIM_ID" 2>/dev/null || true
xcrun simctl privacy "$SIM_ID" grant location app.skymap.ios 2>/dev/null || true
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "id=$SIM_ID" -derivedDataPath "$OUT/app" -quiet build
xcrun simctl install "$SIM_ID" "$OUT/app/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl privacy "$SIM_ID" grant location app.skymap.ios

cd "$HERE"
command -v xcodegen >/dev/null && xcodegen -q
rm -rf "$OUT/results.xcresult"
status=0
xcodebuild test -project SkyMapUITests.xcodeproj -scheme SkyMapUITests \
  -destination "id=$SIM_ID" -derivedDataPath "$OUT/tests" -resultBundlePath "$OUT/results.xcresult" \
  -test-timeouts-enabled YES -maximum-test-execution-time-allowance 600 > "$OUT/test.log" 2>&1 || status=$?
grep -E '^(WALK TRANSITIONS|[0-9]+ m: )' "$OUT/test.log" | head -20
grep -E "error:|Test Case .*(passed|failed)" "$OUT/test.log" || true
echo "screenshots: open $OUT/results.xcresult"
exit $status
