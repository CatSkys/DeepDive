import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

/// Why ``CaptureExport/write(_:in:name:)`` produced no file. Callers word their own errors.
enum ImageExportFailure: Error, Equatable {
  /// ImageIO could not scale or encode the image.
  case unencodable
  /// Even the smallest JPEG fallback is over ``ScreenshotRules/maxImageBytes``.
  case tooLarge
  /// The file could not be written.
  case unwritable
}

/// Turns a confirmed selection into the file that is imported (decision D10): the frozen
/// display's pixels under the selection with the annotations drawn in, scaled to
/// ``ScreenshotRules/maxLongEdge`` and encoded as PNG, falling back to JPEG when the PNG is over
/// the service's image limit.
enum CaptureExport {
  /// A confirmed selection's pixels: with the annotations, and without them (the base a later
  /// edit reopens and what text recognition reads).
  struct Rendered {
    let image: CGImage
    let raw: CGImage
  }

  /// The selection's pixels (whole pixels nearest its edges) with and without `editor`'s
  /// annotations, at the display's native scale. Both are copies: a crop of the frozen image
  /// alone would keep the whole display's pixels alive while the raw image is archived.
  /// Annotation drawing belongs to the editor on the main actor.
  static func render(
    selection: CGRect, display: FrozenDisplay, editor: (any AnnotationEditing)?
  ) -> Rendered? {
    let image = display.image
    guard
      let pixels = CaptureCoordinates.pixelRect(
        selection, scale: display.pixelScale, width: image.width, height: image.height),
      let backdrop = image.cropping(to: pixels),
      let context = bitmap(width: backdrop.width, height: backdrop.height, like: backdrop)
    else { return nil }
    let size = CGRect(x: 0, y: 0, width: backdrop.width, height: backdrop.height)
    // The backdrop is drawn upright in the bitmap's y-up space; the editor then draws with the
    // origin at the top-left, one unit per pixel, as `AnnotationEditing.render` promises.
    context.draw(backdrop, in: size)
    guard let raw = context.makeImage() else { return nil }
    guard let editor else { return Rendered(image: raw, raw: raw) }
    context.translateBy(x: 0, y: size.height)
    context.scaleBy(x: 1, y: -1)
    editor.render(into: context, scale: display.pixelScale)
    return context.makeImage().map { Rendered(image: $0, raw: raw) }
  }

  /// Writes `image` into `folder` under the screenshot's name and returns the file.
  @concurrent
  nonisolated static func store(_ image: CGImage, capturedAt: Date, in folder: URL)
    async throws(BridgeError) -> URL
  {
    do {
      return try await write(image, in: folder) {
        ScreenshotRules.fileName(capturedAt: capturedAt, encoding: $0)
      }
    } catch .tooLarge {
      throw BridgeError("The screenshot is too large to attach.")
    } catch .unwritable {
      throw BridgeError("The screenshot could not be saved.")
    } catch {
      throw BridgeError("The screenshot could not be encoded.")
    }
  }

  /// The one encoder of images the shell imports: `image` scaled to ``ScreenshotRules`` (long
  /// edge, then PNG with JPEG fallbacks under the service's image limit) and written into
  /// `folder` as `name(encoding)`. Scaling and encoding a Retina image take long enough to keep
  /// them off the main actor.
  @concurrent
  nonisolated static func write(
    _ image: CGImage, in folder: URL, name: @Sendable (ScreenshotEncoding) -> String
  ) async throws(ImageExportFailure) -> URL {
    var attempt = ScreenshotRules.firstAttempt(width: image.width, height: image.height)
    while true {
      let data = try encode(image, as: attempt)
      switch ScreenshotRules.step(after: attempt, bytes: data.count) {
      case .keep:
        let file = folder.appending(path: name(attempt.encoding))
        do {
          try data.write(to: file)
        } catch {
          throw .unwritable
        }
        return file
      case .retry(let next):
        attempt = next
      case .giveUp:
        throw .tooLarge
      }
    }
  }

  private nonisolated static func encode(_ image: CGImage, as attempt: ScreenshotAttempt)
    throws(ImageExportFailure) -> Data
  {
    // The first attempt is `ScreenshotRules.exportSize`, the size the selection's label shows.
    let size = ScreenshotRules.pixelSize(
      width: image.width, height: image.height, longEdge: attempt.longEdge)
    let isJPEG = attempt.encoding == .jpeg
    let data = NSMutableData()
    guard let scaled = scaled(image, to: size, onWhite: isJPEG),
      let destination = CGImageDestinationCreateWithData(
        data, (isJPEG ? UTType.jpeg : UTType.png).identifier as CFString, 1, nil)
    else { throw .unencodable }
    let properties: [CFString: Any] =
      isJPEG ? [kCGImageDestinationLossyCompressionQuality: ScreenshotRules.jpegQuality] : [:]
    CGImageDestinationAddImage(destination, scaled, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw .unencodable }
    return data as Data
  }

  /// `image` at `size`. A JPEG has no alpha, so for one the image is flattened onto white
  /// rather than left to turn transparent areas black (a pasted image may have them).
  private nonisolated static func scaled(
    _ image: CGImage, to size: ScreenshotPixelSize, onWhite: Bool
  ) -> CGImage? {
    guard onWhite || size.width != image.width || size.height != image.height else { return image }
    guard let context = bitmap(width: size.width, height: size.height, like: image) else {
      return nil
    }
    let bounds = CGRect(x: 0, y: 0, width: size.width, height: size.height)
    if onWhite {
      context.setFillColor(CGColor(gray: 1, alpha: 1))
      context.fill(bounds)
    }
    context.interpolationQuality = .high
    context.draw(image, in: bounds)
    return context.makeImage()
  }

  /// A 32-bit bitmap in `image`'s RGB colour space (the display's), sRGB otherwise.
  nonisolated static func bitmap(width: Int, height: Int, like image: CGImage)
    -> CGContext?
  {
    let space =
      image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil }
      ?? CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    return CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        | CGBitmapInfo.byteOrder32Little.rawValue)
  }
}
