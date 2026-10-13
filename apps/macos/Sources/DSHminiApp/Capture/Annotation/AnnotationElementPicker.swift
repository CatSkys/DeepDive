import Foundation

/// The detected interface elements under the pointer, for the one-click element box (decision
/// E10). Element detection answers asynchronously (``AnnotationEditing/elementTargets``); like
/// the session's hover, at most one request is in flight and the latest pointer position is
/// asked next, so a slow app never queues work behind every mouse move, and the latest answer
/// wins. An answer for an earlier position still counts while its smallest area holds the
/// pointer (``AnnotationPath/elementBox(in:at:within:)``), so a slow app lags rather than never
/// offering a box.
final class AnnotationElementPicker {
  /// The areas containing a point (view points, smallest first); nil offers no boxes.
  var targets: ((CGPoint) async -> [CGRect])?
  /// The preview may have changed.
  var onChange: (() -> Void)?

  private var pointer: CGPoint?
  private var answer: [CGRect] = []
  private var inFlight = false
  /// Bumped by ``reset()``, so an answer for a hidden editor is dropped.
  private var generation = 0

  /// The box a click at `point` makes, clipped to `area` (the selection).
  func box(at point: CGPoint, within area: CGRect) -> CGRect? {
    AnnotationPath.elementBox(in: answer, at: point, within: area)
  }

  /// The box to preview under the pointer; nil while it is not over empty canvas.
  func preview(within area: CGRect) -> CGRect? {
    pointer.flatMap { box(at: $0, within: area) }
  }

  /// The pointer is at `point` over empty canvas with a tool that boxes elements; nil when it
  /// is anywhere else or the tool does not box elements.
  func hover(at point: CGPoint?) {
    guard point != pointer else { return }
    pointer = point
    onChange?()
    request()
  }

  /// Forgets the pointer and the answer (the editor hides).
  func reset() {
    generation += 1
    pointer = nil
    answer = []
    inFlight = false
  }

  private func request() {
    guard !inFlight, let asked = pointer, let targets else { return }
    inFlight = true
    let generation = generation
    Task { [weak self] in
      let areas = await targets(asked)
      guard let self, generation == self.generation else { return }
      inFlight = false
      answer = areas
      onChange?()
      if let latest = pointer, latest != asked { request() }
    }
  }
}
