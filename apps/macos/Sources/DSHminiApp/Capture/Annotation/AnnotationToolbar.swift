import AppKit

/// The annotation toolbar beside the selection: a grip, the tools, undo and redo, cancel, copy
/// and confirm, on the shared glass capsule (``AnnotationGlassBar``), which the grip or its surface
/// drags. Colours and stroke widths live on the
/// separate ``AnnotationStyleBar``, which appears next to this bar only when there is something
/// to style. Every control carries the app's own hover annotation (``NativeTooltip``: the name
/// and the shortcut as a key cap), and its glyph a VoiceOver description.
final class AnnotationToolbar: NSView {
  var onTool: ((AnnotationTool) -> Void)?
  var onUndo: (() -> Void)?
  var onRedo: (() -> Void)?
  var onCancel: (() -> Void)?
  var onCopy: (() -> Void)?
  var onConfirm: (() -> Void)?
  /// The bar being dragged by its grip or surface.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let grip = AnnotationBarGrip()
  private let tools = AnnotationTool.allCases.map { _ in
    AnnotationToolbarButton(selection: .fill, action: #selector(toolClicked))
  }
  private let undoButton = AnnotationToolbarButton(selection: nil, action: #selector(undoClicked))
  private let redoButton = AnnotationToolbarButton(selection: nil, action: #selector(redoClicked))
  private let cancelButton = AnnotationToolbarButton(
    selection: nil, action: #selector(cancelClicked))
  private let copyButton = AnnotationToolbarButton(selection: nil, action: #selector(copyClicked))
  private let confirmButton = AnnotationToolbarButton(
    selection: nil, tint: .white, action: #selector(confirmClicked))
  private let bar: AnnotationGlassBar

  override init(frame: NSRect) {
    let actions = [undoButton, redoButton, cancelButton, copyButton, confirmButton]
    bar = AnnotationGlassBar(groups: [
      [grip] + (tools as [NSView]), [undoButton, redoButton],
      [cancelButton, copyButton, confirmButton],
    ])
    super.init(frame: frame)
    for button in tools + actions { button.target = self }
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

  /// Reads the copy in the current shell language (once per session, as it opens).
  ///
  /// 注释不再走系统原生 `toolTip`（那种小黄标），改挂全站那套（`attachTooltip`，悬浮玻璃
  /// 注释窗）：全站注释只有一套语言，工具条不该是例外（UI-SPEC §1.11）。
  func applyStrings() {
    let strings = ShellStrings.shared
    setAccessibilityLabel(strings.text(.captureToolbar))
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.attachTooltip(text: strings.text(.captureToolbarMove), caps: [])
    for (button, tool) in zip(tools, AnnotationTool.allCases) {
      let name = strings.text(Self.key(for: tool))
      button.image = AnnotationIcons.glyph(AnnotationIcons.lucideName(for: tool), label: name)
      label(button, name, shortcut: String(tool.key).uppercased())
    }
    for (button, icon, key, shortcut) in [
      (undoButton, AnnotationIcons.undo, ShellStringKey.captureUndo, "⌘Z"),
      (redoButton, AnnotationIcons.redo, .captureRedo, "⇧⌘Z"),
      (cancelButton, AnnotationIcons.cancel, .cancel, "Esc"),
      (copyButton, AnnotationIcons.copy, .captureCopy, "⌘C"),
      (confirmButton, AnnotationIcons.confirm, .captureConfirm, "↩"),
    ] {
      let name = strings.text(key)
      button.image = AnnotationIcons.glyph(icon, label: name)
      label(button, name, shortcut: shortcut)
    }
  }

  /// Shows the current tool (none before the first choice) and undo availability.
  func update(tool: AnnotationTool?, canUndo: Bool, canRedo: Bool) {
    for (button, item) in zip(tools, AnnotationTool.allCases) { button.isSelected = item == tool }
    undoButton.isEnabled = canUndo
    redoButton.isEnabled = canRedo
  }

  /// 一个控件的无障碍名与注释：名字进文字、键位进**键帽**（与网页那份 `data-tip` +
  /// `data-tip-keys` 同一分工——不再拼成"名字（⌘Z）"一句话塞进系统 toolTip）。
  private func label(_ button: AnnotationToolbarButton, _ name: String, shortcut: String) {
    button.setAccessibilityLabel(name)
    button.attachTooltip(text: name, caps: NativeTooltip.caps(shortcut))
  }

  @objc private func toolClicked(_ sender: NSButton) {
    guard let index = tools.firstIndex(where: { $0 === sender }) else { return }
    onTool?(AnnotationTool.allCases[index])
  }

  @objc private func undoClicked() { onUndo?() }
  @objc private func redoClicked() { onRedo?() }
  @objc private func cancelClicked() { onCancel?() }
  @objc private func copyClicked() { onCopy?() }
  @objc private func confirmClicked() { onConfirm?() }

  private static func key(for tool: AnnotationTool) -> ShellStringKey {
    switch tool {
    case .select: .captureToolSelect
    case .rectangle: .captureToolRectangle
    case .ellipse: .captureToolEllipse
    case .arrow: .captureToolArrow
    case .line: .captureToolLine
    case .pen: .captureToolPen
    case .highlighter: .captureToolHighlighter
    case .text: .captureToolText
    case .mosaic: .captureToolMosaic
    case .spotlight: .captureToolSpotlight
    case .step: .captureToolStep
    }
  }
}
