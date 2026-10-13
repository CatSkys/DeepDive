import AppKit

/// One capture overlay window per display (decision D7): borderless, non-activating, above
/// the menu bar, the Dock and open menus, on every Space and over full-screen apps. It can
/// become key although it never activates the app by itself, like the task panel; the session
/// activates the app separately for the cursor, the keyboard and input methods.
final class CaptureOverlayPanel: NSPanel {
  init(screen: NSScreen, content: NSView) {
    super.init(
      contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    level = .screenSaver
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    // With Reduce Motion the default animation zooms the window in, so the frozen image would
    // visibly sit off its display for a moment.
    animationBehavior = .none
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    isMovable = false
    isExcludedFromWindowsMenu = true
    acceptsMouseMovedEvents = true
    contentView = content
    setFrame(screen.frame, display: false)
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  /// A borderless window is otherwise kept below the menu bar; the overlay covers it, because
  /// the frozen image does.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}
