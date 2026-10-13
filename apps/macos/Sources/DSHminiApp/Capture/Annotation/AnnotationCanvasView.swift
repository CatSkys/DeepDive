import AppKit

/// The annotation surface over the committed selection, a flipped subview of the host overlay
/// view. Its frame is the selection and its bounds origin the selection's origin, so its points
/// are the host's view points: annotations, the text editor and pointer locations keep their
/// place on the screen while the selection moves or resizes over them (decision D14).
///
/// Focus and key contract with the host (the capture overlay view, this view's superview's
/// superview and so up its responder chain):
/// - From ``AnnotationEditor/show`` on, this view is the window's first responder (the text
///   view is while text is edited). The host must not take first responder back while the
///   editor is shown.
/// - The host routes the pointer (``AnnotationHostView``): the selection's handles and edge
///   band always go to the session, the rest of the interior comes here only once a tool is
///   chosen. Before that, of the keys only tool letters, ⌘Z and ⇧⌘Z are taken here.
/// - Once a tool is chosen this view also takes Return or Enter (confirm), Delete (removes the
///   selected annotation) and arrows while an annotation is selected (nudge it, Shift ×10).
/// - `[` and `]` step the stroke the style bar shows down or up, whenever it shows one (while
///   text is typed, the text view keeps them as characters). ⌘Delete clears every annotation,
///   typing included, as one undo step.
/// - Esc steps back one level (E6) and is taken only when it did: a gesture in progress is
///   dropped, else the selected annotation is deselected, else the tool is dropped (the
///   interior goes back to the session). Open text ends on Esc in the text view itself.
/// - Everything else goes up the responder chain to the host: Esc with nothing to step back
///   (cancel the session), Tab, arrows with nothing selected and Option-arrows (they nudge or
///   resize the selection), Return while idle, and right-clicks (the session decides with
///   ``AnnotationEditing/hasAnnotations``).
///
/// Cursors: this view sets its own (``AnnotationInteraction/cursor(at:)``) from a tracking area,
/// only where the host routes the pointer here, so it never fights the session's cursors over
/// the handles, the edge band or the bars. The same routing decides where the element preview
/// of a tool that boxes elements shows (E10).
final class AnnotationCanvasView: NSView {
  let store: AnnotationStore
  let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  private let renderer: AnnotationRenderer
  private let picker: AnnotationElementPicker

  /// The frozen display's image, which mosaic regions pixelate, at ``pixelScale`` pixels per
  /// point. The whole display rather than the selection, so a mosaic keeps its blocks when the
  /// selection moves.
  var backdrop: CGImage? {
    didSet { needsDisplay = true }
  }
  var pixelScale: CGFloat = 1

  /// ⌘C outside open text.
  var onCopy: (() -> Void)?
  var onConfirm: (() -> Void)?
  var onChooseTool: ((AnnotationTool) -> Void)?
  /// Esc: steps back one level; false when there was nothing to step back.
  var onEscape: (() -> Bool)?
  /// `[` `-` (-1) or `]` `=` (1): steps the style bar's size; false when it shows none.
  var onStepStroke: ((Int) -> Bool)?
  /// ⌘Delete: ends open text and clears every annotation; false when there was nothing to do.
  var onClearAll: (() -> Bool)?

  init(
    store: AnnotationStore, interaction: AnnotationInteraction, textEditor: AnnotationTextEditor,
    renderer: AnnotationRenderer, picker: AnnotationElementPicker
  ) {
    self.store = store
    self.interaction = interaction
    self.textEditor = textEditor
    self.renderer = renderer
    self.picker = picker
    super.init(frame: .zero)
    clipsToBounds = true
    // `activeAlways`: the overlay panel is non-activating; `inVisibleRect` follows the frame.
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [
          .mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeAlways, .inVisibleRect,
        ],
        owner: self))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  private var isActive: Bool { interaction.tool != nil }

  /// Shows `selection` (view points): the frame moves over the host, the content stays put.
  func place(over selection: CGRect) {
    frame = selection
    setBoundsOrigin(selection.origin)
    needsDisplay = true
  }

  /// The tool or the selected annotation changed: the cursor and element preview follow at once
  /// under a still pointer.
  func refreshPointer() {
    guard let window else { return }
    updatePointer(at: window.mouseLocationOutsideOfEventStream)
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    renderer.draw(
      store.shown, hiding: store.editingID, in: context, backdrop: backdrop, scale: pixelScale)
    if let frame = textEditor.frame, let style = textEditor.style {
      // Open text: the plate goes behind the transparent text view, the outline around both.
      var area = frame
      if style.textBackground {
        AnnotationRenderer.drawTextPlate(around: frame, style: style, in: context)
        area = AnnotationPath.textPlate(around: frame, fontSize: style.stroke.fontSize)
      }
      Self.outline(area.insetBy(dx: -4, dy: -3), in: context)
    } else if let selected = store.selected {
      drawGrips(of: selected, in: context)
    }
    if let element = picker.preview(within: bounds) {
      Self.outline(element, in: context, width: 1.5)
    }
  }

  /// Grips for shapes that resize; a dashed frame for those that only move, and around a
  /// spotlight, which has no outline of its own.
  private func drawGrips(of annotation: Annotation, in context: CGContext) {
    let handles = annotation.handles
    if case .spotlight(let rect) = annotation.shape { Self.outline(rect, in: context) }
    guard !handles.isEmpty else {
      Self.outline(annotation.bounds.insetBy(dx: -3, dy: -3), in: context)
      return
    }
    context.setLineWidth(1.5)
    context.setStrokeColor(NSColor(white: 0, alpha: 0.4).cgColor)
    context.setFillColor(NSColor.white.cgColor)
    for (_, point) in handles {
      let grip = CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)
      context.fillEllipse(in: grip)
      context.strokeEllipse(in: grip)
    }
  }

  private static func outline(_ rect: CGRect, in context: CGContext, width: CGFloat = 1) {
    context.saveGState()
    context.setLineWidth(width)
    context.setStrokeColor(NSColor(white: 1, alpha: 0.85).cgColor)
    context.setLineDash(phase: 0, lengths: [4, 3])
    context.stroke(rect.insetBy(dx: width / 2, dy: width / 2))
    context.restoreGState()
  }

  // MARK: Pointer

  private func point(of event: NSEvent) -> CGPoint {
    let point = convert(event.locationInWindow, from: nil)
    return CGPoint(
      x: min(max(point.x, bounds.minX), bounds.maxX),
      y: min(max(point.y, bounds.minY), bounds.maxY))
  }

  override func mouseDown(with event: NSEvent) {
    // A click away from open text only ends the edit.
    if textEditor.isEditing {
      textEditor.end()
      updatePointer(at: event.locationInWindow)
      return
    }
    window?.makeFirstResponder(self)
    let point = point(of: event)
    interaction.mouseDown(at: point, clickCount: event.clickCount)
    interaction.cursor(at: point)?.set()
  }

  override func mouseDragged(with event: NSEvent) {
    let point = point(of: event)
    interaction.mouseDragged(to: point, constrained: event.modifierFlags.contains(.shift))
    // No cursor updates arrive while the button is down; the gesture's cursor is kept here.
    interaction.cursor(at: point)?.set()
    picker.hover(at: interaction.previewsElement(at: point) ? point : nil)
  }

  override func mouseUp(with event: NSEvent) {
    interaction.mouseUp()
    updatePointer(at: event.locationInWindow)
  }

  override func mouseMoved(with event: NSEvent) { updatePointer(at: event.locationInWindow) }

  override func cursorUpdate(with event: NSEvent) { updatePointer(at: event.locationInWindow) }

  override func mouseExited(with event: NSEvent) { picker.hover(at: nil) }

  /// Sets the tool's cursor and element preview for the pointer at `location` (window
  /// coordinates) when the host routes the pointer there to this view; elsewhere the session or
  /// a bar owns the cursor and no element is previewed.
  private func updatePointer(at location: CGPoint) {
    guard let host = superview, let overlay = host.superview,
      host.hitTest(overlay.convert(location, from: nil))?.isDescendant(of: self) == true
    else {
      picker.hover(at: nil)
      return
    }
    let point = convert(location, from: nil)
    if let editing = textEditor.frame, editing.contains(point) {
      NSCursor.iBeam.set()
    } else {
      interaction.cursor(at: point)?.set()
    }
    let previews = !textEditor.isEditing && interaction.previewsElement(at: point)
    picker.hover(at: previews ? point : nil)
  }

  // MARK: Keys

  override func keyDown(with event: NSEvent) {
    if handleKey(event) { return }
    super.keyDown(with: event)
  }

  private func handleKey(_ event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard modifiers.isDisjoint(with: [.command, .control, .option]) else { return false }
    switch Int(event.keyCode) {
    case 53:  // Esc
      return onEscape?() ?? false
    case 36, 76:  // Return, keypad Enter
      guard isActive else { return false }
      onConfirm?()
      return true
    case 51, 117:  // Delete, forward delete
      return isActive && interaction.deleteSelection()
    case 123, 124, 125, 126:  // ← → ↓ ↑
      guard isActive else { return false }
      let step: CGFloat = modifiers.contains(.shift) ? 10 : 1
      let offset: CGVector =
        switch Int(event.keyCode) {
        case 123: CGVector(dx: -step, dy: 0)
        case 124: CGVector(dx: step, dy: 0)
        case 125: CGVector(dx: 0, dy: step)
        default: CGVector(dx: 0, dy: -step)
        }
      return interaction.nudgeSelection(by: offset)
    default:
      let characters = event.charactersIgnoringModifiers ?? ""
      // `[` `]`, and PixPin's wheel keys `-` `=` (with Shift `_` `+`).
      if let step = ["[": -1, "-": -1, "_": -1, "]": 1, "=": 1, "+": 1][characters] {
        return onStepStroke?(step) ?? false
      }
      guard let tool = AnnotationTool(key: characters) else { return false }
      onChooseTool?(tool)
      return true
    }
  }

  /// ⌘Z and ⇧⌘Z undo the document, or the typing while text is open; ⌘Delete clears it; ⌘C
  /// copies the result, except while text is open, where it copies the text selected in it.
  /// They are taken here rather than through the Edit menu, whose `undo:` would reach the
  /// window's undo manager, and ahead of an open text view's own handling of the keys.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    if event.type == .keyDown, window?.isKeyWindow == true, modifiers == .command,
      event.charactersIgnoringModifiers?.lowercased() == "c", !textEditor.isEditing,
      let onCopy
    {
      onCopy()
      return true
    }
    if event.type == .keyDown, window?.isKeyWindow == true, modifiers == .command,
      event.keyCode == 51, onClearAll?() == true
    {
      return true
    }
    guard event.type == .keyDown, window?.isKeyWindow == true,
      modifiers == .command || modifiers == [.command, .shift],
      event.charactersIgnoringModifiers?.lowercased() == "z"
    else { return super.performKeyEquivalent(with: event) }
    let redo = modifiers.contains(.shift)
    if textEditor.isEditing {
      let typing = textEditor.typingUndo
      if redo, typing.canRedo { typing.redo() } else if !redo, typing.canUndo { typing.undo() }
    } else if redo {
      store.redo()
    } else {
      store.undo()
    }
    return true
  }
}
