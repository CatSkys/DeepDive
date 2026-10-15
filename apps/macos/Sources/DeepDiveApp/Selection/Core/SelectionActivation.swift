import Foundation

/// Which selections bring up the selection toolbar (`toolbar.set`'s `activation` and
/// `activationKeys`): any selection, only one made while the key combination is held, or any
/// selection while the shell listens, which pressing the combination twice on its own turns on
/// and off.
public struct SelectionActivation: Equatable, Sendable {
  public typealias Mode = ToolbarSetParams.Activation
  public typealias Key = ToolbarSetParams.ActivationKey

  public var mode: Mode
  /// The combination; held means every one of them is down.
  public var keys: Set<Key>

  public init(mode: Mode, keys: Set<Key>) {
    self.mode = mode
    self.keys = keys
  }

  /// Whether a selection gesture may bring up the toolbar. `heldAtPress` and `heldAtRelease`:
  /// the combination was down when the button went down and when it came up, so pressing it
  /// before the drag or during it both count. `listening`: the `toggle` mode's state.
  public func admits(heldAtPress: Bool, heldAtRelease: Bool, listening: Bool) -> Bool {
    switch mode {
    case .always: true
    case .hold: heldAtPress || heldAtRelease
    case .toggle: listening
    }
  }
}

/// Recognizes the `toggle` mode's gesture from modifier changes: the combination pressed and
/// released twice on its own, each press short and the second soon after the first. A press
/// counts only while no other modifier is down and no key or mouse button went down meanwhile, so
/// the combination used as a modifier (Option-E, Option-click) or held for a while never toggles.
public struct ModifierDoublePress: Sendable {
  /// Longest press, down to up, that counts.
  public static let maximumPress: TimeInterval = 0.35
  /// Longest time from the first release to the second release.
  public static let maximumInterval: TimeInterval = 0.5

  /// When the combination went down on its own, and the input count then.
  private var pressed: (time: TimeInterval, inputs: Int)?
  /// When a counting press ended, and the input count then.
  private var first: (time: TimeInterval, inputs: Int)?

  public init() {}

  /// Feeds one modifier change. `held`: every key of the combination is down; `others`: a
  /// modifier outside it is down; `time`: the event's timestamp in seconds; `inputs`: a running
  /// count of key and mouse button presses, so a press of anything else between two changes
  /// shows. True when the change completes a double press.
  public mutating func update(held: Bool, others: Bool, time: TimeInterval, inputs: Int) -> Bool {
    if others {
      pressed = nil
      first = nil
      return false
    }
    if held {
      if pressed == nil { pressed = (time, inputs) }
      return false
    }
    guard let press = pressed else { return false }
    pressed = nil
    guard time - press.time <= Self.maximumPress, inputs == press.inputs else {
      first = nil
      return false
    }
    if let first, inputs == first.inputs, time - first.time <= Self.maximumInterval {
      self.first = nil
      return true
    }
    first = (time, inputs)
    return false
  }

  /// Forgets any press in progress, as when the mode or key changes.
  public mutating func reset() {
    pressed = nil
    first = nil
  }
}
