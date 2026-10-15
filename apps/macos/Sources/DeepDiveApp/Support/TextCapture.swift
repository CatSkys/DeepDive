import Foundation

/// Text read from the selection or the clipboard, as the page and the service receive it.
public struct CapturedText: Codable, Equatable, Sendable {
  public let text: String
  /// ISO 8601 with milliseconds, like JavaScript's `Date.toISOString()`.
  public let capturedAt: String

  public init(text: String, capturedAt: Date) {
    self.text = text
    self.capturedAt = CapturedText.timestamp(capturedAt)
  }

  public static func timestamp(_ date: Date) -> String {
    date.formatted(
      Date.ISO8601FormatStyle(includingFractionalSeconds: true, timeZone: .gmt))
  }
}

/// Why a capture has no text. The messages reach the page or the agent, not a native surface, so
/// they stay English like the service's own errors.
public enum CaptureFailure: String, Error, Equatable, Sendable {
  case accessibilityNotTrusted
  case noSelection
  case selectionTooLong
  case clipboardEmpty
  case clipboardTooLong
  /// `selection.read` and `clipboard.read` answer only while the panel is visible.
  case selectionPanelHidden
  case clipboardPanelHidden
  case liveSelectionMissing
  case liveSelectionTooLong
  case liveSelectionUnreadable

  public var message: String {
    switch self {
    case .accessibilityNotTrusted:
      "Enable Accessibility: System Settings → Privacy & Security → Accessibility."
    case .noSelection:
      "No selected text — select text in another app, then use the command shortcut."
    case .selectionTooLong: "Selected text exceeds the input limit — select a smaller passage."
    case .clipboardEmpty: "The clipboard does not contain text."
    case .clipboardTooLong: "Clipboard text exceeds the input limit."
    case .selectionPanelHidden: "Selection is only available while the panel is open."
    case .clipboardPanelHidden: "The clipboard is only available while the panel is open."
    case .liveSelectionMissing: "No selected text is available."
    case .liveSelectionTooLong: "Selected text exceeds the input limit."
    case .liveSelectionUnreadable: "The selection could not be read."
    }
  }
}

/// The capture rules of the shell. Limits count UTF-16 code units, JavaScript's `length`.
public enum TextCapture {
  public static let maxInputLength = NativeBridgeContract.maxCaptureLength

  /// What a summon stashes from a selection read: whitespace-only text counts as none.
  public static func stash(_ text: String?, at date: Date) -> CapturedText? {
    guard let text, hasContent(text) else { return nil }
    return CapturedText(text: text, capturedAt: date)
  }

  /// `capture('selection')`: the stash from the last summon.
  public static func selection(stash: CapturedText?, trusted: Bool) -> Result<
    CapturedText, CaptureFailure
  > {
    guard let stash else { return .failure(trusted ? .noSelection : .accessibilityNotTrusted) }
    guard stash.text.utf16.count <= maxInputLength else { return .failure(.selectionTooLong) }
    return .success(stash)
  }

  /// The `capture` call's answer for ``selection(stash:trusted:)``.
  public static func captureResult(stash: CapturedText?, trusted: Bool) -> CaptureResult {
    switch selection(stash: stash, trusted: trusted) {
    case .success(let captured):
      .ok(.init(text: captured.text, capturedAt: captured.capturedAt))
    case .failure(.accessibilityNotTrusted): .notOk(.init(reason: .notTrusted))
    case .failure(.selectionTooLong): .notOk(.init(reason: .tooLong))
    case .failure: .notOk(.init(reason: .noSelection))
    }
  }

  /// The `clipboard.read` capability (which also needs a visible
  /// panel, checked by the caller through `panelVisible`).
  public static func clipboard(_ text: String?, at date: Date, panelVisible: Bool = true)
    -> Result<CapturedText, CaptureFailure>
  {
    guard panelVisible else { return .failure(.clipboardPanelHidden) }
    guard let text, hasContent(text) else { return .failure(.clipboardEmpty) }
    guard text.utf16.count <= maxInputLength else { return .failure(.clipboardTooLong) }
    return .success(CapturedText(text: text, capturedAt: date))
  }

  /// The `selection.read` capability: a live read, allowed only while the panel is visible.
  /// `readable` is false when the process is not trusted for Accessibility.
  public static func liveSelection(
    _ text: String?, at date: Date, panelVisible: Bool, readable: Bool
  ) -> Result<CapturedText, CaptureFailure> {
    guard panelVisible else { return .failure(.selectionPanelHidden) }
    guard readable else { return .failure(.liveSelectionUnreadable) }
    guard let text, hasContent(text) else { return .failure(.liveSelectionMissing) }
    guard text.utf16.count <= maxInputLength else { return .failure(.liveSelectionTooLong) }
    return .success(CapturedText(text: text, capturedAt: date))
  }

  private static func hasContent(_ text: String) -> Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}
