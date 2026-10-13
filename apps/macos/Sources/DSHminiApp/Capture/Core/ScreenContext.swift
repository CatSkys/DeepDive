import Foundation

/// The screen-context attachment of a confirmed capture (decision F1): what was on screen around
/// the image, as Markdown for the model. Its labels stay English whatever the app's language,
/// because the file is data the model reads, not interface copy.
public struct ScreenContext: Equatable, Sendable {
  /// What Accessibility said about the element the selection was committed from.
  public struct Element: Equatable, Sendable {
    public var role: String
    public var title: String?
    public var value: String?
    public var help: String?

    public init(role: String, title: String?, value: String?, help: String?) {
      self.role = role
      self.title = title
      self.value = value
      self.help = help
    }
  }

  /// One piece of recognized text with its box in the image, normalized to 0…1 with the origin
  /// at the top-left and y down.
  public struct TextBox: Equatable, Sendable {
    public var text: String
    public var box: CGRect

    public init(text: String, box: CGRect) {
      self.text = text
      self.box = box
    }
  }

  /// The whole file stays within this many characters; recognized text is cut to fit.
  public static let maxCharacters = 12_000
  /// Ends recognized text that was cut.
  static let truncationMarker = "[truncated]"

  public var app: String?
  public var window: String?
  public var element: Element?
  /// Recognized lines in reading order.
  public var lines: [String]

  public init(app: String?, window: String?, element: Element?, lines: [String]) {
    self.app = app
    self.window = window
    self.element = element
    self.lines = lines
  }

  /// The file's Markdown, at most ``maxCharacters`` long; nil when nothing is known, so no file
  /// is written. Unknown fields are left out rather than shown empty.
  public var markdown: String? {
    var facts: [String] = []
    if let app = Self.inline(app) { facts.append("- App: \(app)") }
    if let window = Self.inline(window) { facts.append("- Window: \(window)") }
    if let element, let role = Self.inline(element.role) {
      let title = Self.inline(element.title).map { " \"\($0)\"" } ?? ""
      facts.append("- Picked element: \(role)\(title)")
      if let value = Self.inline(element.value) { facts.append("  - Value: \(value)") }
      if let help = Self.inline(element.help) { facts.append("  - Help: \(help)") }
    }
    let text = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    guard !facts.isEmpty || !text.isEmpty else { return nil }
    var head = "# Screen context\n"
    if !facts.isEmpty { head += "\n" + facts.joined(separator: "\n") + "\n" }
    guard !text.isEmpty else { return String(head.prefix(Self.maxCharacters)) }
    head += "\n## Recognized text\n\n"
    return Self.capped(head: head, lines: text)
  }

  /// `head` followed by as many whole lines as fit, then the marker when some were left out;
  /// a line too long for the room left is cut by characters.
  static func capped(head: String, lines: [String]) -> String {
    let full = head + lines.joined(separator: "\n") + "\n"
    guard full.count > maxCharacters else { return full }
    let marker = "\n" + truncationMarker + "\n"
    let room = maxCharacters - marker.count
    guard head.count < room else { return String(head.prefix(maxCharacters)) }
    var body = head
    for line in lines {
      let needed = (body == head ? 0 : 1) + line.count
      if body.count + needed > room {
        // Only the first line is cut mid-way: otherwise whole lines read better than a stub.
        if body == head { body += line.prefix(room - body.count) }
        break
      }
      body += (body == head ? "" : "\n") + line
    }
    return body + marker
  }

  /// A one-line field: whitespace runs (newlines included) become one space; empty is nil.
  static func inline(_ value: String?) -> String? {
    guard let value else { return nil }
    let words = value.split(whereSeparator: \.isWhitespace)
    return words.isEmpty ? nil : words.joined(separator: " ")
  }

  /// Recognized boxes in reading order: rows from top to bottom, each row left to right, joined
  /// with a tab so separate columns stay apart. A box joins a row when its vertical centre lies
  /// within half the height of the row's first box (or its own) from that box's centre.
  public static func readingOrder(_ boxes: [TextBox]) -> [String] {
    let sorted = boxes.filter { !$0.text.isEmpty }.sorted { $0.box.midY < $1.box.midY }
    var rows: [[TextBox]] = []
    for box in sorted {
      if let first = rows.last?.first,
        abs(box.box.midY - first.box.midY) <= max(first.box.height, box.box.height) / 2
      {
        rows[rows.count - 1].append(box)
      } else {
        rows.append([box])
      }
    }
    return rows.map { row in
      row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: "\t")
    }
  }
}
