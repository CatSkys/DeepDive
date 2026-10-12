import CoreGraphics

/// A display the mini panel can rest on: its UUID (nil when the system gives none), its full
/// frame and its work area, in AppKit's y-up global points.
public struct MiniPanelDisplay: Equatable, Sendable {
  public let id: String?
  public let frame: ScreenRect
  public let workArea: ScreenRect

  public init(id: String?, frame: ScreenRect, workArea: ScreenRect) {
    self.id = id
    self.frame = frame
    self.workArea = workArea
  }
}

/// Where a released drag of the mini panel comes to rest. The release carries on as a flick
/// would: the pointer's velocity over its last ``sampleWindow`` is projected forward by
/// ``projectionTime`` (UIScrollView's normal deceleration, 0.998 per millisecond, comes to rest
/// after v × 0.998 / 0.002 ms). The display is the one holding the projected point, else the
/// nearest; the edge is the nearer side of its work area; the height is the projected point's,
/// kept so the pill stays inside the work area.
public enum MiniPanelSnap {
  public static let projectionTime = 0.499
  /// How much of the drag's end the release velocity is measured over, in seconds.
  public static let sampleWindow = 0.08

  /// The pointer during a drag, at a time in seconds on any steady clock.
  public struct Sample: Equatable, Sendable {
    public let time: Double
    public let point: CGPoint

    public init(time: Double, point: CGPoint) {
      self.time = time
      self.point = point
    }
  }

  /// Points per second over the samples of the last ``sampleWindow`` before the release at
  /// `time`, where the pointer is `point`. A pointer that rested before the release has no
  /// recent samples and so no velocity.
  public static func velocity(of samples: [Sample], releasedAt time: Double, point: CGPoint)
    -> CGVector
  {
    let recent = samples.filter { $0.time >= time - sampleWindow && $0.time <= time }
    guard let first = recent.first else { return .zero }
    let elapsed = time - first.time
    guard elapsed > 0.004 else { return .zero }
    return CGVector(
      dx: (point.x - first.point.x) / elapsed, dy: (point.y - first.point.y) / elapsed)
  }

  /// Where the panel's center would come to rest if it carried on with `velocity`.
  public static func projected(_ point: CGPoint, velocity: CGVector) -> CGPoint {
    CGPoint(
      x: point.x + velocity.dx * projectionTime, y: point.y + velocity.dy * projectionTime)
  }

  /// The display (an index into `displays`) and placement a release whose projected center is
  /// `point` comes to rest at; nil without displays.
  public static func target(for point: CGPoint, in displays: [MiniPanelDisplay])
    -> (display: Int, placement: MiniPanelPlacement)?
  {
    guard
      let index = DisplaySelection.index(
        nearestTo: Double(point.x), Double(point.y), in: displays.map(\.frame))
    else { return nil }
    let workArea = displays[index].workArea
    let x = Double(point.x)
    let edge: MiniPanelEdge = abs(x - workArea.x) <= abs(workArea.maxX - x) ? .left : .right
    let position = MiniPanelLayout.position(ofPillCenterY: Double(point.y), in: workArea)
    return (index, MiniPanelPlacement(edge: edge, position: position))
  }
}
