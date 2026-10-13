import CoreGraphics
import Foundation

/// Where the annotation toolbar and its style bar sit beside the selection, in the overlay
/// view's flipped points (y down). The two stack as one block, the style bar on the toolbar's
/// side away from the selection, `stack` apart, leading edges aligned. The block goes below the
/// selection by default (toolbar right-aligned to it); above it when there is no room below; and
/// inside its bottom edge when there is room on neither side (a selection that fills the display),
/// the style bar then above the toolbar. The style bar's room is kept even while it is hidden, so
/// the toolbar never jumps as it appears. Everything stays `margin` inside the display. Once the
/// user drags the bars, ``frames(toolbar:styleBar:at:within:stack:margin:)`` places them instead.
public enum AnnotationToolbarLayout {
  /// Room the overlay's "W × H" label takes above a selection (`CaptureChromeView`: a badge about
  /// 23 pt tall, 6 pt above the edge). A block placed above clears it rather than covering it.
  public static let sizeLabelReach: CGFloat = 30

  public static func frames(
    toolbar: CGSize, styleBar: CGSize, beside selection: CGRect, within display: CGRect,
    gap: CGFloat = 8, stack: CGFloat = 6, margin: CGFloat = 8
  ) -> (toolbar: CGRect, styleBar: CGRect) {
    let block = toolbar.height + stack + styleBar.height
    let below = selection.maxY + gap
    let above = selection.minY - sizeLabelReach - gap - block
    let toolbarY: CGFloat
    let styleY: CGFloat
    if below + block <= display.maxY - margin {
      toolbarY = below
      styleY = toolbarY + toolbar.height + stack
    } else if above >= display.minY + margin {
      styleY = above
      toolbarY = styleY + styleBar.height + stack
    } else {
      toolbarY = clamp(
        selection.maxY - gap - toolbar.height, display.minY + margin + styleBar.height + stack,
        display.maxY - margin - toolbar.height)
      styleY = toolbarY - stack - styleBar.height
    }
    let toolbarX = clamp(
      selection.maxX - toolbar.width, display.minX + margin, display.maxX - margin - toolbar.width)
    return stacked(
      toolbar: CGRect(origin: CGPoint(x: toolbarX, y: toolbarY), size: toolbar),
      styleBar: styleBar, styleY: styleY, within: display, margin: margin)
  }

  /// The block where the user dragged it: the toolbar at `origin`, kept `margin` inside the
  /// display, and the style bar below it when it fits there, else above it.
  public static func frames(
    toolbar: CGSize, styleBar: CGSize, at origin: CGPoint, within display: CGRect,
    stack: CGFloat = 6, margin: CGFloat = 8
  ) -> (toolbar: CGRect, styleBar: CGRect) {
    let toolbarFrame = CGRect(
      origin: CGPoint(
        x: clamp(origin.x, display.minX + margin, display.maxX - margin - toolbar.width),
        y: clamp(origin.y, display.minY + margin, display.maxY - margin - toolbar.height)),
      size: toolbar)
    let below = toolbarFrame.maxY + stack
    let styleY =
      below + styleBar.height <= display.maxY - margin
      ? below : toolbarFrame.minY - stack - styleBar.height
    return stacked(
      toolbar: toolbarFrame, styleBar: styleBar, styleY: styleY, within: display, margin: margin)
  }

  /// The style bar at `styleY`, its leading edge on the toolbar's unless that leaves the display.
  private static func stacked(
    toolbar: CGRect, styleBar: CGSize, styleY: CGFloat, within display: CGRect, margin: CGFloat
  ) -> (toolbar: CGRect, styleBar: CGRect) {
    let styleX = clamp(toolbar.minX, display.minX + margin, display.maxX - margin - styleBar.width)
    return (toolbar, CGRect(origin: CGPoint(x: styleX, y: styleY), size: styleBar))
  }

  /// `value` within `lower...upper`; `lower` wins when the range is empty (a toolbar wider
  /// than the display starts at its left margin).
  private static func clamp(_ value: CGFloat, _ lower: CGFloat, _ upper: CGFloat) -> CGFloat {
    max(lower, min(value, upper))
  }
}
