import CoreGraphics
import Foundation

/// Shape construction rules shared by the canvas (while drawing) and the renderer: drag
/// constraints, arrow heads and freehand smoothing.
public enum AnnotationPath {
  /// One element of a smoothed freehand path, in drawing order.
  public enum Segment: Equatable, Sendable {
    case move(CGPoint)
    case line(CGPoint)
    case quad(to: CGPoint, control: CGPoint)
  }

  /// A drawn arrow: the shaft stops inside the head so its round cap never pokes past the
  /// head's sides; `head` is the filled triangle (tip, then the two barbs).
  public struct Arrow: Equatable, Sendable {
    public let shaftEnd: CGPoint
    public let head: [CGPoint]
  }

  /// Shapes smaller than this many points in a dimension come from a click, not a drag, and
  /// are dropped.
  public static let minimumExtent: CGFloat = 3

  /// The box a drag from `start` to `current` spans; with `square` (Shift) it is the largest
  /// square in that direction, so rectangles become squares and ellipses circles.
  public static func dragRect(from start: CGPoint, to current: CGPoint, square: Bool) -> CGRect {
    guard square else { return AnnotationMath.rect(corners: start, current) }
    let side = max(abs(current.x - start.x), abs(current.y - start.y))
    let corner = CGPoint(
      x: start.x + (current.x < start.x ? -side : side),
      y: start.y + (current.y < start.y ? -side : side))
    return AnnotationMath.rect(corners: start, corner)
  }

  /// The end of a line or arrow dragged from `start`; with `snap` (Shift) the direction snaps
  /// to the nearest multiple of 45 degrees, keeping the dragged length.
  public static func dragEnd(from start: CGPoint, to current: CGPoint, snap: Bool) -> CGPoint {
    guard snap else { return current }
    let (dx, dy) = (current.x - start.x, current.y - start.y)
    let length = hypot(dx, dy)
    let step = CGFloat.pi / 4
    let angle = (atan2(dy, dx) / step).rounded() * step
    return CGPoint(x: start.x + length * cos(angle), y: start.y + length * sin(angle))
  }

  /// Whether a freshly drawn shape is big enough to keep.
  public static func isSubstantial(_ shape: AnnotationShape) -> Bool {
    switch shape {
    case .rectangle(let rect), .ellipse(let rect), .mosaic(let rect), .spotlight(let rect):
      return rect.width >= minimumExtent && rect.height >= minimumExtent
    case .arrow(let from, let to), .line(let from, let to):
      return AnnotationMath.distance(from, to) >= minimumExtent
    case .pen(let points), .highlighter(let points):
      return !points.isEmpty
    case .text(let string, _):
      return !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case .step:
      return true
    }
  }

  /// Length of an arrow head for a shaft of `lineWidth`.
  public static func arrowHeadLength(lineWidth: CGFloat) -> CGFloat {
    lineWidth * 3.2 + 6
  }

  /// The arrow from `start` to the tip at `end`; nil when the two coincide. `headLength`
  /// overrides the head's length for the line width. A short arrow's head shrinks to at most 60%
  /// of its length so the shaft stays visible.
  public static func arrow(
    from start: CGPoint, to end: CGPoint, lineWidth: CGFloat, headLength fullHead: CGFloat? = nil
  ) -> Arrow? {
    let length = AnnotationMath.distance(start, end)
    guard length > 0 else { return nil }
    let headLength = min(fullHead ?? arrowHeadLength(lineWidth: lineWidth), length * 0.6)
    let halfWidth = headLength * tan(CGFloat.pi * 25 / 180)
    let (ux, uy) = ((end.x - start.x) / length, (end.y - start.y) / length)
    let base = CGPoint(x: end.x - ux * headLength, y: end.y - uy * headLength)
    let left = CGPoint(x: base.x - uy * halfWidth, y: base.y + ux * halfWidth)
    let right = CGPoint(x: base.x + uy * halfWidth, y: base.y - ux * halfWidth)
    let inset = headLength * 0.8
    let shaftEnd = CGPoint(x: end.x - ux * inset, y: end.y - uy * inset)
    return Arrow(shaftEnd: shaftEnd, head: [end, left, right])
  }

  /// Where the tail of a step badge at `center` starts when it runs to `tip`: on the badge's
  /// edge, a point inside it so no seam shows. Nil when the tip is not clear of the badge, which
  /// then has no tail to draw.
  public static func stepTailStart(center: CGPoint, tip: CGPoint, diameter: CGFloat) -> CGPoint? {
    let length = AnnotationMath.distance(center, tip)
    let radius = diameter / 2
    guard length > radius + 2 else { return nil }
    let reach = radius - 1
    return CGPoint(
      x: center.x + (tip.x - center.x) / length * reach,
      y: center.y + (tip.y - center.y) / length * reach)
  }

  /// `points` with `point` appended unless it lies within `minimumDistance` of the last
  /// sample, which drops the jitter of a slow drag before smoothing.
  public static func appending(
    _ point: CGPoint, to points: [CGPoint], minimumDistance: CGFloat = 1.5
  ) -> [CGPoint] {
    if let last = points.last, AnnotationMath.distance(last, point) < minimumDistance {
      return points
    }
    return points + [point]
  }

  /// A smooth path through freehand samples: quadratic curves whose control points are the
  /// samples and whose ends are the midpoints between neighbours, so the curve is continuous in
  /// direction and passes through the first and last samples. One sample is a dot (`move`
  /// then `line` to itself, which a round cap paints).
  public static func smoothed(_ points: [CGPoint]) -> [Segment] {
    guard let first = points.first else { return [] }
    guard points.count > 2 else {
      return [.move(first), .line(points.count == 2 ? points[1] : first)]
    }
    var segments: [Segment] = [.move(first)]
    for index in 1..<(points.count - 1) {
      let (control, next) = (points[index], points[index + 1])
      let mid = CGPoint(x: (control.x + next.x) / 2, y: (control.y + next.y) / 2)
      segments.append(.quad(to: mid, control: control))
    }
    segments.append(.line(points[points.count - 1]))
    return segments
  }

  /// The rounded plate behind text with a background (decision E9): the text's frame grown by
  /// a margin that scales with the type, so the glyphs never touch its edge.
  public static func textPlate(around frame: CGRect, fontSize: CGFloat) -> CGRect {
    frame.insetBy(dx: -(fontSize * 0.35).rounded(), dy: -(fontSize * 0.15).rounded())
  }

  /// Corner radius of a text plate.
  public static func textPlateRadius(fontSize: CGFloat) -> CGFloat {
    (fontSize * 0.3).rounded()
  }
}
