import AppKit

/// 迷你面板的屏幕几何与窗口底座（移植自 Atd `AIShell/Windows/Screens.swift`，
/// 授权复制）：AppKit 屏幕与 y-up 全局点坐标的互转、52pt 透明标题栏配方。另并入
/// Atd `DesktopPinScreens.swift` 的 `displayUUID` 扩展（迷你面板按显示器 UUID
/// 记忆归属屏）。玻璃底板在 WindowGlassView（与主窗同源）。
enum Screens {
  /// The work area (`visibleFrame`) of the display under the cursor, or the nearest one.
  static func workAreaUnderCursor() -> ScreenRect {
    let cursor = NSEvent.mouseLocation
    return workArea(nearestTo: cursor.x, cursor.y)
  }

  /// The full `frame` (menu bar and Dock included) of the display under the cursor, or the
  /// nearest one.
  static func frameUnderCursor() -> ScreenRect {
    let cursor = NSEvent.mouseLocation
    return frame(nearestTo: cursor.x, cursor.y)
  }

  /// The work area of the display holding most of `frame`, or the one nearest its center.
  static func workArea(containing frame: ScreenRect) -> ScreenRect {
    let rect = NSRect(frame)
    let best = NSScreen.screens.max {
      area($0.frame.intersection(rect)) < area($1.frame.intersection(rect))
    }
    if let best, area(best.frame.intersection(rect)) > 0 { return ScreenRect(best.visibleFrame) }
    return workArea(nearestTo: rect.midX, rect.midY)
  }

  /// The full frame of the display holding most of `frame`, or the one nearest the cursor when
  /// that display is gone.
  static func frame(containing frame: ScreenRect) -> ScreenRect {
    let rect = NSRect(frame)
    let best = NSScreen.screens.max {
      area($0.frame.intersection(rect)) < area($1.frame.intersection(rect))
    }
    if let best, area(best.frame.intersection(rect)) > 0 { return ScreenRect(best.frame) }
    return frameUnderCursor()
  }

  private static func workArea(nearestTo x: Double, _ y: Double) -> ScreenRect {
    guard let screen = screen(nearestTo: x, y) else { return fallback }
    return ScreenRect(screen.visibleFrame)
  }

  private static func frame(nearestTo x: Double, _ y: Double) -> ScreenRect {
    guard let screen = screen(nearestTo: x, y) else { return fallback }
    return ScreenRect(screen.frame)
  }

  private static func screen(nearestTo x: Double, _ y: Double) -> NSScreen? {
    let screens = NSScreen.screens
    let index = DisplaySelection.index(nearestTo: x, y, in: screens.map { ScreenRect($0.frame) })
    return index.map { screens[$0] }
  }

  /// No display attached (a transient state while displays rearrange).
  private static let fallback = ScreenRect(x: 0, y: 0, width: 1440, height: 900)

  private static func area(_ rect: NSRect) -> CGFloat {
    rect.isNull ? 0 : rect.width * rect.height
  }
}

extension NSScreen {
  /// The Core Graphics display this screen shows (`NSScreenNumber`), which ScreenCaptureKit and
  /// `CGDisplayBounds` name displays by.
  var displayID: CGDirectDisplayID? {
    (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
  }

  /// `CGDisplayCreateUUIDFromDisplayID` as a string（移植自 Atd DesktopPinScreens.swift）。
  var displayUUID: String? {
    guard let displayID, let uuid = CGDisplayCreateUUIDFromDisplayID(displayID) else { return nil }
    return CFUUIDCreateString(nil, uuid.takeRetainedValue()) as String?
  }
}

extension ScreenRect {
  init(_ rect: NSRect) {
    self.init(
      x: Double(rect.origin.x), y: Double(rect.origin.y), width: Double(rect.width),
      height: Double(rect.height))
  }
}

extension NSRect {
  init(_ rect: ScreenRect) {
    self.init(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
  }
}


/// The transparent 52pt title bar every page window shares. An empty unified `NSToolbar` sets
/// the bar's height, centers the traffic lights in it and gives the window the toolbar window's
/// corner radius; the page lays its header out on that bar and reports it as a drag region. The
/// toolbar has no items and cannot be customized, so the bar keeps its height and clicks under it
/// still reach the web view.
enum UnifiedTitleBar {
  static func apply(to window: NSWindow, identifier: String) {
    let toolbar = NSToolbar(identifier: identifier)
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.toolbar = toolbar
    window.toolbarStyle = .unified
    window.titlebarSeparatorStyle = .none
  }
}
