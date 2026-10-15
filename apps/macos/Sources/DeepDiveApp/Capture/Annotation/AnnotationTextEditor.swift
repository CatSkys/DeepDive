import AppKit

/// In-place text entry for the text tool: a transparent `NSTextView` on the canvas, so IME
/// marked text and candidate windows work as in any text field. It types with the renderer's
/// attributes and the same line layout (no inset, no line fragment padding), so the committed
/// annotation draws exactly where the text was. Esc or a click elsewhere ends the edit and
/// keeps the text; an edit left empty removes the annotation. With a text background the canvas
/// draws the plate behind the text view (the view itself stays transparent). The finished edit
/// is one undo step in the document; keystrokes have their own history while the editor is open.
final class AnnotationTextEditor: NSObject, NSTextViewDelegate {
  private struct Session {
    let view: NSTextView
    let id: UUID
    let existing: Bool
    var style: AnnotationStyle
  }

  private let store: AnnotationStore
  private var session: Session?

  /// Typing history of the open editor, kept apart from the document's.
  let typingUndo = UndoManager()
  /// The edit ended; the canvas takes the keyboard back.
  var onEnd: (() -> Void)?

  init(store: AnnotationStore) {
    self.store = store
  }

  var isEditing: Bool { session != nil }

  /// The text view's frame in canvas (view) points, for the canvas's editing outline.
  var frame: CGRect? { session?.view.frame }
  /// The style of the text being edited; nil when no edit is open.
  var style: AnnotationStyle? { session?.style }

  /// Opens the editor on `existing`, or for new text with its first line centred on `point`.
  func begin(
    at point: CGPoint, editing existing: Annotation?, style: AnnotationStyle, in canvas: NSView
  ) {
    end()
    let view = NSTextView(usingTextLayoutManager: false)
    var origin = point
    var text = ""
    var style = style
    if let existing, case .text(let string, let frame) = existing.shape {
      (origin, text, style) = (frame.origin, string, existing.style)
    } else {
      origin.y -= Self.lineHeight(style, in: view) / 2
    }
    let area = canvas.bounds
    origin.x = min(max(origin.x, area.minX), max(area.maxX - 24, area.minX))
    origin.y = max(origin.y, area.minY)
    configure(view, style: style, width: area.maxX - origin.x)
    view.textStorage?.setAttributedString(
      NSAttributedString(string: text, attributes: AnnotationRenderer.textAttributes(style)))
    view.frame = CGRect(origin: origin, size: CGSize(width: 2, height: 2))
    canvas.addSubview(view)
    let id = existing?.id ?? UUID()
    session = Session(view: view, id: id, existing: existing != nil, style: style)
    store.selectedID = nil
    store.editingID = id
    fit()
    view.selectAll(nil)
    canvas.window?.makeFirstResponder(view)
  }

  /// Restyles the whole text being edited (colour, size or background from the style bar).
  func setStyle(_ style: AnnotationStyle) {
    guard let view = session?.view, let storage = view.textStorage else { return }
    session?.style = style
    let attributes = AnnotationRenderer.textAttributes(style)
    storage.setAttributes(attributes, range: NSRange(location: 0, length: storage.length))
    view.typingAttributes = attributes
    view.insertionPointColor = AnnotationRenderer.textColor(style)
    fit()
  }

  /// The selection moved or resized under open text: the text keeps its place on the screen
  /// and wraps at the selection's new right edge.
  func selectionDidChange() {
    guard let view = session?.view, let canvas = view.superview else { return }
    view.textContainer?.containerSize.width = max(canvas.bounds.maxX - view.frame.minX, 24)
    fit()
  }

  /// Ends the edit, committing its text.
  func end() {
    guard let session else { return }
    close()
    let annotation = Annotation(
      id: session.id, shape: .text(session.view.string, frame: session.view.frame),
      style: session.style)
    let keep = AnnotationPath.isSubstantial(annotation.shape)
    var document = store.document
    if session.existing {
      if keep { document.update(annotation) } else { document.remove(session.id) }
    } else if keep {
      document.add(annotation)
    }
    store.commit(document)
    // Finished text stays selected like any new annotation, so its colour and size can change.
    if keep { store.selectedID = session.id }
    onEnd?()
  }

  /// Ends the edit without touching the document (the editor is hiding).
  func cancel() {
    guard session != nil else { return }
    close()
  }

  private func close() {
    session?.view.removeFromSuperview()
    session = nil
    typingUndo.removeAllActions()
    store.editingID = nil
  }

  private func configure(_ view: NSTextView, style: AnnotationStyle, width: CGFloat) {
    view.delegate = self
    view.drawsBackground = false
    view.isRichText = false
    view.importsGraphics = false
    view.allowsUndo = true
    view.isAutomaticQuoteSubstitutionEnabled = false
    view.isAutomaticDashSubstitutionEnabled = false
    view.isAutomaticTextReplacementEnabled = false
    view.isContinuousSpellCheckingEnabled = false
    view.focusRingType = .none
    view.textContainerInset = .zero
    view.isHorizontallyResizable = false
    view.isVerticallyResizable = false
    view.typingAttributes = AnnotationRenderer.textAttributes(style)
    view.insertionPointColor = AnnotationRenderer.textColor(style)
    // The text wraps at the selection's right edge (``selectionDidChange()`` keeps it there);
    // ``fit`` sizes the view to what is typed.
    view.textContainer?.lineFragmentPadding = 0
    view.textContainer?.widthTracksTextView = false
    view.textContainer?.heightTracksTextView = false
    view.textContainer?.containerSize = CGSize(
      width: max(width, 24), height: .greatestFiniteMagnitude)
  }

  /// Sizes the view to the laid-out text (one empty line at least). The width keeps 2 pt for
  /// the caret; lines never get wider than the container, so the renderer, wrapping at this
  /// width, breaks lines where the editor did.
  private func fit() {
    guard let session, let container = session.view.textContainer,
      let layout = session.view.layoutManager
    else { return }
    layout.ensureLayout(for: container)
    let used = layout.usedRect(for: container)
    let width = min(ceil(used.width) + 2, container.containerSize.width)
    let height = max(ceil(used.height), Self.lineHeight(session.style, in: session.view))
    session.view.setFrameSize(CGSize(width: width, height: height))
    session.view.superview?.needsDisplay = true
  }

  private static func lineHeight(_ style: AnnotationStyle, in view: NSTextView) -> CGFloat {
    let font = NSFont.systemFont(ofSize: style.stroke.fontSize, weight: .semibold)
    return ceil(view.layoutManager?.defaultLineHeight(for: font) ?? style.stroke.fontSize * 1.2)
  }

  // MARK: NSTextViewDelegate

  func textDidChange(_ notification: Notification) {
    fit()
  }

  /// Esc reaches the text view as `cancelOperation:`; it ends the edit (keeping the text)
  /// rather than going on to cancel the capture.
  func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    guard commandSelector == #selector(NSResponder.cancelOperation(_:)) else { return false }
    end()
    return true
  }

  func undoManager(for view: NSTextView) -> UndoManager? {
    typingUndo
  }
}
