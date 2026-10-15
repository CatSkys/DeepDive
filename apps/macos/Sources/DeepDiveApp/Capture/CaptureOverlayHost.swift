import AppKit

/// The annotation editor's canvas and bars live here. Its own area never takes the mouse, and
/// neither do the points `passThrough` answers true for (the session's: the selection's handles
/// and edge band, and its interior until a tool claims it), so those presses reach the overlay
/// view whatever the editor puts there — except the bars' controls, which sit inside the
/// selection when it fills the display and must still be clickable.
final class AnnotationHostView: NSView {
  /// Takes points in this view's (equally, the overlay's) coordinates.
  var passThrough: ((CGPoint) -> Bool)?
  /// Offered every scroll-wheel event over the overlay first, wherever it lands (canvas, bars or
  /// the overlay itself); true when the editor took it.
  var scroll: ((NSEvent) -> Bool)?

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    guard let hit, hit !== self else { return nil }
    if passThrough?(point) == true, !Self.isInBar(hit) { return nil }
    return hit
  }

  /// The cursor at `point` (the overlay's coordinates) when it is on one of the editor's bars:
  /// the arrow over a control, an open hand over the bar's surface, which drags it; nil off them.
  func barCursor(at point: CGPoint) -> NSCursor? {
    guard let hit = super.hitTest(point), Self.isInBar(hit) else { return nil }
    return sequence(first: hit, next: \.superview).contains { $0 is NSControl } ? .arrow : .openHand
  }

  private static func isInBar(_ view: NSView) -> Bool {
    sequence(first: view, next: \.superview).contains { $0 is AnnotationGlassBar }
  }
}

/// The frozen display image; drawn once, never hit.
final class FrozenImageView: NSImageView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
