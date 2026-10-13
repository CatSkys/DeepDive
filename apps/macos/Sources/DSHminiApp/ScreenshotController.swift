import AppKit

/// 截图的壳侧编排：一次会话的生命周期（冻结屏幕 → 交互选区 → 标注 → 交付）。
/// 选区与标注本身在 `Capture/`（Atd 移植族）；这里只管**接线**——屏幕录制授权、
/// 激活归属的借还、单会话互斥、以及把结果交给页面（页面按既有附件通道上传）。
///
/// Atd 的同位件是 `ScreenshotTaker`：它把结果经服务导入成资源 id。本项目页面自己
/// 上传（`upload-path`），所以产出是磁盘上的两个文件路径（图 + 屏幕上下文）。
final class ScreenshotController {
  /// 一次确认的捕获：页面要的两个文件（上下文可能没有），以及它是否来自复制。
  struct Delivered {
    let image: URL
    let context: URL?
    let capturedAt: Date
  }

  private let library = CaptureLibrary()
  private let access = ScreenRecordingTrust()
  /// 上次确认的选区，按显示器记住（`R` 复用）。
  private var regions = CaptureRegionMemory()
  private var session: CaptureSession?
  /// 一次只截一张：第二次调用直接拒绝（每次调用都是一场要用户参与的交互）。
  private(set) var isCapturing = false {
    didSet { if isCapturing != oldValue { onCapturingChange?(isCapturing) } }
  }
  /// 捕获开始/结束时通知（迷你面板在捕获期间离屏）。
  var onCapturingChange: ((_ capturing: Bool) -> Void)?
  /// 捕获完成：把文件交给页面（`image` 内联字节、上下文按路径）。
  var onDelivered: ((Delivered) -> Void)?
  /// 复制路径：同样的图进了剪贴板，页面什么也不收。
  var onCopied: (() -> Void)?
  /// 屏幕录制授权被拒；页面据此提示。
  var onPermissionDenied: (() -> Void)?
  /// 屏幕录制授权状态变了（授权后 macOS 只对**重启过**的进程生效，页面据此提示/显示状态）。
  var onTrustChange: ((Bool) -> Void)?
  /// 无障碍提示被点：会话结束后再问授权（系统弹窗会盖在 overlay 之下）。
  var onWantsAccessibility: (() -> Void)?
  private var trustRequested = false

  init() {
    access.onChange = { [weak self] trusted in self?.onTrustChange?(trusted) }
    access.start()
  }

  var isTrusted: Bool { access.isTrusted }

  /// `screen-recording-request`：设置页的权限行按下时问一次（每 launch 一次）。
  func requestPermission() { access.prompt() }

  /// 一次新截图（`screenshot.capture`）。
  func capture() async throws(BridgeError) -> Void {
    try claim()
    defer { isCapturing = false }
    switch try await run(reopening: nil) {
    case .cancelled:
      return
    case .notPermitted:
      onPermissionDenied?()
      throw BridgeError(ShellStrings.shared.text(.screenshotNoDisplay))
    case .confirmed(let capture, let capturedAt, let snapshot):
      regions.remember(
        capture.selection, displayID: capture.displayID, displayFrame: capture.displayFrame)
      let stored = try await library.store(capture, capturedAt: capturedAt, snapshot: snapshot)
      onDelivered?(Delivered(image: stored.image, context: stored.context, capturedAt: capturedAt))
    }
  }

  /// 重开一张已存图片继续编辑（`screenshot.edit`）。
  func edit(path: String) async throws(BridgeError) {
    try claim()
    defer { isCapturing = false }
    guard CGPreflightScreenCaptureAccess() else {
      access.prompt()
      onPermissionDenied?()
      throw BridgeError(ShellStrings.shared.text(.screenshotNoDisplay))
    }
    let base = try await library.base(for: path)
    switch try await run(reopening: base) {
    case .cancelled:
      return
    case .notPermitted:
      onPermissionDenied?()
      throw BridgeError(ShellStrings.shared.text(.screenshotNoDisplay))
    case .confirmed(let capture, let capturedAt, _):
      let stored = try await library.store(capture, capturedAt: capturedAt, snapshot: nil)
      onDelivered?(Delivered(image: stored.image, context: stored.context, capturedAt: capturedAt))
    }
  }

  /// 结束进行中的会话（面板/热键要取消时）；调用方的请求答 `cancelled`。
  func cancel() { session?.cancel() }

  private func claim() throws(BridgeError) {
    guard !isCapturing else { throw BridgeError(ShellStrings.shared.text(.screenshotAlreadyRunning)) }
    isCapturing = true
  }

  private enum SessionEnd {
    case cancelled
    case notPermitted
    case confirmed(CaptureConfirmation, capturedAt: Date, snapshot: WindowSnapshot)
  }

  /// 一次会话：从撤下自己的窗口到交还激活归属。新截图跑元素检测；重开编辑用
  /// `reopening` 预选，不检测。
  private func run(reopening: ReopenBase?) async throws(BridgeError) -> SessionEnd {
    // 授权被吊销（或换了签名）的构建只能截到壁纸与菜单栏，所以每次截图前都现查。
    guard CGPreflightScreenCaptureAccess() else {
      access.prompt()
      return .notPermitted
    }
    // 授权记录在、但采集起不来：macOS 只对重启后的进程应用新授权，这是最常见的成因。
    // 措辞明说，别让用户对着"截图准备失败"猜（原始错误进引擎日志）。
    // 借走激活：overlay 要光标、键盘与输入法；结束后还给原来那个 App。
    let previousApp = NSWorkspace.shared.frontmostApplication.flatMap {
      $0 == NSRunningApplication.current ? nil : $0
    }
    let session = CaptureSession(
      targeting: ElementResolver(), offersTrustRequest: !trustRequested,
      regions: reopening == nil ? regions : CaptureRegionMemory(),
      makeEditor: { AnnotationEditor() })
    self.session = session
    defer { self.session = nil }
    let presented: (capturedAt: Date, snapshot: WindowSnapshot)
    do {
      presented = try await present(session, reopening: reopening)
    } catch {
      session.cancel()
      _ = await session.run()
      if DisplayFreezer.isPermissionError(error) {
        access.prompt()
        return .notPermitted
      }
      throw (error as? BridgeError) ?? BridgeError(ShellStrings.shared.text(.screenshotNotPrepared))
    }
    let outcome = await session.run()
    if NSApp.isActive, let previousApp { _ = previousApp.activate(from: .current, options: []) }
    switch outcome {
    case .cancelled:
      return .cancelled
    case .wantsAccessibility:
      trustRequested = true
      onWantsAccessibility?()
      return .cancelled
    case .failed:
      throw BridgeError(ShellStrings.shared.text(.screenshotNotPrepared))
    case .confirmed(let capture):
      return .confirmed(capture, capturedAt: presented.capturedAt, snapshot: presented.snapshot)
    case .copied(let capture):
      if reopening == nil {
        regions.remember(
          capture.selection, displayID: capture.displayID, displayFrame: capture.displayFrame)
      }
      Self.copy(capture)
      onCopied?()
      return .cancelled
    }
  }

  /// 把标注好的图放到通用剪贴板（PNG + TIFF，按 point 尺寸贴出）。
  private static func copy(_ capture: CaptureConfirmation) {
    let image = NSBitmapImageRep(cgImage: capture.image)
    image.size = NSSize(
      width: CGFloat(capture.image.width) / capture.pixelScale,
      height: CGFloat(capture.image.height) / capture.pixelScale)
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.declareTypes([.png, .tiff], owner: nil)
    if let png = image.representation(using: .png, properties: [:]) {
      pasteboard.setData(png, forType: .png)
    }
    if let tiff = image.tiffRepresentation { pasteboard.setData(tiff, forType: .tiff) }
  }

  /// 取窗口快照（仅新截图）、逐屏冻结（光标所在屏先冻、冻好一屏就上 overlay），
  /// 最后激活本应用。重开编辑把图铺在最先冻结的那块屏上并预选。
  private func present(_ session: CaptureSession, reopening: ReopenBase?) async throws
    -> (capturedAt: Date, snapshot: WindowSnapshot)
  {
    // overlay 出现之前取：元素检测要看用户当时看到的窗口。
    let snapshot = reopening == nil ? WindowSnapshot.take() : WindowSnapshot(entries: [])
    if reopening == nil { session.begin(windows: snapshot.windows) }
    let freezer: DisplayFreezer
    do {
      freezer = try await DisplayFreezer.prepare()
    } catch {
      EngineLog.shared.append("[capture] SCShareableContent failed: \(error)")
      throw BridgeError(ShellStrings.shared.text(.screenshotPermissionStale))
    }
    let capturedAt = Date.now
    var preselection: (displayID: CGDirectDisplayID, rect: CGRect)?
    for target in freezer.targets {
      guard !session.isFinished else { break }
      guard var frozen = try await freezer.freeze(target) else { continue }
      if let reopening, preselection == nil {
        guard let composed = await reopening.compose(over: frozen) else {
          throw BridgeError(ShellStrings.shared.text(.screenshotOpenFailed))
        }
        frozen = composed.display
        preselection = (frozen.displayID, composed.selection)
      }
      session.add(frozen, on: target.screen)
    }
    if session.isFinished { return (capturedAt, snapshot) }
    guard !session.overlays.isEmpty else {
      throw BridgeError(ShellStrings.shared.text(.screenshotNoDisplay))
    }
    // 现在才激活：其余屏幕的窗口在被冻结时仍是前台外观。
    NSApp.activate()
    session.activate()
    if let reopening, let preselection {
      session.preselect(
        preselection.rect, onDisplay: preselection.displayID, restoring: reopening.document)
    }
    return (capturedAt, snapshot)
  }
}
