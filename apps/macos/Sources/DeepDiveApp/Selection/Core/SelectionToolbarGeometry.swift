import CoreGraphics
import Foundation

/// Where the selection toolbar goes, in Cocoa global points (origin bottom-left of the primary
/// display, y up; displays left of or below it have negative origins). The toolbar sits ``gap``
/// above the selection, centered on it; below it when there is no room above; and inside the
/// display's work area by ``margin`` in any case. A selection the app reports no bounds for,
/// or bounds on no display (some apps answer zeros), gives way to the pointer, taken as one
/// text line around it. A selection too tall for either side (a long passage) does the same,
/// so the toolbar never covers the middle of it.
public enum SelectionToolbarPlacement {
  public static let gap = 8.0
  public static let margin = 8.0
  /// Half the height of the text line assumed around the pointer.
  public static let pointerLineHalfHeight = 10.0

  /// A display: its whole frame, which decides where a point is, and its work area
  /// (`NSScreen.visibleFrame`), which the toolbar stays inside.
  public struct Display: Equatable, Sendable {
    public let frame: ScreenRect
    public let workArea: ScreenRect

    public init(frame: ScreenRect, workArea: ScreenRect) {
      self.frame = frame
      self.workArea = workArea
    }
  }

  /// The toolbar's frame for a selection at `selection` (Cocoa points, nil when unknown) and
  /// the pointer at `pointer`; nil without displays (a transient state while they rearrange).
  public static func frame(
    size: WindowSize, selection: ScreenRect?, pointer: CGPoint, displays: [Display]
  ) -> ScreenRect? {
    guard
      let index = DisplaySelection.index(
        nearestTo: pointer.x, pointer.y, in: displays.map(\.frame))
    else { return nil }
    let pointerDisplay = displays[index].workArea
    let pointerLine = ScreenRect(
      x: pointer.x, y: pointer.y - pointerLineHalfHeight, width: 0,
      height: pointerLineHalfHeight * 2)
    if let selection, selection.height > 0, selection.width >= 0,
      let display = displays.first(where: {
        $0.frame.contains(
          x: selection.x + selection.width / 2, y: selection.y + selection.height / 2)
      }),
      let y = verticalPosition(size: size, anchor: selection, within: display.workArea)
    {
      return place(size: size, anchor: selection, y: y, within: display.workArea)
    }
    let y =
      verticalPosition(size: size, anchor: pointerLine, within: pointerDisplay)
      ?? clamp(
        pointerLine.maxY + gap, pointerDisplay.y + margin,
        pointerDisplay.maxY - margin - size.height)
    return place(size: size, anchor: pointerLine, y: y, within: pointerDisplay)
  }

  /// Above the anchor when the toolbar fits there, else below it; nil when it fits on neither.
  private static func verticalPosition(
    size: WindowSize, anchor: ScreenRect, within area: ScreenRect
  )
    -> Double?
  {
    let above = anchor.maxY + gap
    if above + size.height <= area.maxY - margin, above >= area.y + margin { return above }
    let below = anchor.y - gap - size.height
    if below >= area.y + margin, below + size.height <= area.maxY - margin { return below }
    return nil
  }

  /// Centered on the anchor, kept `margin` inside the work area horizontally.
  private static func place(
    size: WindowSize, anchor: ScreenRect, y: Double, within area: ScreenRect
  )
    -> ScreenRect
  {
    let x = clamp(
      anchor.x + anchor.width / 2 - size.width / 2, area.x + margin,
      area.maxX - margin - size.width)
    return ScreenRect(x: x, y: y, width: size.width, height: size.height)
  }

  /// `value` within `lower...upper`; `lower` wins when the range is empty (a display narrower
  /// or shorter than the toolbar keeps its left or bottom margin).
  private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
    max(lower, min(value, upper))
  }
}

/// The selection toolbar's row (visual spec, contracts §6): a 4 pt padded glass capsule with
/// 2 pt between items, Ask Atd first, then one button per command while the toolbar stays
/// within ``maxWidth``, then a More button for the rest.
public enum SelectionToolbarLayout {
  public static let maxWidth = 420.0
  public static let padding = 4.0
  public static let gap = 2.0
  /// The square More button.
  public static let moreWidth = 28.0
  /// The drag handle that leads the row, as the capture toolbar's.
  public static let gripWidth = 16.0

  /// How many commands, in order, get a button of their own after the grip and Ask; the others
  /// go in More. Widths are the buttons' as measured; `endingWidths`, where given, are each
  /// command's when it ends the row with no More after it (a split button's chevron widens there).
  public static func visibleCommandCount(
    askWidth: Double, commandWidths: [Double], endingWidths: [Double]? = nil
  ) -> Int {
    func width(_ count: Int, more: Bool) -> Double {
      var commands = Array(commandWidths.prefix(count))
      if !more, count > 0, let ending = endingWidths?[count - 1] { commands[count - 1] = ending }
      let items = [gripWidth, askWidth] + commands + (more ? [moreWidth] : [])
      return padding * 2 + items.reduce(0, +) + gap * Double(items.count - 1)
    }
    if width(commandWidths.count, more: false) <= maxWidth { return commandWidths.count }
    var count = commandWidths.count - 1
    while count > 0, width(count, more: true) > maxWidth { count -= 1 }
    return max(count, 0)
  }
}
