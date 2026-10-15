import AppKit
import QuartzCore
import SwiftUI

/// Drag sessions and drops (spec v1, States and Drop routing): a drag with something to take
/// anywhere on screen turns the panel into the invite; the dragged item coming near draws it
/// into the drop card; a drop there takes its one route into the task panel's current draft and
/// the card collapses into the pill. Every route shows the panel at once, a promise's before its
/// files arrive, and a drop that comes to nothing is reported there like any import's failure.
///
/// The polled pointer alone decides invite ⇄ target (``MiniPanelMagnet``, with hysteresis);
/// the drop destination only answers what a drop would do. While a session runs, an invisible
/// zone over the magnet's reach takes the release, so a drop there lands on the panel rather
/// than on the app below it.
extension MiniPanelController: MiniPanelDropTarget {
  /// How long the panel waits for a drop after a release in its drop zone: the release reaches
  /// the event monitors and the drop separately.
  static let dropGracePeriod: Duration = .milliseconds(500)
  /// The name a dropped file that never arrived is reported under, which is data the page shows,
  /// like `Dropped text <date>.txt`.
  static let unnamedDrop = "Dropped file"

  /// A drag session with something to take began somewhere on screen. One that begins while the
  /// panel still waits for the last session's drop takes over the invite; one that begins during
  /// a drop's absorb is invited when the absorb ends (``endWait(trigger:)``).
  func dragSessionBegan(_ offer: MiniPanelDragOffer) {
    switch model.phase {
    case .tucked, .expanded:
      guard window?.isPressing != true else { return }
      // A snap still under way lands at once, so the invite grows where the panel rests.
      if snap != nil { relayout() }
      magnet.reset()
      transition(to: .invite, trigger: "drag session")
    case .invite, .target:
      dropGrace?.cancel()
      dropGrace = nil
      magnet.reset()
      transition(to: .invite, trigger: "drag session")
    case .hidden, .dragging, .draggingPill, .absorbing:
      break
    }
  }

  /// The session ended with the button's release at `point`. A release in the drop zone waits
  /// briefly for its drop; any other ends the invite at once.
  func dragSessionEnded(at point: CGPoint) {
    guard model.phase == .invite || model.phase == .target else { return }
    guard let zone = dropZone, zone.contains(x: point.x, y: point.y) else {
      return transition(to: .tucked, trigger: "drag ended")
    }
    dropGrace?.cancel()
    dropGrace = Task { [weak self] in
      try? await Task.sleep(for: Self.dropGracePeriod)
      guard let self, !Task.isCancelled,
        model.phase == .invite || model.phase == .target
      else { return }
      Self.log.info("Mini panel drop zone: no drop arrived after the release.")
      endWait(trigger: "drag ended")
    }
  }

  /// A drop's absorb or the wait for a drop is over: a session that began meanwhile is invited,
  /// otherwise the panel tucks away (``MiniPanelDropFlow``).
  private func endWait(trigger: String) {
    switch MiniPanelDropFlow.afterWait(sessionUnderWay: dragWatch.session != nil) {
    case .invite: transition(to: .invite, trigger: "drag session")
    case .tucked: transition(to: .tucked, trigger: trigger)
    }
  }

  /// One frame of a drag session: the magnet decides whether the drop card shows.
  func followDrag(_ pointer: CGPoint, at now: Double) {
    guard let layout, dragWatch.session != nil else { return }
    let targeted = magnet.update(pointer, invite: layout.invite, target: layout.target, at: now)
    switch (model.phase, targeted) {
    case (.invite, true):
      transition(to: .target, trigger: "drag near")
      NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
    case (.target, false):
      transition(to: .invite, trigger: "drag away")
    default:
      break
    }
  }

  /// Where a release lands on the panel, on screen: the magnet's reach for the current phase.
  var dropZone: ScreenRect? {
    guard let layout, model.phase == .invite || model.phase == .target else { return nil }
    return MiniPanelMagnet.dropZone(
      invite: layout.invite, target: layout.target, targeted: model.phase == .target)
  }

  /// Draws the invisible drop zone for the phase, with the body's resting shape cut out of it,
  /// or none outside a session.
  func updateDropZone() {
    var zone: MiniPanelDropZone?
    if let layout, let reach = dropZone, let shape = Self.shape(for: model.phase),
      let hole = restRect(of: shape)
    {
      zone = MiniPanelDropZone(
        zone: local(reach), hole: hole, corner: layout.cornerRadius(of: shape))
    }
    guard zone != model.dropZone else { return }
    model.dropZone = zone
  }

  // MARK: MiniPanelDropTarget

  /// A copy (or what else the source allows short of a move, which would take the item from
  /// it), only while inviting or targeting and for a drag with something to take. It never
  /// changes the state: the magnet owns that.
  func dragOperation(for info: any NSDraggingInfo) -> NSDragOperation {
    guard model.phase == .invite || model.phase == .target,
      MiniPanelDragOffer(types: info.draggingPasteboard.types ?? []).isAcceptable
    else { return [] }
    let allowed = info.draggingSourceOperationMask
    return [NSDragOperation.copy, .generic, .link].first { allowed.contains($0) } ?? []
  }

  func prepareDrop(_ info: any NSDraggingInfo) -> Bool {
    guard !dragOperation(for: info).isEmpty else {
      let inSession = model.phase == .invite || model.phase == .target
      refuse(info, reason: inSession ? "nothing it takes" : "the panel was \(model.phase.rawValue)")
      return false
    }
    return true
  }

  func performDrop(_ info: any NSDraggingInfo) -> Bool {
    guard model.phase == .invite || model.phase == .target else {
      refuse(info, reason: "the panel was \(model.phase.rawValue)")
      return false
    }
    let board = info.draggingPasteboard
    guard let payload = MiniPanelDropPayload.read(board) else {
      refuse(info, reason: "nothing it takes")
      return false
    }
    let (route, count) = (payload.logName, payload.count)
    Self.log.info("Mini panel drop: \(route, privacy: .public), \(count, privacy: .public) item(s)")
    take(payload, from: board)
    dropGrace?.cancel()
    transition(to: .absorbing, trigger: "drop")
    absorb()
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(MiniPanelChoreography.absorbHold))
      guard let self, model.phase == .absorbing else { return }
      endWait(trigger: "absorbed")
    }
    return true
  }

  /// The drop card takes the drop in with a quick squash, shorter along the edge and thicker
  /// across, and bounces back; never with Reduce Motion.
  private func absorb() {
    guard !model.reduceMotion else { return }
    deformToken += 1
    let token = deformToken
    let squash = MiniPanelChoreography.absorbSquash
    deform(
      CGSize(
        width: MiniPanelChoreography.absorbThickness, height: MiniPanelChoreography.absorbLength),
      squash.animation)
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(squash.duration))
      guard let self, token == deformToken else { return }
      deform(CGSize(width: 1, height: 1), MiniPanelChoreography.absorbRelease.animation)
    }
  }

  /// Logs a refused drop with its reason and the pasteboard's type names, never its contents.
  private func refuse(_ info: any NSDraggingInfo, reason: String) {
    let types = (info.draggingPasteboard.types ?? []).map(\.rawValue).joined(separator: ", ")
    Self.log.info(
      "Mini panel refused a drop: \(reason, privacy: .public); types \(types, privacy: .public)")
  }

  /// The drop's one route; each ends in the composer with the panel shown, and none sends
  /// anything.
  private func take(_ payload: MiniPanelDropPayload, from board: NSPasteboard) {
    switch payload {
    case .files(let files):
      actions.openItems(files)
    case .promises(let receivers):
      actions.showPanel()
      receive(receivers, from: board)
    case .image(let image):
      actions.importImage(image)
    case .quote(let text):
      actions.askAbout(text)
    case .textFile(let text):
      folder.pruneInBackground()
      do {
        actions.openItems([try folder.write(text: text, droppedAt: .now)])
      } catch {
        Self.log.error("Dropped text could not be written: \(String(describing: error))")
        actions.reportFailures([.init(name: Self.unnamedDrop, reason: .unreadable)])
      }
    }
  }

  /// Receives promised files into a drop folder, importing them as they arrive, and settles what
  /// never came once the wait is over.
  private func receive(_ receivers: [NSFilePromiseReceiver], from board: NSPasteboard) {
    folder.pruneInBackground()
    // The drop's own image, still on the pasteboard while no other drag replaced it, stands in
    // for promises that bring nothing; it is read only then.
    let changeCount = board.changeCount
    let image = MiniPanelDragOffer(types: board.types ?? []).image
    do {
      let destination = try folder.makeDropFolder()
      MiniPanelPromises.receive(
        receivers, into: destination,
        deliver: { [weak self] files in self?.actions.openItems(files) },
        settled: { [weak self] result in
          let fallback = image && board.changeCount == changeCount ? board : nil
          self?.promisesSettled(result, image: fallback)
        })
    } catch {
      Self.log.error("A drop folder could not be made: \(String(describing: error))")
      actions.reportFailures([.init(name: Self.unnamedDrop, reason: .unreadable)])
    }
  }

  /// The promises' wait is over (``MiniPanelPromiseOutcome``): when nothing arrived, the drop's
  /// image goes in like a pasted one; whatever failed or never came is reported.
  private func promisesSettled(_ result: MiniPanelPromises.Settled, image board: NSPasteboard?) {
    let image = result.received == 0 ? board.flatMap(MiniPanelDropPayload.image(on:)) : nil
    let settlement = MiniPanelPromiseOutcome.settle(
      expected: result.expected, received: result.received, failed: result.failed,
      imageAvailable: image != nil)
    if settlement.useImage, let image {
      Self.log.info("Mini panel drop: no promised file arrived; the drop's image goes in instead.")
      return actions.importImage(image)
    }
    guard settlement.failures > 0 else { return }
    let failures = settlement.failures
    Self.log.info("Mini panel drop: \(failures, privacy: .public) promised file(s) reported.")
    let unnamed = Array(
      repeating: Self.unnamedDrop, count: max(failures - result.missingNames.count, 0))
    let names = (result.missingNames + unnamed).prefix(failures)
    actions.reportFailures(names.map { .init(name: String($0.prefix(255)), reason: .unreadable) })
  }
}
