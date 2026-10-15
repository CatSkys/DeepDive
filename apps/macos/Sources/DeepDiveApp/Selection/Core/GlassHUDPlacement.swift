import CoreGraphics
import Foundation

/// Where a glass status HUD stands (the selection toolbar's listening HUD, a command's progress),
/// in Cocoa global points (origin bottom-left of the primary display, y up). Its home is the
/// bottom centre of the work area of the display under the pointer, ``bottomMargin`` above the
/// work area's bottom edge; wherever it is (home, or where a drag left it), it stays
/// ``SelectionToolbarPlacement/margin`` inside the work area of the display that holds most of it.
public enum GlassHUDPlacement {
  public typealias Display = SelectionToolbarPlacement.Display

  /// Distance from the bottom of the work area at home.
  public static let bottomMargin = 24.0

  /// The capsule's origin at home for a capsule of `size`. `fallback` (the main display) stands in
  /// when the pointer is on no display; without either, the origin (a transient state while
  /// displays rearrange).
  public static func home(
    size: WindowSize, pointer: CGPoint, displays: [Display], fallback: Display?
  ) -> CGPoint {
    let display = displays.first { $0.frame.contains(x: pointer.x, y: pointer.y) } ?? fallback
    guard let area = display?.workArea else { return .zero }
    return CGPoint(x: area.x + area.width / 2 - size.width / 2, y: area.y + bottomMargin)
  }

  /// `frame` kept ``SelectionToolbarPlacement/margin`` inside the work area of the display that
  /// holds most of it, or of `fallback` when it is on none (a display was removed).
  public static func clamped(_ frame: ScreenRect, displays: [Display], fallback: Display?)
    -> ScreenRect
  {
    let best = displays.max { overlap($0.frame, frame) < overlap($1.frame, frame) }
    let display = best.flatMap { overlap($0.frame, frame) > 0 ? $0 : nil } ?? fallback
    guard let work = display?.workArea else { return frame }
    let margin = SelectionToolbarPlacement.margin
    let area = ScreenRect(
      x: work.x + margin, y: work.y + margin, width: work.width - margin * 2,
      height: work.height - margin * 2)
    var result = frame
    result.x = min(max(frame.x, area.x), area.maxX - frame.width)
    result.y = min(max(frame.y, area.y), area.maxY - frame.height)
    return result
  }

  /// The area two rectangles share; 0 when they only touch or are apart.
  static func overlap(_ a: ScreenRect, _ b: ScreenRect) -> Double {
    let width = min(a.maxX, b.maxX) - max(a.x, b.x)
    let height = min(a.maxY, b.maxY) - max(a.y, b.y)
    return width > 0 && height > 0 ? width * height : 0
  }
}
