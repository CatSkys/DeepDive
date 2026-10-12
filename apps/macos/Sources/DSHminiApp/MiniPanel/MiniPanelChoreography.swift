import CoreGraphics

/// A spring as SwiftUI gives it: a perceptual duration in seconds and a bounce.
public struct MiniPanelSpring: Hashable, Sendable {
  public let duration: Double
  public let bounce: Double

  public init(_ duration: Double, _ bounce: Double) {
    self.duration = duration
    self.bounce = bounce
  }

  /// Reduce Motion keeps the timing and takes the overshoot out.
  public func reduced(_ reduceMotion: Bool) -> MiniPanelSpring {
    reduceMotion ? MiniPanelSpring(duration, 0) : self
  }
}

/// How a change of content or of a press runs: on a spring, or eased over a fixed time.
public enum MiniPanelCurve: Equatable, Sendable {
  case spring(MiniPanelSpring)
  case easeIn(Double)
  case easeOut(Double)

  /// About how long the change takes to arrive, for what waits on it.
  public var duration: Double {
    switch self {
    case .spring(let spring): spring.duration
    case .easeIn(let duration), .easeOut(let duration): duration
    }
  }

  public func reduced(_ reduceMotion: Bool) -> MiniPanelCurve {
    guard case .spring(let spring) = self else { return self }
    return .spring(spring.reduced(reduceMotion))
  }
}

/// How the body's shape moves for one moment: its thickness (across the docked edge) and its
/// length (along it) each run on their own spring from their own start, which is what makes it
/// swell before it stretches, and settle in two motions rather than one.
public struct MiniPanelShapeMotion: Hashable, Sendable {
  public let thickness: MiniPanelSpring
  public let thicknessDelay: Double
  public let length: MiniPanelSpring
  public let lengthDelay: Double

  public init(
    thickness: MiniPanelSpring, thicknessDelay: Double = 0, length: MiniPanelSpring,
    lengthDelay: Double = 0
  ) {
    self.thickness = thickness
    self.thicknessDelay = thicknessDelay
    self.length = length
    self.lengthDelay = lengthDelay
  }

  /// When both axes have come to rest, from the moment's start.
  public var settles: Double {
    max(thicknessDelay + thickness.duration, lengthDelay + length.duration)
  }
}

/// How content arrives and leaves (motion-v3): it arrives after ``delay``, its opacity and its
/// blur from ``hiddenBlur`` clearing together on ``MiniPanelChoreography/contentOpacity``, and
/// leaves at once, eased in over ``exit`` to transparent and blurred. Its size is not its own: it
/// follows the shape it shows in (``MiniPanelChoreography/followLimit``). The blur is a render
/// effect on the content alone, never on the glass, and only while content comes or goes.
public struct MiniPanelContentMotion: Equatable, Sendable {
  public let delay: Double
  public let exit: Double
  /// The blur radius, in points, of the content while it is hidden.
  public let hiddenBlur: Double

  public init(delay: Double, exit: Double, hiddenBlur: Double = 6) {
    self.delay = delay
    self.exit = exit
    self.hiddenBlur = hiddenBlur
  }
}

/// The moments the body's shape changes.
public enum MiniPanelMoment: CaseIterable, Sendable {
  /// The pointer enters the hot zone: the pill swells at once.
  case swell
  /// The pointer leaves the hot zone before the capsule opened: the swell relaxes.
  case relax
  /// The pill opens into the capsule.
  case expand
  /// The capsule, the invite or the drop card closes into the pill.
  case collapse
  /// The pill grows into the invite as a drag session starts.
  case invite
  /// A dragged item draws the invite into the drop card.
  case target
  /// The dragged item leaves: the drop card shrinks back into the invite.
  case untarget
}

/// The mini panel's motion (motion-v3: motion-v2's "Dynamic Island" feel at perf-v1's pace;
/// island-v1: the capsule opens and closes as elastically as the island does): one
/// living shape that grows out of the edge it is docked to with elastic, per-axis springs, and
/// content that rides inside it, scaling with it, arriving out of a blur just after the shape
/// starts and leaving into one just before it closes. The invite, the drop card and the commands
/// card keep motion-v2's bounce with their durations, delays and fade-outs scaled by
/// ``paceScale``; the absorb, presses, the lift and the snap keep motion-v2's values. Reduce
/// Motion takes the bounce out of every spring and keeps content at its own size, revealed by
/// its shape, and drops the squish, lift, stretch and squash, never the change itself.
public enum MiniPanelChoreography {
  public static let paceScale = 0.75

  /// The shape's springs for `moment`. Opening moves first and lets the content follow; closing
  /// waits a moment for the content to leave (the length after 20 ms, the thickness 30 ms later).
  /// The capsule opens and closes as the Dynamic Island does (island-v1): opening, it swells past
  /// its rest, thicker by about 7 % and longer by about 5 %, before it settles; closing, it draws
  /// into the pill a little past it, about 3 % on each axis, and pops back out. Every overshoot
  /// stays inside ``MiniPanelMetrics/overshootRoom``.
  public static func shape(_ moment: MiniPanelMoment, reduceMotion: Bool = false)
    -> MiniPanelShapeMotion
  {
    let motion: MiniPanelShapeMotion =
      switch moment {
      case .swell:
        MiniPanelShapeMotion(thickness: .init(0.22, 0.3), length: .init(0.22, 0.3))
      case .relax:
        MiniPanelShapeMotion(thickness: .init(0.2, 0), length: .init(0.2, 0))
      case .expand:
        MiniPanelShapeMotion(thickness: .init(0.34, 0.36), length: .init(0.42, 0.32))
      case .collapse:
        MiniPanelShapeMotion(
          thickness: .init(0.30, 0.24), thicknessDelay: 0.05, length: .init(0.36, 0.26),
          lengthDelay: 0.02)
      case .invite:
        MiniPanelShapeMotion(thickness: .init(0.27, 0.22), length: .init(0.36, 0.32))
      case .target:
        MiniPanelShapeMotion(thickness: .init(0.30, 0.28), length: .init(0.375, 0.35))
      case .untarget:
        MiniPanelShapeMotion(
          thickness: .init(0.30, 0.20), thicknessDelay: 0.04, length: .init(0.30, 0.20),
          lengthDelay: 0.04)
      }
    return MiniPanelShapeMotion(
      thickness: motion.thickness.reduced(reduceMotion), thicknessDelay: motion.thicknessDelay,
      length: motion.length.reduced(reduceMotion), lengthDelay: motion.lengthDelay)
  }

  /// Content opacity, and its blur clearing, on arrival.
  public static let contentOpacity = MiniPanelSpring(0.20, 0)
  /// How far past its rest content grows with its shape's overshoot, so it rides the spring's
  /// bounce without outgrowing the glass.
  public static let followLimit = 1.06

  /// How the content of the shape `moment` leads to arrives, and how the content it replaces
  /// leaves.
  public static func content(_ moment: MiniPanelMoment) -> MiniPanelContentMotion {
    switch moment {
    case .expand, .swell, .relax, .collapse:
      MiniPanelContentMotion(delay: 0.02, exit: 0.08)
    // The invite glyph and the drop card's content: motion-v2's 60 and 80 ms, scaled.
    case .invite, .untarget: MiniPanelContentMotion(delay: 0.045, exit: 0.075)
    case .target: MiniPanelContentMotion(delay: 0.06, exit: 0.075)
    }
  }

  /// The resting pill's tone (pill-v2), the label color at this opacity: it leaves with the
  /// capsule's content timing as the pill opens, and arrives only once a closing body has all but
  /// drawn into the pill, so the capsule never closes as a filled shape.
  public static let pillFillLevel = 0.2
  public static let pillFill = MiniPanelContentMotion(delay: 0.24, exit: 0.08, hiddenBlur: 0)

  // MARK: The commands card

  public static let flyoutOpen = MiniPanelSpring(0.315, 0.25)
  public static let flyoutClose = MiniPanelSpring(0.225, 0.10)
  /// The card's shape closes this long after its rows start leaving.
  public static let flyoutCloseDelay = 0.04
  /// Closed by a click on Commands, the card closes through the button's label the way it opened
  /// out of it: this long after its shape starts closing it has all but become the label's
  /// bubble, and it draws on into the button's middle as a label draws back (``labelRetract``)
  /// without stopping there.
  public static let flyoutCloseThroughLabel = 0.15
  public static let rows = MiniPanelContentMotion(delay: 0.038, exit: 0.075, hiddenBlur: 4)

  // MARK: Touch

  /// A press on the pill or the capsule squishes the whole body; the release bounces it back.
  public static let bodyPressScale = 0.96
  public static let bodyPress = MiniPanelCurve.easeOut(0.08)
  public static let bodyRelease = MiniPanelSpring(0.35, 0.45)
  /// A press on a button or a row squishes its glyph under its wash.
  public static let controlPressScale = 0.86
  public static let controlPress = MiniPanelCurve.easeOut(0.08)
  public static let controlRelease = MiniPanelSpring(0.30, 0.40)
  /// The capsule lifts as a drag begins, and settles with the snap.
  public static let liftScale = 1.04
  public static let lift = MiniPanelSpring(0.30, 0.30)
  /// The window coming to rest after a release, carrying the release's velocity.
  public static let snap = MiniPanelSpring(0.55, 0.30)
  /// The release's velocity stretch (``MiniPanelStretch``) rises at once and relaxes without
  /// overshoot, so it reads as liquid rather than a wobble.
  public static let stretchRise = MiniPanelCurve.easeOut(0.06)
  public static let stretchRelax = MiniPanelSpring(0.5, 0)

  // MARK: The drop

  /// The drop card's quick squash as it takes a drop in: shorter along the edge, thicker across.
  public static let absorbLength = 0.92
  public static let absorbThickness = 1.06
  public static let absorbSquash = MiniPanelCurve.easeOut(0.10)
  public static let absorbRelease = MiniPanelSpring(0.35, 0.50)
  /// How long after the drop the card collapses into the pill.
  public static let absorbHold = 0.25

  // MARK: The hover label (hover-label-v2)

  /// The label grows out of the hovered control's middle…
  public static let labelAppear = MiniPanelSpring(0.30, 0.25)
  /// …its text arrives just after, growing with it from that middle…
  public static let labelText = MiniPanelContentMotion(delay: 0.04, exit: 0.1, hiddenBlur: 3)
  /// …it glides from control to control while warm, its text riding along and swapping through a
  /// blur…
  public static let labelGlide = MiniPanelSpring(0.35, 0.30)
  /// …and on leaving, once its text has faded, draws back into that middle without overshoot,
  /// merging into the capsule's glass; its glass goes once it has.
  public static let labelRetractDelay = 0.1
  public static let labelRetract = MiniPanelSpring(0.28, 0)
}
