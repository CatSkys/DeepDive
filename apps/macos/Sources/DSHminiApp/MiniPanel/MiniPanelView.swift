import AppKit
import SwiftUI

/// The mini panel as drawn (spec v1 Material, surface-v2, motion-v3, perf-v1): every piece in one
/// `GlassEffectContainer` on the same untinted regular Liquid Glass, so the pieces read as one
/// material and merge as they emerge from one another. The container covers only where glass can
/// be (``MiniPanelLayout/glassRegion``), never the whole transparent canvas.
///
/// Nothing here is written while it moves: every value carries its own animation and the views
/// apply them as scoped animations, so SwiftUI interpolates them and each axis, factor and look
/// keeps its own curve whichever change redraws it. Each piece is drawn in a fixed lane, and its
/// glass, its clip and the content riding inside it all take one animated value, so each frame of
/// an animation updates only render effects, never a layout or a view body, and the content can
/// never drift outside its glass. Buttons and rows sit plain on the glass with neutral washes,
/// never glass on glass; a state shows through shape and content alone.
///
/// No piece carries a `glassEffectID`: none is ever inserted or removed, so no glass transition
/// has anything to match; the container blends the pieces by their distance alone.
struct MiniPanelView: View {
  let model: MiniPanelModel

  /// Below the 8 pt gaps at rest, so the card and the label stand apart from the capsule, while
  /// they still merge with it as they grow out of it and draw back into it.
  static let glassSpacing = 6.0

  var body: some View {
    let region = model.glassFrame
    GlassEffectContainer(spacing: Self.glassSpacing) {
      ZStack(alignment: .topLeading) {
        if let zone = model.dropZone {
          // Invisible, but drawn: the window server gives a drag's release to drawn pixels only,
          // so a drop anywhere in the magnet's reach lands on the panel (as DesktopDropCatcher's).
          // The body's own shape is cut out of it, so nothing lies under the glass.
          MiniPanelZoneShape(zone: zone)
            .fill(Color.black.opacity(1.0 / 255), style: FillStyle(eoFill: true))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        if model.phase == .tucked, let zone = model.clickZone {
          // Invisible, but drawn, as the drop zone is: opening on click, the window server gives
          // the panel a click anywhere the pill swells for, the screen edge included.
          Rectangle()
            .fill(Color.black.opacity(1.0 / 255))
            .frame(width: zone.width, height: zone.height)
            .offset(x: zone.minX, y: zone.minY)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        if model.phase != .hidden {
          MiniPanelBody(model: model)
        }
        MiniPanelCard(model: model)
        MiniPanelLabelView(model: model)
      }
      .frame(width: region.width, height: region.height, alignment: .topLeading)
    }
    .offset(x: region.minX, y: region.minY)
    .frame(width: model.canvas.width, height: model.canvas.height, alignment: .topLeading)
  }
}

/// The body glass: one living shape in its fixed lane (``MiniPanelModel/bodyLane``), its
/// thickness and length on their own springs (``MiniPanelAxisAnimation``). Each content is laid
/// out where its shape rests and follows the shape as drawn (``MiniPanelFollowEffect``), centered
/// in it and scaled with it, inside the clip, before the glass, which the container draws from
/// the same shape.
///
/// The press's squish and the drag's lift scale glass and content alike; the release's stretch
/// and the drop's squash deform the glass alone, the content following the shape without them.
/// All of them are drawn into the shape, about its middle (``MiniPanelBodyShape/drawn(_:)``),
/// never as transforms: in the glass container a glass view's scale is dropped and only its
/// translation kept (macOS 26), so a scaled body would slide aside rather than squish. Each
/// change moves on its own animation, which the shape carries, and only shapes and render effects
/// change from frame to frame, so nothing lays out again (perf-v1).
private struct MiniPanelBody: View {
  let model: MiniPanelModel

  var body: some View {
    let lane = model.bodyLane
    let shape = model.body
    let local = shape.frame.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let factors = model.bodyFactors
    let outline = MiniPanelGlassOutline(
      shape: MiniPanelGlassRect(
        shape.drawn(model.reduceMotion ? MiniPanelBodyFactors() : factors), corner: shape.corner,
        in: lane))
    MiniPanelBodyContent(model: model)
      .frame(width: lane.width, height: lane.height, alignment: .topLeading)
      .overlay(alignment: .topLeading) {
        if model.phase == .tucked {
          MiniPanelPill(model: model)
            .frame(width: local.width, height: local.height)
            .offset(x: local.minX, y: local.minY)
        }
      }
      .animation(shape.animation) { $0.clipShape(outline).glassEffect(.regular, in: outline) }
      .offset(x: lane.minX, y: lane.minY)
      .animation(factors.shiftAnimation) { $0.offset(factors.shift) }
  }
}

/// Every content of every body shape, mounted for good, each laid out where its shape rests (in
/// the lane) and following the body as drawn, arriving and leaving on its own presence.
private struct MiniPanelBodyContent: View {
  let model: MiniPanelModel

  var body: some View {
    ZStack(alignment: .topLeading) {
      MiniPanelPillFill(model: model)
        .frame(width: model.bodyLane.width, height: model.bodyLane.height)
      layer(.capsule) { MiniPanelCapsule(model: model) }
      layer(.invite) { MiniPanelInvite(model: model) }
      layer(.card) { MiniPanelDropCard(model: model) }
    }
  }

  private func layer<Content: View>(
    _ content: MiniPanelContent, @ViewBuilder _ view: () -> Content
  ) -> some View {
    let lane = model.bodyLane
    let shape = model.body
    let frame = model.frame(content).offsetBy(dx: -lane.minX, dy: -lane.minY)
    // The content takes the squish and the lift with the glass, but not its deformation.
    let factors = MiniPanelBodyFactors(scale: model.reduceMotion ? 1 : model.bodyFactors.scale)
    let follow = MiniPanelFollowEffect(
      shape: MiniPanelGlassRect(shape.drawn(factors), corner: shape.corner, in: lane),
      rest: frame, scales: !model.reduceMotion)
    let active = model.activeContent == content
    return view()
      .frame(width: frame.width, height: frame.height)
      .animation(shape.animation) { $0.modifier(follow) }
      .modifier(MiniPanelPresenceEffect(presence: model.presence(content)))
      .animation(nil) { $0.offset(x: frame.minX, y: frame.minY) }
      .allowsHitTesting(active)
      .accessibilityHidden(!active)
  }
}

/// The resting pill's tone (pill-v2): bare glass this thin has almost nothing to refract over a
/// flat window and all but disappears, so the pill and its swell are filled with a neutral tone
/// that the body's outline clips, following every frame of its glass. It leaves as the pill opens,
/// as the capsule's controls would, and returns once the body has all but drawn back into the
/// pill, so every other shape keeps its bare glass.
private struct MiniPanelPillFill: View {
  let model: MiniPanelModel
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    let resting = model.phase == .tucked || model.phase == .draggingPill
    let level = contrast == .increased ? 0.4 : MiniPanelChoreography.pillFillLevel
    Rectangle()
      .fill(Color.primary.opacity(level))
      .modifier(
        MiniPanelPresenceEffect(
          presence: MiniPanelPresence(shown: resting, motion: MiniPanelChoreography.pillFill))
      )
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// Content arriving or leaving (motion-v3): its opacity and its blur together, after the
/// arrival's delay; its size follows its shape. The blur is applied to the content alone, never
/// to the glass, and is gone at rest.
struct MiniPanelPresenceEffect: ViewModifier {
  let presence: MiniPanelPresence

  func body(content: Content) -> some View {
    let (shown, motion) = (presence.shown, presence.motion)
    let arrive = MiniPanelChoreography.contentOpacity.animation.delay(motion.delay)
    let leave = Animation.easeIn(duration: motion.exit)
    content
      .animation(shown ? arrive : leave) {
        $0.blur(radius: shown ? 0 : motion.hiddenBlur).opacity(shown ? 1 : 0)
      }
  }
}

/// The resting pill: one element for VoiceOver, a button named for the panel that opens it,
/// with the capsule's actions as its own so they need no expansion. It is sized to the body. A
/// click on it opens the panel through the window, which takes it rather than SwiftUI
/// (``MiniPanelController``'s `click(_:)`).
private struct MiniPanelPill: View {
  let model: MiniPanelModel

  var body: some View {
    Color.clear
      .accessibilityElement()
      .accessibilityLabel(Text(verbatim: model.labels.panel))
      .accessibilityAddTraits(.isButton)
      .accessibilityAction { model.expand() }
      .accessibilityAction(named: Text(verbatim: model.markLabel)) { model.perform(.mark) }
      .accessibilityAction(named: Text(verbatim: model.labels.newTask)) {
        model.perform(.newTask)
      }
      .accessibilityAction(named: Text(verbatim: model.labels.ask)) { model.perform(.ask) }
      .accessibilityAction(named: Text(verbatim: model.labels.screenshot)) {
        model.perform(.screenshot)
      }
      .accessibilityIdentifier("miniPanel.pill")
  }
}
