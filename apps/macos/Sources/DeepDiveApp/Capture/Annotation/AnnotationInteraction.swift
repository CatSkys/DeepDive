import Foundation

/// The pointer state machine of the annotation canvas. A gesture draws into the store's
/// preview and commits once on mouse-up, so each drawn, moved or resized annotation is one
/// undo step. Points are the overlay's view points (annotations stay put on the screen while
/// the selection moves), already clamped to the selection by the canvas. What a press reaches
/// is ``AnnotationDocument/pressTarget(at:tool:selectedID:)`` (decision D15); what a drag
/// draws is AICore's (`AnnotationDrawing.swift`).
final class AnnotationInteraction {
  /// The gesture in progress, which decides the cursor until the button is released.
  enum Gesture {
    case idle
    /// `dragged` turns true once the pointer has gone ``AnnotationPath/clickReach`` from
    /// `start`; until then a tool that boxes elements treats the press as a click (E10).
    case drawing(Annotation, start: CGPoint, dragged: Bool)
    case moving(Annotation, start: CGPoint)
    case resizing(Annotation, AnnotationHandle)
  }

  let store: AnnotationStore
  /// Nil until a tool is chosen, and again after Esc drops it; the canvas ignores the pointer
  /// then.
  var tool: AnnotationTool?
  /// The styles new annotations take, per slot (E8); the editor remembers them.
  var styles = AnnotationStyles.defaults {
    didSet { if styles != oldValue { onStylesChange?(styles) } }
  }
  var onStylesChange: ((AnnotationStyles) -> Void)?
  /// The element box a click at a point makes (the smallest detected element there, clipped to
  /// the selection), or nil.
  var elementBox: ((CGPoint) -> CGRect?)?

  /// Opens the text editor at a point, or on an existing text annotation.
  var onEditText: ((CGPoint, Annotation?) -> Void)?
  /// A double-click on empty canvas with the select tool confirms, like a double-click inside
  /// the selection before a tool was chosen (D8).
  var onConfirm: (() -> Void)?

  private(set) var gesture = Gesture.idle

  var isGesturing: Bool {
    if case .idle = gesture { return false }
    return true
  }

  init(store: AnnotationStore) {
    self.store = store
  }

  /// What a press at `point` would reach with the current tool; nil before a tool is chosen.
  func target(at point: CGPoint) -> AnnotationPressTarget? {
    guard let tool else { return nil }
    return store.document.pressTarget(at: point, tool: tool, selectedID: store.selectedID)
  }

  /// Whether the pointer at `point` previews the element a click would box (E10): a tool that
  /// boxes elements, over empty canvas, until a press there turns into a drag.
  func previewsElement(at point: CGPoint) -> Bool {
    guard let tool, tool.boxesElements else { return false }
    switch gesture {
    case .idle: return target(at: point) == .canvas
    case .drawing(_, _, let dragged): return !dragged
    case .moving, .resizing: return false
    }
  }

  func mouseDown(at point: CGPoint, clickCount: Int) {
    guard let tool, let target = target(at: point) else { return }
    let document = store.document
    switch target {
    case .grip(let handle):
      guard let selected = store.selected else { return }
      gesture = .resizing(selected, handle)
    case .text(let id):
      onEditText?(point, document[id])
    case .annotation(let id):
      guard let hit = document[id] else { return }
      // A double-click on text with the select tool edits it in place.
      if tool == .select, clickCount >= 2, hit.isText {
        onEditText?(point, hit)
        return
      }
      store.selectedID = id
      gesture = .moving(hit, start: point)
    case .canvas:
      store.selectedID = nil
      switch tool {
      case .select:
        if clickCount >= 2 { onConfirm?() }
      case .text:
        onEditText?(point, nil)
      default:
        guard let shape = tool.initialShape(at: point) else { return }
        let annotation = Annotation(shape: shape, style: styles[tool.styleSlot])
        gesture = .drawing(annotation, start: point, dragged: false)
        // A tool that boxes elements shows nothing until the press turns into a drag: a click
        // makes the element box instead, and an empty spotlight would dim everything.
        if !tool.boxesElements { store.preview = Self.document(document, adding: annotation) }
      }
    }
  }

  func mouseDragged(to point: CGPoint, constrained: Bool) {
    let document = store.document
    switch gesture {
    case .idle:
      return
    case .drawing(var annotation, let start, let wasDragged):
      let dragged =
        wasDragged || AnnotationMath.distance(start, point) >= AnnotationPath.clickReach
      // A tool that boxes elements keeps the press a click until it leaves the click reach.
      if dragged || tool?.boxesElements != true {
        annotation.shape = annotation.shape.dragged(
          from: start, to: point, constrained: constrained)
        store.preview = Self.document(document, adding: annotation)
      }
      gesture = .drawing(annotation, start: start, dragged: dragged)
    case .moving(let original, let start):
      let offset = CGVector(dx: point.x - start.x, dy: point.y - start.y)
      store.preview = Self.document(document, replacing: original.moved(by: offset))
    case .resizing(let original, let handle):
      store.preview = Self.document(document, replacing: original.resized(handle, to: point))
    }
  }

  func mouseUp() {
    defer { gesture = .idle }
    switch gesture {
    case .idle:
      return
    case .drawing(let annotation, let start, let dragged):
      if !dragged, let tool, tool.boxesElements {
        boxElement(at: start, tool: tool, style: annotation.style)
        return
      }
      guard AnnotationPath.isSubstantial(annotation.shape), let preview = store.preview else {
        store.preview = nil
        return
      }
      store.commit(preview)
      // The new annotation stays selected, so the toolbar shows and changes its style at once
      // and its grips adjust it; the next press elsewhere deselects it.
      store.selectedID = annotation.id
    case .moving, .resizing:
      store.commit(store.preview ?? store.document)
    }
  }

  /// A click without a drag: the shape over the element under the press, selected, as one
  /// undo step; nothing when no element is there (E10).
  private func boxElement(at point: CGPoint, tool: AnnotationTool, style: AnnotationStyle) {
    store.preview = nil
    guard let box = elementBox?(point), let shape = tool.elementBox(box) else { return }
    let annotation = Annotation(shape: shape, style: style)
    store.commit(Self.document(store.document, adding: annotation))
    store.selectedID = annotation.id
  }

  /// Applies a style bar change to the selected annotation (one undo step, or one per `burst`;
  /// see ``AnnotationStore/commit(_:burst:)``) and to the style new annotations of its slot
  /// take; with nothing selected, to the active tool's slot. Only the parts picked change.
  func apply(_ change: AnnotationStyleChange, burst: UUID? = nil) {
    let selected = store.selectedID.flatMap { store.document[$0] }
    let slot = selected?.shape.styleSlot ?? tool?.styleSlot ?? .shared
    styles[slot] = change.applied(to: styles[slot])
    guard var selected else { return }
    selected.style = change.applied(to: selected.style)
    store.commit(Self.document(store.document, replacing: selected), burst: burst)
  }

  /// Deletes the selected annotation; false when nothing is selected.
  func deleteSelection() -> Bool {
    guard let id = store.selectedID, store.document[id] != nil else { return false }
    var document = store.document
    document.remove(id)
    store.commit(document)
    return true
  }

  /// Removes every annotation as one undo step; false when there is none.
  func clearAll() -> Bool {
    guard !store.document.isEmpty else { return false }
    cancelGesture()
    store.commit(AnnotationDocument())
    return true
  }

  /// Moves the selected annotation by `offset`; false when nothing is selected.
  func nudgeSelection(by offset: CGVector) -> Bool {
    guard let selected = store.selectedID.flatMap({ store.document[$0] }) else { return false }
    store.commit(Self.document(store.document, replacing: selected.moved(by: offset)))
    return true
  }

  /// Drops a gesture in progress (the editor hides or the tool changes mid-drag).
  func cancelGesture() {
    gesture = .idle
    store.preview = nil
  }

  private static func document(
    _ document: AnnotationDocument, adding annotation: Annotation
  ) -> AnnotationDocument {
    var copy = document
    copy.add(annotation)
    return copy
  }

  private static func document(
    _ document: AnnotationDocument, replacing annotation: Annotation
  ) -> AnnotationDocument {
    var copy = document
    copy.update(annotation)
    return copy
  }
}
