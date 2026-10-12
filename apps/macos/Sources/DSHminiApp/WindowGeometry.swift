/// A rectangle in AppKit screen coordinates: points, origin at the bottom-left of the primary
/// display, y growing upwards. Secondary displays left of or below the primary one have
/// negative origins. `NSScreen.visibleFrame` (the work area) uses the same space.
public struct ScreenRect: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }

  public var maxX: Double { x + width }
  public var maxY: Double { y + height }
  public var size: WindowSize { WindowSize(width: width, height: height) }

  /// Edges included, so a cursor on the shared edge of two displays belongs to the first.
  public func contains(x px: Double, y py: Double) -> Bool {
    px >= x && px <= maxX && py >= y && py <= maxY
  }
}

public struct WindowSize: Equatable, Sendable {
  public var width: Double
  public var height: Double

  public init(width: Double, height: Double) {
    self.width = width
    self.height = height
  }
}

/// Panel placement in AppKit's y-up space: "bottom" is the work area's `y`, not its maximum.
public enum PanelGeometry {
  public static let defaultSize = WindowSize(width: 500, height: 680)
  public static let minimumSize = WindowSize(width: 320, height: 400)
  public static let margin = 16.0

  /// The resize floor stays inside the work area, so a small display never leaves an
  /// unreachable minimum for the native window.
  public static func minimumSize(in workArea: ScreenRect) -> WindowSize {
    WindowSize(
      width: min(minimumSize.width, workArea.width),
      height: min(minimumSize.height, workArea.height))
  }

  /// Docks the panel in the bottom-right corner of the work area. A stored size is kept inside
  /// the supported range; when the minimum plus both margins no longer fits, the panel yields
  /// the margin instead of leaving the work area.
  public static func dockedFrame(in workArea: ScreenRect, size: WindowSize = defaultSize)
    -> ScreenRect
  {
    let margin = min(margin, (min(workArea.width, workArea.height) / 4).rounded(.down))
    let minimum = minimumSize(in: workArea)
    let width = max(minimum.width, min(size.width, workArea.width - margin * 2))
    let height = max(minimum.height, min(size.height, workArea.height - margin * 2))
    return ScreenRect(
      x: max(workArea.x, workArea.maxX - width - margin),
      y: min(workArea.y + margin, workArea.maxY - height),
      width: width,
      height: height)
  }

  /// Shrinks a frame to the work area and moves it fully inside.
  public static func constrain(_ frame: ScreenRect, to workArea: ScreenRect) -> ScreenRect {
    let width = min(frame.width, workArea.width)
    let height = min(frame.height, workArea.height)
    return ScreenRect(
      x: max(workArea.x, min(frame.x, workArea.maxX - width)),
      y: max(workArea.y, min(frame.y, workArea.maxY - height)),
      width: width,
      height: height)
  }

  /// Where the panel goes when its display's work area changes. A panel still where
  /// ``dockedFrame(in:size:)`` docked it against `docked` re-docks in the new work area, so a
  /// resized Dock or menu bar never leaves it off its corner margin; a panel the user moved
  /// only stays inside the work area. The returned `docked` is the work area the panel is
  /// docked against afterwards, or nil.
  public static func follow(
    _ frame: ScreenRect, docked: ScreenRect?, workArea: ScreenRect
  ) -> (frame: ScreenRect, docked: ScreenRect?) {
    if let docked, frame == dockedFrame(in: docked, size: frame.size) {
      return (dockedFrame(in: workArea, size: frame.size), workArea)
    }
    return (constrain(frame, to: workArea), nil)
  }
}

/// The settings window's first frame.
public enum SettingsGeometry {
  public static let preferredSize = WindowSize(width: 1000, height: 720)

  /// Centered in the work area, never larger than it.
  public static func centeredFrame(in workArea: ScreenRect) -> ScreenRect {
    let width = min(preferredSize.width, workArea.width)
    let height = min(preferredSize.height, workArea.height)
    return ScreenRect(
      x: workArea.x + ((workArea.width - width) / 2).rounded(.down),
      y: workArea.y + ((workArea.height - height) / 2).rounded(.down),
      width: width,
      height: height)
  }

  /// The settings window shares the panel's floor.
  public static func minimumSize(in workArea: ScreenRect) -> WindowSize {
    PanelGeometry.minimumSize(in: workArea)
  }
}

/// The display containing the point, otherwise the one whose frame is closest to it.
public enum DisplaySelection {
  public static func index(nearestTo x: Double, _ y: Double, in frames: [ScreenRect]) -> Int? {
    if let containing = frames.firstIndex(where: { $0.contains(x: x, y: y) }) {
      return containing
    }
    return frames.indices.min { distance(x, y, frames[$0]) < distance(x, y, frames[$1]) }
  }

  private static func distance(_ x: Double, _ y: Double, _ rect: ScreenRect) -> Double {
    let dx = max(rect.x - x, 0, x - rect.maxX)
    let dy = max(rect.y - y, 0, y - rect.maxY)
    return dx * dx + dy * dy
  }
}
