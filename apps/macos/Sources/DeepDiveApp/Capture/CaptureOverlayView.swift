import AppKit

/// The content of one display's overlay, flipped so its points are the display's Quartz points
/// minus the display's origin. From back to front: the frozen image, the dim and selection
/// chrome, the annotation host, the loupe and the hints. Only this view and what the annotation
/// editor adds take events; the rest is drawn and ignores the mouse.
///
/// Keys reach this view as the window's first responder. When the annotation editor makes its
/// canvas (a descendant of ``annotationHost``) first responder, the canvas sees keys first and
/// whatever it leaves unhandled climbs the responder chain back to this view. That is the
/// contract behind two shortcuts:
///
/// - Escape steps back one level. The editor ends text editing, deselects an annotation or
///   drops its tool, consuming the key only when it did one of those; an Escape it passes on
///   reaches ``keyDown(with:)`` here and cancels the session.
/// - Select All (⌘A) is the main menu's `selectAll:` through the responder chain: an open text
///   editor answers it first, otherwise it reaches ``selectAll(_:)`` here. ``keyDown(with:)``
///   covers the key arriving unhandled instead.
final class CaptureOverlayView: NSView {
  let display: FrozenDisplay
  let model: SelectionModel
  weak var delegate: (any CaptureOverlayDelegate)?
  let annotationHost = AnnotationHostView()
  private let chrome: CaptureChromeView
  private let loupe: LoupeView
  private var hints: [CaptureBadge] = []
  /// Trackpads scroll in many small steps; the chain walks once per this many points.
  private var scrollAccumulator: CGFloat = 0
  private static let scrollStep: CGFloat = 12
  /// The last mouse position while the button is down, so a Shift change re-applies the drag.
  private var dragPoint: CGPoint?

  init(display: FrozenDisplay) {
    self.display = display
    model = SelectionModel(size: display.quartzFrame.size, scale: display.pixelScale)
    chrome = CaptureChromeView(display: display)
    loupe = LoupeView(image: display.image, scale: display.pixelScale)
    super.init(frame: CGRect(origin: .zero, size: display.quartzFrame.size))
    wantsLayer = true
    let image = FrozenImageView(frame: bounds)
    image.image = NSImage(cgImage: display.image, size: display.quartzFrame.size)
    image.imageScaling = .scaleAxesIndependently
    for view in [image, chrome, annotationHost] as [NSView] {
      view.frame = bounds
      view.autoresizingMask = [.width, .height]
      addSubview(view)
    }
    loupe.isHidden = true
    addSubview(loupe)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Drawing

  /// The undimmed area with its outline and size; handles only on a committed selection.
  func show(area: CGRect?, handles: Bool) { chrome.update(area: area, handles: handles) }

  /// The loupe beside `point`, or hidden for nil.
  func showLoupe(at point: CGPoint?) {
    guard let point else {
      loupe.isHidden = true
      return
    }
    loupe.update(
      at: point, quartz: CaptureCoordinates.quartzPoint(point, display: display.quartzFrame))
    loupe.place(near: point, in: bounds)
    loupe.isHidden = false
  }

  /// Badges centred above the bottom edge, the first one lowest. When they would cover `avoid`
  /// (a selection with its size label and bars around it), they move below the top edge
  /// instead, and when that is covered too they are left out: the user is already working on a
  /// selection that fills the display.
  func showHints(_ texts: [String], avoiding avoid: CGRect? = nil) {
    for hint in hints { hint.removeFromSuperview() }
    hints = texts.map { CaptureBadge(text: $0, font: .systemFont(ofSize: 13)) }
    let insets = window?.screen?.safeAreaInsets
    let bottom = stackedFrames(downFrom: nil, upFrom: bounds.maxY - (insets?.bottom ?? 0) - 28)
    let top = stackedFrames(downFrom: bounds.minY + (insets?.top ?? 0) + 28, upFrom: nil)
    let clear = { (frames: [CGRect]) -> Bool in
      guard let avoid else { return true }
      return !frames.contains { $0.intersects(avoid) }
    }
    guard let frames = clear(bottom) ? bottom : clear(top) ? top : nil else {
      hints = []
      return
    }
    for (hint, frame) in zip(hints, frames) {
      hint.frame = frame
      addSubview(hint)
    }
  }

  /// The hints' frames centred on the view, stacked down from `top` or up from `bottom` (the
  /// first hint nearest that edge), 8 pt apart.
  private func stackedFrames(downFrom top: CGFloat?, upFrom bottom: CGFloat?) -> [CGRect] {
    var edge = top ?? bottom ?? 0
    return hints.map { hint in
      let size = hint.fittingSize
      let y = top == nil ? edge - size.height : edge
      edge = top == nil ? y - 8 : y + size.height + 8
      return CGRect(
        x: ((bounds.width - size.width) / 2).rounded(), y: y, width: size.width,
        height: size.height)
    }
  }

  /// Whether `point` is on the hint at `index`.
  func hint(_ index: Int, contains point: CGPoint) -> Bool {
    hints.indices.contains(index) && hints[index].frame.contains(point)
  }

  // MARK: Mouse

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    // `activeAlways`: a display's overlay follows the pointer before it is the key window.
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [
          .activeAlways, .mouseMoved, .mouseEnteredAndExited, .inVisibleRect, .cursorUpdate,
        ],
        owner: self))
  }

  override func mouseEntered(with event: NSEvent) { pointerMoved(event) }

  override func mouseMoved(with event: NSEvent) { pointerMoved(event) }

  override func cursorUpdate(with event: NSEvent) { hoverCursor(at: point(of: event)) }

  override func mouseDown(with event: NSEvent) {
    // The keyboard comes to this display, but stays with the editor's canvas or open text when
    // they have it: the selection's handles are pressed here while annotating.
    if !((window?.firstResponder as? NSView)?.isDescendant(of: self) ?? false) {
      window?.makeFirstResponder(self)
    }
    let point = point(of: event)
    dragPoint = point
    delegate?.overlay(self, mouseDownAt: point, clickCount: event.clickCount)
    delegate?.overlay(self, cursorAt: point)?.set()
  }

  /// No cursor updates arrive while the button is down; the drag's cursor is kept here.
  override func mouseDragged(with event: NSEvent) {
    let point = point(of: event)
    dragPoint = point
    delegate?.overlay(self, mouseDraggedTo: point, square: Self.squares(event.modifierFlags))
    delegate?.overlay(self, cursorAt: point)?.set()
  }

  override func mouseUp(with event: NSEvent) {
    let point = point(of: event)
    dragPoint = nil
    delegate?.overlay(self, mouseUpAt: point, square: Self.squares(event.modifierFlags))
    hoverCursor(at: point)
  }

  /// Pressing or releasing Shift mid-drag reshapes the selection without a mouse move.
  override func flagsChanged(with event: NSEvent) {
    if let dragPoint {
      delegate?.overlay(
        self, mouseDraggedTo: dragPoint, square: Self.squares(event.modifierFlags))
    }
    super.flagsChanged(with: event)
  }

  private static func squares(_ flags: NSEvent.ModifierFlags) -> Bool {
    flags.intersection(.deviceIndependentFlagsMask).contains(.shift)
  }

  override func rightMouseDown(with event: NSEvent) { delegate?.overlayRightClicked(self) }

  /// Events over the editor's canvas and bars arrive here too, up the responder chain.
  override func scrollWheel(with event: NSEvent) {
    if annotationHost.scroll?(event) == true { return }
    guard event.hasPreciseScrollingDeltas else {
      if event.scrollingDeltaY != 0 { delegate?.overlay(self, perform: .walk(step(event))) }
      return
    }
    if event.phase == .began { scrollAccumulator = 0 }
    scrollAccumulator += event.scrollingDeltaY
    guard abs(scrollAccumulator) >= Self.scrollStep else { return }
    scrollAccumulator = 0
    delegate?.overlay(self, perform: .walk(step(event)))
  }

  /// Scrolling up offers a larger area, down a smaller one.
  private func step(_ event: NSEvent) -> Int { event.scrollingDeltaY > 0 ? 1 : -1 }

  private func pointerMoved(_ event: NSEvent) {
    let point = point(of: event)
    delegate?.overlay(self, pointerAt: point)
    hoverCursor(at: point)
  }

  /// Re-applies the cursor for where the pointer is now, for a change that happens without a
  /// mouse move (the editor dropping its tool on Esc hands the interior back to the session).
  func refreshCursor() {
    guard let window else { return }
    hoverCursor(at: convert(window.mouseLocationOutsideOfEventStream, from: nil))
  }

  /// The editor's bars' cursor over them, else the session's cursor where it has one (D15).
  private func hoverCursor(at point: CGPoint) {
    if let cursor = annotationHost.barCursor(at: point) {
      cursor.set()
    } else {
      delegate?.overlay(self, cursorAt: point)?.set()
    }
  }

  private func point(of event: NSEvent) -> CGPoint {
    convert(event.locationInWindow, from: nil)
  }

  // MARK: Keyboard

  override func keyDown(with event: NSEvent) {
    guard let command = CaptureCommand(event) else {
      super.keyDown(with: event)
      return
    }
    delegate?.overlay(self, perform: command)
  }

  /// Escape normally arrives in `keyDown`; this covers Command-period.
  override func cancelOperation(_ sender: Any?) { delegate?.overlay(self, perform: .cancel) }

  /// The Edit menu's Select All, when no text editor took it.
  override func selectAll(_ sender: Any?) { delegate?.overlay(self, perform: .selectDisplay) }
}
