import AppKit
import QuartzCore
import SwiftUI

/// Dragging the mini panel and its spring to rest (spec v1 Geometry, motion-v2, perf-v1): the
/// capsule, or the tucked pill as it is, lifts and follows the pointer 1:1 (``MiniPanelWindow``
/// moves itself), and a release decides where it comes to rest from the pointer's velocity
/// (``MiniPanelSnap``), then springs there. Only the window's origin is stepped on the display
/// link; the release's stretch and the body's own motion are SwiftUI animations set once.
extension MiniPanelController {
  /// A press on the pill or the capsule travelled: it lifts and follows the pointer as it is. The
  /// pill stays tucked, any swell under the pointer relaxing, and never opens on the way.
  func dragBegan() {
    snap = nil
    snapInterrupted = false
    if model.phase == .tucked {
      hover.reset()
      openStartedAt = nil
      morphBody(
        to: .pill,
        motion: MiniPanelChoreography.shape(.relax, reduceMotion: model.reduceMotion))
      transition(to: .draggingPill, trigger: "drag")
    } else {
      transition(to: .dragging, trigger: "drag")
    }
    setLifted(true)
    setCursor(.closedHand)
  }

  /// The drag's release: the capsule carries on with the pointer's velocity to the display,
  /// edge and height ``MiniPanelSnap`` projects, and springs there.
  func dragEnded(_ samples: [MiniPanelSnap.Sample]) {
    let velocity = MiniPanelSnap.velocity(
      of: samples, releasedAt: ProcessInfo.processInfo.systemUptime,
      point: NSEvent.mouseLocation)
    let body = drawnBody
    let projected = MiniPanelSnap.projected(
      CGPoint(x: body.midX, y: body.midY), velocity: velocity)
    let screens = NSScreen.screens
    let displays = screens.map {
      MiniPanelDisplay(
        id: $0.displayUUID, frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame))
    }
    guard let target = MiniPanelSnap.target(for: projected, in: displays) else {
      return transition(to: dragRest, trigger: "release")
    }
    settle(
      at: target.placement, on: screens[target.display], velocity: velocity, trigger: "release")
  }

  /// The context menu's Move to Left Edge or Move to Right Edge: the same display and height.
  func move(to edge: MiniPanelEdge) {
    guard let screen = screen(), model.phase == .tucked || model.phase == .expanded else { return }
    if model.flyoutOpen { closeFlyout(trigger: "move") }
    settle(
      at: MiniPanelPlacement(edge: edge, position: placement.position), on: screen,
      velocity: .zero, trigger: "menu")
  }

  /// Decides where the panel rests (saved for next time) and springs the window there, carrying
  /// `velocity`, with the release's stretch. Everything takes its place in the new canvas at once,
  /// the body shifted to where it is drawn now should its place in the canvas change (the canvas
  /// stays on its display, so the edge, the display and the height all move it); the shift then
  /// springs out with the window, so on screen it moves as one. A drag rests in the state it
  /// began in; the rest keep their state.
  private func settle(
    at placement: MiniPanelPlacement, on screen: NSScreen, velocity: CGVector, trigger: String
  ) {
    guard let window else { return }
    let shown = drawnBody
    self.placement = placement
    display = screen.displayUUID
    settings.save(placement, display: display)
    guard let layout = makeLayout(on: screen) else { return }
    self.layout = layout
    NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
    let (edge, position, displayID) = (
      placement.edge.rawValue, placement.position, display ?? "none"
    )
    Self.log.info(
      """
      Mini panel snaps to display \(displayID, privacy: .public), \(edge, privacy: .public) edge, \
      position \(position, format: .fixed(precision: 3), privacy: .public) \
      (\(trigger, privacy: .public))
      """)
    let resting = model.phase.isDragging ? dragRest : model.phase
    let shift = hold(shown, as: Self.shape(for: resting), in: layout)
    applyLayout()
    let snap = MiniPanelChoreography.snap.reduced(model.reduceMotion)
    if shift != .zero {
      // The held place is drawn first; the shift then springs out with the window.
      Task { [weak self] in
        try? await Task.sleep(for: .seconds(MiniPanelMotion.frame))
        guard let self, model.bodyFactors.shift == shift else { return }
        model.bodyFactors.shift = .zero
        model.bodyFactors.shiftAnimation = snap.animation
      }
    }
    stretch(velocity)
    self.snap = MiniPanelSnapMotion(
      spring: snap.spring, origin: window.frame.origin, velocity: velocity,
      rest: CGPoint(x: layout.canvas.x, y: layout.canvas.y), at: CACurrentMediaTime())
    pointer.wake()
    if model.phase.isDragging { transition(to: dragRest, trigger: trigger) }
  }

  /// Where a drag comes to rest: a dragged pill tucked, a dragged capsule open.
  private var dragRest: MiniPanelPhase {
    model.phase == .draggingPill ? .tucked : .expanded
  }

  /// Moves the glass container to its place for `layout` and the body to its rest as `shape`, at
  /// once, shifted to where the body is on screen now (`shown`, with the window where it is).
  /// Returns that shift.
  private func hold(
    _ shown: NSRect, as shape: MiniPanelShape?, in layout: MiniPanelLayout
  ) -> CGSize {
    guard let window, let shape, let rest = restRect(of: shape) else { return .zero }
    let glass = Self.glassFrame(of: layout)
    let origin = window.frame.origin
    let held = CGPoint(
      x: shown.minX - origin.x - glass.minX,
      y: model.canvas.height - (shown.maxY - origin.y) - glass.minY)
    let shift = CGSize(width: held.x - rest.minX, height: held.y - rest.minY)
    model.glassFrame = glass
    model.bodyFactors.shift = shift
    model.bodyFactors.shiftAnimation = nil
    placeBody(shape)
    return shift
  }

  /// The release's velocity stretches the glass along its motion (``MiniPanelStretch``) at once,
  /// then relaxes it without overshoot; never with Reduce Motion.
  private func stretch(_ velocity: CGVector) {
    guard !model.reduceMotion else { return }
    let factors = MiniPanelStretch.factors(velocity: velocity)
    guard factors.x != 1 || factors.y != 1 else { return }
    deformToken += 1
    let token = deformToken
    let rise = MiniPanelChoreography.stretchRise
    deform(CGSize(width: factors.x, height: factors.y), rise.animation)
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(rise.duration))
      guard let self, token == deformToken else { return }
      deform(CGSize(width: 1, height: 1), MiniPanelChoreography.stretchRelax.animation)
    }
  }

  /// A press that stopped the snap mid-flight was only a click: the panel goes on to the same
  /// rest from where it is, from a standstill.
  func resumeSnap() {
    snapInterrupted = false
    guard let window, let layout else { return }
    let snap = MiniPanelChoreography.snap.reduced(model.reduceMotion)
    self.snap = MiniPanelSnapMotion(
      spring: snap.spring, origin: window.frame.origin, velocity: .zero,
      rest: CGPoint(x: layout.canvas.x, y: layout.canvas.y), at: CACurrentMediaTime())
    pointer.wake()
  }

  /// One display frame of the snap; once it rests, the frames it took are logged, so a hitch
  /// shows in the log.
  func stepSnap(_ elapsed: Double, at now: Double) {
    guard var motion = snap, let window else { return }
    let settled = motion.step(elapsed)
    snap = settled ? nil : motion
    window.setFrameOrigin(motion.origin)
    guard settled else { return }
    let (frames, longest) = (motion.frames, motion.longestFrame * 1000)
    let duration = now - motion.startedAt
    Self.log.info(
      """
      Mini panel snap settled after \(duration, format: .fixed(precision: 3), privacy: .public) s: \
      \(frames, privacy: .public) frames, longest \
      \(longest, format: .fixed(precision: 1), privacy: .public) ms
      """)
  }
}

/// The window springing to rest (motion-v2: snap after release), its origin stepped on every
/// display frame by `SwiftUI.Spring` from the release's velocity, using the display link's frame
/// times. It counts the frames and the longest gap between them.
struct MiniPanelSnapMotion {
  /// The longest a snap runs, should the spring not come to rest.
  static let limit = 3.0

  private let spring: Spring
  private var value: AnimatablePair<Double, Double>
  private var velocity: AnimatablePair<Double, Double>
  private let rest: AnimatablePair<Double, Double>
  let startedAt: Double
  private var elapsed = 0.0
  private(set) var frames = 0
  private(set) var longestFrame = 0.0

  /// From `origin`, moving at `velocity` points per second (y up), to `rest`, from `start`.
  init(spring: Spring, origin: CGPoint, velocity: CGVector, rest: CGPoint, at start: Double) {
    self.spring = spring
    value = AnimatablePair(origin.x, origin.y)
    self.velocity = AnimatablePair(velocity.dx, velocity.dy)
    self.rest = AnimatablePair(rest.x, rest.y)
    startedAt = start
  }

  var origin: CGPoint { CGPoint(x: value.first, y: value.second) }

  /// Advances by `delta` seconds; true once it rests exactly where it belongs.
  mutating func step(_ delta: Double) -> Bool {
    elapsed += delta
    frames += 1
    longestFrame = max(longestFrame, delta)
    spring.update(value: &value, velocity: &velocity, target: rest, deltaTime: delta)
    let resting =
      (value - rest).magnitudeSquared < 0.25 && velocity.magnitudeSquared < 64
    guard resting || elapsed >= Self.limit else { return false }
    value = rest
    return true
  }
}
