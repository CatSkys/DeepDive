import Foundation

/// Where a reopened screenshot sits on the frozen screen it is edited over (decision F2), in
/// the pixels of a composite image the session uses as that display's frozen image.
///
/// The image is centred at one point per `imageScale` pixels, scaled down to fit
/// ``fitFraction`` of the screen when it is larger. The composite's scale is chosen so the
/// image's pixels land on whole composite pixels one to one: the base is drawn without
/// resampling, and the selection over it crops exactly the image again. Only when that scale
/// would make the composite larger than ``maxCompositeLongEdge`` (while the display's own scale
/// does not) is the image drawn smaller.
public struct ReopenPlacement: Equatable, Sendable {
  /// The screen's share the image may cover when it has to be scaled down.
  public static let fitFraction: CGFloat = 0.85
  /// The composite's longest edge, in pixels, unless the display alone is larger.
  public static let maxCompositeLongEdge: CGFloat = 6144

  /// The composite image's size in pixels; it covers the whole screen.
  public let compositeWidth: Int
  public let compositeHeight: Int
  /// The image's place in the composite, whole pixels, origin top-left.
  public let imagePixels: CGRect
  /// The composite's pixels per point (its width over the screen's), which the frozen display
  /// built from it reports.
  public let pixelScale: CGFloat
  /// The image's rect in the display's view points: the selection the session starts with.
  public let selection: CGRect

  /// Places a `width` × `height` image whose pixels per point are `imageScale` on a screen of
  /// `screen` points whose own scale is `displayScale`. With `keepsSize` the image must keep its
  /// size (annotations are restored on it in points): nil when it would have to be scaled down,
  /// and it may then use the whole screen. Nil also for an empty image or screen.
  public static func place(
    width: Int, height: Int, imageScale: CGFloat, screen: CGSize, displayScale: CGFloat,
    keepsSize: Bool
  ) -> ReopenPlacement? {
    guard width > 0, height > 0, imageScale > 0, displayScale > 0, screen.width > 0,
      screen.height > 0
    else { return nil }
    let natural = CGSize(
      width: CGFloat(width) / imageScale, height: CGFloat(height) / imageScale)
    let room = keepsSize ? 1 : fitFraction
    let fit = min(1, room * screen.width / natural.width, room * screen.height / natural.height)
    if keepsSize, fit < 1 { return nil }
    // One image pixel per composite pixel, unless the composite would grow too large.
    let exact = imageScale / fit
    let ceiling = max(displayScale, maxCompositeLongEdge / max(screen.width, screen.height))
    let scale = min(exact, ceiling)
    let compositeWidth = max(Int((screen.width * scale).rounded()), 1)
    let compositeHeight = max(Int((screen.height * scale).rounded()), 1)
    let pixelScale = CGFloat(compositeWidth) / screen.width
    let drawn =
      scale == exact
      ? (width: width, height: height)
      : (
        width: Int((natural.width * fit * pixelScale).rounded()),
        height: Int((natural.height * fit * pixelScale).rounded())
      )
    let pixelWidth = min(max(drawn.width, 1), compositeWidth)
    let pixelHeight = min(max(drawn.height, 1), compositeHeight)
    let pixels = CGRect(
      x: (compositeWidth - pixelWidth) / 2, y: (compositeHeight - pixelHeight) / 2,
      width: pixelWidth, height: pixelHeight)
    // Dividing by the composite's own scale on both axes is what the crop multiplies back.
    let selection = CGRect(
      x: pixels.minX / pixelScale, y: pixels.minY / pixelScale,
      width: pixels.width / pixelScale, height: pixels.height / pixelScale)
    return ReopenPlacement(
      compositeWidth: compositeWidth, compositeHeight: compositeHeight, imagePixels: pixels,
      pixelScale: pixelScale, selection: selection)
  }
}
