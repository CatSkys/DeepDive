import AppKit
import SwiftUI

/// What a press on the mini panel's window lands on.
enum MiniPanelPress: Equatable {
  /// Nothing drawn: SwiftUI gets the event as it is.
  case none
  /// The pill or the capsule, which a press that travels drags; the control under it, if any.
  case body(MiniPanelControl?)
  /// The commands card: a press there is a click on its row or nothing, never a drag.
  case card(MiniPanelControl?)
  /// A scrolling card's scrollbar: a press there drags its thumb, or jumps it to the press.
  case scroller
  /// The invite or the drop card, which a drag session owns.
  case dropShape

  var control: MiniPanelControl? {
    switch self {
    case .body(let control), .card(let control): control
    case .none, .scroller, .dropShape: nil
    }
  }
}

/// A press on a scrolling card's scrollbar as it goes down, moves and comes back up, at the
/// pointer in global coordinates (y up).
enum MiniPanelScrollerPhase: Equatable {
  case began(CGPoint)
  case moved(CGPoint)
  case ended
}

/// The mini panel's window (spec v1, Window): a borderless, non-activating panel that never
/// becomes key or main, so the app in front keeps the keyboard and its selection while the user
/// clicks. It is a transparent canvas holding every state (``MiniPanelLayout/canvas``); the
/// window server passes clicks and drags on its transparent pixels to the windows below, so only
/// the drawn glass takes them (which is why it never sets `ignoresMouseEvents`, which would make
/// every pixel take them). It floats one level above a pinned task panel, below menus and the
/// selection toolbar, on every Space and beside full-screen apps, without joining the window
/// cycle or the Windows menu, and draws no shadow of its own: the glass draws its own.
///
/// A left press on the drawn panel is held here rather than given to SwiftUI, as
/// ``DesktopPinWindow`` holds one: once a press on the pill or the capsule travels more than
/// ``MiniPanelMetrics/moveThreshold``, the window follows the pointer 1:1 and reports the drag's
/// samples on release (``onDragEnded``), and the owner snaps it to an edge. A press that travels
/// no further is a click: one the owner takes itself (``onClick``, the tucked pill's, which opens
/// it) ends there, and any other is posted again, press and release, and passes through to SwiftUI
/// in order. A press on the commands card that travels further is no click at all, and one on its
/// scrollbar is the scrollbar's own: it goes down, moves and comes back up through
/// ``onScroller``, and is never replayed. A right click or a control-click opens the context
/// menu. Pins resize from their corners and report frames,
/// so this keeps its own, smaller version of their press handling rather than sharing it.
final class MiniPanelWindow: NSPanel {
  static let level = ShellWindowLevel.miniPanel

  /// What lies under a point in global coordinates (y up).
  var pressTarget: ((NSPoint) -> MiniPanelPress)?
  /// A press went down on the drawn panel.
  var onPress: ((MiniPanelPress) -> Void)?
  /// The press ended without a drag: released (a click follows) or travelled off the card.
  var onPressEnded: (() -> Void)?
  /// A press released without travelling, a click: true when the owner acted on it itself, so it
  /// is not posted again for SwiftUI.
  var onClick: ((MiniPanelPress) -> Bool)?
  var onDragBegan: (() -> Void)?
  var onDragMoved: (() -> Void)?
  /// The drag's pointer samples, for the release velocity.
  var onDragEnded: (([MiniPanelSnap.Sample]) -> Void)?
  /// A press on a scrolling card's scrollbar, at the pointer.
  var onScroller: ((MiniPanelScrollerPhase) -> Void)?
  /// The context menu, built fresh in the current language each time it opens.
  var makeMenu: (() -> NSMenu?)?
  /// The context menu opened (true) or closed (false).
  var onMenu: ((Bool) -> Void)?

  private struct Press {
    let down: NSEvent
    let start: NSPoint
    let origin: NSPoint
    let target: MiniPanelPress
    var moving = false
    /// A card press that travelled: no click on release.
    var cancelled = false
    var samples: [MiniPanelSnap.Sample] = []
  }
  private var press: Press?
  /// The replayed press and release still to pass through.
  private var replaying: [NSEvent] = []
  /// Enough pointer samples to cover the release velocity's window at any event rate.
  private static let sampleLimit = 64

  init(content: NSView, size: NSSize) {
    super.init(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    level = Self.level
    collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    // NSPanel hides on deactivation by default, and Atd is an accessory app.
    hidesOnDeactivate = false
    becomesKeyOnlyIfNeeded = true
    isMovable = false
    isExcludedFromWindowsMenu = true
    isReleasedWhenClosed = false
    animationBehavior = .none
    contentView = content
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  /// Where the owner puts it: a borderless window is otherwise kept below the menu bar, and the
  /// canvas reaches past the work area near the top of the display.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }

  /// Whether a press is down on the panel, held here until its release.
  var isPressing: Bool { press != nil }
  /// Whether the held press has become a drag.
  var isDragging: Bool { press?.moving == true }

  /// Forgets a press whose release the window will not see: the panel left the screen.
  func cancelPress() {
    press = nil
    replaying = []
  }

  /// Ends a held press as its release would, without the click a release on the panel makes: a
  /// drag comes to rest where it is (``onDragEnded``), a press comes back out
  /// (``onPressEnded``). For a press whose release another tracking loop took (the owner's
  /// ``MiniPanelPressWatch``), and before the context menu runs its own.
  func endHeldPress() {
    guard let press else { return }
    self.press = nil
    replaying = []
    if press.target == .scroller {
      onScroller?(.ended)
    } else if press.moving {
      onDragEnded?(press.samples)
    } else if !press.cancelled {
      onPressEnded?()
    }
  }

  override func sendEvent(_ event: NSEvent) {
    if let index = replayIndex(of: event) {
      replaying.remove(at: index)
      return super.sendEvent(event)
    }
    switch event.type {
    case .rightMouseDown:
      showMenu(for: event)
    case .leftMouseDown:
      if event.modifierFlags.contains(.control) { return showMenu(for: event) }
      begin(event)
    case .leftMouseDragged where press != nil:
      follow(event)
    case .leftMouseUp where press != nil:
      release(event)
    default:
      super.sendEvent(event)
    }
  }

  private func target(of event: NSEvent) -> MiniPanelPress {
    pressTarget?(convertPoint(toScreen: event.locationInWindow)) ?? .none
  }

  private func begin(_ event: NSEvent) {
    let target = target(of: event)
    guard target != .none, target != .dropShape else { return super.sendEvent(event) }
    press = Press(down: event, start: NSEvent.mouseLocation, origin: frame.origin, target: target)
    onPress?(target)
    if target == .scroller {
      onScroller?(.began(convertPoint(toScreen: event.locationInWindow)))
    }
  }

  /// Follows the pointer as it is now, which is never older than the event being handled; the
  /// scrollbar follows the event itself.
  private func follow(_ event: NSEvent) {
    guard var press else { return }
    if press.target == .scroller {
      onScroller?(.moved(convertPoint(toScreen: event.locationInWindow)))
      return
    }
    let mouse = NSEvent.mouseLocation
    let (dx, dy) = (mouse.x - press.start.x, mouse.y - press.start.y)
    let threshold = MiniPanelMetrics.moveThreshold
    if !press.moving, !press.cancelled, dx * dx + dy * dy > threshold * threshold {
      if case .body = press.target {
        press.moving = true
        onDragBegan?()
      } else {
        press.cancelled = true
        onPressEnded?()
      }
    }
    if press.moving {
      setFrameOrigin(NSPoint(x: press.origin.x + dx, y: press.origin.y + dy))
      press.samples.append(
        MiniPanelSnap.Sample(time: ProcessInfo.processInfo.systemUptime, point: mouse))
      if press.samples.count > Self.sampleLimit { press.samples.removeFirst() }
    }
    self.press = press
    if press.moving { onDragMoved?() }
  }

  private func release(_ up: NSEvent) {
    guard let press else { return }
    self.press = nil
    if press.target == .scroller {
      onScroller?(.ended)
      return
    }
    if press.moving {
      onDragEnded?(press.samples)
      return
    }
    if press.cancelled { return }
    onPressEnded?()
    if onClick?(press.target) == true { return }
    replaying = [press.down, up]
    postEvent(press.down, atStart: false)
    postEvent(up, atStart: false)
  }

  /// The replayed event this is, matched by value in case the queue hands back a copy. Only left
  /// mouse events are compared: `eventNumber` raises for other types.
  private func replayIndex(of event: NSEvent) -> Int? {
    guard !replaying.isEmpty, event.type == .leftMouseDown || event.type == .leftMouseUp else {
      return nil
    }
    return replaying.firstIndex {
      $0.type == event.type && $0.timestamp == event.timestamp
        && $0.eventNumber == event.eventNumber
    }
  }

  /// Only on the drawn panel; the menu's tracking runs until it closes. A left press still held
  /// (a right-click during it) ends first: the menu's tracking takes its release.
  private func showMenu(for event: NSEvent) {
    guard target(of: event) != .none, let menu = makeMenu?(), let view = contentView else {
      return super.sendEvent(event)
    }
    endHeldPress()
    onMenu?(true)
    NSMenu.popUpContextMenu(menu, with: event, for: view)
    onMenu?(false)
  }
}

/// Hosts the mini panel's content, and takes the first click: the panel never becomes key.
final class MiniPanelHostingView: NSHostingView<MiniPanelView> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// The window's content view: the hosting view fills it, and it is the drop destination of drags
/// over the drawn panel, which the owner answers (``MiniPanelDropTarget``). A plain view owns
/// the registration because the hosting view manages its own dragged types for SwiftUI's drop
/// modifiers. The window server hands a drag only to drawn pixels, so the transparent canvas
/// never catches one.
final class MiniPanelDropView: NSView {
  weak var drops: (any MiniPanelDropTarget)?

  init(content: NSView) {
    super.init(frame: content.frame)
    content.autoresizingMask = [.width, .height]
    addSubview(content)
    registerForDraggedTypes(MiniPanelDragOffer.draggedTypes)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    drops?.dragOperation(for: sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    drops?.dragOperation(for: sender) ?? []
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    drops?.prepareDrop(sender) ?? false
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    drops?.performDrop(sender) ?? false
  }
}

/// The owner's side of a drag over the drawn panel. None of it changes the panel's state: only
/// the operation a drop would take, and the drop itself.
protocol MiniPanelDropTarget: AnyObject {
  /// The operation a drop would take: none outside the invite and the drop card, or for a drag
  /// with nothing to take.
  func dragOperation(for info: any NSDraggingInfo) -> NSDragOperation
  /// Whether a release here is a drop; a refused one is logged with its reason.
  func prepareDrop(_ info: any NSDraggingInfo) -> Bool
  /// Takes the drop; false when it has nothing to take.
  func performDrop(_ info: any NSDraggingInfo) -> Bool
}
