import CoreGraphics
import Foundation
import Synchronization
import Vision

/// Text recognition over a selection's pixels, for the annotation toolbar's extract button:
/// Vision's accurate recognizer over the raw selection (annotations would only add noise), with
/// language correction and automatic language detection over Simplified and Traditional Chinese
/// and English. Nothing runs until the user asks, so a capture is never held up by it; a run
/// that fails or passes ``timeout`` answers nil rather than partial text.
nonisolated enum ScreenText {
  static let timeout = Duration.seconds(3)
  static let languages = ["zh-Hans", "zh-Hant", "en-US"].map { Locale.Language(identifier: $0) }

  /// One piece of recognized text with its box in the image, normalized to 0…1 with the origin
  /// at the top-left and y down.
  struct Box: Equatable, Sendable {
    var text: String
    var box: CGRect

    init(text: String, box: CGRect) {
      self.text = text
      self.box = box
    }
  }

  /// The text in `image` in reading order; nil when recognition failed or ran past `timeout`, and
  /// empty when the image holds no text. The work runs off the main actor; a timed-out request is
  /// cancelled and its late answer dropped.
  static func lines(in image: CGImage, timeout: Duration = timeout) async -> [String]? {
    let gate = ResumeGate()
    return await withCheckedContinuation { continuation in
      let work = Task.detached(priority: .userInitiated) {
        let lines = await recognize(image)
        if gate.claim() { continuation.resume(returning: lines) }
      }
      Task.detached {
        try? await Task.sleep(for: timeout)
        work.cancel()
        if gate.claim() { continuation.resume(returning: nil) }
      }
    }
  }

  @concurrent
  private static func recognize(_ image: CGImage) async -> [String]? {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = languages
    guard let observations = try? await request.perform(on: image) else { return nil }
    let boxes = observations.compactMap { observation -> Box? in
      guard let text = observation.topCandidates(1).first?.string else { return nil }
      // Vision's normalized boxes have their origin at the bottom-left.
      let box = observation.boundingBox.cgRect
      return Box(
        text: text,
        box: CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height))
    }
    return readingOrder(boxes)
  }

  /// Recognized boxes in reading order: rows from top to bottom, each row left to right, joined
  /// with a tab so separate columns stay apart. A box joins a row when its vertical centre lies
  /// within half the height of the row's first box (or its own) from that box's centre.
  static func readingOrder(_ boxes: [Box]) -> [String] {
    let sorted = boxes.filter { !$0.text.isEmpty }.sorted { $0.box.midY < $1.box.midY }
    var rows: [[Box]] = []
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

/// Lets exactly one of two racing tasks resume a continuation.
private nonisolated final class ResumeGate: Sendable {
  private let claimed = Mutex(false)

  /// True for the first caller only.
  func claim() -> Bool {
    claimed.withLock { claimed in
      defer { claimed = true }
      return !claimed
    }
  }
}
