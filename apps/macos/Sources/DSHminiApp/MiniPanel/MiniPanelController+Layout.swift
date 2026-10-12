import AppKit

/// Where the mini panel is on its display (``MiniPanelLayout``) and how its coordinates map to
/// the screen. The window is the transparent canvas; the glass container sits inside it over
/// ``MiniPanelLayout/glassRegion`` only, and every frame the model holds is in that container, y
/// down, as the shapes rest. A drag or a snap moves them all with the window, and the content and
/// the pointer tracking agree on where everything is.
extension MiniPanelController {
  /// The display to show on: the saved one, else the main display, so the panel returns to its
  /// own display once that comes back.
  func screen() -> NSScreen? {
    let screens = NSScreen.screens
    let saved = settings.display
    return screens.first { saved != nil && $0.displayUUID == saved } ?? screens.first
  }

  func makeLayout(on screen: NSScreen? = nil) -> MiniPanelLayout? {
    guard let screen = screen ?? self.screen() else { return nil }
    return MiniPanelLayout(
      placement: placement, workArea: ScreenRect(screen.visibleFrame),
      displayFrame: ScreenRect(screen.frame), commands: commands.count, flyoutWidth: flyoutWidth,
      backingScale: Double(screen.backingScaleFactor))
  }

  /// Lays the panel out on its display at once: the window, the glass container, the body in the
  /// shape it is headed for, and where every content lays out.
  func relayout() {
    guard let window, let screen = screen(), let layout = makeLayout(on: screen) else { return }
    display = screen.displayUUID
    self.layout = layout
    snap = nil
    snapInterrupted = false
    window.setFrame(NSRect(layout.canvas), display: false)
    model.glassFrame = Self.glassFrame(of: layout)
    model.bodyFactors.shift = .zero
    model.bodyFactors.shiftAnimation = nil
    if let shape = bodyShape ?? Self.shape(for: model.phase) { placeBody(shape) }
    applyLayout()
  }

  /// The glass container in the canvas, y down.
  static func glassFrame(of layout: MiniPanelLayout) -> CGRect {
    let (canvas, region) = (layout.canvas, layout.glassRegion)
    return CGRect(
      x: region.x - canvas.x, y: canvas.maxY - region.maxY, width: region.width,
      height: region.height)
  }

  /// Where the body and every content lay out for the current layout, and where the closed card
  /// waits.
  func applyLayout() {
    guard let layout else { return }
    model.edge = layout.edge
    let bodyLane = local(layout.bodyRegion)
    if bodyLane != model.bodyLane { model.bodyLane = bodyLane }
    model.contentFrames = [
      .capsule: local(layout.capsule), .invite: local(layout.invite),
      .card: local(layout.target), .rows: layout.flyout.map { local($0) } ?? .zero,
    ]
    // The card takes its new place at once.
    let card = model.flyoutOpen ? layout.flyout.map { local($0) } : closedFlyoutFrame
    if let card, card != model.card.frame { model.card = MiniPanelCardShape(frame: card) }
    let lane = MiniPanelShape.allCases.reduce(layout.flyout.map { local($0) } ?? .null) {
      $0.union(local(layout.rect(of: $1)))
    }
    if lane != model.cardLane { model.cardLane = lane }
    updateClickZone()
    updateDropZone()
  }

  /// Opening on click, the hot zone takes the click that opens the tucked pill, out to the screen
  /// edge, where the pointer comes to rest; opening on hover, the pill takes its own clicks.
  func updateClickZone() {
    let zone = openOn == .click ? layout.map { local($0.hotZone) } : nil
    if zone != model.clickZone { model.clickZone = zone }
  }

  /// A global rectangle in the glass container at rest (the layout's), y down.
  func local(_ rect: ScreenRect) -> CGRect {
    guard let layout else { return .zero }
    let region = layout.glassRegion
    return CGRect(
      x: rect.x - region.x, y: region.maxY - rect.maxY, width: rect.width, height: rect.height)
  }

  /// Where a rectangle of the glass container is on screen now, wherever the window is, y up.
  func global(_ rect: CGRect) -> NSRect {
    let origin = window?.frame.origin ?? .zero
    let glass = model.glassFrame
    return NSRect(
      x: origin.x + glass.minX + rect.minX,
      y: origin.y + model.canvas.height - glass.minY - rect.maxY, width: rect.width,
      height: rect.height)
  }

  /// Where the body is on screen now, as its shape rests.
  var drawnBody: NSRect { global(model.body.frame) }

  /// Where `content` is on screen now.
  func drawn(_ content: MiniPanelContent) -> NSRect { global(model.frame(content)) }
}
