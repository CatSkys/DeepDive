import ApplicationServices
import CoreGraphics
import Dispatch
import Synchronization

/// Element detection for a capture session, on Accessibility.
///
/// Every Accessibility call runs on this actor's own serial queue, never the main actor: calls
/// block on the target app, a hung app must not freeze the overlay, and a call into our own
/// process could not be answered while the main thread waits. `AXUIElement` is not `Sendable`,
/// so references never leave the actor; callers get plain `CGRect`s.
///
/// Which app is under the pointer is decided from the session's window snapshot, not by
/// Accessibility: the system-wide hit-test answers with whatever is topmost, which is the
/// overlay or another screenshot tool's window. The per-app hit-test looks through those.
actor ElementResolver: ElementTargeting {
  private struct Session {
    let windows: [ElementChain.Window]
    let displays: [CGRect]
    let trusted: Bool
  }

  private let queue = DispatchSerialQueue(
    label: "ai.capture.element-resolver", qos: .userInteractive)
  nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

  /// Counts requests as they are made, outside the actor, so a request that waited behind a
  /// slow one can see it was superseded before it does any Accessibility work.
  private let latestRequest = Mutex<UInt64>(0)
  private var session: Session?
  private var applications: [pid_t: AXUIElement] = [:]
  /// Apps whose tree switch was looked at this session, and the ones it was turned on for.
  private var prepared: Set<pid_t> = []
  private var enabledByUs: Set<pid_t> = []
  private var lastAnswer: [CGRect] = []

  func begin(windows: [CaptureWindow]) async -> ElementDetection {
    restoreChangedApplications()
    advanceRequest()
    let trusted = AXIsProcessTrusted()
    let session = Session(
      windows: windows.map {
        ElementChain.Window(id: $0.windowID, pid: $0.pid, frame: $0.quartzFrame)
      },
      displays: Self.activeDisplayBounds(), trusted: trusted)
    self.session = session
    guard trusted else { return .windowsOnly }

    AccessibilityProbe.setDefaultTimeout(AccessibilityProbe.messagingTimeout)
    // Web trees build lazily, so the app under the pointer is prepared before the first hover.
    if let location = CGEvent(source: nil)?.location,
      let window = ElementChain.topmostWindow(at: location, in: session.windows)
    {
      prepare(pid: window.pid)
    }
    return .elements
  }

  nonisolated func targets(at point: CGPoint) async -> [CGRect] {
    let request = advanceRequest()
    return await resolve(point, request: request)
  }

  func end() async {
    advanceRequest()
    restoreChangedApplications()
    if session?.trusted == true { AccessibilityProbe.setDefaultTimeout(0) }
    session = nil
    applications.removeAll()
    lastAnswer = []
  }

  @discardableResult
  private nonisolated func advanceRequest() -> UInt64 {
    latestRequest.withLock {
      $0 &+= 1
      return $0
    }
  }

  private func resolve(_ point: CGPoint, request: UInt64) -> [CGRect] {
    guard let session else { return [] }
    // Superseded while queued: the caller keeps only the latest answer, so repeat the last one
    // instead of spending Accessibility calls on a position the pointer has left.
    guard latestRequest.withLock({ $0 }) == request else { return lastAnswer }
    guard let window = ElementChain.topmostWindow(at: point, in: session.windows) else {
      lastAnswer = []
      return []
    }
    let chain = session.trusted ? accessibilityChain(of: window, at: point) : nil
    lastAnswer = ElementChain.targets(
      at: point, window: window, displays: session.displays, chain: chain)
    return lastAnswer
  }

  /// The ancestor chain of the element under `point` in `window`'s app, or nil when the app
  /// does not answer (the window alone is then offered).
  private func accessibilityChain(of window: ElementChain.Window, at point: CGPoint)
    -> [ElementChain.Node]?
  {
    let app = application(pid: window.pid)
    prepare(pid: window.pid)
    guard let hit = AccessibilityProbe.element(at: point, in: app) else { return nil }
    var refinement = AccessibilityBudget(milliseconds: 35, calls: 96)
    let target = AccessibilityProbe.deepest(below: hit, at: point, budget: &refinement)
    var walk = AccessibilityBudget(milliseconds: 250, calls: 160)
    return AccessibilityProbe.chain(from: target, budget: &walk)
  }

  private func application(pid: pid_t) -> AXUIElement {
    if let cached = applications[pid] { return cached }
    let app = AccessibilityProbe.application(pid: pid)
    applications[pid] = app
    return app
  }

  /// Switches an Electron/Chromium app's accessibility tree on once per session, remembering
  /// that we did so; `end()` puts it back.
  private func prepare(pid: pid_t) {
    guard prepared.insert(pid).inserted else { return }
    if AccessibilityProbe.enableManualAccessibility(on: application(pid: pid)) {
      enabledByUs.insert(pid)
    }
  }

  private func restoreChangedApplications() {
    for pid in enabledByUs {
      AccessibilityProbe.disableManualAccessibility(on: application(pid: pid))
    }
    enabledByUs.removeAll()
    prepared.removeAll()
  }

  /// Display bounds in Quartz points, read without AppKit so it is safe off the main actor.
  private nonisolated static func activeDisplayBounds() -> [CGRect] {
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(UInt32(ids.count), &ids, &count) == .success else { return [] }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
  }
}
