import AppKit
import OSLog
import SwiftUI

/// The Mini Panel (spec v1): Atd's always-there quick entry on a screen edge. A Liquid Glass pill
/// rests against the left or right edge of one display's work area; a click on it (or, set to
/// open on hover, pointing at it) opens a capsule of quick actions, which can be dragged anywhere
/// and springs to the nearest edge on release; a drag of files, images, text or links anywhere on
/// screen turns it into a drop target whose drop joins the task panel's current draft and is
/// never sent by itself.
///
/// This is the one owner of the panel's state machine (``MiniPanelPhase``), its window
/// (``MiniPanelWindow``), its motion (motion-v2) and its settings (``MiniPanelSettings``). Its
/// controls and drops reach the shell's existing flows through ``Actions``. The shown setting
/// has its one owner here: the bridge, the menus and the context menu all change it through
/// ``setShown(_:)``. Extensions own the layout on the display (`+Layout`), the choreography of
/// each change (`+Choreography`), the pointer and the response logs (`+Pointer`), the hover label
/// (`+Label`), dragging and snapping (`+Motion`), and drag sessions and drops (`+Drop`); the
/// state they share is internal only for them. Nothing is written to the model while anything
/// moves (perf-v1): changes set targets and animations once, and SwiftUI runs them.
final class MiniPanelController {
  static let log = Logger(subsystem: "com.deepdive.app", category: "mini-panel")

  /// What the panel's controls and drops do, all through the shell's existing flows.
  struct Actions {
    /// The Atd mark: brings the main window forward (user decision 2026-10-14 — it used to be
    /// the task panel's toggle; the panel keeps ⌥Space and the main window's own entries).
    var openMainWindow: () -> Void
    /// New task: the panel shows, then its page starts a new task.
    var newTask: () -> Void
    /// Ask about selection, which reads the app in front: Atd never activated.
    var ask: () -> Void
    var screenshot: () -> Void
    /// A command row's summon, by command id.
    var command: (String) -> Void
    /// Settings… on the context menu: Settings › General.
    var openSettings: () -> Void
    /// Dropped files and folders, received promises and long text as a file: the panel shows and
    /// they go into its composer, like the Finder service's.
    var openItems: ([URL]) -> Void
    /// A dropped bitmap without a file, imported like a pasted image.
    var importImage: (Data) -> Void
    /// Dropped text to quote, through Ask with the text as the selection.
    var askAbout: (String) -> Void
    /// Shows the task panel, for a drop whose content is still on its way.
    var showPanel: () -> Void
    /// A drop that came to nothing: the panel shows and reports it like an import's failures.
    var reportFailures: ([ResourcesImportedEvent.Failure]) -> Void
    /// The shown or the open-on setting changed, for the pages' `miniPanel.state`.
    var stateChanged: () -> Void

    static var inert: Actions {
      Actions(
        openMainWindow: {}, newTask: {}, ask: {}, screenshot: {}, command: { _ in },
        openSettings: {}, openItems: { _ in }, importImage: { _ in }, askAbout: { _ in },
        showPanel: {}, reportFailures: { _ in }, stateChanged: {})
    }
  }

  /// Why the panel is off the screen for a while; it returns once no reason is left.
  enum Withdrawal: String {
    case capture
    case systemPanel
  }

  var actions = Actions.inert
  let model = MiniPanelModel()
  let settings: MiniPanelSettings
  let folder = MiniPanelDropFolder.forMainBundle()
  let pointer = MiniPanelPointer()
  let dragWatch = MiniPanelDragWatch()
  private(set) var isShown: Bool
  private(set) var commands: [MiniPanelSetCommandsParams.Command] = []
  private(set) var flyoutWidth = MiniPanelMetrics.flyoutMinWidth
  /// The rows whose name the card cuts short, which the hover label shows in full.
  private(set) var truncatedRows: Set<Int> = []
  private var withdrawals: Set<Withdrawal> = []
  private var observers: [NSObjectProtocol] = []

  // Shared with the extensions.
  var window: MiniPanelWindow?
  var placement: MiniPanelPlacement
  /// The display the panel shows on now, which can be the main display standing in for the
  /// saved one.
  var display: String?
  var layout: MiniPanelLayout?
  var hover = MiniPanelHover()
  /// The shape the body is headed for; nil while hidden.
  var bodyShape: MiniPanelShape?
  /// A response to a pointer event or a decision still to be logged on the next frame: its name,
  /// when it began, and how long after that it comes to rest.
  var pendingResponse: (name: String, start: Double, settling: Double)?
  /// When the open that is under way began, for its settle log.
  var openStartedAt: Double?
  /// Bumped by every release's stretch and every drop's squash, so a stale relax never lands.
  var deformToken = 0
  /// Bumped by every open and close of the commands card, so a stale close never lands.
  var flyoutToken = 0
  var labelTimer = MiniPanelLabelTimer<MiniPanelControl>()
  /// Bumped by every label change, so a stale fade never takes the glass off a shown label.
  var labelToken = 0
  var magnet = MiniPanelMagnet()
  /// The window springing to rest.
  var snap: MiniPanelSnapMotion?
  /// A press stopped the snap mid-flight; a click there lets it finish.
  var snapInterrupted = false
  /// Ends a press whose release another tracking loop took.
  var pressWatch = MiniPanelPressWatch()
  /// A press on the body's surface holds its squish until the release.
  var bodyPressed = false
  /// Where a press holds the scrollbar's thumb, from its top, while it drags it.
  var scrollerGrab: Double?
  /// A drag lifted the body.
  var lifted = false
  var menuOpen = false
  /// The cursor the panel set last, or nil when it set none.
  var cursor: NSCursor?
  /// The drop card waiting for a drop after its session ended.
  var dropGrace: Task<Void, Never>?

  init(defaults: UserDefaults = .standard) {
    settings = MiniPanelSettings(defaults: defaults)
    isShown = settings.shown
    placement = settings.placement
    model.labels = .current()
    model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    model.perform = { [weak self] control in self?.perform(control) }
    model.expand = { [weak self] in self?.expand(trigger: "press", awaitingVisit: true) }
    model.collapse = { [weak self] in self?.collapse(trigger: "accessibility") }
    pointer.onFrame = { [weak self] now, elapsed in self?.frame(at: now, elapsed: elapsed) }
    pointer.onMove = { [weak self] point, time in self?.pointerMoved(to: point, at: time) }
    pointer.isNear = { [weak self] point in self?.isNear(point) ?? false }
    pointer.isBusy = { [weak self] in self?.isBusy ?? false }
    dragWatch.onBegin = { [weak self] offer in self?.dragSessionBegan(offer) }
    dragWatch.onMove = { [weak self] in self?.pointer.wake() }
    dragWatch.onEnd = { [weak self] point in self?.dragSessionEnded(at: point) }
  }

  /// Shows the panel when it is on, and follows displays, wake, the language and Reduce Motion.
  func start() {
    observe()
    folder.pruneInBackground()
    present(trigger: "launch")
  }

  /// The shown setting's one owner: `miniPanel.setShown`, Show Mini Panel in the menus and Hide
  /// Mini Panel on the context menu all land here. It is saved, and the pages learn it.
  func setShown(_ shown: Bool) {
    guard shown != isShown else { return }
    isShown = shown
    settings.setShown(shown)
    if shown { present(trigger: "shown") } else { dismiss(trigger: "turned off") }
    actions.stateChanged()
  }

  /// `miniPanel.setCommands`: the Commands button shows while the list is not empty, the card
  /// fits the longest name, and names the card cuts short get a hover label.
  func setCommands(_ commands: [MiniPanelSetCommandsParams.Command]) {
    guard commands != self.commands else { return }
    self.commands = commands
    let font = NSFont.systemFont(ofSize: 13, weight: .medium)
    let widths = commands.map {
      Double(($0.name as NSString).size(withAttributes: [.font: font]).width.rounded(.up))
    }
    flyoutWidth = MiniPanelMetrics.flyoutWidth(textWidth: widths.max() ?? 0)
    let room =
      flyoutWidth - (MiniPanelMetrics.cardPadding + MiniPanelMetrics.rowPadding) * 2
    truncatedRows = Set(widths.indices.filter { widths[$0] > room })
    // Rows that fit have no scroll view, so nothing scrolls them.
    if commands.count <= MiniPanelMetrics.maxVisibleRows { model.flyoutScroll = 0 }
    layout = makeLayout()
    if commands.isEmpty, model.flyoutOpen {
      // No Commands button is left to close into: the card closes into the shorter capsule.
      closeFlyout(trigger: "commands removed", into: restRect(of: .capsule))
    }
    model.commands = commands
    applyLayout()
    // An open capsule grows or shrinks to hold the Commands button.
    if model.phase == .expanded {
      morphBody(
        to: .capsule, motion: MiniPanelChoreography.shape(.expand, reduceMotion: model.reduceMotion)
      )
    }
  }

  /// Takes the panel off the screen during a capture session or while a system open or save
  /// panel is up, and back once nothing withdraws it.
  func setWithdrawn(_ withdrawn: Bool, for reason: Withdrawal) {
    let wasWithdrawn = !withdrawals.isEmpty
    if withdrawn { withdrawals.insert(reason) } else { withdrawals.remove(reason) }
    let isWithdrawn = !withdrawals.isEmpty
    guard isWithdrawn != wasWithdrawn, isShown else { return }
    if !isWithdrawn {
      present(trigger: "\(reason.rawValue) ended")
    } else {
      dismiss(trigger: reason.rawValue)
    }
  }

  // MARK: Showing

  /// Puts the tucked pill on screen, unless the panel is off or withdrawn.
  private func present(trigger: String) {
    guard isShown, withdrawals.isEmpty else { return }
    let window = window ?? makeWindow()
    relayout()
    if model.phase == .hidden { transition(to: .tucked, trigger: trigger) }
    window.orderFrontRegardless()
    if let view = window.contentView { pointer.start(in: view) }
    dragWatch.start()
  }

  private func dismiss(trigger: String) {
    pointer.stop()
    dragWatch.stop()
    snap = nil
    snapInterrupted = false
    dropGrace?.cancel()
    window?.cancelPress()
    setCursor(nil)
    labelTimer = MiniPanelLabelTimer()
    if model.phase != .hidden { transition(to: .hidden, trigger: trigger) }
    model.hovered = nil
    window?.orderOut(nil)
  }

  private func makeWindow() -> MiniPanelWindow {
    let size = MiniPanelMetrics.canvasSize
    model.canvas = CGSize(width: size.width, height: size.height)
    let host = MiniPanelHostingView(rootView: MiniPanelView(model: model))
    // The controller sizes the window; SwiftUI adds no size constraints or safe areas of its own.
    host.sizingOptions = []
    host.safeAreaRegions = []
    host.frame = NSRect(origin: .zero, size: model.canvas)
    let content = MiniPanelDropView(content: host)
    content.drops = self
    let window = MiniPanelWindow(content: content, size: model.canvas)
    window.pressTarget = { [weak self] point in self?.pressTarget(at: point) ?? .none }
    window.onPress = { [weak self] target in self?.pressBegan(target) }
    window.onPressEnded = { [weak self] in self?.pressEnded() }
    window.onClick = { [weak self] target in self?.click(target) ?? false }
    window.onDragBegan = { [weak self] in self?.dragBegan() }
    window.onDragMoved = { [weak self] in self?.pointer.wake() }
    window.onDragEnded = { [weak self] samples in self?.dragEnded(samples) }
    window.onScroller = { [weak self] phase in self?.scroller(phase) }
    window.makeMenu = { [weak self] in self?.makeMenu() }
    window.onMenu = { [weak self] open in self?.menuChanged(open) }
    self.window = window
    return window
  }

  // MARK: State

  /// The state's name in the log: the phase, or `flyout` while the commands card is open.
  var stateName: String {
    model.phase == .expanded && model.flyoutOpen ? "flyout" : model.phase.rawValue
  }

  func logState(from: String, trigger: String) {
    let to = stateName
    guard from != to else { return }
    Self.log.info(
      """
      Mini panel \(from, privacy: .public) → \(to, privacy: .public) \
      (\(trigger, privacy: .public))
      """)
  }

  private func observe() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    let workspace = NSWorkspace.shared.notificationCenter
    let displays: @Sendable (Notification) -> Void = { [weak self] _ in
      MainActor.assumeIsolated { self?.displaysChanged() }
    }
    observers = [
      center.addObserver(
        forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main,
        using: displays),
      workspace.addObserver(
        forName: NSWorkspace.didWakeNotification, object: nil, queue: .main, using: displays),
      center.addObserver(forName: ShellStrings.didChange, object: nil, queue: .main) {
        [weak self] _ in MainActor.assumeIsolated { self?.model.labels = .current() }
      },
      workspace.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        }
      },
    ]
  }

  /// A display came, went or changed its work area, or the Mac woke: the panel lays itself out
  /// again where it belongs. A drag in progress is left alone; its release finds the displays.
  private func displaysChanged() {
    guard let window, window.isVisible, !model.phase.isDragging else { return }
    relayout()
  }
}
