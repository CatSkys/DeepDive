/// Ends a press the mini panel's window holds whose release never reached it: another tracking
/// loop took it (the context menu's, opened by a right-click while the left button is held, or a
/// modal alert's). Read on every display frame with the left button's state. The button must
/// stay up for ``lostAfter`` and over ``lostAfterFrames`` frames: the release of an ordinary
/// click is still on its way to the window for a moment after the button comes up, and after a
/// stall of the app the event loop gets its turn between frames, so a release in flight always
/// lands first; ending the press then would drop the click.
public struct MiniPanelPressWatch: Equatable, Sendable {
  public static let lostAfter = 0.1
  public static let lostAfterFrames = 3

  /// How a press whose release was lost ends.
  public enum Outcome: Equatable, Sendable {
    /// The press is fine, or the release may still arrive.
    case none
    /// A press that never moved: it ends without a click, since nothing was released on it.
    case endPress
    /// A drag: it comes to rest where it was let go.
    case endDrag
  }

  /// Since when, and over how many frames, the window has held a press with the button up.
  private var upSince: Double?
  private var upFrames = 0

  public init() {}

  /// One frame: the window holds a press (`pressing`), which became a drag (`dragging`), while
  /// the left button is down or not.
  public mutating func update(pressing: Bool, dragging: Bool, buttonDown: Bool, at now: Double)
    -> Outcome
  {
    guard pressing, !buttonDown else {
      upSince = nil
      upFrames = 0
      return .none
    }
    let since = upSince ?? now
    upSince = since
    upFrames += 1
    guard now - since >= Self.lostAfter, upFrames >= Self.lostAfterFrames else { return .none }
    upSince = nil
    upFrames = 0
    return dragging ? .endDrag : .endPress
  }
}

/// Where the mini panel goes once a drop's absorb, or the wait for a drop after a release in its
/// drop zone, ends. A drag session that started meanwhile was refused while the panel was busy,
/// and a session announces its start only once, so it is invited now; otherwise the panel tucks
/// away.
public enum MiniPanelDropFlow {
  public enum Rest: Equatable, Sendable {
    case invite
    case tucked
  }

  public static func afterWait(sessionUnderWay: Bool) -> Rest {
    sessionUnderWay ? .invite : .tucked
  }
}

/// What a drop's file promises came to once every promised file called back, or the wait for
/// them ran out. Files that arrived are imported as they come; this decides the rest.
public enum MiniPanelPromiseOutcome {
  public struct Settlement: Equatable, Sendable {
    /// Promised files that failed or never came, which the panel reports like any import's
    /// failures.
    public let failures: Int
    /// Nothing arrived, but the drop also carried an image: it goes in like a pasted image
    /// instead, and nothing is reported.
    public let useImage: Bool

    public init(failures: Int, useImage: Bool) {
      self.failures = failures
      self.useImage = useImage
    }
  }

  /// - Parameters:
  ///   - expected: the files the promisers announced; a promiser may write more than it
  ///     announces, which only adds to `received`.
  ///   - imageAvailable: the drop's pasteboard still offers image data.
  public static func settle(expected: Int, received: Int, failed: Int, imageAvailable: Bool)
    -> Settlement
  {
    let failures = failed + max(expected - received - failed, 0)
    guard received == 0 else { return Settlement(failures: failures, useImage: false) }
    if imageAvailable { return Settlement(failures: 0, useImage: true) }
    // Nothing at all came: the drop is reported even when no promiser said what went wrong.
    return Settlement(failures: max(failures, 1), useImage: false)
  }
}
