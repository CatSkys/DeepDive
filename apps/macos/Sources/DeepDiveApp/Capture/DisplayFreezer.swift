import AppKit
import ScreenCaptureKit

/// Freezes displays with ScreenCaptureKit: one screenshot per display with the app's own windows
/// filtered out, so neither the panel, the settings window nor the overlays are ever in the image.
/// Displays are taken one at a time, the one under the cursor first:
/// `replayd` serialises concurrent requests and charges each queued one, so a sequential run
/// gets the cursor's display interactive soonest.
struct DisplayFreezer {
  /// A display ScreenCaptureKit offers, with the screen its overlay goes on.
  struct Target {
    let display: SCDisplay
    let screen: NSScreen
  }

  private let excluded: [SCRunningApplication]
  /// Displays in capture order: the one under the cursor first.
  let targets: [Target]

  /// Reads what can be captured. Throws ScreenCaptureKit's error, for example when the Screen
  /// Recording grant no longer matches this build.
  static func prepare() async throws -> DisplayFreezer {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false, onScreenWindowsOnly: true)
    let ownPID = ProcessInfo.processInfo.processIdentifier
    let screens = NSScreen.screens
    let cursorID = screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }?
      .displayID
    let targets = content.displays.compactMap { display -> Target? in
      screens.first { $0.displayID == display.displayID }.map {
        Target(display: display, screen: $0)
      }
    }
    return DisplayFreezer(
      excluded: content.applications.filter { $0.processID == ownPID },
      targets: targets.filter { $0.display.displayID == cursorID }
        + targets.filter { $0.display.displayID != cursorID })
  }

  /// The display's pixels at its native scale, without the cursor, in the display's own
  /// colour space (SDR), which is also what the crop exports.
  func freeze(_ target: Target) async throws -> FrozenDisplay? {
    let filter = SCContentFilter(
      display: target.display, excludingApplications: excluded, exceptingWindows: [])
    let scale = CGFloat(filter.pointPixelScale)
    let configuration = SCScreenshotConfiguration()
    configuration.width = Int((filter.contentRect.width * scale).rounded())
    configuration.height = Int((filter.contentRect.height * scale).rounded())
    configuration.showsCursor = false
    configuration.dynamicRange = .sdr
    configuration.displayIntent = .local
    let output = try await SCScreenshotManager.captureScreenshot(
      contentFilter: filter, configuration: configuration)
    guard let image = output.sdrImage else { return nil }
    return FrozenDisplay(
      displayID: target.display.displayID, quartzFrame: CGDisplayBounds(target.display.displayID),
      image: image)
  }

  /// ScreenCaptureKit's answer when the user declined or the grant is gone.
  static func isPermissionError(_ error: any Error) -> Bool {
    (error as? SCStreamError)?.code == .userDeclined
  }
}
