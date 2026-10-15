import CoreGraphics

/// Whether a drag session shows the drop card, from the dragged item's place alone, read on every
/// display frame: the one owner of the invite ⇄ target state. A drop zone that a drag reaches
/// never changes it, so the two cannot disagree.
///
/// The card takes the item within ``enterMargin`` of the invite and holds it within
/// ``holdMargin`` of the card, which is larger than the invite, so the shape never flickers at
/// its edge; the card lets go only after the item has stayed outside that for ``leaveDelay``, so
/// a hand that wavers or the card's own shrinking never turns it back.
public struct MiniPanelMagnet: Equatable, Sendable {
  public static let enterMargin = 16.0
  public static let holdMargin = 24.0
  public static let leaveDelay = 0.12

  public private(set) var isTargeted = false
  /// When the item left the hold zone, while it stays out.
  private var outsideSince: Double?

  public init() {}

  /// A new session, or one the panel stopped following.
  public mutating func reset() {
    isTargeted = false
    outsideSince = nil
  }

  /// One frame with the dragged item at `point`; true while the card shows.
  public mutating func update(
    _ point: CGPoint, invite: ScreenRect, target: ScreenRect, at now: Double
  ) -> Bool {
    if !isTargeted {
      outsideSince = nil
      isTargeted = invite.outset(by: Self.enterMargin).contains(point)
      return isTargeted
    }
    guard !target.outset(by: Self.holdMargin).contains(point) else {
      outsideSince = nil
      return true
    }
    let since = outsideSince ?? now
    outsideSince = since
    if now - since >= Self.leaveDelay { reset() }
    return isTargeted
  }

  /// A departure is being timed, so the frames must keep coming.
  public var isTiming: Bool { outsideSince != nil }

  /// Where a drop lands on the panel rather than on the app below it: the zone that would draw
  /// the item in while inviting, the zone that holds it while targeted.
  public static func dropZone(invite: ScreenRect, target: ScreenRect, targeted: Bool)
    -> ScreenRect
  {
    targeted ? target.outset(by: holdMargin) : invite.outset(by: enterMargin)
  }
}
