import CoreGraphics
import Vision

/// Text recognition over a selection's pixels, for the annotation toolbar's extract button:
/// Vision's accurate recognizer over the raw selection (annotations would only add noise), told
/// which languages to read — Simplified and Traditional Chinese, and English.
///
/// **钉住 rev2，这是快慢的分水岭**（同一台机器、同一张真实捕获 2208×1498 实测）：
/// Vision 的文本识别有几个模型版本，默认走 **rev3**（新的 33 语大模型）——它会占很大一块常驻
/// 内存、被系统换出去，再要它就得重载，实测**首次 30–133s**（先热一次也要 32s），而系统自己
/// 那一脉（Live Text 等）用的是 **rev2**（8 语小模型，常年驻留）：实测 0.61–0.73s。rev2 的语言表
/// 恰好覆盖我们要的（`en-US` + 五种欧洲语 + **`zh-Hans`/`zh-Hant`**），质量也不输：11 张真实
/// 截图逐张比对，5 张逐字相同、其余 rev2 认出的行**更多**（52:51 / 39:37 / 28:27），rev3 没有
/// 一行是 rev2 没认出来的。**新版 Swift API 只能表达 rev3**（`RecognizeTextRequest.Revision`
/// 只有 `.revision3`），所以要钉 rev2 只能用老 API `VNRecognizeTextRequest`——这不是退而求其次，
/// 这就是 Live Text 走的那条路。
///
/// 另外两个开关都关：`usesLanguageCorrection` 与 `automaticallyDetectsLanguage` 同时打开时会
/// 额外备一套语言识别 + 多语纠错模型（热态实测 2.78s，都关 0.85s），而"把屏幕上的字照抄下来"
/// 本来也不该纠错（纠错会把标识符、专名改成词表里的词），语言更不必猜——三种是我们显式给的。
///
/// **没有死线**：这活是用户按下那颗钮才跑的，卡上写着"识别中…"，没有谁在等它（原先那条 3s
/// 超时是"别拖住截图交付"时代的产物，撤掉交付链之后它只剩下一个作用：把识别掐死）。
/// ``warmUp()`` 把 rev2 首次那 1–3s 的加载挪到用户按下之前；失败与耗时由调用方记日志。
nonisolated enum ScreenText {
  /// 认识的语言（老 API 收语言标签字符串）。rev2 的语言表就这 8 门，中简/中繁/英文都在其中。
  static let languages = ["zh-Hans", "zh-Hant", "en-US"]

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

  /// 把识别模型的加载在**后台**先付掉（启动期与标注编辑器出现时各叫一次）：rev2 首次实测
  /// 1–3s（换过 revision 或闲置久了要重新载入），那份代价不该落在用户按下那颗钮的那一刻。
  /// 已经载好时这一次只是一个 8×8 的小请求（几十毫秒）；失败也不报错——它只是热身。
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

  /// rev2 那一次识别（见文件头：版本是这里唯一的速度旋钮，而新版 API 表达不了它）。
  /// `perform` 是同步阻塞的，本函数在 `@concurrent` 里跑，不在主 actor 上。
  @concurrent
  private static func recognize(_ image: CGImage) async throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision2
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = false
    request.recognitionLanguages = languages
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let boxes = (request.results ?? []).compactMap { observation -> Box? in
      guard let text = observation.topCandidates(1).first?.string else { return nil }
      // Vision's normalized boxes have their origin at the bottom-left.
      let box = observation.boundingBox
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
