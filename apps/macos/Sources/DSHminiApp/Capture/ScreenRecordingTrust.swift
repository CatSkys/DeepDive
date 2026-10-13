import AppKit
import CoreGraphics

/// Whether this running app may capture the screen (Screen Recording), which screenshots need,
/// and the one place that asks for it: ``prompt()`` is the system prompt (at most once per launch,
/// since macOS shows it once per app and asking again would only reopen System Settings
/// uninvited), and ``openSystemSettings()`` opens the system's recording pane.
///
/// macOS applies a new grant only to a relaunched app, so after the user allows the app in System
/// Settings ``isTrusted`` can stay false until the next launch; a revoked grant shows at once.
/// The state is re-read every 2 s and when the app becomes active again, since there is no system
/// notification for this grant and the guide stays visible beside System Settings while the user
/// switches it, and ``onChange`` reports every change.
final class ScreenRecordingTrust {
  private(set) var isTrusted: Bool
  var onChange: ((Bool) -> Void)?

  private var promptedThisLaunch = false
  private var activation: NSObjectProtocol?
  private var poll: Timer?

  init() {
    isTrusted = CGPreflightScreenCaptureAccess()
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

  /// The system prompt, at most once per launch, and none while the app already may capture.
  func prompt() {
    guard !isTrusted, !promptedThisLaunch else { return }
    promptedThisLaunch = true
    CGRequestScreenCaptureAccess()
  }

  /// `screenRecording.request`: opens Privacy & Security › Screen Recording and counts as this
  /// launch's ask.
  func openSystemSettings() {
    promptedThisLaunch = true
    SystemSettings.open(.screenRecording)
  }

  private func refresh() {
    let trusted = CGPreflightScreenCaptureAccess()
    guard trusted != isTrusted else { return }
    isTrusted = trusted
    onChange?(trusted)
  }
}
