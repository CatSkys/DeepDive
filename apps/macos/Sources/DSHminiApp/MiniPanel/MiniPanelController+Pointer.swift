import AppKit
import QuartzCore
import SwiftUI

/// The pointer's side of the mini panel: the mouse-moved handler that answers the hot zone at once,
/// the frame callback that times the opening, the closing and the label and steps the window's
/// snap (``MiniPanelHover``), the wash and cursor under the pointer, presses, the controls'
/// actions and the context menu. Nothing it does per frame writes to the model unless something
/// changed.
extension MiniPanelController {
  /// A press, a drag, the context menu or a snap in flight holds the capsule open.
  var isHeld: Bool {
    window?.isPressing == true || model.phase.isDragging || menuOpen || snap != nil
  }

  /// Something needs the frames to keep coming while the pointer rests away from the panel.
  var isBusy: Bool {
    isHeld || hover.isTiming || labelTimer.isTiming || magnet.isTiming
      || dragWatch.session != nil || model.phase == .absorbing || pendingResponse != nil
  }

  func isNear(_ point: CGPoint) -> Bool {
    guard let layout, model.phase != .hidden else { return false }
    var shapes = [ScreenRect(drawnBody)]
    if model.flyoutOpen { shapes.append(ScreenRect(global(model.card.frame))) }
    return layout.isNear(point, shapes: shapes)
  }

  /// One display frame, drawn at `now` (the display link's target time), `elapsed` seconds after
  /// the last: a lost release ends, the window's snap steps, the pointer opens or closes the
  /// panel or draws a dragged item in, the control under it shows its wash, the hover label
  /// follows, and a response that reaches the screen with this frame is logged.
  func frame(at now: Double, elapsed: Double) {
    guard let window, window.isVisible, layout != nil else { return }
    let held = pressWatch.update(
      pressing: window.isPressing, dragging: window.isDragging,
      buttonDown: NSEvent.pressedMouseButtons & 1 == 1, at: now)
    if held != .none {
      Self.log.info("Mini panel press lost its release; ending it.")
      window.endHeldPress()
    }
    stepSnap(elapsed, at: now)
    let pointer = NSEvent.mouseLocation
    switch model.phase {
    case .tucked:
      hoverTucked(pointer, at: now)
    case .expanded:
      hoverExpanded(pointer, at: now)
    case .invite, .target:
      followDrag(pointer, at: now)
    case .hidden, .dragging, .draggingPill, .absorbing:
      break
    }
    track(pointer)
    updateLabel(at: now)
    logResponse(at: now)
  }

  /// A pointer event (the mouse-moved monitors), at the event's time: the hot zone answers here
  /// rather than on the next display frame, so the pill swells in the first frame after the
  /// pointer enters it, and the time away from the open capsule counts from the move itself, so
  /// it closes in the first frame its delay has run out by.
  func pointerMoved(to point: CGPoint, at time: Double) {
    switch model.phase {
    case .tucked: hoverTucked(point, at: time)
    case .expanded: hoverExpanded(point, at: time)
    default: break
    }
  }

  /// The open capsule: it closes once the pointer has stayed away from it for the delay.
  private func hoverExpanded(_ point: CGPoint, at time: Double) {
    guard let layout else { return }
    let near = layout.keepsOpen(point, flyoutOpen: model.flyoutOpen)
    guard hover.expanded(near: near, held: isHeld, at: time) == .collapse else { return }
    respond("close", at: CACurrentMediaTime(), settling: settling(.collapse, from: .capsule))
    collapse(trigger: "pointer left")
  }

  /// The tucked pill and the hot zone: swell at once, open after the dwell (or, opening on click,
  /// wait swollen for the click), relax on leaving.
  private func hoverTucked(_ point: CGPoint, at time: Double) {
    guard let layout else { return }
    let reduce = model.reduceMotion
    switch hover.tucked(inHotZone: layout.isInHotZone(point), at: time) {
    case .swell?:
      if openOn == .hover {
        respond(
          "open", at: time, settling: MiniPanelHover.dwell + settling(.expand, from: .swell))
        openStartedAt = time
      } else {
        respond("swell", at: time, settling: settling(.swell, from: .pill))
      }
      morphBody(to: .swell, motion: MiniPanelChoreography.shape(.swell, reduceMotion: reduce))
      pointer.wake()
    case .relax?:
      openStartedAt = nil
      morphBody(to: .pill, motion: MiniPanelChoreography.shape(.relax, reduceMotion: reduce))
    case .expand?:
      expand(trigger: "hover")
    case .collapse?, nil:
      break
    }
  }

  /// Notes a response to log on the next frame: `name`, triggered at `start`, which comes to rest
  /// `settling` seconds after it.
  func respond(_ name: String, at start: Double, settling: Double) {
    pendingResponse = (name, start, settling)
  }

  /// How long the body takes to come to rest as `moment` changes it from `from`, as it runs
  /// (``MiniPanelAxisAnimation/restTime(_:across:along:)``).
  func settling(_ moment: MiniPanelMoment, from: MiniPanelShape) -> Double {
    guard let layout else { return 0 }
    let to: MiniPanelShape =
      switch moment {
      case .swell: .swell
      case .relax, .collapse: .pill
      case .expand: .capsule
      case .invite, .untarget: .invite
      case .target: .target
      }
    let (old, new) = (layout.rect(of: from), layout.rect(of: to))
    return MiniPanelAxisAnimation.restTime(
      MiniPanelChoreography.shape(moment, reduceMotion: model.reduceMotion),
      across: max(abs(new.x - old.x), abs(new.maxX - old.maxX)),
      along: max(abs(new.y - old.y), abs(new.maxY - old.maxY)))
  }

  /// Logs how long a response took to reach the screen (this frame's display time, which shows
  /// what was committed before it) from its trigger, and when its shape comes to rest.
  private func logResponse(at now: Double) {
    guard let (name, start, settling) = pendingResponse else { return }
    pendingResponse = nil
    let latency = (now - start) * 1000
    let settles = settling * 1000
    Self.log.info(
      """
      Mini panel \(name, privacy: .public) responds after \
      \(latency, format: .fixed(precision: 1), privacy: .public) ms and settles \
      \(settles, format: .fixed(precision: 0), privacy: .public) ms after its trigger
      """)
  }

  /// Opens the capsule. `awaitingVisit`: the pointer did not open it (VoiceOver's press), so it
  /// stays open until the pointer has been near it.
  func expand(trigger: String, awaitingVisit: Bool = false) {
    guard model.phase == .tucked else { return }
    if openStartedAt == nil {
      respond("open", at: CACurrentMediaTime(), settling: settling(.expand, from: .pill))
    }
    openStartedAt = nil
    refreshPanelKey()
    transition(to: .expanded, trigger: trigger)
    hover.reset(awaitingVisit: awaitingVisit)
  }

  func collapse(trigger: String) {
    guard model.phase == .expanded else { return }
    transition(to: .tucked, trigger: trigger)
  }

  // MARK: Hover

  /// The control under `point`: a row of the open card, or a capsule button where the capsule's
  /// content is drawn, inside the body's clip.
  func control(at point: CGPoint) -> MiniPanelControl? {
    guard model.phase == .expanded, let layout else { return nil }
    if model.flyoutOpen, snap == nil, global(model.card.frame).contains(point) {
      guard !isOnScrollbar(point) else { return nil }
      let row = layout.row(at: point, scroll: model.flyoutScroll, count: commands.count)
      return row.map { .row($0) }
    }
    guard drawnBody.contains(point) else { return nil }
    let content = drawn(.capsule)
    let shifted = CGPoint(
      x: point.x - (content.minX - layout.capsule.x),
      y: point.y - (content.minY - layout.capsule.y))
    let buttons = MiniPanelControl.buttons()
    guard let index = layout.button(at: shifted), buttons.indices.contains(index) else {
      return nil
    }
    return buttons[index]
  }

  /// The wash follows the control under the pointer, and the cursor says what a press would do
  /// there (``BackgroundCursor`` lets the inactive app set it): the pointing hand over a button
  /// or a row, and over the tucked pill and the space a click opens it from while it opens on
  /// click, the open hand over the rest of the pill and the capsule, the closed hand while
  /// dragging. A drag session owns the cursor while it runs.
  private func track(_ pointer: CGPoint) {
    var hovered: MiniPanelControl?
    var cursor: NSCursor?
    switch model.phase {
    case .tucked:
      if isInClickZone(pointer) {
        cursor = .pointingHand
      } else if drawnBody.contains(pointer) {
        cursor = .openHand
      }
    case .expanded where snap == nil:
      hovered = control(at: pointer)
      if hovered != nil {
        cursor = .pointingHand
      } else if drawnBody.contains(pointer) {
        cursor = .openHand
      }
    case .dragging, .draggingPill:
      cursor = .closedHand
    default:
      break
    }
    if hovered != model.hovered { model.hovered = hovered }
    setCursor(cursor)
    trackScrollbar(pointer)
  }

  /// Sets `cursor` when it changes, and the arrow once when the panel no longer wants one.
  func setCursor(_ cursor: NSCursor?) {
    guard cursor !== self.cursor else { return }
    self.cursor = cursor
    (cursor ?? .arrow).set()
  }

  // MARK: Presses

  /// What a press at `point` lands on, wherever the body is drawn now.
  func pressTarget(at point: CGPoint) -> MiniPanelPress {
    switch model.phase {
    case .tucked, .expanded:
      if model.flyoutOpen, snap == nil, global(model.card.frame).contains(point) {
        return isOnScrollbar(point) ? .scroller : .card(control(at: point))
      }
      if drawnBody.contains(point) { return .body(control(at: point)) }
      return isInClickZone(point) ? .body(nil) : .none
    case .invite, .target, .absorbing:
      return .dropShape
    case .hidden, .dragging, .draggingPill:
      return .none
    }
  }

  /// A press went down: a snap in flight stops where it is, a label goes, and what is pressed
  /// goes in.
  func pressBegan(_ target: MiniPanelPress) {
    // A press on Commands keeps its label, text and all, for the card its click opens.
    if target == .body(.commands) { holdLabel() } else { dropLabel() }
    if snap != nil {
      snap = nil
      snapInterrupted = true
    }
    showPress(target)
    pointer.wake()
  }

  /// A press ended without a drag: what was pressed bounces back (its click follows), and a snap
  /// the press stopped finishes.
  func pressEnded() {
    endPress()
    if snapInterrupted { resumeSnap() }
    releaseHeldLabel()
  }

  /// A click the panel takes itself rather than replaying it to SwiftUI: on the tucked pill, or
  /// anywhere a click opens it from while it opens on click, it opens. The controls take theirs.
  func click(_ target: MiniPanelPress) -> Bool {
    guard target == .body(nil), model.phase == .tucked else { return false }
    expand(trigger: "click")
    return true
  }

  /// Whether `point` is where a click opens the tucked pill while it opens on click: the hot zone,
  /// pill and all, out to the screen edge (``MiniPanelModel/clickZone``).
  private func isInClickZone(_ point: CGPoint) -> Bool {
    model.phase == .tucked && model.clickZone != nil && layout?.isInHotZone(point) == true
  }

  func perform(_ control: MiniPanelControl) {
    switch control {
    case .mark: actions.toggle()
    case .newTask: actions.newTask()
    case .ask: actions.ask()
    case .screenshot: actions.screenshot()
    case .commands:
      if model.flyoutOpen {
        closeFlyout(trigger: "commands", throughLabel: true)
      } else {
        openFlyout()
      }
      return
    case .row(let index):
      guard commands.indices.contains(index) else { return }
      let id = commands[index].id
      collapse(trigger: "command")
      actions.command(id)
    }
    // An action answers a VoiceOver expansion: from here the pointer's rule applies, which needs
    // the frames even if the pointer rests far away.
    hover.reset()
    pointer.wake()
  }

  // MARK: Context menu

  /// Move to the other edge, Open on Click (checked while it does), Hide Mini Panel, then
  /// Settings… (Settings › General).
  func makeMenu() -> NSMenu {
    let strings = ShellStrings.shared
    let menu = NSMenu()
    let other = placement.edge.opposite
    let move: ShellStringKey = other == .left ? .miniPanelMoveLeft : .miniPanelMoveRight
    menu.addItem(ActionMenuItem(strings.text(move)) { [weak self] in self?.move(to: other) })
    menu.addItem(
      ActionMenuItem(
        strings.text(.miniPanelOpenOnClick), isOn: { [weak self] in self?.openOn == .click }
      ) { [weak self] in
        guard let self else { return }
        setOpenOn(openOn == .click ? .hover : .click)
      })
    menu.addItem(
      ActionMenuItem(strings.text(.miniPanelHide)) { [weak self] in self?.setShown(false) })
    menu.addItem(.separator())
    menu.addItem(
      ActionMenuItem(strings.text(.menuSettings)) { [weak self] in self?.actions.openSettings() })
    return menu
  }

  func menuChanged(_ open: Bool) {
    menuOpen = open
    if open { dropLabel() }
    endPress()
    pointer.wake()
  }
}
