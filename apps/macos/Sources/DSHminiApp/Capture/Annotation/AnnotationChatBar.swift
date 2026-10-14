import AppKit

/// The message bar the toolbar's ask button opens: a one-line text field and a send button on the
/// same glass capsule as the toolbar (``AnnotationGlassBar``), so the words that go out with this
/// screenshot are typed where the screenshot is being annotated. Return, or the send button, hands
/// the text to the editor, which ends the capture with it: the annotated image and the words leave
/// together as one message. Esc closes the bar and gives the keyboard back to the canvas — the
/// capture's own Esc then cancels it, as it does when no text is being typed. What was typed stays
/// in the field for the next time the bar opens.
///
/// It keeps the family's monochrome chrome: no focus ring, and the caret takes the label colour
/// rather than the system accent, like every glyph on the bar — this bar floats over someone
/// else's screen and shows no brand or system colour (SPEC-SEMANTICS §6.2).
final class AnnotationChatBar: NSView, NSTextFieldDelegate {
  /// The user sent `text`: the editor ends the capture with it. An empty field sends the image
  /// alone, as the page's composer allows (text or attachments).
  var onSend: ((String) -> Void)?
  /// The bar was closed without sending (Esc).
  var onClose: (() -> Void)?
  /// The bar being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  /// The field's width: a sentence or two, past which the text scrolls (the field is one line).
  private static let fieldWidth: CGFloat = 240

  private let field = NSTextField()
  private let sendButton = AnnotationToolbarButton(selection: nil, action: #selector(sendClicked))
  private let bar: AnnotationGlassBar

  /// The bar is on screen, with the keyboard in its field.
  private(set) var isOpen = false

  override init(frame: NSRect) {
    // The field and its send button sit in one group (no hairline between them, unlike the
    // toolbar's groups) and stand further apart than its controls do.
    bar = AnnotationGlassBar(groups: [[field, sendButton]], spacing: 8)
    super.init(frame: frame)
    sendButton.target = self
    configureField()
    addSubview(bar)
    isHidden = true
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

  /// Reads the copy in the current shell language (once per session, as the capture opens).
  func applyStrings() {
    let strings = ShellStrings.shared
    let name = strings.text(.captureChat)
    setAccessibilityLabel(name)
    field.placeholderString = strings.text(.captureChatPlaceholder)
    field.setAccessibilityLabel(name)
    let send = strings.text(.captureChatSend)
    sendButton.image = AnnotationIcons.glyph(AnnotationIcons.send, label: send)
    sendButton.setAccessibilityLabel(send)
    sendButton.attachTooltip(text: send, caps: [])
  }

  /// Opens the bar with the keyboard already in its field. The owner places the bar; a visible
  /// bar is enough to take focus, so it can happen before the pass that gives it its frame.
  func open() {
    guard !isOpen else { return }
    isOpen = true
    isHidden = false
    window?.makeFirstResponder(field)
  }

  /// Closes the bar without sending; the owner places the bars again.
  func close() {
    guard isOpen else { return }
    isOpen = false
    isHidden = true
    if field.currentEditor() != nil { window?.makeFirstResponder(nil) }
  }

  private func configureField() {
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.usesSingleLineMode = true
    field.font = AnnotationToolbarButton.Label.font
    field.textColor = .labelColor
    field.delegate = self
    field.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      field.widthAnchor.constraint(equalToConstant: Self.fieldWidth),
      field.heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side),
    ])
  }

  /// What the field holds now: while it is being edited the field editor is the truth (the cell
  /// catches up when the edit ends, which a press on the send button does not necessarily do).
  private var message: String {
    (field.currentEditor() as? NSTextView)?.string ?? field.stringValue
  }

  private func send() {
    onSend?(message)
  }

  @objc private func sendClicked() { send() }

  // MARK: NSTextFieldDelegate

  func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector)
    -> Bool
  {
    switch commandSelector {
    case #selector(NSResponder.insertNewline(_:)):
      send()
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      onClose?()
      return true
    default:
      return false
    }
  }

  /// The caret takes the bar's own colour (the label colour, like its glyphs and text): the
  /// capture family shows no system accent. The field editor is the one that draws it.
  func controlTextDidBeginEditing(_ notification: Notification) {
    (field.currentEditor() as? NSTextView)?.insertionPointColor = .labelColor
  }
}
