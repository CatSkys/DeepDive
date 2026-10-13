// 悬浮注释的宿主：一块独立窗口（`TooltipWindow`，系统液态玻璃 + 注释那一页）。
// 管三件事——把页面报上来的锚点换成屏幕矩形、按那一页量出来的尺寸摆窗口、开合；
// 不管注释长什么样（那一页的 DOM 与 CSS 说了算，见 frontend/src/tooltip/）。
//
// 谁来喂它：任何一块页面里 `data-tip` 元素被悬停时，`TooltipHost` 就把锚点推上来
// （`tooltip-show` / `tooltip-hide`，走 rect 通道）。主窗、迷你面板、命令中心卡三块页面
// 都往这里转——注释窗口只有一块，按屏幕坐标摆，所以它天然同时服务所有窗口。
//
// 尺寸是**两跳**：壳把文案推给注释页（`tooltipContent`），那一页量完报回实测尺寸
// （`tooltip-size`），壳拿到尺寸才摆窗口。因此每条文案的尺寸按内容签名缓存一次，
// 之后同一枚按钮再悬停就是零等待。

import AppKit
import WebKit

final class TooltipController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  /// 一条待显示的注释：文案 + 它挂在哪（屏幕坐标，y 向上）+ 偏好边/间距/可待范围。
  private struct Request {
    let seq: Int
    let text: String
    let caps: [String]
    let side: String
    let gap: CGFloat
    let anchor: NSRect
    let limits: NSRect

    /// 内容签名：同一段文案 + 同一组键帽共用一份实测尺寸（缓存键）。
    var signature: String { "\(text)\u{1}\(caps.joined(separator: "\u{1}"))" }
  }

  /// 注释页量出来的尺寸与圆角（CSS px = 点，那一页不缩放）。
  private struct Measured {
    let size: NSSize
    let radius: CGFloat
  }

  private var window: TooltipWindow?
  private var pageURL: URL?
  /// 注释页是否已经加载完：没加载完时推内容会落空（页面还没有桥），靠 didFinish 补一次。
  private var pageLoaded = false
  private var current: Request?
  private var measured: [String: Measured] = [:]
  private var seq = 0
  /// 窗口此刻该不该是可见的（含正在淡入/淡出）：进出必须幂等，否则每换一个按钮就重播入场。
  private var visible = false
  private var appearanceObservation: NSKeyValueObservation?
  private var deactivateObserver: NSObjectProtocol?

  deinit {
    if let deactivateObserver { NotificationCenter.default.removeObserver(deactivateObserver) }
  }

  // MARK: - 页面 → 壳（锚点与实测尺寸）

  /// 页面报上来的一条注释消息（rect 通道）：认得就处理并返回 true。**三块页面（主窗 /
  /// 迷你面板 / 命令中心卡）与注释页自己都汇到这一处**——类型只有这里解释一次。
  func handleMessage(_ body: [String: Any], from web: WKWebView?) -> Bool {
    guard let type = body["type"] as? String else { return false }
    switch type {
    case "tooltip-show":
      guard let web else { return false }
      show(body, from: web)
      return true
    case "tooltip-hide":
      hide()
      return true
    case "tooltip-size":
      adoptSize(body)
      return true
    default:
      return false
    }
  }

  /// 一条注释被悬停（`tooltip-show`）：`web` 是报上来的那一块页面（用它换算锚点）。
  /// 文案为空或几何不合法时按收起处理——空注释框就是一块漂浮的玻璃。
  private func show(_ body: [String: Any], from web: WKWebView) {
    guard let text = body["text"] as? String, !text.isEmpty,
          let owning = web.window,
          let anchor = screenAnchor(body["anchor"] as? [String: Any], from: web, in: owning) else {
      hide()
      return
    }
    seq += 1
    let request = Request(
      seq: seq,
      text: text,
      caps: (body["caps"] as? [String]) ?? [],
      side: body["side"] as? String ?? "top",
      gap: (body["gap"] as? Double).map { CGFloat($0) } ?? 8,
      anchor: anchor,
      // 可待范围＝触发窗口所在屏的可视区：翻面与夹取都在这一块里算。
      limits: (owning.screen ?? NSScreen.main)?.visibleFrame ?? owning.frame)
    current = request
    ensureWindow()
    // 内容每次都推：注释页换过一次内容之后，缓存里的尺寸仍对得上，页面内容却是它自己记的。
    pushContent(request)
    if let hit = measured[request.signature] {
      present(hit)
    }
    // 尺寸没缓存时窗口先不动：留上一条在原地（换按钮只挪不移，不闪）
  }

  /// 注释该收了（`tooltip-hide`）：滚动/按下/移出与指针离开都由页面判定。
  func hide() {
    current = nil
    guard visible, let host = window else { return }
    visible = false
    host.animateOut { [weak self] in
      // 离场途中又被叫出来（可见态已翻回 true）：这次收尾作废，别把它藏了。
      guard let self, !self.visible else { return }
      self.window?.orderOut(nil)
    }
  }

  /// 注释页量完了（`tooltip-size`）：尺寸属于壳当前正要显示的那一条才采纳（seq 对齐），
  /// 否则是上一条的迟到回报，摆上去就是错的大小。
  private func adoptSize(_ body: [String: Any]) {
    guard let seq = body["seq"] as? Int, let request = current, seq == request.seq else { return }
    let width = (body["w"] as? Double) ?? 0
    let height = (body["h"] as? Double) ?? 0
    guard width > 1, height > 1 else { return }
    let hit = Measured(
      size: NSSize(width: ceil(width), height: ceil(height)),
      radius: (body["radius"] as? Double).map { CGFloat($0) } ?? 0)
    measured[request.signature] = hit
    present(hit)
  }

  // MARK: - 摆与开合

  /// 页面那一侧算出来的锚点（CSS 视口坐标，左上原点、y 向下）→ 屏幕坐标（y 向上）。
  /// 中间过两道：页面局部 → 窗口（含页面缩放）→ 屏幕。缩放取那块页面自己的 `pageZoom`
  /// （主窗不缩放，浏览器面板会）。
  ///
  /// **不要手动翻 y**：WKWebView 自己就是 flipped 的（`isFlipped == true`，左上原点，
  /// 2026-10-13 实测），与 CSS 视口坐标同向，交给 `convert(_:to:)` 就对了；手动再翻一次
  /// 等于翻两遍，锚点会落到窗口底部（"都跑到下面去了"就是这么来的，见 PITFALLS §4.39）。
  /// 本仓别处（`QuickPanelController.hostFrame`、titlebar 的 rect 表）手写翻转是对的——
  /// 它们从 webview 的 frame 起算、不经过 `convert`，两种口径别混。
  func screenAnchor(_ raw: [String: Any]?, from web: WKWebView, in owning: NSWindow) -> NSRect? {
    guard let raw, let css = cssRect(raw) else { return nil }
    let zoom = web.pageZoom
    let inWeb = NSRect(
      x: css.minX * zoom,
      y: css.minY * zoom,
      width: css.width * zoom,
      height: css.height * zoom)
    return owning.convertToScreen(web.convert(inWeb, to: nil))
  }

  private func cssRect(_ raw: [String: Any]) -> NSRect? {
    let rect = NSRect(
      x: raw["x"] as? Double ?? 0,
      y: raw["y"] as? Double ?? 0,
      width: raw["w"] as? Double ?? 0,
      height: raw["h"] as? Double ?? 0)
    return rect.width > 1 && rect.height > 1 ? rect : nil
  }

  private func present(_ hit: Measured) {
    guard let request = current, let host = window else { return }
    let frame = TipPlacement.frame(
      anchor: request.anchor, size: hit.size, side: request.side, gap: request.gap, limits: request.limits)
    // 已经摆在这一处就什么都不做：`present` 因此是幂等的（同一条文案的重量、迟到的那一份
    // 尺寸都落在这里被挡掉）。
    if visible, host.frame == candidateFrame(frame) { return }
    host.place(size: hit.size, origin: frame.origin, radius: hit.radius)
    // 入场只在"从看不见到看得见"那一刻跑；已经在屏上就只挪位置（换按钮不重播动画）。
    let entering = !visible
    host.orderFrontRegardless()
    visible = true
    if entering { host.animateIn() }
  }

  /// 注释内容该占的那块窗口矩形（加投影余量）：`present` 拿它跟当前 frame 比对。
  private func candidateFrame(_ frame: NSRect) -> NSRect {
    frame.insetBy(dx: -TooltipWindow.shadowInset, dy: -TooltipWindow.shadowInset)
  }

  // MARK: - 注释那一页

  /// 注释页的地址（同一个包，多一个 `?tooltip=1`）：随主窗一起记下并**预载**——第一次悬停
  /// 就要有东西可看，不能等页面冷启动。
  func load(bridgeURL: URL?) {
    guard let bridgeURL,
          var comps = URLComponents(url: bridgeURL, resolvingAgainstBaseURL: false) else { return }
    comps.fragment = nil
    comps.queryItems = (comps.queryItems ?? []).filter { $0.name != "engine" }
      + [URLQueryItem(name: "tooltip", value: "1")]
    pageURL = comps.url
    ensureWindow()
  }

  @discardableResult
  private func ensureWindow() -> TooltipWindow {
    if let window { return window }
    let config = WKWebViewConfiguration()
    config.defaultWebpagePreferences.allowsContentJavaScript = true
    let host = TooltipWindow(configuration: config)
    host.web.configuration.userContentController.add(self, name: "deepdive")
    host.web.navigationDelegate = self
    window = host
    applyAppearanceMode()
    // 应用退到后台就收：注释浮在所有窗口之上，跟着跑到别的应用头上没有道理。
    deactivateObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.hide() }
    pageLoaded = false
    loadPageIfNeeded()
    return host
  }

  private func loadPageIfNeeded() {
    guard let pageURL, let web = window?.web, web.url == nil else { return }
    web.load(URLRequest(url: pageURL))
  }

  private func pushContent(_ request: Request) {
    guard pageLoaded, let web = window?.web else { return }
    let payload = AppDelegate.jsonPayload([
      "seq": request.seq, "text": request.text, "caps": request.caps,
    ])
    web.evaluateJavaScript(
      "window.__deepDiveHost ? (window.__deepDiveHost.dispatch('tooltipContent', \(payload)), 'ok') : 'no-host'",
      completionHandler: nil)
  }

  // MARK: - 外观（与 MainWindowController.applyAppearanceMode 同源解析）

  /// 注释窗口跟主窗一个明暗：WebKit 把它报成本地媒体查询，注释页因此不用问谁要主题
  /// （`prefs.ts` 的口径：页面明暗以 `prefers-color-scheme` 为准）。
  func applyAppearanceMode() {
    guard let host = window else { return }
    let mode = DSHAppPrefs.appearance
    let light = mode == "light"
      || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua)
    let appearance: NSAppearance? = mode == "system" ? nil : NSAppearance(named: light ? .aqua : .darkAqua)
    host.appearance = appearance
    host.web.appearance = appearance
    host.glass.applyAppearance(light: light)
  }

  // MARK: - WKScriptMessageHandler（注释页量出来的尺寸）

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "deepdive", let body = message.body as? [String: Any] else { return }
    _ = handleMessage(body, from: message.webView)
  }

  // MARK: - WKNavigationDelegate

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pageLoaded = true
    // 页面加载期间推的那一条必然落空（那时桥还没挂）：这里补一次。
    if let request = current { pushContent(request) }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    EngineLog.shared.append("[tooltip] didFail \(error.localizedDescription)")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    EngineLog.shared.append("[tooltip] provisionalFail \(error.localizedDescription)")
  }
}
