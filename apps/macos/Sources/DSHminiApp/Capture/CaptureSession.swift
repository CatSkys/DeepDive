import AppKit

/// One interactive capture over frozen displays (decisions D7, D8): an overlay per display, the
/// detected area under the pointer, a free or detected selection, and the annotation editor on
/// the committed selection. It ends once, with an ``Outcome``; the overlays are gone by then.
///
/// Everything runs on the main actor. Element detection is the injected ``ElementTargeting``,
/// whose answers arrive asynchronously; at most one request is in flight and the latest
/// pointer position is asked next, so a slow app never queues work behind every mouse move.
/// The annotation editor comes from `makeEditor` when a selection is committed.
///
/// A session that reopens a screenshot for editing (decision F2) never starts detection: the
/// caller preselects the image with ``preselect(_:onDisplay:restoring:)`` instead.
final class CaptureSession {
  enum Outcome {
    case cancelled
    /// The user clicked the Accessibility hint; the caller asks for trust once the overlays
    /// are gone, since the system's prompt would open beneath them.
    case wantsAccessibility
    case confirmed(CaptureConfirmation)
    /// The same result as `confirmed`, for the clipboard rather than an attachment.
    case copied(CaptureConfirmation)
    /// The same result as `confirmed`, with the message the user typed in the toolbar's chat bar:
    /// the caller sends the two together as one message rather than attaching them.
    case asked(CaptureConfirmation, text: String)
    case failed
  }

  /// A detected element the selection was committed from: where the click was and the
  /// element's area, both Quartz, and the selection it became (view points). It describes the
  /// capture only while the selection is still exactly that.
  struct Pick {
    let point: CGPoint
    let frame: CGRect
    let selection: CGRect
  }

  enum Phase {
    /// The detected area under the pointer is offered.
    case idle
    /// The button is down in idle; a click commits the detected area, a drag starts a free one.
    case pressing(CaptureOverlayView, start: CGPoint)
    case creating(CaptureOverlayView, SelectionDrag)
    /// A committed selection with the annotation editor on it; it moves and resizes at any
    /// time, and the annotations stay where they are on the screen.
    case selected(CaptureOverlayView, CGRect)
    /// The committed selection is being moved or resized with the mouse.
    case adjusting(CaptureOverlayView, SelectionDrag)
  }

  let targeting: any ElementTargeting
  let makeEditor: @MainActor () -> any AnnotationEditing
  /// The Accessibility hint asks for trust only once per launch; after that it only informs.
  let offersTrustRequest: Bool
  /// The last confirmed selection per display, offered by `R` (decision F3).
  let regions: CaptureRegionMemory
  /// `W` reduced the candidates to the window and the display; per session.
  var onlyWindows = false
  /// The element the current selection was committed from, if it was.
  var pick: Pick?
  private(set) var overlays: [CaptureOverlayView] = []
  var phase = Phase.idle
  /// A tool is chosen: presses inside the selection, away from its handles and edge band, are
  /// the editor's. The selection itself stays adjustable either way (D14).
  var interiorClaimed = false
  var editor: (any AnnotationEditing)?
  private(set) var detection: ElementDetection?
  /// Detection was started; only then is it ended (and asked to describe a pick).
  private var began = false
  /// The latest pointer position and the overlay it is on.
  var pointer: (overlay: CaptureOverlayView, point: CGPoint)?
  /// Candidate areas under the pointer on `chainOverlay`, smallest first, ending with the
  /// display; `chainIndex` is the one offered.
  private var chain: [CGRect] = []
  private weak var chainOverlay: CaptureOverlayView?
  private var chainIndex = 0
  private var hoverInFlight = false
  private var beginTask: Task<Void, Never>?
  private var outcome: Outcome?
  private var continuation: CheckedContinuation<Outcome, Never>?
  private var observers: [any NSObjectProtocol] = []

  init(
    targeting: any ElementTargeting, offersTrustRequest: Bool, regions: CaptureRegionMemory,
    makeEditor: @escaping @MainActor () -> any AnnotationEditing
  ) {
    self.targeting = targeting
    self.offersTrustRequest = offersTrustRequest
    self.regions = regions
    self.makeEditor = makeEditor
    // A frozen image no longer matches a rearranged display, and an app switch takes the
    // keyboard away from the overlays: both end the session.
    let center = NotificationCenter.default
    for name in [
      NSApplication.didChangeScreenParametersNotification,
      NSApplication.didResignActiveNotification,
    ] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.cancel() }
        })
    }
  }

  var isFinished: Bool { outcome != nil }

  /// Starts element detection over the pre-overlay window snapshot.
  func begin(windows: [CaptureWindow]) {
    began = true
    let targeting = targeting
    beginTask = Task {
      let detection = await targeting.begin(windows: windows)
      guard !isFinished else { return }
      self.detection = detection
      refreshHints()
      requestHover()
    }
  }

  /// Puts a frozen display's overlay on its screen, inert until ``activate()``.
  func add(_ display: FrozenDisplay, on screen: NSScreen) {
    guard !isFinished else { return }
    let view = CaptureOverlayView(display: display)
    view.delegate = self
    let panel = CaptureOverlayPanel(screen: screen, content: view)
    panel.orderFrontRegardless()
    overlays.append(view)
    view.show(area: nil, handles: false)
    view.showHints(hintTexts(on: view))
  }

  /// Every display is frozen: the overlay under the pointer takes the keyboard and the
  /// detected area follows the pointer.
  func activate() {
    guard !isFinished else { return }
    let mouse = NSEvent.mouseLocation
    let overlay =
      overlays.first { NSMouseInRect(mouse, $0.window?.frame ?? .zero, false) } ?? overlays.first
    guard let overlay, let window = overlay.window else { return }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(overlay)
    pointer = (overlay, overlay.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    renderIdle()
    requestHover()
  }

  /// Suspends until the session ends, then ends element detection.
  func run() async -> Outcome {
    var outcome: Outcome
    if let finished = self.outcome {
      outcome = finished
    } else {
      outcome = await withCheckedContinuation { continuation = $0 }
    }
    await beginTask?.value
    guard began else { return outcome }
    await targeting.end()
    return outcome
  }

  func cancel() { finish(.cancelled) }

  /// Renders the selection with and without its annotations and ends the session with them.
  func confirm() { end(as: Outcome.confirmed) }

  /// Ends the session like ``confirm()``, with the result meant for the clipboard.
  func copy() { end(as: Outcome.copied) }

  /// Ends the session like ``confirm()``, carrying the message typed in the toolbar's chat bar.
  func ask(_ text: String) { end(as: { .asked($0, text: text) }) }

  /// The editor's document is read before ``finish(_:)`` hides it.
  private func end(as outcome: (CaptureConfirmation) -> Outcome) {
    guard case .selected(let owner, let rect) = phase else { return }
    guard
      let rendered = CaptureExport.render(selection: rect, display: owner.display, editor: editor)
    else { return finish(.failed) }
    finish(
      outcome(
        CaptureConfirmation(
          image: rendered.image, raw: rendered.raw, pixelScale: owner.display.pixelScale,
          document: editor?.document ?? AnnotationDocument(), displayID: owner.display.displayID,
          displayFrame: owner.display.quartzFrame, selection: rect)))
  }

  /// Edit mode: makes `rect` (view points) the selection on the display `displayID` and puts
  /// `document` (selection-local) back on it, still editable.
  func preselect(
    _ rect: CGRect, onDisplay displayID: CGDirectDisplayID, restoring document: AnnotationDocument
  ) {
    guard !isFinished, let owner = overlays.first(where: { $0.display.displayID == displayID })
    else { return }
    if let window = owner.window {
      window.makeKeyAndOrderFront(nil)
      window.makeFirstResponder(owner)
      pointer = (owner, owner.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    }
    commit(owner, rect)
    if !document.isEmpty { editor?.restore(document) }
  }

  func finish(_ outcome: Outcome) {
    guard self.outcome == nil else { return }
    self.outcome = outcome
    editor?.hide()
    editor = nil
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
    for overlay in overlays { overlay.window?.close() }
    // The views hold the frozen images, tens of megabytes per Retina display.
    overlays.removeAll()
    pointer = nil
    continuation?.resume(returning: outcome)
    continuation = nil
  }

  // MARK: Detected areas

  /// Asks for the areas under the latest pointer position unless a request is in flight; the
  /// answer then asks again if the pointer moved meanwhile.
  func requestHover() {
    guard detection != nil, !hoverInFlight, let pointer, case .idle = phase else { return }
    hoverInFlight = true
    let quartz = CaptureCoordinates.quartzPoint(
      pointer.point, display: pointer.overlay.display.quartzFrame)
    let targeting = targeting
    Task {
      let areas = await targeting.targets(at: quartz)
      hoverInFlight = false
      guard !isFinished else { return }
      apply(areas, for: pointer)
      if let latest = self.pointer,
        latest.overlay !== pointer.overlay || latest.point != pointer.point
      {
        requestHover()
      }
    }
  }

  private func apply(_ areas: [CGRect], for asked: (overlay: CaptureOverlayView, point: CGPoint)) {
    guard case .idle = phase, let current = pointer, current.overlay === asked.overlay else {
      return
    }
    let display = asked.overlay.display.quartzFrame
    // The window ends the targeting's answer; windows only keeps just that.
    let offered = onlyWindows ? Array(areas.suffix(1)) : areas
    var candidates: [CGRect] = []
    for area in offered.compactMap({ CaptureCoordinates.viewRect($0, display: display) }) + [
      asked.overlay.bounds
    ] where candidates.last.map({ !Self.nearlyEqual($0, area) }) ?? true {
      candidates.append(area)
    }
    // A stale answer still counts while its smallest area holds the pointer: a slow app then
    // lags behind the pointer instead of never being offered.
    guard current.point == asked.point || candidates[0].contains(current.point) else { return }
    if candidates != chain || chainOverlay !== asked.overlay {
      chain = candidates
      chainOverlay = asked.overlay
      chainIndex = 0
    }
    renderIdle()
  }

  /// The area a click on `overlay` commits: the offered candidate, or the whole display.
  func offeredArea(on overlay: CaptureOverlayView) -> CGRect {
    guard chainOverlay === overlay, !chain.isEmpty else { return overlay.bounds }
    return chain[min(chainIndex, chain.count - 1)]
  }

  /// The detected area a click at `point` on `overlay` commits as `selection`, as a ``Pick``;
  /// nil for the display, which ends every chain and is no element.
  func pickedElement(at point: CGPoint, on overlay: CaptureOverlayView, selection: CGRect) -> Pick?
  {
    guard chainOverlay === overlay, chainIndex < chain.count - 1 else { return nil }
    let display = overlay.display.quartzFrame
    return Pick(
      point: CaptureCoordinates.quartzPoint(point, display: display),
      frame: CaptureCoordinates.quartzRect(chain[chainIndex], display: display),
      selection: selection)
  }

  /// Forgets the offered candidates, so the next answer is applied afresh (`W`).
  func resetChain() {
    chain = []
    chainOverlay = nil
    chainIndex = 0
  }

  /// Scroll and Tab: a larger (positive) or smaller candidate under the pointer.
  func walkChain(_ step: Int) {
    guard case .idle = phase, !chain.isEmpty else { return }
    chainIndex = min(max(chainIndex + step, 0), chain.count - 1)
    renderIdle()
  }

  /// Idle: the pointer's display shows its offered area and the loupe, the others stay dim.
  func renderIdle() {
    for overlay in overlays {
      let here = overlay === pointer?.overlay
      overlay.show(area: here ? offeredArea(on: overlay) : nil, handles: false)
      overlay.showLoupe(at: here ? pointer?.point : nil)
    }
  }

  private static func nearlyEqual(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
    abs(lhs.minX - rhs.minX) < 1 && abs(lhs.minY - rhs.minY) < 1 && abs(lhs.maxX - rhs.maxX) < 1
      && abs(lhs.maxY - rhs.maxY) < 1
  }
}

/// A confirmed capture: what is imported, and what reopening it later needs (decision F2).
struct CaptureConfirmation {
  /// The selection's pixels with the annotations drawn in.
  let image: CGImage
  /// The same pixels without annotations.
  let raw: CGImage
  /// Pixels per point of the display the selection was on.
  let pixelScale: CGFloat
  /// The annotations, selection-local.
  let document: AnnotationDocument
  let displayID: CGDirectDisplayID
  /// The display's Quartz frame.
  let displayFrame: CGRect
  /// The selection in the display's view points.
  let selection: CGRect
}
