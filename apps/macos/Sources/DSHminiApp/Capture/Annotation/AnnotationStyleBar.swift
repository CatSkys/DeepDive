import AppKit

/// The style bar that accompanies the annotation toolbar, for what there is to style — the open
/// text, the selected annotation, or the next one the active tool draws: for a mosaic whether it
/// pixelates, blurs or covers; colours; the size slider; for text the background toggle. The
/// editor shows it only then, and only with the controls that apply
/// (``AnnotationStyleControls``): a mosaic has no colour, and a covering mosaic no size. The size
/// (``AnnotationStroke``) sets each tool's measure: line width, marker width, text size,
/// step-badge size, mosaic block or blur.
final class AnnotationStyleBar: NSView {
  /// A change the user picked: only the part the control stands for, and for a size slider
  /// drag the burst it belongs to (one undo step per drag).
  var onChange: ((AnnotationStyleChange, _ burst: UUID?) -> Void)?
  /// The bar being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let redactions = AnnotationRedaction.allCases.map { _ in
    AnnotationToolbarButton(selection: .fill, action: #selector(redactionClicked))
  }
  private let colors = AnnotationColor.allCases.map { _ in
    AnnotationToolbarButton(selection: .ring, action: #selector(colorClicked))
  }
  private let size = AnnotationSizeSlider()
  private let background = AnnotationToolbarButton(
    selection: .toggle, action: #selector(backgroundClicked))
  private let bar: AnnotationGlassBar

  override init(frame: NSRect) {
    bar = AnnotationGlassBar(groups: [redactions, colors, [size], [background]])
    super.init(frame: frame)
    for button in redactions + colors + [background] { button.target = self }
    size.target = self
    size.action = #selector(sizeChanged)
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    applyStrings()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// The bar's size with every control shown, which the layout reserves so the toolbar keeps
  /// its place whichever controls show.
  var fullSize: NSSize {
    let hidden = [redactions[0], colors[0], size, background].map(\.isHidden)
    for group in hidden.indices { bar.setGroup(group, hidden: false) }
    defer { for (group, isHidden) in hidden.enumerated() { bar.setGroup(group, hidden: isHidden) } }
    return bar.fittingSize
  }

  /// Reads the copy in the current shell language (once per session, as it opens).
  func applyStrings() {
    let strings = ShellStrings.shared
    setAccessibilityLabel(strings.text(.captureStyleBar))
    for (button, redaction) in zip(redactions, AnnotationRedaction.allCases) {
      let name = strings.text(Self.key(for: redaction))
      button.image = AnnotationIcons.redaction(redaction, label: name)
      button.toolTip = name
      button.setAccessibilityLabel(name)
    }
    for (button, color) in zip(colors, AnnotationColor.allCases) {
      let name = strings.text(Self.key(for: color))
      button.image = AnnotationIcons.swatch(color, label: name)
      button.toolTip = name
      button.setAccessibilityLabel(name)
    }
    let sizeName = strings.text(.captureSize)
    size.toolTip = strings.text(.captureSizeTooltip)
    size.setAccessibilityLabel(sizeName)
    let name = strings.text(.captureTextBackground)
    background.image = AnnotationIcons.glyph(AnnotationIcons.textBackground, label: name)
    background.toolTip = name
    background.setAccessibilityLabel(name)
  }

  /// Shows `style`, with only the `controls` that apply.
  func update(style: AnnotationStyle, controls: AnnotationStyleControls) {
    bar.setGroup(0, hidden: !controls.contains(.redaction))
    bar.setGroup(1, hidden: !controls.contains(.colors))
    bar.setGroup(2, hidden: !controls.contains(.strokes))
    bar.setGroup(3, hidden: !controls.contains(.textBackground))
    background.isSelected = style.textBackground
    // The knob being dragged is the user's; the style catches up with it, not the other way.
    if size.burst == nil { size.doubleValue = style.stroke.value }
    for (button, item) in zip(redactions, AnnotationRedaction.allCases) {
      button.isSelected = item == style.redaction
    }
    for (button, item) in zip(colors, AnnotationColor.allCases) {
      button.isSelected = item == style.color
    }
  }

  @objc private func redactionClicked(_ sender: NSButton) {
    guard let index = redactions.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(redaction: AnnotationRedaction.allCases[index]), nil)
  }

  @objc private func sizeChanged() {
    onChange?(AnnotationStyleChange(stroke: AnnotationStroke(size.doubleValue)), size.burst)
  }

  @objc private func colorClicked(_ sender: NSButton) {
    guard let index = colors.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(color: AnnotationColor.allCases[index]), nil)
  }

  @objc private func backgroundClicked() {
    onChange?(AnnotationStyleChange(textBackground: !background.isSelected), nil)
  }

  private static func key(for redaction: AnnotationRedaction) -> ShellStringKey {
    switch redaction {
    case .pixelate: .captureRedactionPixelate
    case .blur: .captureRedactionBlur
    case .solid: .captureRedactionSolid
    }
  }

  private static func key(for color: AnnotationColor) -> ShellStringKey {
    switch color {
    case .red: .captureColorRed
    case .yellow: .captureColorYellow
    case .green: .captureColorGreen
    case .blue: .captureColorBlue
    case .black: .captureColorBlack
    case .white: .captureColorWhite
    }
  }
}
