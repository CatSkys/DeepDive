import Foundation

/// What a drag carries, as far as the mini panel is concerned, read from the drag pasteboard: its
/// types while the drag is under way (whether to invite it), its contents at the drop.
public struct MiniPanelDragOffer: Equatable, Sendable {
  /// File or folder URLs.
  public var files: Bool
  /// File promises: Photos, a browser's images, Mail's attachments.
  public var promises: Bool
  /// Image data without a file: PNG, TIFF or JPEG.
  public var image: Bool
  /// Text, or a URL that is not a file's.
  public var text: Bool
  /// The drag started in Atd: a desktop pin drag, or a drag out of one of its windows.
  public var fromAtd: Bool

  public init(files: Bool, promises: Bool, image: Bool, text: Bool, fromAtd: Bool) {
    self.files = files
    self.promises = promises
    self.image = image
    self.text = text
    self.fromAtd = fromAtd
  }

  /// Whether the panel invites the drop: something it can take, dragged from another app. A drag
  /// without it gets no invite, no drop card and no drop operation.
  public var isAcceptable: Bool { !fromAtd && (files || promises || image || text) }
}

/// The one route a drop on the mini panel takes: the first that applies, so files beat images,
/// which beat text. Every route ends in the task panel's current draft and sends nothing.
public enum MiniPanelDropRoute: Equatable, Sendable {
  /// File and folder URLs, imported like the Finder service's.
  case files
  /// Promised files, received into the app's own folder first, then imported like files.
  case promises
  /// A bitmap without a file, imported like a pasted image.
  case image
  /// Text short enough to quote, put in the composer as the selection Ask Atd quotes.
  case quote(String)
  /// Longer text, written to a text file that is then imported like a file.
  case textFile(String)

  /// `MAX_QUOTE_CHARS` (packages/agent-contracts/src/quotes.ts), in UTF-16 units like the
  /// renderer's string lengths.
  public static let maxQuoteLength = 12_000

  /// The route of a drop carrying `offer`, with `text` its text (or non-file URL) if any; nil for
  /// a drop with nothing to take, whitespace included.
  public static func route(for offer: MiniPanelDragOffer, text: String?) -> MiniPanelDropRoute? {
    guard !offer.fromAtd else { return nil }
    if offer.files { return .files }
    if offer.promises { return .promises }
    if offer.image { return .image }
    guard offer.text, let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return nil }
    return text.utf16.count <= maxQuoteLength ? .quote(text) : .textFile(text)
  }

  /// The route's name for the log, which never names the content.
  public var logName: String {
    switch self {
    case .files: "files"
    case .promises: "promise"
    case .image: "image"
    case .quote: "text-quote"
    case .textFile: "text-file"
    }
  }
}

/// The file a drop's own bytes are written to, which has no name of its own: long dropped text,
/// and a bitmap dragged without a file. One date shape for both, so two drops of the same kind
/// never collide; the name is data the page and the model read, so it stays English.
public enum MiniPanelDroppedName {
  /// `Dropped text 2026-10-01 at 10.16.11.txt` in the user's time zone, shaped like
  /// ``PastedImageName/fileName(pastedAt:encoding:timeZone:)``.
  public static func fileName(
    _ kind: String, extension ext: String, droppedAt date: Date, timeZone: TimeZone = .current
  ) -> String {
    let style = Date.VerbatimFormatStyle(
      format: """
        \(year: .extended(minimumLength: 4))-\(month: .twoDigits)-\(day: .twoDigits) \
        at \(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)).\
        \(minute: .twoDigits).\(second: .twoDigits)
        """,
      locale: Locale(identifier: "en_US_POSIX"), timeZone: timeZone,
      calendar: Calendar(identifier: .gregorian))
    return "\(kind) \(date.formatted(style)).\(ext)"
  }
}

/// The file long dropped text is written to, which has no name of its own.
public enum MiniPanelDroppedText {
  /// `Dropped text 2026-10-01 at 10.16.11.txt` (see ``MiniPanelDroppedName``).
  public static func fileName(droppedAt date: Date, timeZone: TimeZone = .current) -> String {
    MiniPanelDroppedName.fileName(
      "Dropped text", extension: "txt", droppedAt: date, timeZone: timeZone)
  }
}

/// The file a dropped bitmap without a file is written to. Always PNG: the file's extension is
/// what the page turns into the image's media type, so the bytes have to be PNG (``MiniPanelDropFolder/write(image:droppedAt:)``).
public enum MiniPanelDroppedImage {
  /// The kind name in the file's name, and what the drop is reported under when it cannot be
  /// written (``MiniPanelDroppedName/fileName(_:extension:droppedAt:timeZone:)``).
  public static let kind = "Dropped image"

  /// `Dropped image 2026-10-01 at 10.16.11.png`.
  public static func fileName(droppedAt date: Date, timeZone: TimeZone = .current) -> String {
    MiniPanelDroppedName.fileName(kind, extension: "png", droppedAt: date, timeZone: timeZone)
  }
}
