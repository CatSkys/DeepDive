import AppKit

/// The selection toolbar's More menu: the commands that did not fit the capsule, a row each, on
/// a Liquid Glass panel of its own (``SelectionToolbarMenuLayout``, placed by
/// ``SelectionToolbarMenuPlacement``). It replaces the system menu More used to pop up, which,
/// opened from an app that is not active, highlighted an item only once the window server got
/// round to delivering its tracking events. Its rows are the toolbar's own labelled buttons,
/// stretched to the longest row with the name leading, and the toolbar's
/// ``SelectionToolbarHover`` washes them on every display frame like the capsule's buttons.
///
/// Its window never takes the keyboard or activates Atd, sits above the toolbar at the same
/// level and joins every Space like it (``SelectionToolbarPanel/makeWindow()``), and reaches
/// ``SelectionToolbarPanel/inset`` past the glass on every side, so the glass's shadow is never
/// cut off; that margin is transparent. Command names are user data and stay untranslated; a long
/// one is cut with an ellipsis like on the capsule and shows in full as the row's tooltip. A list
/// taller than the room scrolls; a scroll over it scrolls the list, one over another app still
/// hides the toolbar.
///
/// VoiceOver reads it as a menu named like the More button, with a menu item per command.
final class SelectionToolbarMenu: NSObject {
  /// A row was clicked, with its command's id; the owner hides the toolbar and the menu.
  var onChoose: ((String) -> Void)?

  private let window = SelectionToolbarPanel.makeWindow()
  private let hover: SelectionToolbarHover
  /// The commands behind the rows, in order: a row's tag is its command's index.
  private var commands: [SelectionToolbarSettings.Command] = []
  private var rows: [AnnotationToolbarButton] = []

  /// `hover` is the toolbar's: one owner for the wash and the cursor across both windows.
  init(hover: SelectionToolbarHover) {
    self.hover = hover
    super.init()
  }

  var isOpen: Bool { window.isVisible }

  /// Shows a row per command beside `anchor` (screen points): the More button's column through
  /// the toolbar's capsule, which ``SelectionToolbarMenuPlacement`` measures the gap from.
  func open(_ commands: [SelectionToolbarSettings.Command], from anchor: NSRect) {
    close()
    let names = commands.map(\.name)
    let rowWidth = names.map { AnnotationToolbarButton.Label.width(text: $0, hasImage: false) }
      .max()
    guard let rowWidth else { return }
    let content = SelectionToolbarMenuLayout.size(rowWidth: rowWidth, rowCount: names.count)
    let displays = NSScreen.screens.map {
      SelectionToolbarPlacement.Display(
        frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame))
    }
    guard
      let placed = SelectionToolbarMenuPlacement.frame(
        size: content, anchor: ScreenRect(anchor), displays: displays)
    else { return }
    self.commands = commands
    rows = names.enumerated().map { index, name in
      let row = AnnotationToolbarButton(
        label: name, image: nil, width: rowWidth, action: #selector(rowClicked))
      row.tag = index
      row.toolTip = name
      row.setAccessibilityRole(.menuItem)
      row.target = self
      return row
    }
    let inset = SelectionToolbarPanel.inset
    let frame = NSRect(placed).insetBy(dx: -inset, dy: -inset)
    let container = MenuContainer(frame: NSRect(origin: .zero, size: frame.size))
    container.wantsLayer = true
    container.onPressOutside = { [weak self] in self?.close() }
    let glass = makeGlass(rows: rows, scrolls: placed.height < content.height)
    glass.frame = container.bounds.insetBy(dx: inset, dy: inset)
    container.surface = glass
    container.addSubview(glass)
    window.contentView = container
    window.setFrame(frame, display: true)
    window.orderFrontRegardless()
    hover.add(rows)
  }

  /// Takes the menu off the screen and its rows out of hover; nothing to do when it is closed.
  func close() {
    if !rows.isEmpty { hover.remove(rows) }
    rows = []
    commands = []
    guard window.contentView != nil else { return }
    window.orderOut(nil)
    window.contentView = nil
  }

  /// The glass panel around the rows' list, which scrolls when the panel is shorter than the
  /// list. The list is clipped to the glass's own corners (the glass does not clip its content),
  /// so a row scrolled half out of sight never shows past them.
  private func makeGlass(rows: [AnnotationToolbarButton], scrolls: Bool) -> NSGlassEffectView {
    let layout = SelectionToolbarMenuLayout.self
    let list = MenuList(views: rows)
    list.orientation = .vertical
    list.alignment = .leading
    list.spacing = layout.rowGap
    list.edgeInsets = NSEdgeInsets(
      top: layout.padding, left: layout.padding, bottom: layout.padding, right: layout.padding)
    list.frame = NSRect(origin: .zero, size: list.fittingSize)
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    scroll.automaticallyAdjustsContentInsets = false
    scroll.horizontalScrollElasticity = .none
    scroll.verticalScrollElasticity = .none
    scroll.scrollerStyle = .overlay
    scroll.hasVerticalScroller = scrolls
    // The scroller runs along the straight part of the edge, clear of the rounded corners.
    scroll.scrollerInsets = NSEdgeInsets(
      top: layout.cornerRadius, left: 0, bottom: layout.cornerRadius, right: 0)
    scroll.documentView = list
    // A scroll view clips to its bounds; rounding its layer like the glass rounds that clip.
    scroll.wantsLayer = true
    scroll.clipsToBounds = true
    scroll.layer?.cornerRadius = layout.cornerRadius
    scroll.layer?.cornerCurve = .continuous
    // The rows are the menu's items, not a scroll area's.
    scroll.setAccessibilityElement(false)
    let glass = NSGlassEffectView()
    glass.cornerRadius = layout.cornerRadius
    glass.contentView = scroll
    glass.setAccessibilityElement(true)
    glass.setAccessibilityRole(.menu)
    glass.setAccessibilityLabel(ShellStrings.shared.text(.selectionToolbarMore))
    return glass
  }

  @objc private func rowClicked(_ sender: NSButton) {
    guard commands.indices.contains(sender.tag) else { return }
    onChoose?(commands[sender.tag].id)
  }
}

/// The rows top down from the list's origin, so a list taller than the panel opens at its first
/// row.
private final class MenuList: NSStackView {
  override var isFlipped: Bool { true }
}

/// The menu window's content. The glass's shadow in the transparent margin can keep a press
/// there from passing to the window below, where the toolbar's More button sits under the
/// margin, so a press off the glass closes the menu, as a press outside a menu does.
private final class MenuContainer: NSView {
  var onPressOutside: (() -> Void)?
  weak var surface: NSView?

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    guard let surface, !surface.frame.contains(convert(event.locationInWindow, from: nil))
    else { return }
    onPressOutside?()
  }
}
