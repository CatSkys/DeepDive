import CoreGraphics
import Foundation

// What a drawing gesture on the canvas makes: the shape a tool starts with, how a drag reshapes
// it (Shift squares boxes, snaps lines and straightens freehand strokes), and the element box a
// click without a drag makes (decision E10). The canvas's pointer state machine applies them.

extension AnnotationTool {
  /// The zero-sized shape this tool starts drawing at `point`; nil for the tools that do not
  /// draw by dragging (select, text).
  public func initialShape(at point: CGPoint) -> AnnotationShape? {
    switch self {
    case .rectangle: .rectangle(CGRect(origin: point, size: .zero))
    case .ellipse: .ellipse(CGRect(origin: point, size: .zero))
    case .mosaic: .mosaic(CGRect(origin: point, size: .zero))
    case .spotlight: .spotlight(CGRect(origin: point, size: .zero))
    case .arrow: .arrow(from: point, to: point)
    case .line: .line(from: point, to: point)
    case .pen: .pen([point])
    case .highlighter: .highlighter([point])
    case .step: .step(center: point)
    case .select, .text: nil
    }
  }

  /// The shape this tool makes over `rect` when a click boxes an interface element; nil for the
  /// tools that do not (decision E10).
  public func elementBox(_ rect: CGRect) -> AnnotationShape? {
    switch self {
    case .rectangle: .rectangle(rect)
    case .ellipse: .ellipse(rect)
    case .mosaic: .mosaic(rect)
    case .spotlight: .spotlight(rect)
    case .select, .arrow, .line, .pen, .highlighter, .text, .step: nil
    }
  }

  /// Whether a click without a drag boxes the element under the pointer, and hovering empty
  /// canvas previews that element.
  public var boxesElements: Bool { elementBox(.zero) != nil }
}

extension AnnotationShape {
  /// The shape being drawn after a drag from `start` (the press) to `point`. With `constrained`
  /// (Shift) boxes are squares, arrows, lines and a step badge's tail snap to 45 degrees, and pen
  /// and highlighter strokes become one straight segment from the press point, snapped the same
  /// way (E7);
  /// letting go of Shift mid-drag continues freehand from that segment's end.
  public func dragged(from start: CGPoint, to point: CGPoint, constrained: Bool) -> AnnotationShape
  {
    let end = AnnotationPath.dragEnd(from: start, to: point, snap: constrained)
    func box() -> CGRect { AnnotationPath.dragRect(from: start, to: point, square: constrained) }
    func stroke(_ points: [CGPoint]) -> [CGPoint] {
      constrained ? [start, end] : AnnotationPath.appending(point, to: points)
    }
    return switch self {
    case .rectangle: .rectangle(box())
    case .ellipse: .ellipse(box())
    case .mosaic: .mosaic(box())
    case .spotlight: .spotlight(box())
    case .arrow: .arrow(from: start, to: end)
    case .line: .line(from: start, to: end)
    case .pen(let points): .pen(stroke(points))
    case .highlighter(let points): .highlighter(stroke(points))
    case .step:
      // The badge stays where it was pressed; dragging past a click pulls a tail out of it.
      .step(
        center: start,
        tip: AnnotationMath.distance(start, point) > AnnotationPath.clickReach ? end : nil)
    case .text: self
    }
  }
}

extension AnnotationPath {
  /// A press that never moved this far from where it started is a click, not a drag.
  public static let clickReach: CGFloat = 4

  /// The element box a click at `point` makes: the smallest of `targets` (smallest first, as
  /// element detection answers) that holds the point, clipped to `area` (the selection); nil
  /// when none does or the clipped box is too small to keep. A stale answer for an earlier
  /// pointer position therefore never boxes an element the pointer has left.
  public static func elementBox(in targets: [CGRect], at point: CGPoint, within area: CGRect)
    -> CGRect?
  {
    guard let target = targets.first(where: { $0.contains(point) }) else { return nil }
    let box = target.intersection(area)
    guard !box.isNull, box.width >= minimumExtent, box.height >= minimumExtent else { return nil }
    return box
  }
}
