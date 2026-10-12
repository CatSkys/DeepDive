import CoreGraphics

/// The work-area edge the mini panel rests against (`miniPanel.edge`).
public enum MiniPanelEdge: String, CaseIterable, Sendable {
  case left
  case right

  /// The edge the context menu offers to move to.
  public var opposite: MiniPanelEdge { self == .left ? .right : .left }
}

/// Where the mini panel rests on its display: the edge, and the pill center's fraction of the
/// work-area height from the top (`miniPanel.position`), so it keeps its relative place when the
/// work area changes size or the panel falls back to another display.
public struct MiniPanelPlacement: Equatable, Sendable {
  public static let standard = MiniPanelPlacement(edge: .right, position: 0.4)

  public var edge: MiniPanelEdge
  /// 0 at the top of the work area, 1 at the bottom; a stored value outside that range (or not
  /// a number) reads as the nearest valid one.
  public var position: Double

  public init(edge: MiniPanelEdge, position: Double) {
    self.edge = edge
    self.position = position.isNaN ? Self.standard.position : min(max(position, 0), 1)
  }
}

/// The mini panel's measurements in points (spec v1). Everything the shell draws, hit-tests and
/// animates derives from these, so the SwiftUI content and the AppKit pointer tracking agree.
public enum MiniPanelMetrics {
  // The resting pill.
  public static let pillWidth = 6.0
  public static let pillHeight = 44.0
  /// The fewest device pixels a glass shape may span across. Measured on macOS 26: Liquid Glass
  /// samples what lies behind it in blocks of 4 × 4 device pixels, and a shape that covers no
  /// whole block samples nothing and draws as a near-black fill, as a 6 pt pill on a 1x display
  /// does wherever it settles off that grid. A shape 8 pixels across covers a block wherever it
  /// lies.
  public static let glassMinPixels = 8.0
  /// The pill's distance from the work-area edge.
  public static let pillInset = 4.0
  /// The pill swollen as the pointer enters the hot zone (perf-v1): thicker, and a little longer.
  public static let swellWidth = 10.0
  public static let swellGrowth = 8.0

  // The open capsule, the invite capsule and the drop card share the column 8 pt from the edge.
  public static let capsuleWidth = 44.0
  public static let capsuleInset = 8.0
  /// What every shape keeps from the other edges of the work area.
  public static let margin = 8.0
  public static let buttonSide = 32.0
  public static let glyphSide = 16.0
  public static let buttonGap = 4.0
  /// The same on every side, so the capsule (radius 22) and the round buttons (radius 16) nest.
  public static let padding = 6.0
  /// The hairline under the Atd mark: 1 pt, 4 pt above and below, 8 pt in from the sides.
  public static let hairline = 1.0
  public static let hairlineMargin = 4.0
  public static let hairlineInset = 8.0

  // The commands card beside the capsule.
  public static let flyoutGap = 8.0
  public static let flyoutMinWidth = 180.0
  public static let flyoutMaxWidth = 280.0
  public static let rowHeight = 28.0
  public static let rowPadding = 8.0
  public static let cardPadding = 6.0
  /// Concentric with the rows' 8 pt highlight: 18 − 6 = 12 ≥ 8.
  public static let cardRadius = 18.0
  public static let rowRadius = 8.0
  /// More commands than this scroll inside the card.
  public static let maxVisibleRows = 8

  // A drag session's shapes.
  public static let inviteSize = WindowSize(width: 44, height: 96)
  public static let targetSize = WindowSize(width: 184, height: 112)
  public static let targetGlyphSide = 24.0

  // The hover label (hover-label-v1): 12 pt medium text on a 16 pt line, in a capsule.
  public static let labelTextSize = 12.0
  public static let labelPadding = 10.0
  public static let labelHeight = 26.0
  /// From the side of the capsule, or of the commands card for a row's label.
  public static let labelGap = 8.0
  public static let labelMaxWidth = 280.0

  // The pointer.
  /// The hot zone reaches this far in from the work-area edge…
  public static let hotZoneDepth = 20.0
  /// …and this far above and below the pill.
  public static let hotZoneSlop = 16.0
  /// How far outside the open capsule (and its card) the pointer may stray without closing it.
  public static let collapseMargin = 12.0
  /// How far a press must travel before it drags the panel rather than clicking.
  public static let moveThreshold = 3.0
  /// How close to the drawn shapes the pointer keeps the frame callbacks running at rest.
  public static let nearMargin = 48.0
  /// Transparent room around the farthest shapes, so the glass's shadow is never cut off.
  public static let shadowRoom = 24.0
  /// Room around the body's shapes for its springs' overshoot, so its glass never leaves the
  /// lane it is drawn in.
  public static let overshootRoom = 12.0

  /// The pill's thickness on a display with `backingScale` device pixels per point:
  /// ``pillWidth``, or ``glassMinPixels`` where that is wider (8 pt on a 1x display).
  public static func pillWidth(backingScale: Double) -> Double {
    max(pillWidth, glassMinPixels / max(backingScale, 1))
  }

  /// The capsule's height: padding, the Atd mark, the hairline with its margins, New task, Ask
  /// and Screenshot, and Commands while the pushed list is not empty.
  public static func capsuleHeight(hasCommands: Bool) -> Double {
    let buttons = hasCommands ? 4.0 : 3.0
    return padding * 2 + buttonSide + hairlineMargin * 2 + hairline + buttons * buttonSide
      + (buttons - 1) * buttonGap
  }

  /// The commands card for `rows` commands, at most ``maxVisibleRows`` of them visible.
  public static func flyoutHeight(rows: Int) -> Double {
    cardPadding * 2 + Double(min(max(rows, 1), maxVisibleRows)) * rowHeight
  }

  /// The card fits the longest name (`textWidth`, measured by the shell) within its bounds.
  public static func flyoutWidth(textWidth: Double) -> Double {
    min(max(textWidth + rowPadding * 2 + cardPadding * 2, flyoutMinWidth), flyoutMaxWidth)
  }

  /// The transparent window every state is drawn in: wide enough for the card and a row's hover
  /// label beside it on either side of the capsule column, so either edge's shapes fit however
  /// the canvas moves to stay on its display, and tall enough for the card's farthest reach from
  /// the column's anchor (``MiniPanelLayout/canvas``).
  public static var canvasSize: WindowSize {
    let reach = capsuleWidth / 2 + flyoutGap + flyoutMaxWidth + labelGap + labelMaxWidth
    return WindowSize(
      width: 2 * (reach + shadowRoom), height: 2 * (verticalReach + shadowRoom))
  }

  /// How far above or below the anchor (the center of a full-height capsule, see
  /// ``MiniPanelLayout``) any shape can reach: the full card beside the Commands button, which
  /// reaches furthest, or a full-height capsule.
  static var verticalReach: Double {
    let capsule = capsuleHeight(hasCommands: true) / 2
    let commandsCenter = capsule - padding - buttonSide / 2
    let card = flyoutHeight(rows: maxVisibleRows)
    // The card's last row sits level with the Commands button, so the card rises from there.
    let above = card - (rowHeight / 2 + cardPadding) - commandsCenter
    return max(above, capsule)
  }
}

extension ScreenRect {
  /// The smallest rectangle holding every one of `rects`; empty at the origin for none.
  static func bounds(of rects: [ScreenRect]) -> ScreenRect {
    let (minX, minY) = (rects.map(\.x).min() ?? 0, rects.map(\.y).min() ?? 0)
    let (maxX, maxY) = (rects.map(\.maxX).max() ?? 0, rects.map(\.maxY).max() ?? 0)
    return ScreenRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  /// Grown by `amount` on every side.
  func outset(by amount: Double) -> ScreenRect {
    ScreenRect(
      x: x - amount, y: y - amount, width: width + amount * 2, height: height + amount * 2)
  }

  func contains(_ point: CGPoint) -> Bool {
    contains(x: Double(point.x), y: Double(point.y))
  }

  var midX: Double { x + width / 2 }
  var midY: Double { y + height / 2 }
}
