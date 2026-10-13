import AppKit
import ApplicationServices

/// Whether the app is trusted for Accessibility, which selection capture and the selection
/// toolbar need, and when the system asks for it (grill decision Q7):
/// - the first launch with the toolbar on asks once, remembered in this bundle id's defaults,
///   so Debug and Release builds each ask once ever and never again by themselves; opening the
///   welcome guide retires that prompt, since the guide asks in context;
/// - after that only a summon that wants the selection asks (once per launch), or the
///   settings page's permission row (`accessibility.request`), which opens the system's
///   Accessibility pane.
///
/// Trust is re-read every 2 s, whether held or missing, and when the app becomes active again, so
/// granting or revoking it in System Settings shows without a restart. The system's
/// `com.apple.accessibility.api` notification is not relied on: a grant switched off in System
/// Settings did not reach the guide through it. ``onChange`` reports every change.
final class AccessibilityTrust {
  private(set) var isTrusted: Bool
  var onChange: ((Bool) -> Void)?

  private let defaults: UserDefaults
  private var promptedThisLaunch = false
  private var poll: Timer?
  private var activation: NSObjectProtocol?

  private static let autoPromptedKey = "accessibility.autoPrompted"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    isTrusted = SelectionReader.isTrusted
  }

  func start() {
    activation = NotificationCenter.default.addObserver(
      forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.refresh() }
    }
    let poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.refresh() }
    }
    poll.tolerance = 0.5
    self.poll = poll
    refresh()
  }

  /// The once-ever prompt of a first launch with the toolbar on.
  func promptOnFirstLaunch() {
    guard !isTrusted, !defaults.bool(forKey: Self.autoPromptedKey) else { return }
    defaults.set(true, forKey: Self.autoPromptedKey)
    promptOncePerLaunch()
  }

  /// The app has asked for Accessibility before, by the first-launch prompt or the welcome guide.
  var hasAsked: Bool { defaults.bool(forKey: Self.autoPromptedKey) }

  /// Retires the first-launch prompt without asking: the welcome guide asks in context, and
  /// opens before the panel's first `toolbar.set` could prompt.
  func skipFirstLaunchPrompt() {
    defaults.set(true, forKey: Self.autoPromptedKey)
  }

  /// The system prompt for a summon that wants the selection, at most once per launch. None while
  /// the welcome guide is open (``guideAsks``): it asks on its own step, and a summon from its
  /// hotkey try-out must not ask first.
  func promptForSummon() {
    guard !guideAsks else { return }
    promptOncePerLaunch()
  }

  /// Set while the welcome guide window is open.
  var guideAsks = false

  /// The system prompt, at most once per launch; ``StaleGrantRecovery`` asks through it too.
  func promptOncePerLaunch() {
    guard !isTrusted, !promptedThisLaunch else { return }
    promptedThisLaunch = true
    SelectionReader.requestTrust()
  }

  /// `accessibility.request`: opens Privacy & Security › Accessibility and counts as this
  /// launch's ask.
  func openSystemSettings() {
    promptedThisLaunch = true
    SystemSettings.open(.accessibility)
  }

  private func refresh() {
    let trusted = SelectionReader.isTrusted
    guard trusted != isTrusted else { return }
    isTrusted = trusted
    onChange?(trusted)
  }
}
