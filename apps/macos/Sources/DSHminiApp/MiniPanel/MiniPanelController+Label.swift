import AppKit
import QuartzCore
import SwiftUI

/// The hover label (hover-label-v1, its way in and out from hover-label-v2): the panel's own
/// tooltip, since AppKit delays or drops an inactive app's tooltips and Atd stays inactive while
/// the panel is used. A capsule button's name, or a commands row's full name when the card cuts it
/// short, shows beside the capsule (or the card) toward the interior after the pointer rests on it
/// (``MiniPanelLabelTimer``). The label grows out of the hovered control's middle, glides from
/// control to control while warm with its text cross-fading, and leaves the way it came: its text
/// fades, then it draws back into that middle (``MiniPanelLabelPath``). A press, a drag, the
/// panel closing, the card opening over it or a drag session sends it away at once, except that
/// a press on Commands keeps it for the card to grow out of. It is visual only: the controls keep
/// their own labels.
extension MiniPanelController {
  /// One frame of the label, with the control under the pointer. Writes only when the label
  /// changes.
  func updateLabel(at now: Double) {
    let hovered = model.hovered
    let item = hovered.flatMap { labels($0) ? $0 : nil }
    let suppressed = suppressesLabel(hovered)
    let previous = labelTimer.shown
    // Suppressed, the label stays away from the control under the pointer until the pointer
    // leaves it, as after a click, even from one that has no label now: Commands under its open
    // card does not show its label as soon as a click on it closes the card.
    let shown = labelTimer.update(
      item: suppressed ? hovered : item, suppressed: suppressed, at: now)
    if shown != previous {
      showLabel(shown, hadLabel: previous != nil)
    } else if shown == nil, let item, !model.label.drawn, !isSeeded(for: item) {
      // Warming up: the hidden label waits where it will grow from, so it starts from there.
      seedLabel(for: item)
    }
  }

  /// Whether `control` has a label now: a capsule button while the card is closed, a row whose
  /// name the open card cuts short.
  private func labels(_ control: MiniPanelControl) -> Bool {
    if case .row(let index) = control { return model.flyoutOpen && truncatedRows.contains(index) }
    return !model.flyoutOpen
  }

  private func suppressesLabel(_ hovered: MiniPanelControl?) -> Bool {
    if window?.isPressing == true || model.phase != .expanded || snap != nil || menuOpen
      || dragWatch.session != nil
    {
      return true
    }
    // The open card covers where a capsule button's label would show.
    if model.flyoutOpen, let hovered, !Self.isRow(hovered) { return true }
    return false
  }

  private static func isRow(_ control: MiniPanelControl) -> Bool {
    if case .row = control { return true }
    return false
  }

  /// The label's text: the control's name, or the row's command name, which is user data.
  private func labelText(_ control: MiniPanelControl) -> String {
    switch control {
    case .mark: model.markLabel
    case .newTask: model.labels.newTask
    case .ask: model.labels.ask
    case .screenshot: model.labels.screenshot
    case .commands: model.labels.commands
    case .row(let index): commands.indices.contains(index) ? commands[index].name : ""
    }
  }

  /// The middle of `control`, which its label grows out of and draws back into, and the shape
  /// the label shows beside (the capsule, or the card for a row), in global points.
  private func labelAnchor(_ control: MiniPanelControl) -> (point: CGPoint, beside: ScreenRect)? {
    guard let layout else { return nil }
    if case .row(let index) = control {
      guard let card = layout.flyout else { return nil }
      let middle =
        card.maxY - MiniPanelMetrics.cardPadding
        - (Double(index) + 0.5) * MiniPanelMetrics.rowHeight + model.flyoutScroll
      return (CGPoint(x: card.x + card.width / 2, y: middle), card)
    }
    let buttons = MiniPanelControl.buttons()
    guard let index = buttons.firstIndex(of: control), layout.buttons.indices.contains(index)
    else { return nil }
    let button = layout.buttons[index]
    return (
      CGPoint(x: button.x + button.width / 2, y: button.y + button.height / 2), layout.capsule
    )
  }

  /// The control's middle in the glass container.
  private func labelPoint(_ control: MiniPanelControl) -> CGPoint? {
    labelAnchor(control).map {
      local(ScreenRect(x: $0.point.x, y: $0.point.y, width: 0, height: 0)).origin
    }
  }

  /// Where `control`'s label rests and the middle it grows out of, in the glass container. Measures
  /// the text, so it runs only when the label changes.
  private func labelShape(_ control: MiniPanelControl) -> MiniPanelLabelShape? {
    guard let layout, let anchor = labelAnchor(control), let point = labelPoint(control)
    else { return nil }
    let text = labelText(control)
    let font = NSFont.systemFont(ofSize: MiniPanelMetrics.labelTextSize, weight: .medium)
    let measured = (text as NSString).size(withAttributes: [.font: font]).width
    let width = Double(measured.rounded(.up)) + MiniPanelMetrics.labelPadding * 2
    let rest = layout.hoverLabel(beside: anchor.beside, centerY: anchor.point.y, width: width)
    let lane = labelLane(beside: anchor.beside, middle: anchor.point.x, edge: layout.edge)
    return MiniPanelLabelShape(text: text, rest: local(rest), point: point, lane: local(lane))
  }

  /// Where any label beside `shape` can show, its controls' middles at `middle`: from the
  /// farthest a label reaches to those middles, along the whole shape, with room for the
  /// entrance's overshoot. The label view's fixed frame.
  private func labelLane(beside shape: ScreenRect, middle: Double, edge: MiniPanelEdge)
    -> ScreenRect
  {
    let room = MiniPanelMetrics.labelHeight
    let reach = MiniPanelMetrics.labelGap + MiniPanelMetrics.labelMaxWidth + room
    let minX = edge == .right ? shape.x - reach : middle - room
    let maxX = edge == .right ? middle + room : shape.maxX + reach
    return ScreenRect(
      x: minX, y: shape.y - room, width: maxX - minX, height: shape.height + room * 2)
  }

  /// The hidden label already waits at `control`'s middle with its text.
  private func isSeeded(for control: MiniPanelControl) -> Bool {
    model.label.progress == 0 && model.label.text == labelText(control)
      && model.label.point == labelPoint(control)
  }

  /// Puts the hidden label at `control`'s middle, drawn in, with its text gone.
  private func seedLabel(for control: MiniPanelControl) {
    guard let shape = labelShape(control) else { return }
    model.label = shape
    model.setPresence(
      .labelText, MiniPanelPresence(shown: false, motion: MiniPanelChoreography.labelText))
  }

  /// Shows `control`'s label (nil hides it): growing out of its middle, or gliding there from the
  /// control it showed for, or from wherever it was drawing back.
  private func showLabel(_ control: MiniPanelControl?, hadLabel: Bool) {
    guard let control, let shape = labelShape(control) else { return hideLabel() }
    labelToken += 1
    let token = labelToken
    let reduce = model.reduceMotion
    let kind = Self.isRow(control) ? "row" : control.identifier
    Self.log.debug("Mini panel hover label: \(kind, privacy: .public)")
    if hadLabel || model.label.drawn {
      // On screen, or still drawing back: it glides to the new control, its text cross-fading.
      model.label = MiniPanelLabelShape(
        text: shape.text, rest: shape.rest, point: shape.point, lane: shape.lane, progress: 1,
        drawn: true, animation: MiniPanelChoreography.labelGlide.reduced(reduce).animation)
      reveal(.labelText, MiniPanelChoreography.labelText)
      return
    }
    let appear = { [weak self] in
      guard let self, token == labelToken else { return }
      var label = model.label
      label.progress = 1
      label.drawn = true
      label.animation = MiniPanelChoreography.labelAppear.reduced(reduce).animation
      model.label = label
      reveal(.labelText, MiniPanelChoreography.labelText)
    }
    guard isSeeded(for: control), model.label.rest == shape.rest else {
      // The drawn-in label must be drawn where it grows from before it grows.
      seedLabel(for: control)
      Task {
        try? await Task.sleep(for: .seconds(MiniPanelMotion.frame))
        appear()
      }
      return
    }
    appear()
  }

  /// The label leaves the way it came: its text fades first, then its shape draws back into the
  /// control's middle without overshoot, merging with the capsule's glass until nothing is left of
  /// it. Anything still waiting to show it stops.
  private func hideLabel() {
    labelToken += 1
    conceal(.labelText, MiniPanelChoreography.labelText)
    guard model.label.drawn else { return }
    Self.log.debug("Mini panel hover label: hidden")
    retractLabel(after: MiniPanelChoreography.labelRetractDelay)
  }

  /// After `delay`, the label's bubble draws back into its control's middle without overshoot,
  /// merging with the capsule's glass, and its glass goes once it has.
  private func retractLabel(after delay: Double) {
    let token = labelToken
    let retract = MiniPanelChoreography.labelRetract
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(delay))
      guard let self, token == labelToken else { return }
      var label = model.label
      label.progress = 0
      label.animation = retract.animation
      model.label = label
      try? await Task.sleep(for: .seconds(MiniPanelMotion.settling(retract)))
      guard token == labelToken else { return }
      label.drawn = false
      label.animation = nil
      model.label = label
    }
  }

  /// Takes the label away at once, mid-appear or mid-glide alike, and keeps it away over the
  /// control under the pointer until the pointer leaves it: a press, a drag, a state change, the
  /// card opening over it, or the context menu.
  func dropLabel() {
    let hovered = model.hovered
    _ = labelTimer.update(item: hovered, suppressed: true, at: CACurrentMediaTime())
    hideLabel()
  }

  // MARK: The commands card

  /// How long a held label waits after its press for the card: the press's click is replayed
  /// after the release, so the card opens a few frames later.
  static let labelHoldGrace = 0.2

  /// A press on Commands, whose click grows the card out of the button's label: the label stays
  /// as it is, text and all, so no empty bubble waits on the press, until the card takes it
  /// (``takeLabelBubble(of:)``) or the press ends without one (``releaseHeldLabel()``).
  func holdLabel() {
    _ = labelTimer.update(item: model.hovered, suppressed: true, at: CACurrentMediaTime())
    labelToken += 1
  }

  /// A held label that no card took once the press's click has run leaves as any label does.
  func releaseHeldLabel() {
    guard model.label.drawn, model.label.progress == 1 else { return }
    let token = labelToken
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(Self.labelHoldGrace))
      guard let self, token == labelToken, model.label.drawn, !model.flyoutOpen else { return }
      hideLabel()
    }
  }

  /// Takes `control`'s label, if it is out, for the card that grows out of it: the card takes the
  /// bubble's place in the same frame and grows around it while the label's text fades out over
  /// it; then the bubble goes at once, held inside the card by then, so its glass, merged with the
  /// card's, leaves nothing to see. Otherwise the label goes as a press takes it. Returns where
  /// the bubble rests, in the glass container.
  func takeLabelBubble(of control: MiniPanelControl) -> CGRect? {
    guard model.label.drawn, model.label.progress == 1, model.label.point == labelPoint(control)
    else {
      dropLabel()
      return nil
    }
    _ = labelTimer.update(item: model.hovered, suppressed: true, at: CACurrentMediaTime())
    labelToken += 1
    let token = labelToken
    let text = MiniPanelChoreography.labelText
    conceal(.labelText, text)
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(text.exit))
      guard let self, token == labelToken else { return }
      var label = model.label
      label.progress = 0
      label.drawn = false
      label.animation = nil
      model.label = label
    }
    return model.label.rest
  }

  /// Where `control`'s label bubble rests, in the glass container: what the card closes through
  /// on its way into the control.
  func labelBubble(of control: MiniPanelControl) -> CGRect? { labelShape(control)?.rest }
}
