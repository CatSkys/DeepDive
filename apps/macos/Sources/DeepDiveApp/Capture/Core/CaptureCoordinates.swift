import Foundation

/// The coordinate spaces of a screen capture, all in points unless a name says pixels:
///
/// - Cocoa: global, origin at the bottom-left of the primary display, y up (`NSScreen.frame`).
/// - Quartz: global, origin at the top-left of the primary display, y down (`CGDisplayBounds`,
///   Accessibility, `CGWindowList`, ScreenCaptureKit).
/// - View: one display's overlay view, flipped, origin at that display's top-left; it equals
///   Quartz minus the display's Quartz origin.
/// - Pixels: one display's frozen image, origin top-left, `scale` pixels per point.
///
/// Displays left of or above the primary one have negative origins in both global spaces, so
/// nothing here clamps to zero.
public enum CaptureCoordinates {
  /// Cocoa ↔ Quartz for a rect; the conversion is its own inverse. `primaryHeight` is the
  /// height of the primary display (`NSScreen.screens[0].frame.height`).
  public static func flip(_ rect: CGRect, primaryHeight: CGFloat) -> CGRect {
    CGRect(x: rect.minX, y: primaryHeight - rect.maxY, width: rect.width, height: rect.height)
  }

  /// Cocoa ↔ Quartz for a point; its own inverse.
  public static func flip(_ point: CGPoint, primaryHeight: CGFloat) -> CGPoint {
    CGPoint(x: point.x, y: primaryHeight - point.y)
  }

  /// A Quartz point in the overlay view of the display whose Quartz bounds are `display`.
  public static func viewPoint(_ quartz: CGPoint, display: CGRect) -> CGPoint {
    CGPoint(x: quartz.x - display.minX, y: quartz.y - display.minY)
  }

  public static func quartzPoint(_ view: CGPoint, display: CGRect) -> CGPoint {
    CGPoint(x: view.x + display.minX, y: view.y + display.minY)
  }

  /// A Quartz rect in the display's view, cut to the display; nil when it misses it.
  public static func viewRect(_ quartz: CGRect, display: CGRect) -> CGRect? {
    let cut = quartz.intersection(display)
    guard !cut.isNull, cut.width > 0, cut.height > 0 else { return nil }
    return cut.offsetBy(dx: -display.minX, dy: -display.minY)
  }

  /// Detected areas (Quartz) as the annotation editor wants them: in the display's view, cut to
  /// it, those that miss it dropped, smallest first (ties keep their order).
  public static func viewTargets(_ quartz: [CGRect], display: CGRect) -> [CGRect] {
    quartz.compactMap { viewRect($0, display: display) }
      .enumerated()
      .sorted {
        ($0.element.width * $0.element.height, $0.offset) < (
          $1.element.width * $1.element.height, $1.offset
        )
      }
      .map(\.element)
  }

  public static func quartzRect(_ view: CGRect, display: CGRect) -> CGRect {
    view.offsetBy(dx: display.minX, dy: display.minY)
  }

  /// Image pixels per point of a display; mixed setups differ per display, so this is never a
  /// global value.
  public static func pixelScale(pixelWidth: Int, pointWidth: CGFloat) -> CGFloat {
    pointWidth > 0 ? CGFloat(pixelWidth) / pointWidth : 1
  }

  /// The pixels of a view rect in a `width` × `height` image: each edge rounded to the nearest
  /// pixel, then cut to the image. Nil when nothing is left.
  public static func pixelRect(_ view: CGRect, scale: CGFloat, width: Int, height: Int)
    -> CGRect?
  {
    let minX = (view.minX * scale).rounded()
    let minY = (view.minY * scale).rounded()
    let maxX = (view.maxX * scale).rounded()
    let maxY = (view.maxY * scale).rounded()
    let rect = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
      .intersection(CGRect(x: 0, y: 0, width: width, height: height))
    guard !rect.isNull, rect.width >= 1, rect.height >= 1 else { return nil }
    return rect
  }

  /// Maps view points into the image cropped to `selection` by ``pixelRect(_:scale:width:height:)``
  /// (origin at its top-left pixel, y down, one unit per pixel), so what is drawn at a view point
  /// lands on the pixel the crop took from there, wherever the selection is.
  public static func cropTransform(selection: CGRect, scale: CGFloat) -> CGAffineTransform {
    CGAffineTransform(
      translationX: -(selection.minX * scale).rounded(), y: -(selection.minY * scale).rounded()
    )
    .scaledBy(x: scale, y: scale)
  }

  /// The pixel a view point falls in, kept inside a `width` × `height` image (the pointer can
  /// rest on the display's far edge, one point past its last pixel).
  public static func pixel(at view: CGPoint, scale: CGFloat, width: Int, height: Int)
    -> CapturePixel
  {
    CapturePixel(
      x: min(max(Int((view.x * scale).rounded(.down)), 0), max(width - 1, 0)),
      y: min(max(Int((view.y * scale).rounded(.down)), 0), max(height - 1, 0)))
  }

  /// An edge moved to the nearest pixel boundary of a display whose view origin is 0, so a
  /// selection crops whole device pixels.
  public static func snap(_ value: CGFloat, scale: CGFloat) -> CGFloat {
    scale > 0 ? (value * scale).rounded() / scale : value
  }

  /// Every edge of `rect` snapped; a rect of at least one pixel keeps at least one pixel.
  public static func snap(_ rect: CGRect, scale: CGFloat) -> CGRect {
    let minX = snap(rect.minX, scale: scale)
    let minY = snap(rect.minY, scale: scale)
    let maxX = snap(rect.maxX, scale: scale)
    let maxY = snap(rect.maxY, scale: scale)
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }
}

/// One pixel of a display image, origin top-left.
public struct CapturePixel: Equatable, Sendable {
  public var x: Int
  public var y: Int

  public init(x: Int, y: Int) {
    self.x = x
    self.y = y
  }
}
