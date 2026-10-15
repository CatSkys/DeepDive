import CoreGraphics

/// The body's velocity stretch while its window moves (motion-v2): the shape, never its content,
/// lengthens along the motion by up to ``maximum`` and narrows across it by half that, in
/// proportion to the speed up to ``fullSpeed``, so a flung panel reads as liquid. The shape stays
/// axis-aligned: a diagonal motion stretches both axes a little rather than shearing the shape.
public enum MiniPanelStretch {
  public static let maximum = 0.08
  /// Points per second at which the stretch is full.
  public static let fullSpeed = 3000.0

  /// How much of the stretch a speed earns: 0 at rest, 1 at ``fullSpeed`` or faster.
  public static func intensity(speed: Double) -> Double {
    guard speed.isFinite, speed > 0 else { return 0 }
    return min(speed / fullSpeed, 1)
  }

  /// The share of a motion that runs along x (1 horizontal, 0 vertical, 0.5 diagonal); nil for no
  /// motion, which has no direction.
  public static func horizontalShare(_ velocity: CGVector) -> Double? {
    let (x, y) = (Double(velocity.dx * velocity.dx), Double(velocity.dy * velocity.dy))
    guard x + y > 0 else { return nil }
    return x / (x + y)
  }

  /// The shape's scale on each axis at `intensity`, moving with `horizontalShare` of its motion
  /// along x.
  public static func factors(intensity: Double, horizontalShare share: Double)
    -> (x: Double, y: Double)
  {
    let intensity = min(max(intensity, 0), 1)
    let share = min(max(share, 0), 1)
    let (along, across) = (maximum, -maximum / 2)
    return (
      x: 1 + intensity * (along * share + across * (1 - share)),
      y: 1 + intensity * (along * (1 - share) + across * share)
    )
  }

  /// The shape's scale for a body moving at `velocity` points per second.
  public static func factors(velocity: CGVector) -> (x: Double, y: Double) {
    guard let share = horizontalShare(velocity) else { return (1, 1) }
    let speed = Double((velocity.dx * velocity.dx + velocity.dy * velocity.dy).squareRoot())
    return factors(intensity: intensity(speed: speed), horizontalShare: share)
  }
}
