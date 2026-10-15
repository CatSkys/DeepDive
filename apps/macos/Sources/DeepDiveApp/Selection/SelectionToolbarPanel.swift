import AppKit

/// The selection toolbar's window (visual spec, contracts §6): a borderless, non-activating
/// panel that never becomes key, so the app with the selection keeps the keyboard and its
/// selection while the user clicks. The Liquid Glass capsule (``AnnotationGlassBar``) owns the
/// edge and shadow; the window draws nothing of its own. The window reaches ``inset`` past the
/// capsule on every side, so the glass's shadow and the entrance's movement are never cut off
/// at its edge; that margin is transparent, so clicks there go to the app below.
///
/// Ask Atd comes first, then a button per command while the capsule stays within
/// ``SelectionToolbarLayout/maxWidth``, then More, which opens the remaining commands in
/// ``SelectionToolbarMenu`` and closes it again. The menu goes whenever the toolbar does, and
/// when a drag of the toolbar starts. Command names are user data and stay untranslated; the
/// rest of the copy is read in the current shell language each time the toolbar shows.
final class SelectionToolbarPanel: NSObject {
  var onAsk: (() -> Void)?
  var onCommand: ((String) -> Void)?

  /// The transparent margin around the capsule.
  static let inset: CGFloat = 24

  private let window = SelectionToolbarPanel.makeWindow()
  private var commands: [SelectionToolbarSettings.Command] = []
  /// The commands behind More, in order.
  private var overflow: [SelectionToolbarSettings.Command] = []
  /// Follows the pointer over the capsule and, while it is open, the menu.
  private let hover: SelectionToolbarHover
  private let menu: SelectionToolbarMenu
  /// The window frame that put the capsule beside the selection; a double-click returns it.
  private var placed: NSRect?
  /// The window's origin when the current drag began.
  private var dragOrigin: NSPoint?

  override init() {
    let hover = SelectionToolbarHover()
    self.hover = hover
    menu = SelectionToolbarMenu(hover: hover)
    super.init()
    menu.onChoose = { [weak self] id in
      self?.hide()
      self?.onCommand?(id)
    }
  }

  /// The toolbar's window, and its menu's: a borderless panel that draws nothing of its own,
  /// stays up while Atd is inactive, and shows on every Space and beside full-screen apps
  /// without joining the window cycle.
  static func makeWindow() -> ToolbarWindow {
    let window = ToolbarWindow(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = ShellWindowLevel.selectionToolbar
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.becomesKeyOnlyIfNeeded = true
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle,
    ]
    return window
  }

  var isVisible: Bool { window.isVisible }

  func setCommands(_ commands: [SelectionToolbarSettings.Command]) {
    self.commands = commands
  }

  /// Builds the row and shows it beside `selection` (Quartz points from Accessibility), or at
  /// the pointer when the app gave no bounds.
  func show(selection quartz: CGRect?, pointer: CGPoint) {
    // A menu still open belongs to the More button this replaces.
    menu.close()
    let (bar, buttons, grip) = makeContent()
    let size = bar.fittingSize
    let screens = NSScreen.screens
    let primaryHeight = screens.first?.frame.height ?? 0
    let selection = quartz.map {
      ScreenRect(CaptureCoordinates.flip($0, primaryHeight: primaryHeight))
    }
    guard
      let frame = SelectionToolbarPlacement.frame(
        size: WindowSize(width: size.width, height: size.height), selection: selection,
        pointer: pointer,
        displays: screens.map {
          .init(frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame))
        })
    else { return }
    let windowFrame = NSRect(frame).insetBy(dx: -Self.inset, dy: -Self.inset)
    placed = windowFrame
    // A plain layer-backed container under the capsule carries the entrance transform, so the
    // glass view's own layer is never touched.
    let container = NSView(frame: NSRect(origin: .zero, size: windowFrame.size))
    container.wantsLayer = true
    bar.frame = container.bounds.insetBy(dx: Self.inset, dy: Self.inset)
    container.addSubview(bar)
    window.contentView = container
    window.setFrame(windowFrame, display: true)
    window.orderFrontRegardless()
    let anchorY = selection.map { $0.y + $0.height / 2 } ?? pointer.y
    SelectionToolbarEntrance.play(on: container, capsule: bar.frame, upward: frame.y >= anchorY)
    hover.start(buttons, grip: grip, in: container)
  }

  /// The pointer moved over another app (the controller's dismissal monitor), which wakes
  /// hover tracking, for the capsule and the menu alike, if it paused.
  func pointerMoved() {
    hover.pointerMoved()
  }

  /// Takes the toolbar and its menu off the screen.
  func hide() {
    hover.stop()
    menu.close()
    placed = nil
    dragOrigin = nil
    guard window.isVisible else { return }
    window.orderOut(nil)
    window.contentView = nil
  }

  // MARK: Content

  /// The glass row, its buttons in order, and its drag handle.
  private func makeContent() -> (AnnotationGlassBar, [AnnotationToolbarButton], NSView) {
    let strings = ShellStrings.shared
    let grip = AnnotationBarGrip()
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = strings.text(.captureToolbarMove)
    let ask = AnnotationToolbarButton(
      label: strings.text(.selectionToolbarAsk),
      image: nil,
      action: #selector(askClicked))
    ask.toolTip = strings.text(.selectionToolbarAskTooltip)
    let buttons = commands.enumerated().map { index, command in
      let button = AnnotationToolbarButton(
        label: command.name, image: nil, action: #selector(commandClicked))
      button.tag = index
      button.toolTip = command.name
      return button
    }
    let visible = SelectionToolbarLayout.visibleCommandCount(
      askWidth: ask.fittingSize.width, commandWidths: buttons.map { $0.fittingSize.width })
    overflow = Array(commands.dropFirst(visible))
    var items: [AnnotationToolbarButton] = [ask] + Array(buttons.prefix(visible))
    if !overflow.isEmpty {
      let more = AnnotationToolbarButton(selection: nil, action: #selector(moreClicked))
      more.image = AnnotationIcons.glyph(
        SelectionToolbarIcons.more, label: strings.text(.selectionToolbarMore))
      more.setAccessibilityLabel(strings.text(.selectionToolbarMore))
      more.toolTip = strings.text(.selectionToolbarMoreTooltip)
      items.append(more)
    }
    for button in items { button.target = self }
    let bar = AnnotationGlassBar(
      groups: [[grip] + (items as [NSView])], padding: SelectionToolbarLayout.padding)
    bar.onDrag = { [weak self] in self?.drag($0) }
    bar.setAccessibilityElement(true)
    bar.setAccessibilityRole(.toolbar)
    bar.setAccessibilityLabel(strings.text(.selectionToolbar))
    return (bar, items, grip)
  }

  // MARK: Moving

  /// The grip or the capsule's surface moves the toolbar, like the capture toolbar: it stays
  /// where it is dropped, inside the work area of the display under it, until it hides; a
  /// double-click puts it back beside the selection. A press there closes the menu, which would
  /// otherwise be left behind.
  private func drag(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began:
      menu.close()
      dragOrigin = window.frame.origin
    case .moved(let travel):
      guard let dragOrigin else { return }
      var capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
      capsule.origin = NSPoint(
        x: dragOrigin.x + Self.inset + travel.dx, y: dragOrigin.y + Self.inset - travel.dy)
      let origin = clamped(capsule).origin
      window.setFrameOrigin(NSPoint(x: origin.x - Self.inset, y: origin.y - Self.inset))
    case .reset:
      dragOrigin = nil
      if let placed { window.setFrame(placed, display: true, animate: true) }
    }
  }

  /// The capsule's `frame` kept ``SelectionToolbarPlacement/margin`` inside the work area of
  /// the display that holds most of it.
  private func clamped(_ frame: NSRect) -> NSRect {
    let screen =
      NSScreen.screens.max {
        $0.frame.intersection(frame).area < $1.frame.intersection(frame).area
      } ?? window.screen
    guard
      let area = screen?.visibleFrame.insetBy(
        dx: SelectionToolbarPlacement.margin, dy: SelectionToolbarPlacement.margin)
    else { return frame }
    var result = frame
    result.origin.x = min(max(frame.minX, area.minX), area.maxX - frame.width)
    result.origin.y = min(max(frame.minY, area.minY), area.maxY - frame.height)
    return result
  }

  @objc private func askClicked() {
    hide()
    onAsk?()
  }

  @objc private func commandClicked(_ sender: NSButton) {
    guard commands.indices.contains(sender.tag) else { return }
    let id = commands[sender.tag].id
    hide()
    onCommand?(id)
  }

  /// Opens the menu under (or over) the capsule, aligned with More, or closes it if it is open.
  @objc private func moreClicked(_ sender: NSButton) {
    guard !menu.isOpen else { return menu.close() }
    let button = window.convertToScreen(sender.convert(sender.bounds, to: nil))
    let capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
    menu.open(
      overflow,
      from: NSRect(x: button.minX, y: capsule.minY, width: button.width, height: capsule.height))
  }
}

/// The toolbar's Lucide glyphs, template image sets in the App target's asset catalog
/// (`App/Assets.xcassets/Selection/lucide-<name>.imageset`), found like ``AnnotationIcons``'s.
/// Source: the icon nodes of `lucide-react` 1.49.0 (ISC), the version pinned in
/// `pnpm-workspace.yaml`, written out as unmodified 24 × 24 SVGs.
enum SelectionToolbarIcons {
  static let more = "ellipsis"
}

/// A panel that never takes the keyboard: clicks act on its buttons, keys stay with the app
/// that has the selection.
final class ToolbarWindow: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

extension NSRect {
  fileprivate var area: CGFloat { isNull ? 0 : width * height }
}
