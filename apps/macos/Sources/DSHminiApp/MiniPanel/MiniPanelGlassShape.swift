import AppKit
import SwiftUI

/// A glass shape's frame and corner radius in the lane it is drawn in, animatable as one vector, so
/// the shape's outline and the content that follows it (``MiniPanelFollowEffect``) are interpolated
/// from the same values on every frame and can never drift apart. The body's thickness axis (x,
/// width and the corner) and length axis (y, height) can still move on their own springs: the
/// animation splits the vector (``MiniPanelAxisAnimation``), for the clip and the content; the
/// glass, whose shape `glassEffect(in:)` erases, moves as a whole on the length's.
nonisolated struct MiniPanelGlassRect: VectorArithmetic {
  var x = 0.0
  var y = 0.0
  var width = 0.0
  var height = 0.0
  var corner = 0.0

  init(x: Double = 0, y: Double = 0, width: Double = 0, height: Double = 0, corner: Double = 0) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
    self.corner = corner
  }

  /// `rect`, with `corner`, in the lane at `lane` (both in the same coordinates).
  init(_ rect: CGRect, corner: Double, in lane: CGRect) {
    self.init(
      x: rect.minX - lane.minX, y: rect.minY - lane.minY, width: rect.width, height: rect.height,
      corner: corner)
  }

  var rect: CGRect { CGRect(x: x, y: y, width: width, height: height) }

  static var zero: MiniPanelGlassRect { MiniPanelGlassRect() }

  static func + (lhs: MiniPanelGlassRect, rhs: MiniPanelGlassRect) -> MiniPanelGlassRect {
    MiniPanelGlassRect(
      x: lhs.x + rhs.x, y: lhs.y + rhs.y, width: lhs.width + rhs.width,
      height: lhs.height + rhs.height, corner: lhs.corner + rhs.corner)
  }

  static func - (lhs: MiniPanelGlassRect, rhs: MiniPanelGlassRect) -> MiniPanelGlassRect {
    lhs + rhs.scaled(by: -1)
  }

  mutating func scale(by rhs: Double) {
    x *= rhs
    y *= rhs
    width *= rhs
    height *= rhs
    corner *= rhs
  }

  var magnitudeSquared: Double {
    x * x + y * y + width * width + height * height + corner * corner
  }
}

/// A glass shape's outline: a rounded rectangle at its animated frame in the lane, its corner at
/// most half its shorter side so a squeezed shape stays a capsule; nothing while it has shrunk to
/// nothing. The same value clips the content and draws the glass, so both are always one shape.
struct MiniPanelGlassOutline: Shape {
  var shape: MiniPanelGlassRect

  var animatableData: MiniPanelGlassRect {
    get { shape }
    set { shape = newValue }
  }

  func path(in bounds: CGRect) -> Path {
    guard shape.width > 0, shape.height > 0 else { return Path() }
    let radius = max(0, min(shape.corner, min(shape.width, shape.height) / 2))
    return Path(roundedRect: shape.rect, cornerRadius: radius, style: .continuous)
  }
}

/// Content that follows its glass shape, as the Dynamic Island's does: laid out where the shape
/// rests (`rest`, in the lane), it stays centered on the shape as drawn now and scales with it,
/// to fit inside it, up to ``MiniPanelChoreography/followLimit`` past its rest, so it never shows
/// outside the glass or is cut by its edge. Under Reduce Motion it only moves with the shape's
/// middle, at its own size, and the clip reveals it. Render-only: it takes the same animated
/// vector as the shape's outline, on the same animation.
///
/// Content taller than what shows of it (the rows of a scrolling card) gives `middleY`, the
/// height in it that rests at the shape's middle; otherwise that is its own middle.
struct MiniPanelFollowEffect: GeometryEffect {
  var shape: MiniPanelGlassRect
  let rest: CGRect
  let scales: Bool
  var middleY: Double?

  var animatableData: MiniPanelGlassRect {
    get { shape }
    set { shape = newValue }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    Self.transform(
      following: shape.rect, from: rest, size: size, scales: scales, middleY: middleY)
  }

  /// The transform that takes content of `size`, laid out at `rest` about `middleY` (its own
  /// middle when nil), to `shape`.
  static func transform(
    following shape: CGRect, from rest: CGRect, size: CGSize, scales: Bool,
    middleY: Double? = nil
  ) -> ProjectionTransform {
    guard rest.width > 0, rest.height > 0 else { return ProjectionTransform() }
    let fit = min(shape.width / rest.width, shape.height / rest.height)
    // Never quite nothing: the transform stays invertible for hit testing.
    let scale = scales ? min(max(fit, 0.01), MiniPanelChoreography.followLimit) : 1
    let (middleX, middleY) = (size.width / 2, middleY ?? size.height / 2)
    let transform = CGAffineTransform(
      translationX: middleX + shape.midX - rest.midX, y: middleY + shape.midY - rest.midY
    )
    .scaledBy(x: scale, y: scale)
    .translatedBy(x: -middleX, y: -middleY)
    return ProjectionTransform(transform)
  }
}

/// The hover label's text following its capsule (``MiniPanelLabelPath``) as it grows out of a
/// control, glides from control to control and draws back in: the same animated values as the
/// label's outline, with the text laid out at the label's rest (`layout`).
struct MiniPanelLabelFollowEffect: GeometryEffect {
  var progress: Double
  var rest: CGRect
  var point: CGPoint
  let edge: MiniPanelEdge
  let layout: CGRect
  let scales: Bool

  var animatableData: MiniPanelLabelOutline.AnimatableData {
    get { MiniPanelLabelOutline.data(progress: progress, rest: rest, point: point) }
    set { (progress, rest, point) = MiniPanelLabelOutline.values(newValue, height: rest.height) }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    let shape = MiniPanelLabelPath.rect(progress: progress, rest: rest, point: point, edge: edge)
    return MiniPanelFollowEffect.transform(
      following: shape, from: layout, size: size, scales: scales)
  }
}
