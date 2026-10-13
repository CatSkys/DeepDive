import AppKit

/// The capsule both annotation bars are built on: a row of ``AnnotationToolbarButton``s on a
/// Liquid Glass capsule (`NSGlassEffectView`), in groups split by hairlines. The capsule's radius
/// is the buttons' radius plus the even ``padding``, so the outline and the circular buttons nest
/// concentrically. A divider shows only between visible groups, and the capsule shrinks to fit.
///
/// The bar's own surface (anywhere but a control, including an ``AnnotationBarGrip``) moves it:
/// a drag reports ``Drag`` to the owner, which places the bars. A bar without ``onDrag`` (the
/// selection toolbar) stays put.
final class AnnotationGlassBar: NSView {
  /// A press on the bar's surface.
  enum Drag {
    /// A move starts.
    case began
    /// The pointer's travel since the press, in flipped points (y down) like the overlay's.
    case moved(CGVector)
    /// A double-click: the bars go back beside the selection.
    case reset
  }

  /// The same on every side, so the capsule stays concentric with the circular buttons.
  static let padding: CGFloat = 6

  var onDrag: ((Drag) -> Void)?

  private let glass = NSGlassEffectView()
  private let stack = NSStackView()
  private let groups: [[NSView]]
  /// Each group's divider (none before the first group).
  private var dividers: [NSView?] = []
  /// Where the press that is moving the bar went down, in screen coordinates. Travel is
  /// measured on screen, not in the window: the selection toolbar moves its own window while it
  /// is dragged, so a window-relative point would shift under the pointer with every move and
  /// make the drag jitter. (The capture overlay's window never moves, so both agree there.)
  private var dragStart: CGPoint?

  init(groups: [[NSView]], padding: CGFloat = AnnotationGlassBar.padding) {
    self.groups = groups
    super.init(frame: .zero)
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 2
    let inset = padding
    stack.edgeInsets = NSEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
    for (index, group) in groups.enumerated() {
      var divider: NSView?
      if index > 0 {
        let line = Self.divider()
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(6, after: last) }
        stack.addArrangedSubview(line)
        stack.setCustomSpacing(6, after: line)
        divider = line
      }
      dividers.append(divider)
      for view in group { stack.addArrangedSubview(view) }
    }
    glass.contentView = stack
    addSubview(glass)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The bar's natural size; ``layout()`` makes the glass a capsule of that height.
  override var fittingSize: NSSize { stack.fittingSize }

  override func layout() {
    super.layout()
    glass.frame = bounds
    glass.cornerRadius = bounds.height / 2
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Moving

  /// Taken here rather than passed up, so a press between the controls never reaches the
  /// overlay under the bar, where it would start a new selection.
  override func mouseDown(with event: NSEvent) {
    guard let onDrag else { return }
    guard event.clickCount < 2 else {
      onDrag(.reset)
      return
    }
    dragStart = NSEvent.mouseLocation
    onDrag(.began)
    NSCursor.closedHand.set()
  }

  override func mouseDragged(with event: NSEvent) {
    guard let dragStart else { return }
    // The pointer now, which is never older than the event being handled.
    let point = NSEvent.mouseLocation
    onDrag?(.moved(CGVector(dx: point.x - dragStart.x, dy: dragStart.y - point.y)))
    NSCursor.closedHand.set()
  }

  override func mouseUp(with event: NSEvent) {
    guard dragStart != nil else { return }
    dragStart = nil
    NSCursor.openHand.set()
  }

  /// Hides or shows group `index`; each divider then shows only with a visible group on both
  /// sides of it.
  func setGroup(_ index: Int, hidden: Bool) {
    for view in groups[index] { view.isHidden = hidden }
    var visibleBefore = false
    for (group, divider) in zip(groups, dividers) {
      let visible = group.contains { !$0.isHidden }
      divider?.isHidden = !(visible && visibleBefore)
      visibleBefore = visibleBefore || visible
    }
  }

  /// A hairline between groups, as tall as a glyph.
  private static func divider() -> NSView {
    let line = NSBox()
    line.boxType = .separator
    line.translatesAutoresizingMaskIntoConstraints = false
    line.heightAnchor.constraint(equalToConstant: 16).isActive = true
    return line
  }
}

/// The handle at the toolbar's leading edge that shows the bar can be dragged. A press on it
/// goes up the responder chain to the bar, which moves; the glyph inside, a control that would
/// keep the press, is never hit.
final class AnnotationBarGrip: NSView {
  private let glyph = NSImageView()

  var image: NSImage? {
    get { glyph.image }
    set { glyph.image = newValue }
  }

  init() {
    super.init(frame: CGRect(x: 0, y: 0, width: 16, height: AnnotationToolbarButton.side))
    glyph.imageScaling = .scaleNone
    // The toolbar text's colour, like every glyph on the bar.
    glyph.contentTintColor = .labelColor
    glyph.frame = bounds
    glyph.autoresizingMask = [.width, .height]
    glyph.setAccessibilityElement(false)
    addSubview(glyph)
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: bounds.width),
      heightAnchor.constraint(equalToConstant: bounds.height),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func hitTest(_ point: NSPoint) -> NSView? {
    super.hitTest(point) == nil ? nil : self
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
