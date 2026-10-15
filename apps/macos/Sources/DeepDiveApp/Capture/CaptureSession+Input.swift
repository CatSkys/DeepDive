import AppKit

/// The session's input (decisions D8, D14): the pointer offers areas, a click commits one, a
/// drag selects freely, and a committed selection resizes from its handles and edge band at any
/// time, moves from inside until a tool claims the interior, and confirms.
extension CaptureSession: CaptureOverlayDelegate {
  func overlay(_ overlay: CaptureOverlayView, pointerAt point: CGPoint) {
    pointer = (overlay, point)
    guard case .idle = phase else { return }
    // While nothing is selected the keyboard follows the pointer's display.
    if let window = overlay.window, !window.isKeyWindow {
      window.makeKey()
      window.makeFirstResponder(overlay)
    }
    renderIdle()
    requestHover()
  }

  func overlay(_ overlay: CaptureOverlayView, mouseDownAt point: CGPoint, clickCount: Int) {
    switch phase {
    case .idle:
      if isTrustRequest(point, on: overlay) {
        finish(.wantsAccessibility)
      } else {
        phase = .pressing(overlay, start: point)
      }
    case .selected(let owner, let rect):
      guard owner === overlay else { return }
      // Outside the selection a press does nothing; a right-click starts over instead, so a
      // stray click cannot lose the selection.
      let drag = overlay.model.drag(startingAt: point, selection: rect)
      switch drag {
      case .create:
        return
      case .move:
        // The host routes a claimed interior to the editor; this only guards the contract.
        guard !interiorClaimed else { return }
        if clickCount >= 2 {
          confirm()
          return
        }
      case .resize:
        break
      }
      phase = .adjusting(overlay, drag)
    case .pressing, .creating, .adjusting:
      break
    }
  }

  func overlay(_ overlay: CaptureOverlayView, mouseDraggedTo point: CGPoint, square: Bool) {
    switch phase {
    case .pressing(let owner, let start):
      guard !SelectionModel.isClick(from: start, to: point) else { return }
      let drag = SelectionDrag.create(origin: owner.model.clamped(start))
      phase = .creating(owner, drag)
      for other in overlays where other !== owner {
        other.show(area: nil, handles: false)
        other.showLoupe(at: nil)
      }
      showCreating(owner, drag, at: point, square: square)
    case .creating(let owner, let drag):
      showCreating(owner, drag, at: point, square: square)
    case .adjusting(let owner, let drag):
      let rect = owner.model.rect(for: drag, to: point)
      showSelection(owner, rect)
      // The loupe shows the pixel being adjusted until the button goes up (`move`).
      owner.showLoupe(at: owner.model.loupePoint(for: drag, rect: rect, pointer: point))
      editor?.selectionDidChange(rect)
    case .idle, .selected:
      break
    }
  }

  func overlay(_ overlay: CaptureOverlayView, mouseUpAt point: CGPoint, square: Bool) {
    switch phase {
    case .pressing(let owner, let start):
      let selection = owner.model.settled(offeredArea(on: owner))
      let pick = pickedElement(at: start, on: owner, selection: selection)
      commit(owner, selection)
      self.pick = pick
    case .creating(let owner, let drag):
      commit(owner, owner.model.rect(for: drag, to: point, square: square))
    case .adjusting(let owner, let drag):
      move(owner, to: owner.model.rect(for: drag, to: point))
    case .idle, .selected:
      break
    }
  }

  /// Clears the selection back to idle, unless that would lose annotations (or open text).
  func overlayRightClicked(_ overlay: CaptureOverlayView) {
    guard case .selected(let owner, _) = phase, editor?.hasAnnotations != true else { return }
    editor?.hide()
    editor = nil
    interiorClaimed = false
    owner.annotationHost.passThrough = nil
    owner.annotationHost.scroll = nil
    phase = .idle
    refreshHints()
    renderIdle()
    requestHover()
  }

  func overlay(_ overlay: CaptureOverlayView, perform command: CaptureCommand) {
    switch command {
    case .cancel:
      cancel()
    case .confirm:
      confirm()
    case .walk(let step):
      walkChain(step)
    case .selectDisplay:
      selectDisplay(on: overlay)
    // Arrows reach the session whenever the editor did not take them (it takes them only to
    // nudge a selected annotation).
    case .nudge(let dx, let dy):
      guard case .selected(let owner, let rect) = phase else { return }
      move(owner, to: owner.model.nudged(rect, dx: dx, dy: dy))
    case .resize(let dWidth, let dHeight):
      guard case .selected(let owner, let rect) = phase else { return }
      move(owner, to: owner.model.resized(rect, dWidth: dWidth, dHeight: dHeight))
    case .resizeLeading(let dx, let dy):
      guard case .selected(let owner, let rect) = phase else { return }
      move(owner, to: owner.model.resizedLeading(rect, dx: dx, dy: dy))
    case .recall:
      recallRegion()
    case .toggleWindowsOnly:
      toggleWindowsOnly()
    }
  }

  /// The selection's cursors (D15, `CaptureCursors.swift`): nil inside an interior a tool claimed,
  /// where the editor's canvas sets its own.
  func overlay(_ overlay: CaptureOverlayView, cursorAt point: CGPoint) -> NSCursor? {
    switch phase {
    case .selected(let owner, let rect) where owner === overlay:
      if let handle = overlay.model.handle(at: point, of: rect) { return handle.cursor }
      guard rect.contains(point) else { return .arrow }
      return interiorClaimed ? nil : .openHand
    case .adjusting(_, .move):
      return .closedHand
    case .adjusting(_, .resize(let handle, _)):
      return handle.cursor
    case .selected, .adjusting:
      return .arrow
    case .idle, .pressing, .creating:
      return .crosshair
    }
  }

  // MARK: Selection

  /// Select All: the whole display becomes the selection. Idle, that is the display under the
  /// pointer (the keyboard follows it); with a selection it is the selection's display, whose
  /// annotations stay where they are (D14). A selection being dragged is left alone.
  private func selectDisplay(on overlay: CaptureOverlayView) {
    switch phase {
    case .idle:
      let target = pointer?.overlay ?? overlay
      commit(target, target.model.settled(target.bounds))
    case .selected(let owner, _):
      move(owner, to: owner.model.settled(owner.bounds))
    case .pressing, .creating, .adjusting:
      break
    }
  }

  /// Makes `rect` the selection on `owner` and hands it to a new annotation editor. A click on
  /// a detected element sets ``CaptureSession/pick`` once this returns.
  func commit(_ owner: CaptureOverlayView, _ rect: CGRect) {
    phase = .selected(owner, rect)
    pick = nil
    interiorClaimed = false
    for overlay in overlays {
      overlay.showLoupe(at: nil)
      if overlay !== owner { overlay.show(area: nil, handles: false) }
    }
    refreshHints()
    showSelection(owner, rect)
    let editor = makeEditor()
    self.editor = editor
    editor.onConfirm = { [weak self] in self?.confirm() }
    editor.onCancel = { [weak self] in self?.cancel() }
    editor.onCopy = { [weak self] in self?.copy() }
    editor.onAsk = { [weak self] text in self?.ask(text) }
    editor.onInteriorClaimChange = { [weak self, weak owner] claimed in
      self?.interiorClaimed = claimed
      owner?.refreshCursor()
    }
    editor.elementTargets = { [weak self, weak owner] point in
      guard let self, let owner else { return [] }
      return await elementTargets(at: point, on: owner)
    }
    owner.annotationHost.passThrough = { [weak self] in self?.ownsPress(at: $0) ?? false }
    owner.annotationHost.scroll = { [weak editor] in editor?.scroll($0) ?? false }
    editor.show(in: owner.annotationHost, selection: rect, display: owner.display)
    owner.window?.makeKey()
  }

  /// Whether a press at `point` (the selection's overlay) is the session's rather than the
  /// editor's (D14): the handles and the edge band always, the interior until a tool claims it.
  private func ownsPress(at point: CGPoint) -> Bool {
    guard case .selected(let owner, let rect) = phase else { return false }
    if owner.model.handle(at: point, of: rect) != nil { return true }
    return !interiorClaimed && rect.contains(point)
  }

  /// The detected areas under a view point of `owner`, for the editor's one-click shapes: the
  /// targeting's Quartz answer in view points, cut to the display, smallest first.
  private func elementTargets(at point: CGPoint, on owner: CaptureOverlayView) async -> [CGRect] {
    guard detection != nil, !isFinished else { return [] }
    let display = owner.display.quartzFrame
    let areas = await targeting.targets(
      at: CaptureCoordinates.quartzPoint(point, display: display))
    return CaptureCoordinates.viewTargets(areas, display: display)
  }

  private func move(_ owner: CaptureOverlayView, to rect: CGRect) {
    phase = .selected(owner, rect)
    owner.showLoupe(at: nil)
    showSelection(owner, rect)
    editor?.selectionDidChange(rect)
    refreshHints()
  }

  /// The selection's chrome, handles included: it can always change.
  private func showSelection(_ owner: CaptureOverlayView, _ rect: CGRect) {
    owner.show(area: rect, handles: true)
  }

  private func showCreating(
    _ owner: CaptureOverlayView, _ drag: SelectionDrag, at point: CGPoint, square: Bool
  ) {
    owner.show(area: owner.model.rect(for: drag, to: point, square: square), handles: false)
    owner.showLoupe(at: owner.model.clamped(point))
  }
}
