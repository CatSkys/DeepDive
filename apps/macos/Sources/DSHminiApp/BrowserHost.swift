// 侧栏浏览器的壳侧宿主：窗口里的第二个 WKWebView。对应官方
// @deepseek-ai/dsh-client-ui-sidebar-browser 的 ElectronWebViewImpl（Electron <webview> 那一支），
// 位置由前端推上来的槽位 rect 决定（nativeSlot.ts），命令由 SPA 与 agent 两侧共用。
//
// 三条与官方对齐的策略：
//   · 协议白名单：只放 http/https/about:blank（file:/data:/blob 一律拒；本地文件预览归文档预览）；
//   · 独立数据存储：nonPersistent，cookie/Web 存储不落盘、不与应用自身会话共享；
//   · 不让页面拿到任何宿主能力：无 userContentController 处理器、无脚本注入、弹窗不开原生窗口。
//
// 缩略图态要让点击落到 SPA（点它是"展开面板"而非操作网页）：那由 hitTest 直接返回 nil 完成
// ——原生视图恒在 SPA 之上，不收点击必须由壳让位。

import AppKit
import WebKit

/// 收点击可控的浏览器视图：`acceptsInput == false` 时整格对鼠标透明。
final class BrowserHostView: WKWebView {
    var acceptsInput = true

    override func hitTest(_ point: NSPoint) -> NSView? {
        acceptsInput ? super.hitTest(point) : nil
    }
}

/// 前端推上来的槽位：CSS px 的 rect + 可见/收点击标志。
struct BrowserSlot {
    var rect: NSRect
    var visible: Bool
    var interactive: Bool

    /// 换算成 AppKit 的 frame：横向与尺寸乘 pageZoom（CSS px → point），y 轴翻转用
    /// **当前**内容高度（不缓存高度，窗口尺寸变化就不会过期）。
    func frame(contentHeight: CGFloat, zoom: CGFloat) -> NSRect {
        NSRect(
            x: rect.minX * zoom,
            y: contentHeight - (rect.minY + rect.height) * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom
        )
    }
}

/// 推给 SPA 的浏览器观察（前端 useNativeBrowser 的 NativeBrowserState 同形）。
struct BrowserObservation {
    var url: String = ""
    var title: String = ""
    var loading: Bool = false
    var canGoBack: Bool = false
    var canGoForward: Bool = false
    var error: Bool = false
    /// 当前页面的缩放（pageZoom；SPA 的缩放控件与「浏览器」设置页读它）
    var zoom: Double = 1

    var payload: [String: Any] {
        [
            "url": url, "title": title, "loading": loading,
            "canGoBack": canGoBack, "canGoForward": canGoForward, "error": error,
            "zoom": zoom,
        ]
    }
}

final class BrowserHost: NSObject {
    let view: BrowserHostView
    /// 观察变化回调（主线程）。
    var onObservation: ((BrowserObservation) -> Void)?
    /// 页面要开新窗口/新标签（`target=_blank`、`window.open`）：把地址交出去，由标签集合开新标签。
    /// 壳自己不开原生窗口（见 BrowserHost+Navigation 的 `createWebViewWith`）。
    var onPopup: ((String) -> Void)?
    /// 页面申请摄像头/麦克风、而我们没记过这个站点：请人答一次（host、种类）。
    /// 决定权在 `BrowserPermissions`（记忆 + 超时），这里只是把问题传出去。
    var onPermissionAsk: ((String, String) -> Void)?

    var lastError = false
    /// 最近一次槽位；窗口尺寸或 pageZoom 变化时按它重算（槽位状态放这里，主窗口控制器
    /// 就不必为它多一个存储属性）。
    private var slot: BrowserSlot?

    /// 新宿主的配置。数据存储由调用方给——**一个窗口的标签共用同一个 store**，cookie 才跨
    /// 标签可见（每个标签一个 store 就是各登各的）。进程池不在这里管：macOS 12 起
    /// `WKProcessPool` 已废弃（"Creating and using multiple instances of WKProcessPool no
    /// longer has any effect."），WebKit 自己按应用共享内容进程。
    static func configuration(store: WKWebsiteDataStore) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = store
        config.userContentController = WKUserContentController()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.applicationNameForUserAgent = BrowserUserAgent.safariIdentity
        // 新 controller 先挂上拦截规则（还没编译好就排队，编译完补上）
        BrowserShield.shared.protect(config.userContentController)
        return config
    }

    init(configuration: WKWebViewConfiguration) {
        view = BrowserHostView(frame: Self.idleViewport, configuration: configuration)
        super.init()
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsMagnification = false
        view.isInspectable = true
        view.autoresizingMask = []
    }

    // MARK: - 位置与可见性

    /// 记下前端推来的槽位并立刻摆位。
    func setSlot(_ slot: BrowserSlot, contentHeight: CGFloat, zoom: CGFloat) {
        self.slot = slot
        applySlot(contentHeight: contentHeight, zoom: zoom)
    }

    /// 按缓存的槽位与当前 bounds/pageZoom 重算 frame。
    func applySlot(contentHeight: CGFloat, zoom: CGFloat) {
        guard let slot else {
            place(rect: .zero, visible: false, interactive: false)
            return
        }
        place(rect: slot.frame(contentHeight: contentHeight, zoom: zoom), visible: slot.visible, interactive: slot.interactive)
    }

    /// agent 看不到面板时的默认视口（ZCode 的 DEFAULT_AGENT_BROWSER_VIEWPORT 同值）：
    /// 面板关着也要能截图，而截图尺寸就是这个 frame。
    static let idleViewport = NSRect(x: 0, y: 0, width: 1280, height: 720)

    /// 按槽位摆放。
    ///
    /// **不用 `isHidden`**：隐藏会把视图移出渲染树，`takeSnapshot` 直接失败
    /// （实测 agent 在面板关着时截图报 snapshot failed）。改用 alpha 0 + 不收点击
    /// ——用户看不见也点不到，但 WebKit 仍能出帧。面板关着时给默认视口，
    /// 让 agent 拿到的截图有个正常尺寸；面板开着时用槽位尺寸（所见即 agent 所见）。
    func place(rect: NSRect, visible: Bool, interactive: Bool) {
        view.acceptsInput = visible && interactive
        view.alphaValue = visible ? 1 : 0
        let target = visible ? rect : Self.idleViewport
        if view.frame != target { view.frame = target }
    }

    // MARK: - 命令（SPA 与 agent 共用同一份）

    /// 只放行 http/https/about:blank（官方 parseBrowserAddress 的壳侧等价物）。
    static func allowed(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "about" { return url.absoluteString == "about:blank" }
        return scheme == "http" || scheme == "https"
    }

    func load(_ urlString: String) {
        guard let url = URL(string: urlString), Self.allowed(url) else {
            lastError = true
            publish()
            return
        }
        lastError = false
        view.load(URLRequest(url: url))
    }

    func goBack() { if view.canGoBack { view.goBack() } }
    func goForward() { if view.canGoForward { view.goForward() } }
    func reload() {
        if view.url == nil { return }
        lastError = false
        view.reload()
    }

    /// 睡过的标签回来：`interactionState` 里是历史 + 当前位置 + 表单状态，赋值即由 WebKit
    /// 把页面放回去（**不要再 load 一次**——那会把"回到原处"冲掉，参考实现同一条）。
    func restore(interactionState: Any) {
        view.interactionState = interactionState
    }

    /// 截图（MCP 的 browser_screenshot 用）：返回 PNG 的规范 base64。
    func screenshot(completion: @escaping (String?) -> Void) {
        let config = WKSnapshotConfiguration()
        config.rect = view.bounds
        view.takeSnapshot(with: config) { image, _ in
            guard let image,
                  let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                completion(nil)
                return
            }
            completion(png.base64EncodedString())
        }
    }

    /// 缩略图预览用的小图（面板收起时那一格显示的就是它）。
    ///
    /// 为什么不是"把 WKWebView 缩小放进去"：`pageZoom` 是**重新排版**（参考实现 Search 的
    /// 原话："not a magnifying glass over the rendered page — the page is laid out again at
    /// this size"），缩到 292 宽只会把页面排成又矮又窄的版式；`magnification` 只缩放不改
    /// 排版；`scaleUnitSquare` 是相对缩放、连调会爆掉 bounds（实测把 app 打崩）。所以预览走
    /// **快照图**：页面始终按正常屏宽排版，缩略图只是它的一张缩小照片（同参考实现给睡着的
    /// tab 存 `takeSnapshot` 图）。缩略图因此也顺带把 agent 的截图保持在整屏尺寸。
    func previewShot(width: CGFloat, completion: @escaping (String?) -> Void) {
        // snapshotWidth 在这版 WebKit 上被忽略（实测照旧出整屏像素），所以自己缩：
        // 缩略图那一格不到 300pt 宽，480px 足够清楚，又不至于每 4s 推几百 KB 过桥。
        view.takeSnapshot(with: WKSnapshotConfiguration()) { image, _ in
            guard let image, image.size.width > 0 else {
                completion(nil)
                return
            }
            let scale = min(1, width / image.size.width)
            let size = NSSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
            guard let rep = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
            ) else {
                completion(nil)
                return
            }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
            guard let png = rep.representation(using: .png, properties: [:]) else {
                completion(nil)
                return
            }
            completion(png.base64EncodedString())
        }
    }

    /// 在页面里执行 JS（MCP 的 browser_evaluate 用）；结果转成 JSON 文本。
    ///
    /// **脚本是表达式，不是函数体**：`callAsyncJavaScript` 把字符串当函数体解析，
    /// 不写 return 就永远拿不到值（实测 `document.title` 回的是 nil）。所以壳负责包一层
    /// `return (…)`——SDK 侧因此只写表达式（IIFE / 字符串比较），不必各自记得 return。
    func evaluate(_ script: String, completion: @escaping (String) -> Void) {
        let trimmed = script.trimmingCharacters(in: .whitespacesAndNewlines)
        let expression = trimmed.hasSuffix(";") ? String(trimmed.dropLast()) : trimmed
        view.callAsyncJavaScript("return (\n\(expression)\n);", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                if JSONSerialization.isValidJSONObject(value),
                   let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
                   let text = String(data: data, encoding: .utf8) {
                    completion(text)
                } else if value is NSNull {
                    completion("null")
                } else {
                    completion(String(describing: value))
                }
            case .failure(let error):
                completion("Error: \(error.localizedDescription)")
            }
        }
    }

    /// 把当前观察重推一次（SPA 挂载浏览器页时经 `browser-sync` 主动要一次）。
    /// 观察只在导航事件里发，面板关着时 agent 导航过的那一条没人收——重推是补那一次。
    func resync() { publish() }

    /// 当前观察（换标签/补推时取一次；宿刚醒时 url 可能还是空，由标签的镜像兜）。
    func observation() -> BrowserObservation {
        BrowserObservation(
            url: view.url?.absoluteString ?? "",
            title: view.title ?? "",
            loading: view.isLoading,
            canGoBack: view.canGoBack,
            canGoForward: view.canGoForward,
            error: lastError,
            zoom: Double(view.pageZoom)
        )
    }

    func publish() { onObservation?(observation()) }
}
