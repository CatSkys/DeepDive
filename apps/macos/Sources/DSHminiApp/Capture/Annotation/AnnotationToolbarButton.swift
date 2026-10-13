import AppKit

/// One control of the annotation toolbar. Every tool, colour, stroke width and action is this
/// button, so they share one geometry and one set of states: a circle of ``side`` points (the
/// glass capsule around them is ``side`` / 2 + its padding in radius, so the shapes nest
/// concentrically), a wash on hover and a deeper one while pressed, the selected state, a
/// dimmed disabled glyph, and the keyboard focus ring drawn inside the toolbar's padding.
///
/// The selection toolbar uses the same control with a label (``init(label:image:width:action:)``):
/// a capsule ``side`` points tall around a leading glyph and its text, with the same washes; its
/// More menu stretches such buttons to one width as its rows.
///
/// A choice among several (tools, colours, strokes) reads as a selected radio button to
/// VoiceOver, an on/off control (the text background) as a checkbox; the bars set
/// ``isSelected`` from the editor's state after every change.
final class AnnotationToolbarButton: NSButton {
  /// How the selected state shows: an accent fill under a white glyph (tools, stroke widths),
  /// or an accent ring around the glyph (colour swatches, which a fill would hide). `toggle` is
  /// an on/off control that shows "on" like `fill`.
  enum Selection {
    case fill, ring, toggle
  }

  static let side: CGFloat = 28

  /// A disabled glyph or label: the system's disabled form of the label colour, as AppKit
  /// dims a disabled button in a key window (about 42% in dark, 30% in light), clearly off yet
  /// still legible.
  static let disabledColor = NSColor.labelColor.withSystemEffect(.disabled)

  private let selection: Selection?
  /// The text and leading glyph of a labelled button, which draws them itself.
  private let label: (text: String, image: NSImage?)?
  private var trackingArea: NSTrackingArea?

  /// Whether the button follows the pointer itself, through a tracking area and cursor rects.
  /// Set before the button joins a window. The selection toolbar turns it off: its app stays
  /// inactive, where tracking events arrive late or not at all, so the toolbar reads the pointer
  /// on every frame and sets ``isHovered`` and the cursor itself.
  var followsPointer = true

  /// The pointer is over the button: a light wash, unless it is pressed or disabled.
  var isHovered = false {
    didSet {
      guard isHovered != oldValue else { return }
      needsDisplay = true
    }
  }

  var isSelected = false {
    didSet {
      guard isSelected != oldValue else { return }
      updateTint()
      needsDisplay = true
    }
  }

  /// `selection` is nil for a plain action (undo, confirm…); `tint` colours an action's glyph.
  /// The owner sets `target` once it exists.
  init(selection: Selection?, tint: NSColor? = nil, action: Selector) {
    self.selection = selection
    label = nil
    super.init(frame: CGRect(x: 0, y: 0, width: Self.side, height: Self.side))
    configure(width: Self.side, action: action)
    contentTintColor = tint
  }

  /// A labelled action: `image` (a template glyph drawn at ``Label/iconSide``) then `text`, cut
  /// with an ellipsis past ``Label/maxTextWidth``, ``Label/padding`` in from each end. `width`
  /// stretches it past its natural width (``Label/width(text:hasImage:)``) with the label still
  /// leading, as a menu row as wide as its longest sibling; nil keeps the natural width.
  init(label text: String, image: NSImage?, width: CGFloat? = nil, action: Selector) {
    selection = nil
    label = (text, image)
    let width = width ?? Label.width(text: text, hasImage: image != nil)
    super.init(frame: CGRect(x: 0, y: 0, width: width, height: Self.side))
    configure(width: width, action: action)
    setAccessibilityLabel(text)
  }

  private func configure(width: CGFloat, action: Selector) {
    isBordered = false
    imagePosition = .imageOnly
    imageScaling = .scaleNone
    title = ""
    focusRingType = .exterior
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: width),
      heightAnchor.constraint(equalToConstant: Self.side),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isEnabled: Bool {
    didSet { needsDisplay = true }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    let circle = capsule
    if selection == .fill || selection == .toggle, isSelected {
      NSColor.controlAccentColor.withAlphaComponent(isHighlighted ? 0.8 : 1).setFill()
      circle.fill()
    } else if let wash {
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      circle.fill()
    }
    if selection == .ring, isSelected {
      let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2))
      ring.lineWidth = 2
      NSColor.controlAccentColor.setStroke()
      ring.stroke()
    }
    if let label {
      Label.draw(text: label.text, image: label.image, in: bounds, enabled: isEnabled)
    } else if let image, image.isTemplate {
      // Drawn here rather than tinted by AppKit, which dims a template image whenever the window
      // is not key (the selection toolbar's app never activates): glyphs take the label colour
      // of the toolbar's text in either toolbar, or the button's own tint.
      let color = isEnabled ? contentTintColor ?? .labelColor : Self.disabledColor
      let rect = NSRect(
        x: bounds.midX - image.size.width / 2, y: bounds.midY - image.size.height / 2,
        width: image.size.width, height: image.size.height)
      Label.tinted(image, color, size: image.size).draw(in: rect)
    } else {
      super.draw(dirtyRect)
    }
  }

  /// A circle for a square button, a capsule for a labelled one.
  private var capsule: NSBezierPath {
    let radius = min(bounds.width, bounds.height) / 2
    return NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius)
  }

  /// The neutral wash: none at rest, light on hover, deeper while pressed; never when disabled.
  private var wash: CGFloat? {
    guard isEnabled else { return nil }
    if isHighlighted { return 0.16 }
    return isHovered ? 0.09 : nil
  }

  override var isHighlighted: Bool {
    didSet { needsDisplay = true }
  }

  private func updateTint() {
    guard selection == .fill || selection == .toggle else { return }
    contentTintColor = isSelected ? .white : nil
  }

  // MARK: Hover

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    trackingArea = nil
    guard followsPointer else { return }
    // `.activeAlways`: the overlay panel is non-activating, so hover must not wait for key.
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
  }

  override func resetCursorRects() {
    guard followsPointer else { return }
    addCursorRect(bounds, cursor: .arrow)
  }

  // MARK: Focus and accessibility

  override var focusRingMaskBounds: NSRect { bounds }

  override func drawFocusRingMask() {
    capsule.fill()
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    switch selection {
    case nil: super.accessibilityRole()
    case .toggle: .checkBox
    case .fill, .ring: .radioButton
    }
  }

  override func accessibilityValue() -> Any? {
    selection == nil ? super.accessibilityValue() : NSNumber(value: isSelected)
  }
}

extension AnnotationToolbarButton {
  /// The labelled button's metrics (visual spec, contracts §6) and drawing.
  enum Label {
    static let padding: CGFloat = 10
    static let iconSide: CGFloat = 14
    static let iconGap: CGFloat = 6
    static let maxTextWidth: CGFloat = 160
    static let font = NSFont.systemFont(ofSize: 13, weight: .medium)

    static func width(text: String, hasImage: Bool) -> CGFloat {
      let textWidth = min(ceil(text.size(withAttributes: [.font: font]).width), maxTextWidth)
      return padding * 2 + (hasImage ? iconSide + iconGap : 0) + textWidth
    }

    /// The glyph tinted like the text (the label colour, as the capture toolbar's glyphs draw
    /// in its key window), then the text on one line, cut with an ellipsis.
    static func draw(text: String, image: NSImage?, in bounds: NSRect, enabled: Bool) {
      let color = enabled ? NSColor.labelColor : AnnotationToolbarButton.disabledColor
      var x = bounds.minX + padding
      if let image {
        let icon = NSRect(
          x: x, y: bounds.midY - iconSide / 2, width: iconSide, height: iconSide)
        tinted(image, color, size: icon.size).draw(in: icon)
        x += iconSide + iconGap
      }
      let style = NSMutableParagraphStyle()
      style.lineBreakMode = .byTruncatingTail
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: color, .paragraphStyle: style,
      ]
      let height = ceil(font.ascender - font.descender + font.leading)
      let rect = NSRect(
        x: x, y: bounds.midY - height / 2, width: max(0, bounds.maxX - padding - x),
        height: height)
      NSAttributedString(string: text, attributes: attributes).draw(in: rect)
    }

    /// A template glyph in `color` at `size`; it draws in the appearance of the view being
    /// drawn.
    static func tinted(_ image: NSImage, _ color: NSColor, size: NSSize) -> NSImage {
      NSImage(size: size, flipped: false) { rect in
        image.draw(in: rect)
        color.set()
        rect.fill(using: .sourceAtop)
        return true
      }
    }
  }
}
