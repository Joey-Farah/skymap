import XCTest

/// Opening the feedback form must not raise the keyboard: on a phone it
/// came up at once and pushed the top of the form off the screen (Joey,
/// 2026-10-14). The keyboard should wait for a tap on a field.
///
/// The app must be built with VITE_FEEDBACK_ENDPOINT set, as Xcode Cloud
/// builds it; without one the button goes straight to Mail instead. These
/// tests never press Send.
final class FeedbackTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "app.skymap.ios")

  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    app.terminate()
  }

  func testFeedbackFormOpensWithTheKeyboardDown() throws {
    app.launch()
    let feedback = app.buttons["Feedback"]
    XCTAssertTrue(feedback.waitForExistence(timeout: 30), "no Feedback button")
    feedback.tap()

    let title = app.staticTexts["Send feedback"]
    XCTAssertTrue(title.waitForExistence(timeout: 10), "the form didn't open")
    let message = app.textViews.firstMatch
    XCTAssertTrue(message.waitForExistence(timeout: 5), "no message box")
    sleep(2) // give a keyboard time to come up, if one is going to
    attach("form open")

    XCTAssertFalse(hasFocus(message), "the message box took focus on open, which raises the keyboard")
    XCTAssertEqual(app.keyboards.count, 0, "a keyboard came up on open")
    XCTAssertTrue(title.isHittable, "the form's title is off screen")

    // Typing still starts with a tap.
    message.tap()
    let focused = NSPredicate { _, _ in self.hasFocus(message) }
    expectation(for: focused, evaluatedWith: nil)
    waitForExpectations(timeout: 5)
    attach("message tapped")
  }

  private func hasFocus(_ element: XCUIElement) -> Bool {
    (element.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
  }

  private func attach(_ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }
}
