import Foundation

/// How a `screenshot.capture` becomes an attachment: the size and format the image is stored
/// in and the name the user sees on it.
public enum ScreenshotRules {
  /// The longest edge, in pixels, a stored screenshot keeps. A Retina capture of a whole display
  /// is far larger; this keeps the image legible for a model while a PNG of it stays well under
  /// the service's 8 MiB image limit for typical screen content.
  public static let maxLongEdge = 2560

  /// The service's image limit (`MAX_IMAGE_ATTACHMENT_BYTES`); a larger file is refused.
  public static let maxImageBytes = 8 * 1024 * 1024
  /// The JPEG quality of the fallback for a PNG over ``maxImageBytes``.
  public static let jpegQuality = 0.9
  /// The fallback scales down no further than this long edge; below it a capture is refused.
  public static let minimumFallbackLongEdge = 640

  /// The long edge to scale a `width` × `height` capture down to, or nil when it already fits:
  /// a capture is never scaled up.
  public static func scaledLongEdge(width: Int, height: Int) -> Int? {
    max(width, height) > maxLongEdge ? maxLongEdge : nil
  }

  /// The first encoding of a `width` × `height` capture: PNG, scaled to the stored size.
  public static func firstAttempt(width: Int, height: Int) -> ScreenshotAttempt {
    ScreenshotAttempt(
      encoding: .png, longEdge: scaledLongEdge(width: width, height: height) ?? max(width, height))
  }

  /// What follows an attempt that produced `bytes`: keep it when it fits the service's limit;
  /// otherwise the PNG becomes a JPEG of the same size, and a JPEG shrinks by a quarter until
  /// ``minimumFallbackLongEdge``, after which the capture is refused.
  public static func step(after attempt: ScreenshotAttempt, bytes: Int) -> ScreenshotEncodingStep {
    guard bytes > maxImageBytes else { return .keep }
    switch attempt.encoding {
    case .png:
      return .retry(ScreenshotAttempt(encoding: .jpeg, longEdge: attempt.longEdge))
    case .jpeg:
      let next = attempt.longEdge * 3 / 4
      guard next >= minimumFallbackLongEdge else { return .giveUp }
      return .retry(ScreenshotAttempt(encoding: .jpeg, longEdge: next))
    }
  }

  /// A `width` × `height` image scaled so its long edge is `longEdge`, never scaled up; each
  /// side keeps at least one pixel.
  public static func pixelSize(width: Int, height: Int, longEdge: Int) -> ScreenshotPixelSize {
    let long = max(width, height)
    guard long > longEdge, long > 0 else {
      return ScreenshotPixelSize(width: width, height: height)
    }
    let factor = Double(longEdge) / Double(long)
    return ScreenshotPixelSize(
      width: max(1, Int((Double(width) * factor).rounded())),
      height: max(1, Int((Double(height) * factor).rounded())))
  }

  /// The pixel size of the stored file for a `width` × `height` capture: that of its first
  /// attempt, which `CaptureExport` encodes (a later JPEG retry may only be smaller).
  public static func exportSize(width: Int, height: Int) -> ScreenshotPixelSize {
    pixelSize(
      width: width, height: height, longEdge: firstAttempt(width: width, height: height).longEdge)
  }

  /// The selection overlay's size label: "W × H" in points, plus " · W × H px" for the stored
  /// file when its pixels differ (Retina scale, or the ``maxLongEdge`` cap). `selection` is in
  /// view points on a `scale` display whose frozen image is `imageWidth` × `imageHeight`; the
  /// stored pixels are the ones `CaptureExport` crops for it.
  public static func sizeLabel(selection: CGRect, scale: CGFloat, imageWidth: Int, imageHeight: Int)
    -> String
  {
    let points = ScreenshotPixelSize(
      width: Int(selection.width.rounded()), height: Int(selection.height.rounded()))
    var label = "\(points.width) × \(points.height)"
    guard
      let crop = CaptureCoordinates.pixelRect(
        selection, scale: scale, width: imageWidth, height: imageHeight)
    else { return label }
    let stored = exportSize(width: Int(crop.width), height: Int(crop.height))
    if stored != points { label += " · \(stored.width) × \(stored.height) px" }
    return label
  }

  /// The macOS screenshot name, `Screenshot 2026-10-01 at 10.16.11.png`, in the user's time
  /// zone. The name is data the page and the model read, so it stays English like the system's
  /// default in an English locale; the 24-hour clock keeps it free of locale-specific markers.
  public static func fileName(
    capturedAt date: Date, encoding: ScreenshotEncoding = .png, timeZone: TimeZone = .current
  ) -> String {
    stem(capturedAt: date, timeZone: timeZone) + "." + encoding.fileExtension
  }

  /// The screen-context attachment imported beside the image: the image's name with
  /// ` context.md` in place of its extension, so the two sort and read as a pair.
  public static func contextFileName(capturedAt date: Date, timeZone: TimeZone = .current)
    -> String
  {
    stem(capturedAt: date, timeZone: timeZone) + " context.md"
  }

  private static func stem(capturedAt date: Date, timeZone: TimeZone) -> String {
    let style = Date.VerbatimFormatStyle(
      format: """
        Screenshot \(year: .extended(minimumLength: 4))-\(month: .twoDigits)-\(day: .twoDigits) \
        at \(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)).\
        \(minute: .twoDigits).\(second: .twoDigits)
        """,
      locale: Locale(identifier: "en_US_POSIX"), timeZone: timeZone,
      calendar: Calendar(identifier: .gregorian))
    return date.formatted(style)
  }
}

public enum ScreenshotEncoding: Sendable {
  case png, jpeg

  /// Both are in `AttachmentRules.extensions`.
  public var fileExtension: String {
    switch self {
    case .png: "png"
    case .jpeg: "jpg"
    }
  }
}

/// One encoding of a capture: its format and the long edge it is scaled to.
public struct ScreenshotAttempt: Equatable, Sendable {
  public var encoding: ScreenshotEncoding
  public var longEdge: Int

  public init(encoding: ScreenshotEncoding, longEdge: Int) {
    self.encoding = encoding
    self.longEdge = longEdge
  }
}

public enum ScreenshotEncodingStep: Equatable, Sendable {
  case keep
  case retry(ScreenshotAttempt)
  case giveUp
}

public struct ScreenshotPixelSize: Equatable, Sendable {
  public var width: Int
  public var height: Int

  public init(width: Int, height: Int) {
    self.width = width
    self.height = height
  }
}
