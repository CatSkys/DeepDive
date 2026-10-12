import Darwin
import Foundation

/// Lets the app set the cursor while another app is active. The window server ignores cursor
/// changes from an inactive app, and two surfaces show theirs while Atd is not active: the
/// selection toolbar, which never activates Atd (the app with the selection keeps it), for its
/// pointing hand; and desktop pins, which sit on the desktop while other apps are active, for
/// the frame-resize cursor of their resize corner (``DesktopPinCorner``). Both need the connection
/// property `SetsCursorInBackground`. It is private CoreGraphics API with no public replacement;
/// this is the one place that touches it. Missing symbols leave the cursor as the system draws it.
@MainActor
enum BackgroundCursor {
  private typealias DefaultConnection = @convention(c) () -> Int32
  private typealias SetConnectionProperty =
    @convention(c) (Int32, Int32, CFString, CFTypeRef) -> Int32

  private static var enabled = false

  /// Turns the property on once for this process; later calls do nothing.
  static func enable() {
    guard !enabled else { return }
    enabled = true
    guard let connection = symbol("_CGSDefaultConnection", as: DefaultConnection.self),
      let setProperty = symbol("CGSSetConnectionProperty", as: SetConnectionProperty.self)
    else { return }
    let id = connection()
    _ = setProperty(id, id, "SetsCursorInBackground" as CFString, kCFBooleanTrue)
  }

  private static func symbol<T>(_ name: String, as type: T.Type) -> T? {
    guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else { return nil }
    return unsafeBitCast(pointer, to: type)
  }
}
