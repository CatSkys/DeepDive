import CoreGraphics
import Foundation
import Vision

/// Text recognition over a selection's pixels, for the annotation toolbar's extract button:
/// Vision's accurate recognizer over the raw selection (annotations would only add noise), told
/// which languages to read — Simplified and Traditional Chinese, and English.
///
/// **请求参数**：`usesLanguageCorrection` 与 `automaticallyDetectsLanguage` 都关掉。热态实测
/// （同一张真实捕获，2208×1498）：两个都开 2.78s，都关 0.85s；并且"把屏幕上的字照抄下来"本就
/// 不该纠错（纠错会把标识符、专名改成词表里的词），语言也不必猜——三种语言是我们显式给的。
///
/// **冷启动是这台机器上真实存在的一档**：识别服务/模型冷的时候首次请求实测 0.1s…133s 不等，
/// 两组参数都慢（所以那不是参数的锅，是服务本身），热起来稳定 ~1s。于是这里：① **没有死线**——
/// 那颗钮是用户按出来的、卡上写着"识别中…"，没有谁在等它（原先那条 3s 超时是"别拖住截图交付"
/// 时代的产物，撤掉交付链之后它只剩下一个作用：把首次识别掐死）；② ``warmUp()`` 把冷启动从
/// "用户按下那一刻"挪开；③ 如实抛 Vision 的错误，由调用方记日志、卡上报一句人话。
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

  /// The text in `image` in reading order, empty when the image holds no text. Throws what
  /// Vision throws; the work runs off the main actor.
  static func lines(in image: CGImage) async throws -> [String] {
    try await recognize(image)
  }

  /// 把识别服务的冷启动在**后台**先付掉。首次请求实测可能是分钟级（识别服务/模型的冷启动，
  /// 参数修好之后热态 ~1s），那份代价不该落在用户按下那颗钮的那一刻，所以启动期与标注编辑器
  /// 出现时各叫一次：前者给足分钟级的余量，后者覆盖"应用开了一整天、模型被系统换出去了"。
  /// 已经热的时候这一次只是一个 8×8 的小请求（几十毫秒），失败也不报错——它只是热身。
  static func warmUp() async {
    guard let blank = blankImage else { return }
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
    // 见文件头：这两个别同时开（分钟级代价），而"照抄屏幕上的字"本来也不该纠错。
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = false
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
