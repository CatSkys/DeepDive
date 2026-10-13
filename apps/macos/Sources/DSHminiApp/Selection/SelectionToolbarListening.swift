import AppKit

/// The selection toolbar's `toggle` mode: whether the shell listens for selections, which
/// pressing the activation key combination twice on its own flips (``ModifierDoublePress``) and
/// the status menu can set. While armed it watches modifier changes in other apps (a global monitor) and in
/// this one (a local monitor, which the global one never sees); only modifier changes, so typing
/// never wakes the app. Listening starts off at every launch and ends whenever it is disarmed.
final class SelectionToolbarListening {
  /// Listening turned on or off.
  var onChange: ((Bool) -> Void)?
  private(set) var isOn = false
  /// The watched combination's flags while armed.
  private var combination: NSEvent.ModifierFlags?
  private var monitors: [Any] = []
  private var doublePress = ModifierDoublePress()

  /// The modifiers that make a press of the combination not count when another of them is down.
  private static let modifiers: NSEvent.ModifierFlags = [
    .command, .option, .control, .shift, .function,
  ]

  var isArmed: Bool { combination != nil }

  /// Watches `keys`, or stops watching and listening for nil (another mode, the toolbar off, or
  /// no Accessibility trust). Changing the keys keeps listening as it was.
  func arm(_ keys: Set<SelectionActivation.Key>?) {
    let flag = keys.map(SelectionActivation.Key.flags)
    guard flag != combination else { return }
    combination = flag
    doublePress.reset()
    if flag != nil {
      watch()
    } else {
      stopWatching()
      set(false)
    }
  }

  func set(_ on: Bool) {
    guard on != isOn, !on || isArmed else { return }
    isOn = on
    onChange?(on)
  }

  private func watch() {
    guard monitors.isEmpty else { return }
    let global = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
      MainActor.assumeIsolated { self?.modifiersChanged(event) }
    }
    let local = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
      MainActor.assumeIsolated { self?.modifiersChanged(event) }
      return event
    }
    monitors = [global, local].compactMap(\.self)
  }

  private func stopWatching() {
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors = []
  }

  private func modifiersChanged(_ event: NSEvent) {
    guard let combination else { return }
    let flags = event.modifierFlags.intersection(Self.modifiers)
    let completed = doublePress.update(
      held: flags.isSuperset(of: combination), others: !flags.subtracting(combination).isEmpty,
      time: event.timestamp, inputs: Self.inputCount())
    if completed { set(!isOn) }
  }

  /// Key and mouse button presses the window server has seen, from any source: a change between
  /// two modifier changes means the combination was used with something else.
  private static func inputCount() -> Int {
    let types: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    return types.reduce(0) { count, type in
      count &+ Int(CGEventSource.counterForEventType(.combinedSessionState, eventType: type))
    }
  }
}

extension SelectionActivation.Key {
  /// The flag that is set while either side's key is down.
  var modifierFlag: NSEvent.ModifierFlags {
    switch self {
    case .option: .option
    case .command: .command
    case .shift: .shift
    }
  }

  /// The flags a combination sets while all of its keys are down.
  static func flags(_ keys: Set<Self>) -> NSEvent.ModifierFlags {
    keys.reduce(into: []) { flags, key in flags.formUnion(key.modifierFlag) }
  }
}

extension SelectionActivation {
  /// Whether every key of the combination is down in `flags`.
  func isHeld(in flags: NSEvent.ModifierFlags) -> Bool {
    flags.isSuperset(of: Key.flags(keys))
  }
}
