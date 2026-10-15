import AppKit
import SwiftUI

/// The commands card's glass: closed, it has shrunk to nothing in the Commands button's middle; it
/// grows out of there to the card's frame on its own animation, and its rows, laid out where the
/// open card rests, ride inside it, centered in it and scaled with it (``MiniPanelFlyout``), so
/// they open out of the button with the card. It is drawn in a fixed lane that holds the card
/// and every body shape it closes into, so its frames lay nothing out again while it opens or
/// closes (perf-v1).
struct MiniPanelCard: View {
  let model: MiniPanelModel

  var body: some View {
    let card = model.card
    let lane = model.cardLane
    let rows = model.frame(.rows).offsetBy(dx: -lane.minX, dy: -lane.minY)
    let shape = MiniPanelGlassRect(card.frame, corner: MiniPanelMetrics.cardRadius, in: lane)
    let outline = MiniPanelGlassOutline(shape: shape)
    MiniPanelFlyout(model: model, card: shape, rest: rows, animation: card.animation)
      .frame(width: rows.width, height: rows.height)
      .animation(nil) { $0.offset(x: rows.minX, y: rows.minY) }
      .frame(width: lane.width, height: lane.height, alignment: .topLeading)
      .animation(card.animation) { $0.clipShape(outline).glassEffect(.regular, in: outline) }
      .offset(x: lane.minX, y: lane.minY)
      .allowsHitTesting(model.flyoutOpen)
      .accessibilityHidden(!model.flyoutOpen)
  }
}

/// The hover label (hover-label-v2): a small capsule of the same glass that grows out of the
/// hovered control's middle, glides from control to control, and draws back into that middle
/// (``MiniPanelLabelPath``). Its text rides inside it on the same animated values
/// (``MiniPanelLabelFollowEffect``): it grows out of the control with the capsule, glides with it,
/// swapping through a blur, and shows only through its own presence, so the label hides by
/// fading its text and drawing its shape in, never by an effect over the glass. Visual only:
/// VoiceOver reads the controls' own labels.
///
/// It is drawn in a fixed lane beside the shape it belongs to, so its frames lay nothing out
/// again (perf-v1): only its outline (a shape) and its text's transform move.
struct MiniPanelLabelView: View {
  let model: MiniPanelModel

  var body: some View {
    let label = model.label
    let lane = label.lane
    // A glide swaps its text on its own animation; a hidden label swaps it at once.
    let swap = MiniPanelChoreography.labelGlide.reduced(model.reduceMotion).animation
    let rest = label.rest.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let point = CGPoint(x: label.point.x - lane.minX, y: label.point.y - lane.minY)
    let outline = MiniPanelLabelOutline(
      progress: label.progress, rest: rest, point: point, edge: model.edge)
    let follow = MiniPanelLabelFollowEffect(
      progress: label.progress, rest: rest, point: point, edge: model.edge, layout: rest,
      scales: !model.reduceMotion)
    // A text swapped by a plain write would drop the leaving one at once: one text interpolates
    // into the next instead, through a blur, on the glide's animation.
    Text(verbatim: label.text)
      .font(.system(size: MiniPanelMetrics.labelTextSize, weight: .medium))
      .lineLimit(1)
      .truncationMode(.tail)
      .foregroundStyle(.primary)
      .contentTransition(.interpolate)
      .animation(label.drawn ? swap : nil, value: label.text)
      .padding(.horizontal, MiniPanelMetrics.labelPadding)
      .animation(nil) { $0.frame(width: rest.width, height: rest.height) }
      .animation(label.animation) { $0.modifier(follow) }
      .modifier(MiniPanelPresenceEffect(presence: model.presence(.labelText)))
      .animation(nil) { $0.offset(x: rest.minX, y: rest.minY) }
      .frame(width: lane.width, height: lane.height, alignment: .topLeading)
      .animation(label.animation) { $0.clipShape(outline).glassEffect(.regular, in: outline) }
      .offset(x: lane.minX, y: lane.minY)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// The label's outline at its animated progress, in its lane: SwiftUI interpolates the progress,
/// the rest and the control's middle, and only this shape's path is drawn again on each frame.
/// Its text's transform (``MiniPanelLabelFollowEffect``) takes the same values.
struct MiniPanelLabelOutline: Shape {
  typealias AnimatableData = AnimatablePair<
    AnimatablePair<Double, Double>,
    AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>>
  >

  var progress: Double
  var rest: CGRect
  var point: CGPoint
  let edge: MiniPanelEdge

  var animatableData: AnimatableData {
    get { Self.data(progress: progress, rest: rest, point: point) }
    set { (progress, rest, point) = Self.values(newValue, height: rest.height) }
  }

  /// The progress, the rest (its height is fixed) and the control's middle as one vector.
  static func data(progress: Double, rest: CGRect, point: CGPoint) -> AnimatableData {
    AnimatablePair(
      AnimatablePair(progress, rest.minX),
      AnimatablePair(AnimatablePair(rest.minY, rest.width), AnimatablePair(point.x, point.y)))
  }

  /// The values ``data(progress:rest:point:)`` holds, with the rest `height` tall.
  static func values(_ data: AnimatableData, height: Double) -> (Double, CGRect, CGPoint) {
    let rest = CGRect(
      x: data.first.second, y: data.second.first.first, width: data.second.first.second,
      height: height)
    return (
      data.first.first, rest, CGPoint(x: data.second.second.first, y: data.second.second.second)
    )
  }

  func path(in rect: CGRect) -> Path {
    let shape = MiniPanelLabelPath.rect(progress: progress, rest: rest, point: point, edge: edge)
    guard shape.width > 0, shape.height > 0 else { return Path() }
    return Path(roundedRect: shape, cornerRadius: min(shape.width, shape.height) / 2)
  }
}

/// A drag session's drop zone with the body's resting shape cut out (even-odd fill).
struct MiniPanelZoneShape: Shape {
  let zone: MiniPanelDropZone

  func path(in rect: CGRect) -> Path {
    var path = Path(zone.zone)
    let radius = min(zone.corner, min(zone.hole.width, zone.hole.height) / 2)
    path.addRoundedRect(
      in: zone.hole, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
    return path
  }
}
