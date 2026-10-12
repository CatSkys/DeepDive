import AppKit
import SwiftUI

/// The mini panel's motion as SwiftUI runs it (perf-v1, motion-v3). The values are
/// ``MiniPanelChoreography``'s; SwiftUI interpolates every shape, factor and look, so nothing is
/// written while anything moves, and only the window's snap is stepped on the display link.
///
/// Every write is plain, in no transaction of its own: each value carries the animation it moves
/// on (nil for a jump), which the views apply as scoped animations. Writes made together share
/// one transaction, so SwiftUI updates once for them; a write in another transaction (such as
/// `withAnimation`) would make it update for the earlier ones at once, on the spot.
enum MiniPanelMotion {
  /// The shortest wait that lets a change made now be drawn before an animation starts from it.
  static let frame = 1.0 / 60

  /// How long `spring` takes to come to rest, as SwiftUI runs it.
  static func settling(_ spring: MiniPanelSpring) -> Double { spring.spring.settlingDuration }
}

nonisolated extension MiniPanelSpring {
  var animation: Animation { .spring(duration: duration, bounce: bounce) }
  var spring: Spring { Spring(duration: duration, bounce: bounce) }
}

extension MiniPanelCurve {
  var animation: Animation {
    switch self {
    case .spring(let spring): spring.animation
    case .easeIn(let duration): .easeIn(duration: duration)
    case .easeOut(let duration): .easeOut(duration: duration)
    }
  }
}

extension MiniPanelShapeMotion {
  /// The body's shape moving as one value, each axis on its own spring.
  var animation: Animation { Animation(MiniPanelAxisAnimation(motion: self)) }
}

/// Runs a body shape's change (``MiniPanelGlassRect``) with its thickness (x, width and corner)
/// and its length (y, height) each on their own spring after their own delay
/// (``MiniPanelShapeMotion``). One animation over one vector, so the glass, its clip and the
/// content following it are interpolated together. A change made while one runs adds to it, as
/// SwiftUI combines animations that do not merge, which for springs is the same as retargeting
/// them with their velocity.
///
/// The clip and the content get the shape itself and move per axis. `glassEffect(in:)` erases
/// the shape it is given, so the glass's change arrives as opaque data, which moves as a whole on
/// the length's spring. Drawing the glass from a per-axis shape every frame instead (an animatable
/// modifier) costs about 1 ms more of the main thread per frame, measured: SwiftUI interpolates
/// the erased shape without updating the view graph.
///
/// A change ends once it can no longer move anything by more than ``restTolerance`` (perf-v2):
/// SwiftUI's own estimate for a spring at rest runs a bouncy spring's sub-pixel tail, redrawing
/// the glass on every frame for a few hundred milliseconds after the last visible motion. The jump
/// to rest is under a pixel, so ending there cannot be seen.
nonisolated struct MiniPanelAxisAnimation: CustomAnimation {
  /// The most, in points, a shape's change still has to go when it ends: half a pixel on Retina.
  static let restTolerance = 0.25

  let motion: MiniPanelShapeMotion

  func animate<V: VectorArithmetic>(
    value: V, time: TimeInterval, context: inout AnimationContext<V>
  ) -> V? {
    let (thickness, length) = (motion.thickness.spring, motion.length.spring)
    let settles = max(
      motion.thicknessDelay + thickness.settlingDuration,
      motion.lengthDelay + length.settlingDuration)
    guard time < settles else { return nil }
    let across = Self.progress(thickness, after: motion.thicknessDelay, at: time)
    let along = Self.progress(length, after: motion.lengthDelay, at: time)
    // The glass's erased shape, or anything else in the scope, moves with the length as a whole,
    // its change in points at most its magnitude.
    guard let shape = value as? MiniPanelGlassRect else {
      let change = value.magnitudeSquared.squareRoot()
      guard !Self.rests(length, after: motion.lengthDelay, change: change, at: time) else {
        return nil
      }
      return value.scaled(by: along)
    }
    let change = Self.change(of: shape)
    guard !Self.rests(motion, across: change.across, along: change.along, at: time) else {
      return nil
    }
    let moved = MiniPanelGlassRect(
      x: shape.x * across, y: shape.y * along, width: shape.width * across,
      height: shape.height * along, corner: shape.corner * across)
    return moved as? V
  }

  /// How long `motion` takes to end for a change of `across` points across the edge and `along`
  /// points along it, as it runs on the body.
  static func restTime(_ motion: MiniPanelShapeMotion, across: Double, along: Double) -> Double {
    let step = 1.0 / 240
    var time = 0.0
    while time < motion.settles * 4, !rests(motion, across: across, along: along, at: time) {
      time += step
    }
    return time
  }

  /// Whether neither axis of `motion`, changing by `across` and `along` points, can move the
  /// shape by more than ``restTolerance`` from `time` on.
  private static func rests(
    _ motion: MiniPanelShapeMotion, across: Double, along: Double, at time: Double
  ) -> Bool {
    rests(motion.thickness.spring, after: motion.thicknessDelay, change: across, at: time)
      && rests(motion.length.spring, after: motion.lengthDelay, change: along, at: time)
  }

  /// The spring's remaining energy, its distance from rest and its speed over its frequency, which
  /// bounds every swing still to come, as a share of the change, against the tolerance.
  private static func rests(
    _ spring: Spring, after delay: Double, change: Double, at time: Double
  ) -> Bool {
    guard change > restTolerance else { return true }
    guard time > delay else { return false }
    let left = 1 - spring.value(target: 1.0, time: time - delay)
    let speed = spring.velocity(target: 1.0, time: time - delay) / (2 * .pi / spring.duration)
    return (left * left + speed * speed).squareRoot() * change <= restTolerance
  }

  /// How far a shape's change moves it across the edge (x, width, corner) and along it (y, height).
  private static func change(of shape: MiniPanelGlassRect) -> (across: Double, along: Double) {
    (
      max(abs(shape.x), abs(shape.x + shape.width), abs(shape.corner)),
      max(abs(shape.y), abs(shape.y + shape.height))
    )
  }

  /// How far along a unit change `spring` is `time` seconds in, once `delay` has passed.
  private static func progress(_ spring: Spring, after delay: Double, at time: Double) -> Double {
    time <= delay ? 0 : spring.value(target: 1.0, time: time - delay)
  }
}

/// The mini panel's glyphs (spec v1, Material). Functional glyphs are Lucide template image sets
/// in the App target's asset catalog (`App/Assets.xcassets/MiniPanel/lucide-<name>.imageset`;
/// Ask reuses the selection toolbar's `Selection/lucide-sparkles`), found in the main bundle by
/// `NSImage(named:)` like ``AnnotationIcons``'s; outside the app bundle (`swift run`, tests) they
/// are missing and the controls keep their labels. They match the renderer's: New task
/// `square-pen`, Screenshot `camera` (the composer's screenshot), Commands `command` (the
/// settings Commands section), the drop `file-plus` (the panel's drop overlay).
///
/// Source: the icon nodes of `lucide-react` 1.49.0 (ISC), the version pinned in
/// `pnpm-workspace.yaml`, written out as unmodified 24 × 24 SVGs.
///
/// The Atd mark is the status item's own template image (``StatusItemController``), its idle
/// mark: the Debug build's wider `DevTemplate` adds a DEV label that would not fit a button.
enum MiniPanelIcons {
  static let newTask = "square-pen"
  static let ask = "sparkles" // adapted：Atd 复用选区工具栏的 ask 图形名；划词 P2，动作空接
  static let screenshot = "camera"
  static let commands = "command"
  static let drop = "file-plus"

  static func glyph(for control: MiniPanelControl) -> NSImage {
    switch control {
    case .mark:
      // adapted：Atd 的 idleTemplate（状态项品牌图）→ 本项目 BrandMark 的 D 剪影。
      let base = BrandMark.image
      let image = (base.copy() as? NSImage) ?? base
      image.isTemplate = true
      return image
    case .newTask: return glyph(newTask)
    case .ask: return glyph(ask)
    case .screenshot: return glyph(screenshot)
    case .commands, .row: return glyph(commands)
    }
  }

  /// The Lucide glyph `name`, a template image.
  static func glyph(_ name: String) -> NSImage {
    NSImage(named: "lucide-\(name)") ?? NSImage(size: NSSize(width: 16, height: 16))
  }
}
