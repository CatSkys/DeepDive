import Foundation

/// The selection toolbar's More menu (visual spec, contracts §6): the toolbar's labelled buttons
/// as rows of one common width, ``rowGap`` apart, on a glass panel padded like the capsule. The
/// panel's corner radius is a row's radius plus ``padding``, so its corners nest concentrically
/// with the rows' capsules, as the capsule's do with its buttons.
public enum SelectionToolbarMenuLayout {
  /// The same on every side, as the capsule's.
  public static let padding = SelectionToolbarLayout.padding
  /// Between rows, as between the capsule's buttons.
  public static let rowGap = SelectionToolbarLayout.gap
  /// The labelled button's height.
  public static let rowHeight = 28.0
  public static let cornerRadius = rowHeight / 2 + padding
  /// The shortest a list gets when the room for it is shorter still: one row.
  public static let minimumHeight = rowHeight + padding * 2

  /// A hairline between groups of rows (an options menu's Run row), with the room around it.
  public static let separatorHeight = 9.0

  /// The whole list's size: `rowCount` rows of `rowWidth` and `separatorCount` hairlines,
  /// padding included.
  public static func size(rowWidth: Double, rowCount: Int, separatorCount: Int = 0) -> WindowSize {
    let rows = Double(max(rowCount, 0))
    let separators = Double(max(separatorCount, 0))
    let items = rows + separators
    return WindowSize(
      width: rowWidth + padding * 2,
      height: rows * rowHeight + separators * separatorHeight + max(items - 1, 0) * rowGap
        + padding * 2)
  }
}

/// Where the More menu's panel goes, in Cocoa global points: ``gap`` below the toolbar's capsule
/// with its leading edge on the More button's, as the system menu it replaced sat; above the
/// capsule when the list does not fit below; and inside the work area of the display under the
/// button by ``SelectionToolbarPlacement/margin`` in any case. A list taller than the room on
/// both sides takes the side with more room, shortened to fit (it scrolls), but never below
/// ``SelectionToolbarMenuLayout/minimumHeight``.
public enum SelectionToolbarMenuPlacement {
  public static let gap = 4.0

  /// The panel's frame for a list of `size` opened from `anchor`, the More button's column
  /// through the capsule (the button's leading edge and width, the capsule's bottom and height),
  /// so the gap is measured from the capsule's visible edge; nil without displays (a transient
  /// state while they rearrange).
  public static func frame(
    size: WindowSize, anchor: ScreenRect, displays: [SelectionToolbarPlacement.Display]
  ) -> ScreenRect? {
    guard
      let index = DisplaySelection.index(
        nearestTo: anchor.x + anchor.width / 2, anchor.y + anchor.height / 2,
        in: displays.map(\.frame))
    else { return nil }
    let margin = SelectionToolbarPlacement.margin
    let area = displays[index].workArea
    let lowest = area.y + margin
    let highest = area.maxY - margin
    let below = anchor.y - gap - lowest
    let above = highest - (anchor.maxY + gap)
    let downward = size.height <= below || (size.height > above && below >= above)
    let height = max(
      min(size.height, downward ? below : above),
      min(size.height, SelectionToolbarMenuLayout.minimumHeight))
    let y = downward ? anchor.y - gap - height : anchor.maxY + gap
    return ScreenRect(
      x: clamp(anchor.x, area.x + margin, area.maxX - margin - size.width),
      y: clamp(y, lowest, highest - height), width: size.width, height: height)
  }
}

/// Where a submenu's panel goes (a command's option values, or its options from the More menu),
/// in Cocoa global points: ``gap`` past the trailing edge of its parent menu's panel, with its
/// first row level with the row that opened it; past the leading edge when it does not fit on
/// the trailing side; on the side with more room when it fits on neither, pushed inside the work
/// area (over its parent if it must). Vertically it stays inside the work area of the display
/// under that row by ``SelectionToolbarPlacement/margin``, shortened to fit when it is taller (it
/// scrolls), but never below ``SelectionToolbarMenuLayout/minimumHeight``.
public enum SelectionToolbarSubmenuPlacement {
  public static let gap = 4.0

  /// The panel's frame for a list of `size` opened from `row` (the row's frame on screen) of the
  /// parent panel at `parent`; nil without displays (a transient state while they rearrange).
  public static func frame(
    size: WindowSize, row: ScreenRect, parent: ScreenRect,
    displays: [SelectionToolbarPlacement.Display]
  ) -> ScreenRect? {
    guard
      let index = DisplaySelection.index(
        nearestTo: row.x + row.width / 2, row.y + row.height / 2, in: displays.map(\.frame))
    else { return nil }
    let margin = SelectionToolbarPlacement.margin
    let area = displays[index].workArea
    let left = area.x + margin
    let right = area.maxX - margin
    let lowest = area.y + margin
    let highest = area.maxY - margin
    let height = max(
      min(size.height, highest - lowest),
      min(size.height, SelectionToolbarMenuLayout.minimumHeight))
    let trailing = parent.maxX + gap
    let leading = parent.x - gap - size.width
    let x: Double
    if trailing + size.width <= right {
      x = trailing
    } else if leading >= left {
      x = leading
    } else {
      x = right - parent.maxX >= parent.x - left ? trailing : leading
    }
    // The list starts `padding` below the panel's top, so its first row meets the parent row.
    let top = row.maxY + SelectionToolbarMenuLayout.padding
    return ScreenRect(
      x: clamp(x, left, right - size.width), y: clamp(top - height, lowest, highest - height),
      width: size.width, height: height)
  }
}

/// `value` within `lower...upper`; `lower` wins when the range is empty (a display narrower or
/// shorter than the panel keeps its left or bottom margin).
private func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
  max(lower, min(value, upper))
}
