import Foundation

/// The annotation document of one capture session, its undo history and the canvas's
/// selection. Every committed change is one undo step that restores the whole previous
/// document, so undo and redo can never leave a half-applied edit.
final class AnnotationStore {
  /// Undo for document changes only. Text typed in an open text editor has its own history
  /// (``AnnotationTextEditor``); the finished edit lands here as one step.
  let undoManager = UndoManager()

  private(set) var document = AnnotationDocument()

  /// The document as drawn mid-gesture (a shape being drawn, moved or resized), committed or
  /// dropped when the gesture ends; nil between gestures.
  var preview: AnnotationDocument? {
    didSet { onChange?() }
  }

  /// The annotation showing grips, if any.
  var selectedID: UUID? {
    didSet { if oldValue != selectedID { onChange?() } }
  }

  /// The text annotation open in the text editor; the renderer skips it while the editor
  /// shows it.
  var editingID: UUID? {
    didSet { if oldValue != editingID { onChange?() } }
  }

  /// Called after anything drawn or the undo state changed.
  var onChange: (() -> Void)?

  /// The burst the last commit belonged to, if any (``commit(_:burst:)``).
  private var burst: UUID?

  init() {
    // Groups are opened per commit, so `canUndo` is right at once rather than after the event
    // loop closes an automatic group.
    undoManager.groupsByEvent = false
  }

  var shown: AnnotationDocument { preview ?? document }

  var selected: Annotation? { selectedID.flatMap { shown[$0] } }

  /// Makes `next` the document as one undo step; ends any preview. Unchanged documents add no
  /// step. Commits sharing a `burst` (one drag of the size slider, one run of scroll-wheel
  /// ticks) make one step together: each moves the document on at once, and undoing restores
  /// what was there before the burst began.
  func commit(_ next: AnnotationDocument, burst: UUID? = nil) {
    preview = nil
    guard next != document else { return }
    if burst == nil || burst != self.burst {
      undoManager.beginUndoGrouping()
      registerRestore(document)
      undoManager.endUndoGrouping()
    }
    self.burst = burst
    document = next
    dropMissingSelection()
    onChange?()
  }

  /// The restore inside the undo already announced the new document, but while the undo manager
  /// is still undoing it reports the step being undone; announcing again once it has finished
  /// gives the toolbar the final `canUndo` and `canRedo` (undo greys out at the oldest step).
  func undo() {
    guard undoManager.canUndo else { return }
    preview = nil
    burst = nil
    undoManager.undo()
    onChange?()
  }

  /// Like ``undo()``: announced again once the redo has finished.
  func redo() {
    guard undoManager.canRedo else { return }
    preview = nil
    burst = nil
    undoManager.redo()
    onChange?()
  }

  /// Makes `next` the document without an undo step and forgets the history: a reopened
  /// capture starts from its annotations, not from an edit of nothing.
  func load(_ next: AnnotationDocument) {
    undoManager.removeAllActions()
    burst = nil
    document = next
    preview = nil
    selectedID = nil
    editingID = nil
    onChange?()
  }

  /// Forgets the document and its history (a new session).
  func reset() {
    undoManager.removeAllActions()
    burst = nil
    document = AnnotationDocument()
    preview = nil
    selectedID = nil
    editingID = nil
    onChange?()
  }

  /// Registered while undoing, the restore lands on the redo stack and vice versa, so each
  /// step can go back and forth.
  private func registerRestore(_ previous: AnnotationDocument) {
    undoManager.registerUndo(withTarget: self) { store in
      MainActor.assumeIsolated { store.restore(previous) }
    }
  }

  private func restore(_ previous: AnnotationDocument) {
    registerRestore(document)
    document = previous
    dropMissingSelection()
    onChange?()
  }

  private func dropMissingSelection() {
    if let id = selectedID, document[id] == nil { selectedID = nil }
  }
}
