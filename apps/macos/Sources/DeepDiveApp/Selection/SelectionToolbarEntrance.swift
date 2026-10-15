import AppKit
import QuartzCore

/// The selection toolbar's entrance. AppKit's `NSGlassEffectView` has no materialize transition,
/// so the capsule grows out of the selection instead: it scales up from the edge facing the
/// selection while rising ``rise`` points away from it, on a brisk spring without visible
/// overshoot, and turns opaque within the first part of that so the glass never lingers
/// half-faded. With Reduce Motion on it only fades in. There is no exit animation: the toolbar
/// goes at once when the user acts or moves on.
enum SelectionToolbarEntrance {
  /// Pace of the grow, in seconds (perceptual, like SwiftUI's spring duration).
  static let duration = 0.32
  /// Brisk, not visibly bouncy (a presentation without momentum).
  static let bounce = 0.15
  static let startScale = 0.9
  /// How far the capsule starts toward the selection.
  static let rise = 4.0
  static let fadeDuration = 0.16
  static let reducedMotionFade = 0.2

  /// Plays the entrance on `container`'s layer, which holds the capsule at `capsule` (container
  /// coordinates) inside the window's transparent margin. `upward`: the toolbar sits above what
  /// it belongs to, so it grows from its bottom edge.
  @MainActor
  static func play(on container: NSView, capsule: NSRect, upward: Bool) {
    guard let layer = container.layer else { return }
    layer.removeAllAnimations()
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      layer.add(fade(duration: reducedMotionFade, timing: .easeInEaseOut), forKey: "entrance.fade")
      return
    }
    // A sublayer transform acts about the layer's anchor point, which AppKit puts at a view
    // layer's origin rather than its center: the pivot is measured from there.
    let anchor = CGPoint(
      x: layer.anchorPoint.x * layer.bounds.width, y: layer.anchorPoint.y * layer.bounds.height)
    let edge = CGPoint(x: capsule.midX, y: upward ? capsule.minY : capsule.maxY)
    let grow = CASpringAnimation(perceptualDuration: duration, bounce: bounce)
    grow.keyPath = "sublayerTransform"
    grow.fromValue = NSValue(
      caTransform3D: startTransform(
        pivot: CGPoint(x: edge.x - anchor.x, y: edge.y - anchor.y), upward: upward))
    grow.toValue = NSValue(caTransform3D: CATransform3DIdentity)
    layer.add(grow, forKey: "entrance.grow")
    layer.add(fade(duration: fadeDuration, timing: .easeOut), forKey: "entrance.fade")
  }

  /// Scaled by ``startScale`` about `pivot` (relative to the layer's anchor point, y up), the
  /// middle of the edge facing the selection, and moved ``rise`` toward the selection.
  static func startTransform(pivot: CGPoint, upward: Bool) -> CATransform3D {
    let shift = upward ? -rise : rise
    var transform = CATransform3DMakeTranslation(pivot.x, pivot.y + shift, 0)
    transform = CATransform3DScale(transform, startScale, startScale, 1)
    return CATransform3DTranslate(transform, -pivot.x, -pivot.y, 0)
  }

  private static func fade(duration: Double, timing: CAMediaTimingFunctionName)
    -> CABasicAnimation
  {
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0
    fade.toValue = 1
    fade.duration = duration
    fade.timingFunction = CAMediaTimingFunction(name: timing)
    return fade
  }
}
