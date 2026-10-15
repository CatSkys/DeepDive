import CoreGraphics
import Foundation
import ImageIO

/// The image a `screenshot.edit` session opens over the frozen screen (decision F2): an
/// archived capture's raw pixels with its annotations, or a downloaded image with none.
nonisolated struct ReopenBase: Sendable {
  let image: CGImage
  /// Pixels per point the image was captured at; nil takes the display's own (a downloaded
  /// image carries no scale the shell trusts).
  let scale: CGFloat?
  /// Selection-local annotations restored on the image, still editable.
  let document: AnnotationDocument

  /// Decodes downloaded bytes, applying an EXIF orientation, or nil when they are no image.
  @concurrent
  static func decode(_ data: Data) async -> ReopenBase? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: max(width, height),
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    return ReopenBase(image: image, scale: nil, document: AnnotationDocument())
  }

  /// Whether the image keeps its size on a screen of `size` points at `scale`, as restoring
  /// annotations needs. Without annotations it always opens.
  func opens(onScreen size: CGSize, scale displayScale: CGFloat) -> Bool {
    document.isEmpty
      || ReopenPlacement.place(
        width: image.width, height: image.height, imageScale: scale ?? displayScale,
        screen: size, displayScale: displayScale, keepsSize: true) != nil
  }

  /// The frozen `display` with the image drawn over it where ``ReopenPlacement`` puts it, and
  /// the image's rect (view points) the session preselects. The composite becomes the
  /// display's frozen image, so the crop, the loupe and mosaics all read the image. Nil when
  /// the image or the bitmap is unusable.
  @concurrent
  func compose(over display: FrozenDisplay) async -> (
    display: FrozenDisplay, selection: CGRect
  )? {
    let screen = display.quartzFrame.size
    let imageScale = scale ?? display.pixelScale
    // Annotations are restored in points, so they need the image at its size. The caller checked
    // that it fits (``opens(onScreen:scale:)``); a display rearranged since then still opens.
    guard
      let placement = ReopenPlacement.place(
        width: image.width, height: image.height, imageScale: imageScale, screen: screen,
        displayScale: display.pixelScale, keepsSize: !document.isEmpty)
        ?? ReopenPlacement.place(
          width: image.width, height: image.height, imageScale: imageScale, screen: screen,
          displayScale: display.pixelScale, keepsSize: false),
      let context = CaptureExport.bitmap(
        width: placement.compositeWidth, height: placement.compositeHeight, like: display.image)
    else { return nil }
    let height = CGFloat(placement.compositeHeight)
    context.interpolationQuality = .high
    context.draw(
      display.image,
      in: CGRect(x: 0, y: 0, width: placement.compositeWidth, height: placement.compositeHeight))
    let pixels = placement.imagePixels
    // One image pixel per composite pixel needs no interpolation; a capped composite does.
    let exact = Int(pixels.width) == image.width && Int(pixels.height) == image.height
    context.interpolationQuality = exact ? .none : .high
    context.draw(
      image,
      in: CGRect(
        x: pixels.minX, y: height - pixels.maxY, width: pixels.width, height: pixels.height))
    guard let composite = context.makeImage() else { return nil }
    return (
      FrozenDisplay(
        displayID: display.displayID, quartzFrame: display.quartzFrame, image: composite),
      placement.selection
    )
  }
}
