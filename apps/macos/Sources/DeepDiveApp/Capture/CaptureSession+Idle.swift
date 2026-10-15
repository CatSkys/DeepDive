import AppKit

/// What idle offers besides the detected area (decisions E5, F3): the hints, `R` for the last
/// region on the pointer's display and `W` for windows only.
extension CaptureSession {
  /// Idle: how to pick an area; at index 1 the Accessibility hint while detection offers only
  /// windows (``isTrustRequest(_:on:)`` relies on that place); then whether `W` chose windows
  /// only, and that `R` reuses this display's last region when there is one. Once a selection
  /// exists: how to adjust and confirm it, on its display only, in the same place.
  func hintTexts(on overlay: CaptureOverlayView) -> [String] {
    let strings = ShellStrings.shared
    switch phase {
    case .idle:
      var texts = [strings.text(.captureHintIdle)]
      if detection == .windowsOnly { texts.append(strings.text(.captureHintAccessibility)) }
      if onlyWindows { texts.append(strings.text(.captureHintWindowsOnly)) }
      if lastRegion(on: overlay) != nil { texts.append(strings.text(.captureHintRecall)) }
      return texts
    case .selected(let owner, _), .adjusting(let owner, _):
      return owner === overlay ? [strings.text(.captureHintSelected)] : []
    case .pressing, .creating:
      return []
    }
  }

  func refreshHints() {
    for overlay in overlays {
      overlay.showHints(hintTexts(on: overlay), avoiding: hintClearance(on: overlay))
    }
  }

  /// The band a hint must stay out of on `overlay`: the selection's rows with room for its size
  /// label and the annotation bars (toolbar, gap, style bar), which can sit above or below it and
  /// wider than it. Re-placed when a selection drag ends (`move`); while one runs, the hint stays.
  private func hintClearance(on overlay: CaptureOverlayView) -> CGRect? {
    guard case .selected(let owner, let rect) = phase, owner === overlay else { return nil }
    let reach = AnnotationToolbarLayout.sizeLabelReach + 8 + 40 + 6 + 40
    return CGRect(
      x: overlay.bounds.minX, y: rect.minY - reach, width: overlay.bounds.width,
      height: rect.height + reach * 2)
  }

  /// Whether a press at `point` is on the Accessibility hint while it can still ask for trust.
  func isTrustRequest(_ point: CGPoint, on overlay: CaptureOverlayView) -> Bool {
    offersTrustRequest && detection == .windowsOnly && overlay.hint(1, contains: point)
  }

  // MARK: Recall and windows only

  /// The region last confirmed on `overlay`'s display, while that display keeps its frame.
  func lastRegion(on overlay: CaptureOverlayView) -> CGRect? {
    regions.region(
      displayID: overlay.display.displayID, displayFrame: overlay.display.quartzFrame)
  }

  /// `R` in idle: the pointer's display's last region becomes the selection.
  func recallRegion() {
    guard case .idle = phase, let owner = pointer?.overlay, let region = lastRegion(on: owner)
    else { return }
    commit(owner, owner.model.settled(region))
  }

  /// `W` in idle: candidates shrink to the window and the display, or grow back to elements.
  /// Only meaningful while elements are detected.
  func toggleWindowsOnly() {
    guard case .idle = phase, detection == .elements else { return }
    onlyWindows.toggle()
    resetChain()
    refreshHints()
    renderIdle()
    requestHover()
  }
}
