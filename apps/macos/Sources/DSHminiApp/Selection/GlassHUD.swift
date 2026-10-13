import AppKit

/// A Liquid Glass status capsule near the bottom of the screen (``AnnotationGlassBar``, the
/// single native glass material): the selection toolbar's listening HUD, which yields its place
/// while the command island (``IslandController``) is on screen. Clients supply only the row and
/// react to its buttons; this owns everything else:
///
/// - the window: a borderless ``ToolbarWindow`` that never takes the keyboard or activates Atd,
///   joins every Space and reaches ``inset`` past the capsule so its shadow and entrance are
///   never cut off (the margin is transparent to clicks);
/// - placement (``GlassHUDPlacement``): every appearance starts at home, the bottom centre of
///   the display under the pointer; a row with a grip drags within the work area of the display
///   under it and stays where it is dropped while on screen, and a double-click puts it back;
/// - motion: it enters like the selection toolbar (``SelectionToolbarEntrance``, growing from
///   its bottom edge), changes in place without one, and fades out on ``exit()``;
/// - timing: a show `lasting` a duration exits after it unless something showed meanwhile;
/// - hover (``SelectionToolbarHover``): the button wash and pointing hand, the open hand on the
///   grip; tracking pauses while the pointer rests away and the window's ``HoverWakeView``
///   wakes it as the pointer comes near, so it never watches the pointer across other apps;
/// - language: content shown until further notice is built again in a new shell language, a
///   timed one just runs out;
/// - accessibility: the capsule is one group that reads the content's label.
final class GlassHUD: NSObject {
  /// What a client shows.
  struct Content {
    /// The capsule's row, in order.
    let views: [NSView]
    /// What VoiceOver reads for the capsule.
    let label: String
    /// The buttons hover follows.
    let buttons: [AnnotationToolbarButton]
    /// The drag handle, which makes the capsule movable; nil keeps it at home.
    let grip: NSView?
  }

  static let exitDuration = 0.2
  /// The transparent margin around the capsule.
  static let inset: CGFloat = 24

  /// The HUD came onto the screen (true) or left it (false, once any fade finished).
  var onVisibilityChange: ((Bool) -> Void)?

  private let window: ToolbarWindow
  private let hover = SelectionToolbarHover()
  /// Builds the content shown until further notice again, in the current language.
  private var rebuild: (() -> Content)?
  private var dragOrigin: NSPoint?
  /// Where the capsule was dropped while it is on screen; every appearance starts at home.
  private var dropped: NSPoint?
  /// Bumped by every show, so an exit still fading or a timer running never hides a capsule
  /// shown again meanwhile.
  private var generation = 0
  private var reportedVisible = false

  override init() {
    window = ToolbarWindow(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    super.init()
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = .statusBar
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.becomesKeyOnlyIfNeeded = true
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle,
    ]
    NotificationCenter.default.addObserver(
      self, selector: #selector(languageChanged), name: ShellStrings.didChange, object: nil)
  }

  /// On screen and not leaving.
  var isShown: Bool { window.isVisible && window.alphaValue == 1 }

  @objc private func languageChanged() {
    if isShown, let rebuild { present(rebuild()) }
  }

  /// Shows `build()`'s content: a capsule not on screen, or leaving, enters at home; one on
  /// screen changes in place. Without `lasting` it stays until ``exit()`` or ``hide()``;
  /// with it, it exits after that long unless something shows meanwhile.
  func show(lasting duration: Duration? = nil, _ build: @escaping () -> Content) {
    rebuild = duration == nil ? build : nil
    present(build())
    guard let duration else { return }
    let current = generation
    Task { [weak self] in
      try? await Task.sleep(for: duration)
      guard let self, self.generation == current else { return }
      self.exit()
    }
  }

  /// Fades out as it is, then leaves the screen.
  func exit() {
    guard window.isVisible else { return }
    let current = generation
    hover.stop()
    NSAnimationContext.runAnimationGroup { context in
      context.duration = Self.exitDuration
      window.animator().alphaValue = 0
    } completionHandler: { [weak self] in
      MainActor.assumeIsolated {
        guard let self, self.generation == current else { return }
        self.hide()
      }
    }
  }

  /// Leaves the screen at once.
  func hide() {
    hover.stop()
    dragOrigin = nil
    dropped = nil
    guard window.isVisible else { return }
    window.orderOut(nil)
    window.contentView = nil
    report(false)
  }

  private func present(_ content: Content) {
    generation += 1
    // Every appearance starts at home, even one that interrupts the exit fade.
    let appearing = !window.isVisible || window.alphaValue < 1
    if appearing { dropped = nil }
    let bar = AnnotationGlassBar(groups: [content.views], padding: SelectionToolbarLayout.padding)
    if content.grip != nil { bar.onDrag = { [weak self] in self?.drag($0) } }
    bar.setAccessibilityElement(true)
    bar.setAccessibilityRole(.group)
    bar.setAccessibilityLabel(content.label)
    let size = bar.fittingSize
    let capsule = NSRect(origin: dropped ?? home(size: size), size: size)
    let frame = clamped(capsule).insetBy(dx: -Self.inset, dy: -Self.inset)
    let container = HoverWakeView(frame: NSRect(origin: .zero, size: frame.size))
    container.wantsLayer = true
    container.onPointerNear = { [weak self] in self?.hover.pointerMoved() }
    bar.frame = container.bounds.insetBy(dx: Self.inset, dy: Self.inset)
    container.addSubview(bar)
    window.contentView = container
    window.setFrame(frame, display: true)
    window.alphaValue = 1
    window.orderFrontRegardless()
    if appearing {
      SelectionToolbarEntrance.play(on: container, capsule: bar.frame, upward: true)
    }
    if content.buttons.isEmpty, content.grip == nil {
      hover.stop()
    } else {
      hover.start(content.buttons, grip: content.grip, in: container)
    }
    report(true)
  }

  private func report(_ visible: Bool) {
    guard visible != reportedVisible else { return }
    reportedVisible = visible
    onVisibilityChange?(visible)
  }

  // MARK: Placing

  private func drag(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began:
      dragOrigin = window.frame.origin
    case .moved(let travel):
      guard let dragOrigin else { return }
      var capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
      capsule.origin = NSPoint(
        x: dragOrigin.x + Self.inset + travel.dx, y: dragOrigin.y + Self.inset - travel.dy)
      let placed = clamped(capsule)
      window.setFrameOrigin(NSPoint(x: placed.minX - Self.inset, y: placed.minY - Self.inset))
      dropped = placed.origin
    case .reset:
      dragOrigin = nil
      dropped = nil
      let capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
      let home = clamped(NSRect(origin: home(size: capsule.size), size: capsule.size))
      window.setFrame(home.insetBy(dx: -Self.inset, dy: -Self.inset), display: true, animate: true)
    }
  }

  private func home(size: NSSize) -> NSPoint {
    GlassHUDPlacement.home(
      size: WindowSize(width: size.width, height: size.height), pointer: NSEvent.mouseLocation,
      displays: Self.displays(NSScreen.screens), fallback: Self.displays([NSScreen.main]).first)
  }

  private func clamped(_ frame: NSRect) -> NSRect {
    NSRect(
      GlassHUDPlacement.clamped(
        ScreenRect(frame), displays: Self.displays(NSScreen.screens),
        fallback: Self.displays([NSScreen.main]).first))
  }

  private static func displays(_ screens: [NSScreen?]) -> [GlassHUDPlacement.Display] {
    screens.compactMap { screen in
      screen.map { .init(frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame)) }
    }
  }
}

/// The content of a capsule window that stays up while the pointer is elsewhere (``GlassHUD``):
/// reports the pointer entering it (the capsule or its margin), which wakes paused hover
/// tracking. Entered events reach an inactive app late, which is fine for a wake-up; the
/// tracking itself reads the pointer every frame.
final class HoverWakeView: NSView {
  var onPointerNear: (() -> Void)?

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    addTrackingArea(
      NSTrackingArea(
        rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
        owner: self))
  }

  override func mouseEntered(with event: NSEvent) { onPointerNear?() }
}
