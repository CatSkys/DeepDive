import AppKit
import ApplicationServices
import Synchronization

/// The selection toolbar's Accessibility check (grill decision Q4): whether the frontmost app's
/// focused element has a non-empty selection, and where it is. It asks only for the selection's
/// range, length and bounds, never for the text, which ``SelectionReader`` reads only when the
/// user picks a toolbar action.
///
/// - Every AX message is bounded by a 100 ms messaging timeout set on each element it asks
///   (never on the system-wide element, which would change the default of every read).
/// - A secure text field answers ``SelectionProbe/secureField`` before anything else is asked.
/// - `AXSelectedTextRange` first; web content (WebKit, Chromium) reports its selection as a
///   text-marker range, whose length and bounds it answers without the text.
/// - Electron and Chromium build their web tree only once an assistive tool asks the
///   application something (``wakeWebContent(_:)``), so each probe does, and
///   ``prepare(pid:bundleURL:)`` does it ahead of time when an Electron app comes forward.
///
/// Blocking; call it off the main thread.
nonisolated struct SelectionPresence: Sendable {
  static let messagingTimeout: Float = 0.1

  let pid: pid_t

  func probe() -> SelectionProbe {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, Self.messagingTimeout)
    Self.wakeWebContent(app)
    guard let focused: AXUIElement = Self.copy(app, kAXFocusedUIElementAttribute) else {
      return .none
    }
    AXUIElementSetMessagingTimeout(focused, Self.messagingTimeout)
    let secure = kAXSecureTextFieldSubrole as String
    let role: String? = Self.copy(focused, kAXRoleAttribute)
    let subrole: String? = Self.copy(focused, kAXSubroleAttribute)
    if role == secure || subrole == secure { return .secureField }

    if let rangeValue: AXValue = Self.copy(focused, kAXSelectedTextRangeAttribute) {
      var range = CFRange()
      if AXValueGetValue(rangeValue, .cfRange, &range), range.length > 0 {
        let bounds: AXValue? = Self.copy(
          focused, kAXBoundsForRangeParameterizedAttribute, rangeValue)
        return .selected(length: range.length, bounds: bounds.flatMap(Self.rect))
      }
    }
    guard let marker: CFTypeRef = Self.copy(focused, "AXSelectedTextMarkerRange"),
      let length: Int = Self.copy(focused, "AXLengthForTextMarkerRange", marker), length > 0
    else { return .none }
    let bounds: AXValue? = Self.copy(focused, "AXBoundsForTextMarkerRange", marker)
    return .selected(length: length, bounds: bounds.flatMap(Self.rect))
  }

  /// Asks the application for its `AXRole`. Chromium's and Electron's `accessibilityRole`
  /// override treats that as Apple recommends for assistive tools such as Voice Control: an app
  /// with no accessibility mode yet turns on its basic one (native elements and web content)
  /// and builds the tree asynchronously. Setting `AXManualAccessibility` would turn on the
  /// complete mode instead, which VS Code and Cursor take for a screen reader: they prompt,
  /// switch the editor to screen-reader mode, and a "No" writes a user setting. Other apps just
  /// answer. Electron keeps the basic mode for the life of the process, so repeating the read
  /// costs one message. The write target's capture and the answer card's focus check wake the
  /// app the same way before they ask for its focus.
  static func wakeWebContent(_ app: AXUIElement) {
    var role: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &role)
  }

  private static func rect(_ value: AXValue) -> CGRect? {
    var rect = CGRect.zero
    return AXValueGetValue(value, .cgRect, &rect) ? rect : nil
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
    else { return nil }
    return value as? T
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String, _ parameter: CFTypeRef)
    -> T?
  {
    var value: CFTypeRef?
    let error = AXUIElementCopyParameterizedAttributeValue(
      element, attribute as CFString, parameter, &value)
    return error == .success ? value as? T : nil
  }
}

extension SelectionPresence {
  /// Where probes run: a serial queue of their own, so a blocking AX read never holds one of
  /// Swift concurrency's few cooperative threads while an unresponsive app runs out its
  /// timeouts.
  private nonisolated static let queue = DispatchQueue(
    label: "com.junerdd.ai.selection-presence", qos: .userInitiated)
  /// A probe is running; a gesture meanwhile is not asked about (the app is still answering
  /// the last one, and the caller drops stale answers anyway).
  private nonisolated static let busy = Mutex(false)

  /// Where ``prepare(pid:bundleURL:)`` runs, apart from the probes' queue so a slow app never
  /// holds up a selection check.
  private nonisolated static let prepareQueue = DispatchQueue(
    label: "com.junerdd.ai.selection-prepare", qos: .utility)

  /// Wakes an Electron app's web content off the main thread, ahead of the first selection: the
  /// tree takes a moment to build, longer than a quick selection gives the first probe. Only
  /// apps that ship Electron's framework are woken early; any other app waits for its first
  /// probe, so merely bringing a browser forward never changes its accessibility state.
  nonisolated static func prepare(pid: pid_t, bundleURL: URL?) {
    guard let bundleURL else { return }
    prepareQueue.async {
      let framework = bundleURL.appendingPathComponent(
        "Contents/Frameworks/Electron Framework.framework", isDirectory: true)
      guard FileManager.default.fileExists(atPath: framework.path) else { return }
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, messagingTimeout)
      wakeWebContent(app)
    }
  }

  /// Wakes the web content of the app a command is summoned from, off the main thread, as soon
  /// as the shortcut fires: a browser that had no accessibility mode yet builds its tree while
  /// the selection is read, so its focused field answers by the time the write target is.
  nonisolated static func wake(pid: pid_t) {
    prepareQueue.async {
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, messagingTimeout)
      wakeWebContent(app)
    }
  }

  /// Checks off the main thread and gives up after `limit`, a net under the per-message
  /// timeouts; a late answer is dropped.
  static func check(pid: pid_t, limit: Duration = .milliseconds(300)) async -> SelectionProbe {
    let claimed = busy.withLock { busy in
      guard !busy else { return false }
      busy = true
      return true
    }
    guard claimed else { return .none }
    let presence = SelectionPresence(pid: pid)
    return await Deadline.value(within: limit, fallback: .none) {
      await withCheckedContinuation { continuation in
        queue.async {
          let probe = presence.probe()
          busy.withLock { $0 = false }
          continuation.resume(returning: probe)
        }
      }
    }
  }
}
