import AppKit
import QuartzCore

/// Hover for the selection toolbar's buttons. Atd stays inactive while the toolbar shows (the
/// app with the selection keeps focus), and the window server delivers an inactive app's
/// tracking events late or drops them when the pointer moves fast, so the buttons' own tracking
/// areas lag behind the pointer. Instead, while the toolbar shows, this reads the pointer on
/// every display frame, washes the button under it and shows the pointing hand there, or the
/// open hand over the drag handle (``BackgroundCursor`` lets an inactive app set the cursor).
///
/// It is the one owner of the wash and the cursor across the toolbar's windows: the capsule's
/// buttons (``start(_:grip:in:)``) and, while they are open, the rows of its menus and submenus
/// (``add(_:)``, ``remove(_:)``), so no second tracker ever sets the cursor against it. The menus
/// time their submenus off the same frames (``onFrame``).
///
/// The frame callbacks pause once the pointer has rested away from those windows for
/// ``idleFrames``; the next move over another app (seen by the controller's monitor) resumes
/// them before the pointer can reach the toolbar or its menu, so hover never waits on a frame.
@MainActor
final class SelectionToolbarHover: NSObject {
  /// Called on every display frame while following, after the wash moved, with the followed view
  /// under the pointer (a button, a row or the grip), or nil. Frames pause only while the pointer
  /// rests away from every followed window, where no submenu timing is due.
  var onFrame: ((NSView?) -> Void)?

  /// Every button followed, in whichever window shows it.
  private var buttons: [any ToolbarHoverable] = []
  private var grip: NSView?
  /// The view the frame callbacks were made for (the toolbar's content): its window going away
  /// ends following.
  private var anchor: NSView?
  /// The view under the pointer: a button or the grip.
  private var hovered: NSView?
  private var link: CADisplayLink?
  /// Where the pointer was at the last frame, and for how many frames it stayed there.
  private var lastPointer: CGPoint?
  private var stillFrames = 0

  static let idleFrames = 30
  /// How close to the toolbar or its menu the pointer keeps the frame callbacks running even at
  /// rest.
  static let nearMargin: CGFloat = 24

  /// Follows the pointer over `buttons` and `grip` (if the capsule has one), shown in `view`'s
  /// window, until ``stop()``.
  func start(_ buttons: [any ToolbarHoverable], grip: NSView?, in view: NSView) {
    stop()
    BackgroundCursor.enable()
    self.grip = grip
    anchor = view
    let link = view.displayLink(target: self, selector: #selector(frame(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
    add(buttons)
  }

  /// Follows `buttons` too, shown in another window that goes with the toolbar (a menu's rows),
  /// until ``remove(_:)`` or ``stop()``.
  func add(_ buttons: [any ToolbarHoverable]) {
    for case let button as AnnotationToolbarButton in buttons { button.followsPointer = false }
    self.buttons += buttons
    resume()
  }

  /// Stops following `buttons` (the menu closed): one under the pointer loses its wash, and the
  /// cursor turns to whatever is under the pointer now.
  func remove(_ buttons: [any ToolbarHoverable]) {
    self.buttons.removeAll { button in buttons.contains { $0 === button } }
    if let button = hovered as? any ToolbarHoverable,
      !self.buttons.contains(where: { $0 === button })
    {
      button.isHovered = false
      hovered = nil
      NSCursor.arrow.set()
    }
    update()
  }

  /// Ends following; the cursor goes back to the arrow if the pointer was on a button, since
  /// the toolbar hides under it and no later move would restore it.
  func stop() {
    link?.invalidate()
    link = nil
    if hovered != nil { NSCursor.arrow.set() }
    (hovered as? any ToolbarHoverable)?.isHovered = false
    hovered = nil
    buttons = []
    grip = nil
    anchor = nil
    lastPointer = nil
    stillFrames = 0
  }

  /// The pointer moved outside the toolbar and its menu: resume the frame callbacks if they
  /// paused.
  func pointerMoved() {
    guard let link, link.isPaused else { return }
    resume()
  }

  private func resume() {
    stillFrames = 0
    link?.isPaused = false
    update()
  }

  @objc private func frame(_ link: CADisplayLink) {
    // Hidden by any path that skipped ``stop()`` (the app quitting orders every window out):
    // never keep firing for a window that is gone.
    guard let window = anchor?.window, window.isVisible else { return stop() }
    update()
    // Only from here, never from `add` or `remove`: what it does may open or close a menu.
    onFrame?(hovered)
    let pointer = NSEvent.mouseLocation
    stillFrames = pointer == lastPointer ? stillFrames + 1 : 0
    lastPointer = pointer
    if stillFrames >= Self.idleFrames, !isNear(pointer) { link.isPaused = true }
  }

  /// Whether `pointer` is within ``nearMargin`` of a window that shows something followed.
  private func isNear(_ pointer: CGPoint) -> Bool {
    let windows = (buttons.map(\.window) + [anchor?.window, grip?.window]).compactMap { $0 }
    return windows.contains {
      $0.frame.insetBy(dx: -Self.nearMargin, dy: -Self.nearMargin).contains(pointer)
    }
  }

  private func update() {
    guard link != nil else { return }
    let pointer = NSEvent.mouseLocation
    let candidates: [NSView] =
      buttons.filter(\.isEnabled).map { $0 as NSView } + (grip.map { [$0] } ?? [])
    let target = candidates.first { view in
      // Only the part not clipped away: a menu row scrolled out of its list is not under the
      // pointer. Views no longer clip to their bounds, so neither does their visible rect.
      let visible = view.visibleRect.intersection(view.bounds)
      guard let window = view.window, window.isVisible, !visible.isEmpty else { return false }
      return window.convertToScreen(view.convert(visible, to: nil)).contains(pointer)
    }
    if target !== hovered {
      (hovered as? any ToolbarHoverable)?.isHovered = false
      (target as? any ToolbarHoverable)?.isHovered = true
      hovered = target
      switch target {
      case nil: NSCursor.arrow.set()
      case let view? where view === grip: NSCursor.openHand.set()
      default: NSCursor.pointingHand.set()
      }
    }
  }
}

/// A control the toolbar's hover washes: a capsule button or a menu row. It draws its own wash
/// from ``isHovered``, which only the hover sets.
protocol ToolbarHoverable: NSControl {
  var isHovered: Bool { get set }
}

extension AnnotationToolbarButton: ToolbarHoverable {}
