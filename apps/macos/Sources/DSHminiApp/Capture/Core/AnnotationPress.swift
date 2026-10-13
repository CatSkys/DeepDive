import CoreGraphics
import Foundation

/// What a press on the annotation canvas reaches with the active tool (decision D15). The
/// canvas's pointer handling and its cursor both read it, so the cursor always shows what a
/// press there would do.
public enum AnnotationPressTarget: Equatable, Sendable {
  /// A grip of the selected annotation: the press resizes it.
  case grip(AnnotationHandle)
  /// An annotation the press selects (unless it already is) and drags.
  case annotation(UUID)
  /// A text annotation the text tool opens for editing.
  case text(UUID)
  /// Nothing there: the tool's own action (draw, new text, a badge; the select tool deselects).
  case canvas

  /// Slack around strokes and around a selected annotation's bounds.
  public static let slack: CGFloat = 4
  /// How far from a grip's center a press still takes it.
  public static let gripReach: CGFloat = 7
}

extension AnnotationDocument {
  /// The target of a press at `point` with `tool`, while `selectedID` shows its grips.
  ///
  /// The selected annotation's grips come first, whatever the tool. Then, per tool:
  /// - select and the shape tools: an annotation drawn in front of the selected one, by its
  ///   body; then the selected one, anywhere in its padded bounds; then the front-most body;
  ///   with the select tool lastly the front-most padded bounds, so a frame selects from inside.
  /// - pen and highlighter: the selected annotation by its body only; strokes are drawn over
  ///   everything else, and a new stroke can start right beside the last one (unchanged from v3).
  /// - text: a text annotation's body opens it; then the selected annotation's padded bounds.
  public func pressTarget(at point: CGPoint, tool: AnnotationTool, selectedID: UUID?)
    -> AnnotationPressTarget
  {
    let slack = AnnotationPressTarget.slack
    let selectedIndex = selectedID.flatMap { id in annotations.firstIndex { $0.id == id } }
    let selected = selectedIndex.map { annotations[$0] }
    if let selected,
      let grip = selected.handle(at: point, tolerance: AnnotationPressTarget.gripReach)
    {
      return .grip(grip)
    }
    let inSelected = selected?.boundsContain(point, padding: slack) == true
    switch tool {
    case .pen, .highlighter:
      guard let selected, selected.contains(point, tolerance: slack) else { return .canvas }
      return .annotation(selected.id)
    case .text:
      if let text = annotations.last(where: { $0.isText && $0.contains(point, tolerance: slack) }) {
        return .text(text.id)
      }
      if let selected, inSelected { return .annotation(selected.id) }
      return .canvas
    case .select, .rectangle, .ellipse, .arrow, .line, .mosaic, .spotlight, .step:
      let body = annotations.lastIndex { $0.contains(point, tolerance: slack) }
      if let body, body > (selectedIndex ?? -1) { return .annotation(annotations[body].id) }
      if let selected, inSelected { return .annotation(selected.id) }
      if let body { return .annotation(annotations[body].id) }
      guard tool == .select,
        let framed = annotations.last(where: { $0.boundsContain(point, padding: slack) })
      else { return .canvas }
      return .annotation(framed.id)
    }
  }
}

extension Annotation {
  /// Whether this is a text annotation, which the text tool and a double-click edit in place.
  public var isText: Bool {
    if case .text = shape { return true }
    return false
  }
}
