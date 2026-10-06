import CoreLocation
import XCTest

/// Drives the installed SkyMap app the way a person would — search, card,
/// Directions, GO — then walks the simulated GPS down the drawn route and
/// checks the banner names each building at its door, not before.
///
/// Install the app first (run.sh does it); these tests attach to it by
/// bundle id rather than building it.
final class WalkTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "app.skymap.ios")
  /// Earliest the banner may move on before a door, and latest after it.
  /// The tracker smooths fixes, so a little lag is expected; running early
  /// is the bug 1.18 fixed (it used to switch a median 34 m early).
  private let earlySlack = 5.0
  private let lateSlack = 20.0

  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    app.terminate()
  }

  func testBannerChangesBuildingAtEachDoor() throws {
    let points = WalkFixture.waypoints
    XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: points[0].latitude, longitude: points[0].longitude))
    app.launch()
    startNavigation(to: WalkFixture.to)
    let names = WalkFixture.buildings
    XCTAssertEqual(banner(), "Head into \(names[1])", "starts heading into the first building after the origin")

    var transitions: [(at: Double, text: String)] = []
    var last = banner()
    for (along, point) in samples(points, every: 3) {
      XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: point.latitude, longitude: point.longitude))
      usleep(400_000)
      let now = banner()
      if now != last {
        transitions.append((along, now))
        attachScreenshot("\(Int(along)) m — \(now)")
        last = now
      }
    }
    let log = transitions.map { "\(Int($0.at)) m: \($0.text)" }.joined(separator: "\n")
    print("WALK TRANSITIONS\n\(log)")

    // One change per building after the first: "Head into" each next one,
    // then "You've arrived" at the end of the line.
    let expected = (2..<names.count).map { "Head into \(names[$0])" } + ["You've arrived"]
    XCTAssertEqual(transitions.map(\.text), expected, log)
    let doors = Array(WalkFixture.stepStarts.dropFirst())
    for (t, door) in zip(transitions, doors) {
      XCTAssertGreaterThanOrEqual(t.at, door - earlySlack, "\(t.text) came \(Int(door - t.at)) m before the door\n\(log)")
      XCTAssertLessThanOrEqual(t.at, door + lateSlack, "\(t.text) came \(Int(t.at - door)) m after the door\n\(log)")
    }
  }

  // MARK: - Steps a person takes

  private func startNavigation(to destination: String) {
    let search = app.textFields["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 20), "search field")
    search.tap()
    search.typeText(destination)
    let firstResult = app.otherElements["Search results"].children(matching: .other).element(boundBy: 0)
    XCTAssertTrue(firstResult.waitForExistence(timeout: 5), "search results")
    firstResult.tap()
    let directions = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Directions'")).firstMatch
    XCTAssertTrue(directions.waitForExistence(timeout: 10), "place card for \(destination)")
    directions.tap()
    let go = app.buttons["GO"]
    XCTAssertTrue(go.waitForExistence(timeout: 10), "route preview")
    XCTAssertTrue(app.textFields["Destination"].value as? String == destination, "routing to \(destination)")
    go.tap()
    XCTAssertTrue(app.buttons["End"].waitForExistence(timeout: 10), "navigation started")
  }

  private func banner() -> String {
    let match = app.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH 'Head into' OR label == \"You've arrived\"")
    ).firstMatch
    return match.exists ? match.label : ""
  }

  private func attachScreenshot(_ name: String) {
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  /// Points every `step` metres along the polyline, with their distance along it.
  private func samples(_ line: [CLLocationCoordinate2D], every step: Double) -> [(Double, CLLocationCoordinate2D)] {
    var out: [(Double, CLLocationCoordinate2D)] = []
    var walked = 0.0
    var next = 0.0
    for (a, b) in zip(line, line.dropFirst()) {
      let leg = CLLocation(latitude: a.latitude, longitude: a.longitude)
        .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
      while next <= walked + leg {
        let f = leg > 0 ? (next - walked) / leg : 0
        out.append((next, CLLocationCoordinate2D(
          latitude: a.latitude + (b.latitude - a.latitude) * f,
          longitude: a.longitude + (b.longitude - a.longitude) * f)))
        next += step
      }
      walked += leg
    }
    out.append((walked, line[line.count - 1]))
    return out
  }
}
