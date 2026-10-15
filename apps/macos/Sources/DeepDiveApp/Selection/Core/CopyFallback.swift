/// What the summon's Accessibility read learned about the focused element when it found no
/// selected text.
public enum SelectionFocus: Equatable, Sendable {
  /// Accessibility cannot tell whether anything is selected: no focused element reports a
  /// selected range, or the focus is web content, whose page may draw a selection of its own
  /// that the document's selection does not show (VS Code's editor outside its screen-reader
  /// mode), or the range is not empty but its text could not be read.
  case unknown
  /// The focus is a native text element (not web content) whose selected range is empty. ⌘C
  /// goes to that element, so it would copy nothing, and the app would beep.
  case emptyNativeText
  /// The focus is a password field.
  case secureField
  /// The app did not answer within the read's limits.
  case unresponsive
}

/// The state a summon's copy fallback depends on.
public struct CopyFallbackFacts: Equatable, Sendable {
  public var focus: SelectionFocus
  /// Atd is the frontmost app or one of its windows has the keyboard (the panel can be key
  /// without activating Atd), so ⌘C would copy from Atd itself.
  public var shellHasKeyboard: Bool
  /// Secure event input is on (a password field somewhere has the keyboard).
  public var secureInput: Bool

  public init(focus: SelectionFocus, shellHasKeyboard: Bool, secureInput: Bool) {
    self.focus = focus
    self.shellHasKeyboard = shellHasKeyboard
    self.secureInput = secureInput
  }
}

/// The rules of reading the selection by a simulated ⌘C where Accessibility found none: when
/// the copy may be posted, when the summoning shortcut's keys are out of its way, and what the
/// copy left that counts as the selection. The pasteboard is the user's: only a copy that
/// changed it counts, so text that was already there is never taken for the selection.
public enum CopyFallback {
  /// How long the copy waits for the summoning shortcut's modifiers to come up; still held
  /// after it, the copy is not posted.
  public static let releaseLimit: Duration = .milliseconds(400)
  /// How long the app gets to put the copy on the pasteboard before the summon goes on without.
  public static let copyLimit: Duration = .milliseconds(300)
  /// How long after ``copyLimit`` a late copy is still watched for, so the user's pasteboard
  /// comes back even from an app that copied too late to count.
  public static let lateCopyLimit: Duration = .seconds(1)

  /// Whether the summon may post ⌘C: only where Accessibility could not tell, never into Atd,
  /// a password field or while secure input is on, and not into an app that did not answer.
  public static func applies(_ facts: CopyFallbackFacts) -> Bool {
    !facts.shellHasKeyboard && !facts.secureInput && facts.focus == .unknown
  }

  /// `CGEventFlags` masks of the modifiers that would turn a posted ⌘C into another shortcut
  /// for an app that reads the keyboard's state rather than the event's flags: Shift, Control,
  /// Option and Command. Caps Lock (a lock, not a held key) and Fn are left out.
  static let shortcutModifierMask: UInt64 = 0x0002_0000 | 0x0004_0000 | 0x0008_0000 | 0x0010_0000

  /// Whether the keyboard state's `CGEventFlags` raw value still holds a shortcut modifier.
  public static func shortcutModifiersHeld(_ flags: UInt64) -> Bool {
    flags & shortcutModifierMask != 0
  }

  /// The selection a copy put on the pasteboard, once the change count moved (an unchanged
  /// pasteboard is the user's, never the selection): its plain string, unless that is missing or
  /// whitespace only, or the copy was of files (Finder puts their names there as a string too).
  public static func copiedText(string: String?, hasFiles: Bool) -> String? {
    guard !hasFiles, let string,
      !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return nil }
    return string
  }
}
