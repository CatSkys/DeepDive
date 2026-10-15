import AppKit

/// What the keyboard or the scroll wheel asks of a capture session.
enum CaptureCommand: Equatable {
  case cancel
  case confirm
  /// Walks the candidate chain: positive towards larger areas.
  case walk(Int)
  case nudge(dx: CGFloat, dy: CGFloat)
  /// Moves the trailing (right, bottom) edges.
  case resize(dWidth: CGFloat, dHeight: CGFloat)
  /// Moves the leading (left, top) edges by `dx`, `dy`.
  case resizeLeading(dx: CGFloat, dy: CGFloat)
  /// Select All: the whole display of the overlay that received it.
  case selectDisplay
  /// `R`: the last region confirmed on the pointer's display.
  case recall
  /// `W`: offers only windows (and the display) instead of elements, or elements again.
  case toggleWindowsOnly

  /// The command a key press means on an overlay, or nil for a key the overlay leaves alone.
  /// Arrows nudge the selection (Shift: 10 points), Option-arrows move its trailing edges and
  /// Option-Shift-arrows its leading ones.
  init?(_ event: NSEvent) {
    let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
    let key = event.charactersIgnoringModifiers?.lowercased()
    if flags == .command, key == "a" {
      self = .selectDisplay
      return
    }
    if let (dx, dy) = Self.arrow(event.keyCode) {
      switch (flags.contains(.option), flags.contains(.shift)) {
      case (true, true): self = .resizeLeading(dx: dx, dy: dy)
      case (true, false): self = .resize(dWidth: dx, dHeight: dy)
      case (false, true): self = .nudge(dx: dx * 10, dy: dy * 10)
      case (false, false): self = .nudge(dx: dx, dy: dy)
      }
      return
    }
    switch event.keyCode {
    case 53: self = .cancel
    case 36, 76: self = .confirm
    case 48: self = .walk(flags.contains(.shift) ? -1 : 1)
    default:
      guard flags.isEmpty else { return nil }
      switch key {
      case "r": self = .recall
      case "w": self = .toggleWindowsOnly
      default: return nil
      }
    }
  }

  /// One point in an arrow key's direction (view space, y down).
  private static func arrow(_ keyCode: UInt16) -> (CGFloat, CGFloat)? {
    switch keyCode {
    case 123: (-1, 0)
    case 124: (1, 0)
    case 125: (0, 1)
    case 126: (0, -1)
    default: nil
    }
  }
}

/// Receives an overlay's input; points are in the overlay's view space.
protocol CaptureOverlayDelegate: AnyObject {
  func overlay(_ overlay: CaptureOverlayView, pointerAt point: CGPoint)
  func overlay(_ overlay: CaptureOverlayView, mouseDownAt point: CGPoint, clickCount: Int)
  /// `square` is Shift's state: a free selection being created is held to a square.
  func overlay(_ overlay: CaptureOverlayView, mouseDraggedTo point: CGPoint, square: Bool)
  func overlay(_ overlay: CaptureOverlayView, mouseUpAt point: CGPoint, square: Bool)
  func overlayRightClicked(_ overlay: CaptureOverlayView)
  func overlay(_ overlay: CaptureOverlayView, perform command: CaptureCommand)
  /// The cursor at `point`, or nil to leave it to whatever the annotation editor shows there.
  func overlay(_ overlay: CaptureOverlayView, cursorAt point: CGPoint) -> NSCursor?
}
