import CoreGraphics
import Foundation

/// The windows on screen when a capture starts, front to back, taken before any overlay
/// appears: element detection decides from it which app is under a point, because hit-testing
/// the live screen would answer with the overlay.
struct WindowSnapshot {
  /// The smallest side a window needs to be offered; thinner ones are shadows and separators.
  private static let minimumSide: CGFloat = 5

  let windows: [CaptureWindow]

  /// On-screen windows of other apps from the normal level up to open menus, without the
  /// desktop, invisible windows and the Dock's screen-sized window. The app's own windows are
  /// left out: they are not in the frozen image either.
  static func take() -> WindowSnapshot {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let infos = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
    else { return WindowSnapshot(windows: []) }
    let ownPID = ProcessInfo.processInfo.processIdentifier
    let highest = Int(CGWindowLevelForKey(.popUpMenuWindow))
    let dock = Int(CGWindowLevelForKey(.dockWindow))
    return WindowSnapshot(
      windows: infos.compactMap { info -> CaptureWindow? in
        guard let number = info[kCGWindowNumber as String] as? NSNumber,
          let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid != ownPID,
          let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue,
          (0...highest).contains(layer), layer != dock,
          (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1 > 0,
          let bounds = info[kCGWindowBounds as String] as? NSDictionary,
          let frame = CGRect(dictionaryRepresentation: bounds),
          min(frame.width, frame.height) >= minimumSide
        else { return nil }
        return CaptureWindow(
          windowID: number.uint32Value, pid: pid, quartzFrame: frame, layer: layer)
      })
  }
}
