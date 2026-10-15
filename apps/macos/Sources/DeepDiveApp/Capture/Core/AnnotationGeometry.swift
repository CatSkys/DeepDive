import CoreGraphics
import Foundation

/// A grip on a selected annotation: the eight frame grips of a box shape, or the two ends of an
/// arrow or line.
public enum AnnotationHandle: CaseIterable, Sendable {
  case topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left
  case start, end

  /// The selection handle at the same place on a box, whose frame-resize cursor the grip shows;
  /// nil for the ends of arrows and lines.
  public var boxHandle: SelectionHandle? {
    switch self {
    case .topLeft: .topLeft
    case .top: .top
    case .topRight: .topRight
    case .right: .right
    case .bottomRight: .bottomRight
    case .bottom: .bottom
    case .bottomLeft: .bottomLeft
    case .left: .left
    case .start, .end: nil
    }
  }
}

extension Annotation {
  /// The area the annotation paints, strokes included.
  public var bounds: CGRect {
    let width = paintedWidth
    switch shape {
    case .rectangle(let rect), .ellipse(let rect):
      return rect.insetBy(dx: -width / 2, dy: -width / 2)
    case .arrow(let from, let to):
      // The head is wider than the shaft (``AnnotationPath.arrowHead``).
      let outset = max(width / 2, AnnotationPath.arrowHeadLength(lineWidth: width))
      return AnnotationMath.rect(corners: from, to).insetBy(dx: -outset, dy: -outset)
    case .line(let from, let to):
      return AnnotationMath.rect(corners: from, to).insetBy(dx: -width / 2, dy: -width / 2)
    case .pen(let points), .highlighter(let points):
      return AnnotationMath.rect(enclosing: points).insetBy(dx: -width / 2, dy: -width / 2)
    case .text(_, let frame):
      guard style.textBackground else { return frame }
      return AnnotationPath.textPlate(around: frame, fontSize: style.stroke.fontSize)
    case .mosaic(let rect), .spotlight(let rect):
      return rect
    case .step(let center, let tip):
      let radius = style.stroke.stepDiameter / 2
      let badge = CGRect(
        x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
      guard let tip, stepTailStart(center: center, tip: tip) != nil else { return badge }
      // The head is wider than the tail's shaft, like an arrow's.
      let outset = style.stroke.stepTailHeadLength
      return badge.union(
        AnnotationMath.rect(corners: center, tip).insetBy(dx: -outset, dy: -outset))
    }
  }

  /// The width the shape's stroke paints with (0 for filled shapes).
  public var paintedWidth: CGFloat {
    switch shape {
    case .highlighter: style.stroke.highlighterWidth
    case .text, .mosaic, .step, .spotlight: 0
    default: style.stroke.lineWidth
    }
  }

  /// Where a step badge's tail leaves the badge, when the tail is long enough to show.
  func stepTailStart(center: CGPoint, tip: CGPoint) -> CGPoint? {
    AnnotationPath.stepTailStart(center: center, tip: tip, diameter: style.stroke.stepDiameter)
  }

  /// Whether `point` is in the annotation's bounds grown by `padding`: the area that drags a
  /// selected annotation, and that selects one with the select tool (decision D15).
  public func boundsContain(_ point: CGPoint, padding: CGFloat) -> Bool {
    bounds.insetBy(dx: -padding, dy: -padding).contains(point)
  }

  /// Whether `point` hits the annotation's body. Outlines (rectangle, ellipse) and open shapes
  /// hit only near their stroke, so an annotation inside a frame stays reachable; filled shapes
  /// (text with its plate, mosaic, step badges) hit anywhere inside. A spotlight hits along its
  /// edge, where the dimming ends, so anything drawn inside it stays reachable.
  public func contains(_ point: CGPoint, tolerance: CGFloat) -> Bool {
    let reach = paintedWidth / 2 + tolerance
    switch shape {
    case .rectangle(let rect), .spotlight(let rect):
      let outer = rect.insetBy(dx: -reach, dy: -reach)
      let inner = rect.insetBy(dx: reach, dy: reach)
      return outer.contains(point) && (inner.isNull || !inner.contains(point))
    case .ellipse(let rect):
      return Self.ellipseDistance(from: point, to: rect) <= reach
    case .arrow(let from, let to), .line(let from, let to):
      return AnnotationMath.distance(point, toSegment: from, to) <= reach
    case .pen(let points), .highlighter(let points):
      return Self.polylineDistance(from: point, to: points) <= reach
    case .text:
      return bounds.insetBy(dx: -tolerance, dy: -tolerance).contains(point)
    case .mosaic(let rect):
      return rect.insetBy(dx: -tolerance, dy: -tolerance).contains(point)
    case .step(let center, let tip):
      if AnnotationMath.distance(point, center) <= style.stroke.stepDiameter / 2 + tolerance {
        return true
      }
      // The tail counts as the badge's body, so it selects and drags the badge.
      guard let tip, stepTailStart(center: center, tip: tip) != nil else { return false }
      return AnnotationMath.distance(point, toSegment: center, tip)
        <= style.stroke.stepTailWidth / 2 + tolerance
    }
  }

  /// The grips a selected annotation offers, with their positions. Freehand paths, text and
  /// plain badges only move; box shapes resize from eight grips, arrows and lines from their
  /// ends, and a badge with a tail from its centre (`start`) and its tip (`end`).
  public var handles: [(handle: AnnotationHandle, point: CGPoint)] {
    switch shape {
    case .rectangle(let rect), .ellipse(let rect), .mosaic(let rect), .spotlight(let rect):
      return [
        (.topLeft, CGPoint(x: rect.minX, y: rect.minY)),
        (.top, CGPoint(x: rect.midX, y: rect.minY)),
        (.topRight, CGPoint(x: rect.maxX, y: rect.minY)),
        (.right, CGPoint(x: rect.maxX, y: rect.midY)),
        (.bottomRight, CGPoint(x: rect.maxX, y: rect.maxY)),
        (.bottom, CGPoint(x: rect.midX, y: rect.maxY)),
        (.bottomLeft, CGPoint(x: rect.minX, y: rect.maxY)),
        (.left, CGPoint(x: rect.minX, y: rect.midY)),
      ]
    case .arrow(let from, let to), .line(let from, let to):
      return [(.start, from), (.end, to)]
    case .step(let center, let tip?):
      return [(.start, center), (.end, tip)]
    case .pen, .highlighter, .text, .step:
      return []
    }
  }

  /// The grip within `tolerance` of `point`, nearest first.
  public func handle(at point: CGPoint, tolerance: CGFloat) -> AnnotationHandle? {
    handles.filter { AnnotationMath.distance($0.point, point) <= tolerance }
      .min { AnnotationMath.distance($0.point, point) < AnnotationMath.distance($1.point, point) }?
      .handle
  }

  /// The annotation moved by `offset`.
  public func moved(by offset: CGVector) -> Annotation {
    func shift(_ point: CGPoint) -> CGPoint {
      CGPoint(x: point.x + offset.dx, y: point.y + offset.dy)
    }
    var copy = self
    switch shape {
    case .rectangle(let rect): copy.shape = .rectangle(rect.offsetBy(dx: offset.dx, dy: offset.dy))
    case .ellipse(let rect): copy.shape = .ellipse(rect.offsetBy(dx: offset.dx, dy: offset.dy))
    case .mosaic(let rect): copy.shape = .mosaic(rect.offsetBy(dx: offset.dx, dy: offset.dy))
    case .spotlight(let rect):
      copy.shape = .spotlight(rect.offsetBy(dx: offset.dx, dy: offset.dy))
    case .arrow(let from, let to): copy.shape = .arrow(from: shift(from), to: shift(to))
    case .line(let from, let to): copy.shape = .line(from: shift(from), to: shift(to))
    case .pen(let points): copy.shape = .pen(points.map(shift))
    case .highlighter(let points): copy.shape = .highlighter(points.map(shift))
    case .text(let string, let frame):
      copy.shape = .text(string, frame: frame.offsetBy(dx: offset.dx, dy: offset.dy))
    case .step(let center, let tip): copy.shape = .step(center: shift(center), tip: tip.map(shift))
    }
    return copy
  }

  /// The annotation with `handle` dragged to `point`. A box grip moves the edges it sits on (the
  /// box may flip past its opposite edge and is kept standardized); an end grip moves that end.
  public func resized(_ handle: AnnotationHandle, to point: CGPoint) -> Annotation {
    var copy = self
    switch shape {
    case .rectangle(let rect): copy.shape = .rectangle(Self.resize(rect, handle, to: point))
    case .ellipse(let rect): copy.shape = .ellipse(Self.resize(rect, handle, to: point))
    case .mosaic(let rect): copy.shape = .mosaic(Self.resize(rect, handle, to: point))
    case .spotlight(let rect): copy.shape = .spotlight(Self.resize(rect, handle, to: point))
    case .arrow(let from, let to):
      copy.shape = handle == .start ? .arrow(from: point, to: to) : .arrow(from: from, to: point)
    case .line(let from, let to):
      copy.shape = handle == .start ? .line(from: point, to: to) : .line(from: from, to: point)
    case .step(let center, let tip?):
      copy.shape =
        handle == .start ? .step(center: point, tip: tip) : .step(center: center, tip: point)
    case .pen, .highlighter, .text, .step:
      break
    }
    return copy
  }

  static func resize(_ rect: CGRect, _ handle: AnnotationHandle, to point: CGPoint) -> CGRect {
    var (minX, minY, maxX, maxY) = (rect.minX, rect.minY, rect.maxX, rect.maxY)
    switch handle {
    case .topLeft, .left, .bottomLeft: minX = point.x
    case .topRight, .right, .bottomRight: maxX = point.x
    case .top, .bottom, .start, .end: break
    }
    switch handle {
    case .topLeft, .top, .topRight: minY = point.y
    case .bottomLeft, .bottom, .bottomRight: maxY = point.y
    case .left, .right, .start, .end: break
    }
    return AnnotationMath.rect(corners: CGPoint(x: minX, y: minY), CGPoint(x: maxX, y: maxY))
  }

  /// Approximate distance from `point` to the outline of the ellipse inscribed in `rect`: the
  /// gap between the point's distance from the centre and the ellipse's radius in that
  /// direction. Exact on the axes and close enough elsewhere for hit-testing.
  static func ellipseDistance(from point: CGPoint, to rect: CGRect) -> CGFloat {
    let (a, b) = (rect.width / 2, rect.height / 2)
    let center = CGPoint(x: rect.midX, y: rect.midY)
    guard a > 0, b > 0 else {
      return AnnotationMath.distance(
        point, toSegment: CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.maxY))
    }
    let (dx, dy) = (point.x - center.x, point.y - center.y)
    let rho = (dx * dx + dy * dy).squareRoot()
    guard rho > 0 else { return min(a, b) }
    let (cos, sin) = (dx / rho, dy / rho)
    let radius = 1 / ((cos / a) * (cos / a) + (sin / b) * (sin / b)).squareRoot()
    return abs(rho - radius)
  }

  static func polylineDistance(from point: CGPoint, to points: [CGPoint]) -> CGFloat {
    guard let first = points.first else { return .infinity }
    guard points.count > 1 else { return AnnotationMath.distance(point, first) }
    return zip(points, points.dropFirst()).map { AnnotationMath.distance(point, toSegment: $0, $1) }
      .min()
      ?? .infinity
  }
}

/// Point and rect helpers for annotation geometry, namespaced so they cannot collide with
/// other capture code's extensions on the CoreGraphics types.
public enum AnnotationMath {
  public static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
    hypot(a.x - b.x, a.y - b.y)
  }

  /// Distance from `point` to the segment from `a` to `b`.
  public static func distance(_ point: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
    let (dx, dy) = (b.x - a.x, b.y - a.y)
    let lengthSquared = dx * dx + dy * dy
    guard lengthSquared > 0 else { return distance(point, a) }
    let t = max(0, min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    return distance(point, CGPoint(x: a.x + t * dx, y: a.y + t * dy))
  }

  /// The standardized rect spanning two opposite corners.
  public static func rect(corners a: CGPoint, _ b: CGPoint) -> CGRect {
    CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))
  }

  /// The smallest rect containing `points` (zero-sized at a single point, null when empty).
  public static func rect(enclosing points: [CGPoint]) -> CGRect {
    guard let first = points.first else { return .null }
    var (minX, minY, maxX, maxY) = (first.x, first.y, first.x, first.y)
    for point in points.dropFirst() {
      (minX, maxX) = (min(minX, point.x), max(maxX, point.x))
      (minY, maxY) = (min(minY, point.y), max(maxY, point.y))
    }
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }
}
