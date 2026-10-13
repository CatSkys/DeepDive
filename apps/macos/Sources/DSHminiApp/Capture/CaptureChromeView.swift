import AppKit

/// The dim over the frozen display with one undimmed area: the detected area under the pointer
/// or the selection, with its "W × H" size in points and, on a committed selection, its eight
/// handles. The mask carries the state (the accent colour is not used: the capture chrome is
/// black, white and grey); the boundary is a white hairline with a dark one just outside it, so
/// it reads over dark and light content alike. Redraws only the region an update touches, so
/// a mouse move does not repaint a whole Retina display.
final class CaptureChromeView: NSView {
  /// An area with its size label, placed once per update.
  private struct Placement {
    let area: CGRect
    let label: String
    let labelFrame: CGRect
  }

  private let display: FrozenDisplay
  private var placement: Placement?
  private var handles = false
  private static let dim = NSColor(white: 0, alpha: 0.4)
  /// 选区边缘：内侧一条亮发丝线，外侧紧跟一条深发丝线（亮底暗底都看得见）。
  private static let outlineLight = NSColor(white: 1, alpha: 0.85)
  private static let outlineDark = NSColor(white: 0, alpha: 0.35)
  private static let handleRadius: CGFloat = 4
  private static let labelFont = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)

  init(display: FrozenDisplay) {
    self.display = display
    super.init(frame: CGRect(origin: .zero, size: display.quartzFrame.size))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func update(area: CGRect?, handles: Bool) {
    guard area != placement?.area || handles != self.handles else { return }
    let before = placement.map(extent(of:))
    placement = area.map(place)
    self.handles = handles
    if let before, let after = placement.map(extent(of:)) {
      setNeedsDisplay(before.union(after))
    } else {
      needsDisplay = true
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let dim = NSBezierPath(rect: bounds)
    dim.windingRule = .evenOdd
    if let area = placement?.area { dim.appendRect(area) }
    Self.dim.setFill()
    dim.fill()
    guard let placement else { return }
    let area = placement.area
    let outer = NSBezierPath(rect: area.insetBy(dx: -0.75, dy: -0.75))
    outer.lineWidth = 1.5
    Self.outlineDark.setStroke()
    outer.stroke()
    let outline = NSBezierPath(rect: area)
    outline.lineWidth = 1
    Self.outlineLight.setStroke()
    outline.stroke()
    if handles {
      for handle in SelectionHandle.allCases {
        let center = handle.point(on: area)
        let dot = NSBezierPath(
          ovalIn: CGRect(x: center.x, y: center.y, width: 0, height: 0)
            .insetBy(dx: -Self.handleRadius, dy: -Self.handleRadius))
        NSColor.white.setFill()
        dot.fill()
        dot.lineWidth = 1
        Self.outlineDark.setStroke()
        dot.stroke()
      }
    }
    CaptureBadge.draw(placement.label, font: Self.labelFont, in: placement.labelFrame)
  }

  /// What a placement occupies on screen: its area, outline and handles, and its size label.
  private func extent(of placement: Placement) -> CGRect {
    let reach = Self.handleRadius + 2
    return placement.area.insetBy(dx: -reach, dy: -reach).union(placement.labelFrame)
  }

  /// The size label above the area's top-left corner, or just inside it when the display's top
  /// edge is in the way; always within the display. The text is points, plus the exported
  /// pixels when they differ (`ScreenshotRules.sizeLabel`).
  private func place(_ area: CGRect) -> Placement {
    let text = ScreenshotRules.sizeLabel(
      selection: area, scale: display.pixelScale, imageWidth: display.image.width,
      imageHeight: display.image.height)
    let size = CaptureBadge.size(of: text, font: Self.labelFont)
    let above = area.minY - size.height - 6
    let y = above >= bounds.minY + 4 ? above : area.minY + 6
    let x = min(max(area.minX, bounds.minX + 4), bounds.maxX - size.width - 4)
    return Placement(
      area: area, label: text, labelFrame: CGRect(origin: CGPoint(x: x, y: y), size: size).integral)
  }
}

/// A short white text on a dark rounded plate: the size label and the hints.
final class CaptureBadge: NSView {
  private let text: String
  private let font: NSFont
  private static let padding = CGSize(width: 8, height: 4)

  init(text: String, font: NSFont) {
    self.text = text
    self.font = font
    super.init(frame: CGRect(origin: .zero, size: Self.size(of: text, font: font)))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var fittingSize: NSSize { Self.size(of: text, font: font) }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) { Self.draw(text, font: font, in: bounds) }

  static func size(of text: String, font: NSFont) -> CGSize {
    let size = NSAttributedString(string: text, attributes: [.font: font]).size()
    return CGSize(
      width: (size.width + padding.width * 2).rounded(.up),
      height: (size.height + padding.height * 2).rounded(.up))
  }

  static func draw(_ text: String, font: NSFont, in frame: CGRect) {
    NSColor(white: 0, alpha: 0.72).setFill()
    NSBezierPath(roundedRect: frame, xRadius: 6, yRadius: 6).fill()
    NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white])
      .draw(at: CGPoint(x: frame.minX + padding.width, y: frame.minY + padding.height))
  }
}
