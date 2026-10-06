# SkyMap UI tests

Drive the real iOS app in a simulator — search, Directions, GO — then walk the
simulated GPS down a route and check the banner names each building at its
door. Nothing to click.

    sh ios/UITests/run.sh

This is a separate Xcode project on purpose: the tests attach to the installed
app by bundle id, so `App.xcodeproj` and Xcode Cloud never see them.
`project.yml` generates `SkyMapUITests.xcodeproj` (needs `brew install xcodegen`).

`WalkFixture.swift` is generated from the shipped data by `make-walk.mjs`;
re-run it if a data refresh changes the route:

    node ios/UITests/make-walk.mjs "Target Center" "IDS Center"

Xcode 27 has no Simulator.app; to watch a run, open Device Hub
(`/Applications/Xcode.app/Contents/Applications/DeviceHub.app`).
