import AppKit

/// 提取文字的结果卡：标注工具条上那颗扫描钮按下后，选区里认出来的文字落在这里——一张
/// 浮动玻璃卡（标题 + 可选中的正文 + 复制 / 翻译），由 owner 摆在工具条旁边。它只管自己
/// 的状态（识别中 / 文字 / 一句话说明 / 译文）与显示；识别与翻译在 `ScreenText` /
/// `ScreenTranslation`，接线（截哪块像素、什么时候去翻）在 `AnnotationEditor`。
///
/// 与这一族同一口径：玻璃走 `GlassSurface`（浮动档那一份配方），控件是
/// `AnnotationToolbarButton`，不出现系统强调色。译文是**替身**：按下「翻译」正文换成译文、
/// 那颗钮翻成「原文」，原文留在卡里，翻回来不重跑识别。
final class AnnotationExtractCard: NSView {
  /// 复制正文现在那一份（原文或译文）。
  var onCopy: ((String) -> Void)?
  /// 正文是识别原文时按下「翻译」：把这段文字交给 owner 去翻。
  var onTranslate: ((String) -> Void)?
  /// 卡被关掉（关闭钮；Esc 由 owner 走它自己的回退阶梯）。
  var onClose: (() -> Void)?

  /// 卡是否开着（识别中、有正文、或是一句说明）。
  private(set) var isOpen = false

  /// 正文行的宽（卡宽 = 它 + 两侧内距）与正文区的高：正文再长就滚动，卡不会长到盖住整块选区。
  private static let contentWidth: CGFloat = 372
  private static let bodyHeight: CGFloat = 176
  private static let padding: CGFloat = 12
  private static let gap: CGFloat = 8

  /// 卡的整体宽度（摆放与夹边用它）。
  static var width: CGFloat { contentWidth + padding * 2 }

  private let title = NSTextField(labelWithString: "")
  private let closeButton = AnnotationToolbarButton(selection: nil, action: #selector(closeClicked))
  private let body = NSTextView()
  private let scroll = NSScrollView()
  private let copyButton = AnnotationToolbarButton(
    label: "", image: nil, action: #selector(copyClicked))
  private let translateButton = AnnotationToolbarButton(
    label: "", image: nil, action: #selector(translateClicked))
  private let glass = WindowGlassView.makeFloatingGlass()

  /// 识别到的原文；译文是它的替身，翻回原文用它。
  private var original = ""
  private var showingTranslation = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    configure()
    addSubview(glass)
    applyStrings()
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { stack.fittingSize }

  override func layout() {
    super.layout()
    glass.frame = bounds
    GlassSurface.shape(glass, content: stack, cornerRadius: ShellRadius.card)
    sizeBody()
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// 卡上空白处的按下就地吃掉：放它上去会落到 overlay 上，在卡下面重新起一个选区
  /// （`AnnotationGlassBar` 同款）。
  override func mouseDown(with event: NSEvent) {
    NativeTooltip.hide()
  }

  /// 会话开始时读一次当前语言的文案（与这一族其余控件同一口径）。
  func applyStrings() {
    let strings = ShellStrings.shared
    let name = strings.text(.captureExtract)
    title.stringValue = name
    setAccessibilityLabel(name)
    body.setAccessibilityLabel(name)
    let close = strings.text(.captureClose)
    closeButton.image = AnnotationIcons.glyph(AnnotationIcons.cancel, label: close)
    closeButton.setAccessibilityLabel(close)
    closeButton.attachTooltip(text: close, caps: [])
    label(copyButton, strings.text(.captureCopy))
    label(
      translateButton,
      strings.text(showingTranslation ? .captureTranslateOriginal : .captureTranslate))
  }

  // MARK: 状态

  /// 打开卡并显示「识别中」。
  func openBusy() {
    original = ""
    showingTranslation = false
    setBody(ShellStrings.shared.text(.captureExtractBusy))
    setActions(hidden: true)
    open()
  }

  /// 识别到的文字；`canTranslate` 为假时收起翻译钮（没装那种语言的模型，按了也只是失败）。
  func show(text: String, canTranslate: Bool) {
    original = text
    showingTranslation = false
    setBody(text)
    setActions(hidden: false)
    translateButton.isHidden = !canTranslate
    translateButton.setLabel(ShellStrings.shared.text(.captureTranslate))
    open()
  }

  /// 译文替身正文；那颗钮翻成「原文」。
  func showTranslation(_ text: String) {
    showingTranslation = true
    setBody(text)
    translateButton.setLabel(ShellStrings.shared.text(.captureTranslateOriginal))
  }

  /// 翻不动（按下之前探到没装模型，或按下之后系统拒绝）：正文留在原文，翻译钮收起来
  /// 不再给按——按钮在而按了必然失败，比没有这颗钮更糟。
  func translationUnavailable() {
    showingTranslation = false
    translateButton.isHidden = true
    setBody(original)
  }

  /// 一句话说明（没有文字 / 识别失败 / 翻不动）：动作收起来，卡里只有这句话。
  func show(note: String) {
    original = ""
    showingTranslation = false
    setBody(note)
    setActions(hidden: true)
    open()
  }

  func close() {
    guard isOpen else { return }
    isOpen = false
    isHidden = true
    // 键盘还在正文上就交回去：卡一关，Esc 该回到会话那架阶梯。
    if body.window?.firstResponder === body { window?.makeFirstResponder(nil) }
  }

  private func open() {
    isOpen = true
    isHidden = false
    needsLayout = true
  }

  private func setBody(_ text: String) {
    body.string = text
    body.scrollRangeToVisible(NSRange(location: 0, length: 0))
    sizeBody()
  }

  /// 正文随文字长高，到卡给它的高度为止（再长就滚动）。
  private func sizeBody() {
    guard let container = body.textContainer, let layout = body.layoutManager else { return }
    layout.ensureLayout(for: container)
    let used = layout.usedRect(for: container).height + body.textContainerInset.height * 2
    body.frame = NSRect(
      origin: .zero,
      size: NSSize(
        width: scroll.contentSize.width, height: max(used, scroll.contentSize.height)))
  }

  // MARK: 布局

  /// 标题行 / 正文 / 动作行，三行一条竖栈；玻璃垫在整块下面（内容层不加底色）。
  private lazy var stack: NSStackView = {
    let titleRow = NSStackView(views: [title, Self.spacer(), closeButton])
    let actions = NSStackView(views: [Self.spacer(), copyButton, translateButton])
    for row in [titleRow, actions] {
      row.orientation = .horizontal
      row.alignment = .centerY
      row.translatesAutoresizingMaskIntoConstraints = false
      row.widthAnchor.constraint(equalToConstant: Self.contentWidth).isActive = true
    }
    actions.spacing = 4
    let stack = NSStackView(views: [titleRow, scroll, actions])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = Self.gap
    stack.edgeInsets = NSEdgeInsets(
      top: Self.padding, left: Self.padding, bottom: Self.padding, right: Self.padding)
    NSLayoutConstraint.activate([
      scroll.widthAnchor.constraint(equalToConstant: Self.contentWidth),
      scroll.heightAnchor.constraint(equalToConstant: Self.bodyHeight),
    ])
    return stack
  }()

  /// 行里撑开的那一段（纽扣挤到两端）。
  private static func spacer() -> NSView {
    let view = NSView()
    view.setContentHuggingPriority(.defaultLow, for: .horizontal)
    view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return view
  }

  private func configure() {
    GlassSurface.attach(glass, content: stack)
    title.font = .systemFont(ofSize: 13, weight: .medium)
    title.textColor = .labelColor
    title.setAccessibilityElement(false)
    closeButton.target = self
    copyButton.target = self
    translateButton.target = self
    body.isEditable = false
    body.isSelectable = true
    body.isRichText = false
    body.drawsBackground = false
    body.textColor = .labelColor
    body.font = .systemFont(ofSize: 13)
    body.textContainerInset = NSSize(width: 0, height: 2)
    body.isVerticallyResizable = true
    body.isHorizontallyResizable = false
    body.autoresizingMask = [.width]
    body.textContainer?.widthTracksTextView = true
    body.textContainer?.lineFragmentPadding = 0
    scroll.documentView = body
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    scroll.translatesAutoresizingMaskIntoConstraints = false
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
  }

  private func label(_ button: AnnotationToolbarButton, _ text: String) {
    button.setLabel(text)
    button.setAccessibilityLabel(text)
    button.attachTooltip(text: text, caps: [])
  }

  private func setActions(hidden: Bool) {
    copyButton.isHidden = hidden
    translateButton.isHidden = hidden
  }

  // MARK: 动作

  @objc private func copyClicked() { onCopy?(body.string) }

  @objc private func closeClicked() { onClose?() }

  /// 同一颗钮两个语义：正文是原文时去翻，是译文时翻回原文（原文一直在卡里）。
  @objc private func translateClicked() {
    guard showingTranslation else {
      onTranslate?(original)
      return
    }
    showingTranslation = false
    setBody(original)
    translateButton.setLabel(ShellStrings.shared.text(.captureTranslate))
  }
}
