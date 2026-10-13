import AppKit
import Carbon.HIToolbox

/// Synthesized key presses, posted at the HID level so they reach the frontmost app. Posting
/// needs Accessibility. Every event carries a private marker in its source user data, so an event
/// monitor can tell them from the user's own (``isSynthesized(_:)``).
enum KeyPress {
  /// "ATDKEYPR" in ASCII: the marker in `eventSourceUserData`, which other posters leave at 0
  /// or set to their own value.
  private nonisolated static let marker: Int64 = 0x4154_444B_4559_5052

  /// Presses and releases `code` with exactly `flags`, so modifiers still held from a shortcut
  /// cannot turn the press into another one.
  static func post(_ code: CGKeyCode, flags: CGEventFlags) {
    let source = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
      guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
      else { continue }
      event.flags = flags
      event.setIntegerValueField(.eventSourceUserData, value: marker)
      event.post(tap: .cghidEventTap)
    }
  }

  /// Whether `event`, as an event monitor received it, is one ``post(_:flags:)`` synthesized: it
  /// carries the marker, or Atd's process posted it, whichever of the two fields the event kept
  /// on its way to the monitor.
  nonisolated static func isSynthesized(_ event: NSEvent) -> Bool {
    guard let event = event.cgEvent else { return false }
    return event.getIntegerValueField(.eventSourceUserData) == marker
      || event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid())
  }

  /// The key that types "v" with ⌘ held in the current keyboard layout, so ⌘V pastes on Dvorak
  /// or AZERTY too. Layouts without a Latin "v" fall back to the ANSI position, where macOS
  /// resolves ⌘ shortcuts for them.
  static func pasteKeyCode() -> CGKeyCode {
    keyCode(typing: "v", modifiers: UInt32((cmdKey >> 8) & 0xFF)) ?? CGKeyCode(kVK_ANSI_V)
  }

  /// The key that types "c" with ⌘ held in the current layout, like ``pasteKeyCode()``.
  static func copyKeyCode() -> CGKeyCode {
    keyCode(typing: "c", modifiers: UInt32((cmdKey >> 8) & 0xFF)) ?? CGKeyCode(kVK_ANSI_C)
  }

  /// The first virtual key code whose translation in the current layout is `character`. TIS
  /// wants the main thread.
  private static func keyCode(typing character: String, modifiers: UInt32) -> CGKeyCode? {
    guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
      let pointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
    else { return nil }
    let data = Unmanaged<CFData>.fromOpaque(pointer).takeUnretainedValue() as Data
    return data.withUnsafeBytes { bytes -> CGKeyCode? in
      guard let layout = bytes.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self)
      else { return nil }
      for code in UInt16(0)..<128 {
        var deadKeys: UInt32 = 0
        var characters = [UniChar](repeating: 0, count: 4)
        var length = 0
        let status = UCKeyTranslate(
          layout, code, UInt16(kUCKeyActionDisplay), modifiers, UInt32(LMGetKbdType()),
          OptionBits(kUCKeyTranslateNoDeadKeysMask), &deadKeys, characters.count, &length,
          &characters)
        if status == noErr,
          String(utf16CodeUnits: characters, count: length).lowercased() == character
        {
          return CGKeyCode(code)
        }
      }
      return nil
    }
  }
}
