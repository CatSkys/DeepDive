import AppKit
import QuartzCore

/// The mini panel's clock and pointer (spec v1, Pointer and cursor). Atd stays inactive while the
/// panel is used, and the window server delivers an inactive app's tracking events late or drops
/// them, so tracking areas would lag; like ``SelectionToolbarHover``, this reads
/// `NSEvent.mouseLocation` on every display frame instead, and the owner hovers, opens, closes
/// and animates from there (``onFrame``).
///
/// The frames pause once the pointer has rested away from the panel for ``idleFrames`` while
/// nothing is being timed or animated (``isBusy``); a pointer move anywhere (global and local
/// monitors) resumes them as it comes near (``isNear``), before it can reach the panel. Each move
/// also reaches the owner at once (``onMove``), so the panel answers it without waiting for the
/// next frame (perf-v1). The frames run at up to 120 Hz where the display allows.
final class MiniPanelPointer: NSObject {
  static let idleFrames = 30
  static let longestStep = 0.1

  /// Called on every frame with the time it is drawn at (the display link's target time, on the
  /// `CACurrentMediaTime()` clock) and the seconds since the previous frame.
  var onFrame: ((_ now: Double, _ elapsed: Double) -> Void)?
  /// Whether the pointer is close enough to the panel to keep watching it at rest.
  var isNear: ((CGPoint) -> Bool)?
  /// Whether a dwell, a departure, a drag or an animation needs the frames to keep coming.
  var isBusy: (() -> Bool)?
  /// Called in the event handler of every pointer move anywhere, with the pointer and the event's
  /// time (on the `CACurrentMediaTime()` clock).
  var onMove: ((_ point: CGPoint, _ time: Double) -> Void)?

  private var link: CADisplayLink?
  private var monitors: [Any] = []
  private var lastPointer: CGPoint?
  private var stillFrames = 0
  private var lastTimestamp: CFTimeInterval?

  /// Follows the pointer for `view`'s window, on its display, until ``stop()``.
  func start(in view: NSView) {
    stop()
    // adapted：Atd 工程默认 MainActor 隔离，这里没有——跳一次主线程。
    if Thread.isMainThread {
      MainActor.assumeIsolated { BackgroundCursor.enable() }
    } else {
      DispatchQueue.main.async { MainActor.assumeIsolated { BackgroundCursor.enable() } }
    }
    let link = view.displayLink(target: self, selector: #selector(frame(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    link.add(to: .main, forMode: .common)
    self.link = link
    if let global = NSEvent.addGlobalMonitorForEvents(
      matching: .mouseMoved,
      handler: { [weak self] event in
        let time = event.timestamp
        MainActor.assumeIsolated { self?.pointerMoved(at: time) }
      })
    {
      monitors.append(global)
    }
    if let local = NSEvent.addLocalMonitorForEvents(
      matching: .mouseMoved,
      handler: { [weak self] event in
        let time = event.timestamp
        MainActor.assumeIsolated { self?.pointerMoved(at: time) }
        return event
      })
    {
      monitors.append(local)
    }
  }

  func stop() {
    link?.invalidate()
    link = nil
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors = []
    lastPointer = nil
    lastTimestamp = nil
    stillFrames = 0
  }

  /// Resumes paused frames: a state change, an animation or a drag session needs them now.
  func wake() {
    guard let link else { return }
    stillFrames = 0
    if link.isPaused {
      lastTimestamp = nil
      link.isPaused = false
    }
  }

  private func pointerMoved(at time: Double) {
    let point = NSEvent.mouseLocation
    onMove?(point, time)
    guard let link, link.isPaused, isNear?(point) == true else { return }
    wake()
  }

  @objc private func frame(_ link: CADisplayLink) {
    // The display link's own frame times. The first frame after a pause counts as one frame, and
    // a stall of the app as at most ``longestStep``, so no spring jumps.
    let now = link.targetTimestamp
    let elapsed = lastTimestamp.map { now - $0 } ?? link.duration
    lastTimestamp = now
    onFrame?(now, min(max(elapsed, 0), Self.longestStep))
    let pointer = NSEvent.mouseLocation
    stillFrames = pointer == lastPointer ? stillFrames + 1 : 0
    lastPointer = pointer
    guard stillFrames >= Self.idleFrames, isNear?(pointer) != true, isBusy?() != true else {
      return
    }
    link.isPaused = true
  }
}
