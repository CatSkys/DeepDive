/// How the tucked mini panel opens (`miniPanel.openOn`): only on a click there, the pointer only
/// swelling the pill, which is the setting's default, or as the pointer rests in the hot zone.
public enum MiniPanelOpenOn: String, Equatable, Sendable {
  case hover
  case click
}

/// When the pointer opens and closes the mini panel (perf-v1), read on every pointer event and
/// display frame. Times are seconds on any steady clock.
///
/// - Tucked, the pill swells the moment the pointer enters the hot zone (``Change/swell``), so the
///   panel answers at once; after ``dwell`` there it opens (``Change/expand``), and leaving
///   before that relaxes the swell (``Change/relax``). A pointer passing along the screen edge
///   only swells it. Opening on click (``openOn``), it stays swollen while the pointer is there
///   and only a click opens it.
/// - Expanded, the pointer must stay away from the capsule (and its open card) plus
///   ``MiniPanelMetrics/collapseMargin`` for ``collapseDelay`` to close it again. Nothing closes
///   it while it is held: a press, a drag or the context menu.
/// - An expansion the pointer did not make (VoiceOver's press) waits for the pointer: it stays
///   open until the pointer has been near it once, then follows the rule above.
public struct MiniPanelHover: Equatable, Sendable {
  public static let dwell = 0.06
  public static let collapseDelay = 0.35

  public enum Change: Equatable, Sendable {
    case swell
    case relax
    case expand
    case collapse
  }

  /// When the pointer entered the hot zone, while it stays there.
  private var enteredAt: Double?
  /// When the pointer left the open capsule, while it stays away.
  private var leftAt: Double?
  public private(set) var awaitsVisit = false
  /// Whether resting in the hot zone opens the panel, or only a click does. The panel sets it from
  /// its setting; on its own the rule opens on hover.
  public var openOn = MiniPanelOpenOn.hover

  public init() {}

  /// Starts over, as the panel changes state; `awaitingVisit` for an expansion the pointer did
  /// not make.
  public mutating func reset(awaitingVisit: Bool = false) {
    enteredAt = nil
    leftAt = nil
    awaitsVisit = awaitingVisit
  }

  /// The pill is swollen: the pointer is in the hot zone and the capsule has not opened yet.
  public var isSwollen: Bool { enteredAt != nil }

  /// A pointer event or a frame while the panel is tucked.
  public mutating func tucked(inHotZone: Bool, at now: Double) -> Change? {
    leftAt = nil
    guard inHotZone else {
      guard enteredAt != nil else { return nil }
      enteredAt = nil
      return .relax
    }
    guard let since = enteredAt else {
      enteredAt = now
      return .swell
    }
    guard openOn == .hover, now - since >= Self.dwell else { return nil }
    reset()
    return .expand
  }

  /// A frame while the panel is open: `near` is the pointer within the collapse margin of the
  /// capsule (and its card), `held` a press, drag or menu that keeps it open.
  public mutating func expanded(near: Bool, held: Bool, at now: Double) -> Change? {
    enteredAt = nil
    if near { awaitsVisit = false }
    guard !near, !held, !awaitsVisit else {
      leftAt = nil
      return nil
    }
    let since = leftAt ?? now
    leftAt = since
    guard now - since >= Self.collapseDelay else { return nil }
    reset()
    return .collapse
  }

  /// A dwell or a departure is being timed, so the frames must keep coming. A swell waiting for a
  /// click times nothing: leaving the hot zone relaxes it on the pointer's own event.
  public var isTiming: Bool { (enteredAt != nil && openOn == .hover) || leftAt != nil }
}
