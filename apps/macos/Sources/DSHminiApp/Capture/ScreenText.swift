import CoreGraphics
import Foundation
import Synchronization
import Vision

/// Text recognition over a selection's pixels, for the annotation toolbar's extract button:
/// Vision's accurate recognizer over the raw selection (annotations would only add noise), with
/// language correction and automatic language detection over Simplified and Traditional Chinese
/// and English.
///
/// **没有死线**：这活是用户按下那颗扫描钮才跑的，卡上写着"识别中…"，没有谁在等它——原先那条
/// 3s 超时是"别拖住截图交付"时代的产物，撤掉交付链之后它只剩下一个作用：把**首次**识别掐死。
/// 实测同一台机器上首次调用 0.1s…93s 不等（系统识别服务/模型的冷启，起来之后稳定 ~1s），
/// 所以这里如实把 Vision 的错误抛出去，由调用方记日志、卡上报一句说明；首次那份冷启代价由
/// ``warmUp()`` 提前到用户还在标注的时候付。
nonisolated enum ScreenText {
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

  /// 本进程是否已经预热过（``warmUp()`` 只认真跑一次）。
  private static let warmed = Mutex(false)

  /// The text in `image` in reading order, empty when the image holds no text. Throws what
  /// Vision throws; the work runs off the main actor.
  static func lines(in image: CGImage) async throws -> [String] {
    try await recognize(image)
  }

  /// 把识别器的冷启动在**后台**先付掉（标注编辑器一出现就叫一次，整个进程只跑一次）：首次识别
  /// 要等系统那份识别服务/模型就位，最坏见过几十秒；那份代价放在用户还在看选区的时候，比放在他
  /// 按下按钮之后好。预热失败不报错——它只是一次热身，真按下去时照样如实抛。
  static func warmUp() async {
    let first = warmed.withLock { warmed -> Bool in
      defer { warmed = true }
      return !warmed
    }
    guard first, let blank = blankImage else { return }
    _ = try? await recognize(blank)
  }

  /// 8×8 的白图：预热只需要"跑一次请求"，内容无关紧要。
  private static var blankImage: CGImage? {
    guard
      let context = CGContext(
        data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return nil }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
    return context.makeImage()
  }

  @concurrent
  private static func recognize(_ image: CGImage) async throws -> [String] {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = languages
    let observations = try await request.perform(on: image)
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
