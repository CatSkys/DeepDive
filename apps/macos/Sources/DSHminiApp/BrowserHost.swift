// 侧栏浏览器的壳侧宿主：窗口里的第二个 WKWebView。对应官方
// @deepseek-ai/dsh-client-ui-sidebar-browser 的 ElectronWebViewImpl（Electron <webview> 那一支），
// 位置由前端推上来的槽位 rect 决定（nativeSlot.ts），命令由 SPA 与 agent 两侧共用。
//
// 三条与官方对齐的策略：
//   · 协议白名单：只放 http/https/about:blank（file:/data:/blob 一律拒；本地文件预览归文档预览）；
//   · 独立数据存储：`BrowserDataStore`（自己的一份、持久，与 dsh 引擎那份互不可见）；
//   · 页面拿不到宿主能力：**唯一**一条页面 → 壳的通道是拾取回话（`BrowserHost+Hidden`，只在拾取
//     模式开着时认、只接受两种形状），注入的脚本只有壳自己那几段（按站隐藏的 CSS / 拾取 / 阅读
//     模式），弹窗不开原生窗口。
//
// 缩略图态要让点击落到 SPA（点它是"展开面板"而非操作网页）：那由 hitTest 直接返回 nil 完成
// ——原生视图恒在 SPA 之上，不收点击必须由壳让位。

// 槽位（`BrowserSlot`）、给 SPA 的观察（`BrowserObservation`）与那个能"不收点击"的视图
// （`BrowserHostView`）在 BrowserHostParts.swift：它们是被推来推去的**数据/零件**，宿主只管接线。

import AppKit
import WebKit

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
    /// 按站隐藏的拾取回来了（选择器、它的名字）；取消是另一条
    var onPicked: ((String, String) -> Void)?
    var onPickCancelled: (() -> Void)?
    /// 正在等人在页面上点一个元素（面板要显示提示）
    var picking = false
    /// 拾取回话的弱代理（见 BrowserHost+Hidden：不能把宿主自己注册成 handler，会成环）
    let pickerProxy = BrowserPickerProxy()
    /// 滚动回话的弱代理（阅读进度用；见 BrowserHost+Scroll）
    let scrollProxy = BrowserScrollProxy()
    /// 页面滚动回报（y, 还能滚多少）：标签集合据此记每个标签的阅读进度
    var onScroll: ((Double, Double) -> Void)?

    var lastError = false
    /// 标题的 KVO（标题是**稍后**解析出来的：导航事件都发完了它才到，没有人推观察的话
    /// 标签栏、地址栏与历史里的标题就永远停在那一刻的空值上）
    private var titleObservation: NSKeyValueObservation?
    /// 这一页正在"阅读模式"里（导航一开始就清掉：换页等于退出）
    var readerOn = false
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
        // 空白/未加载时不画自己的底（透出底下 SPA 的空白页——与标签行同底色一体，
        // 用户指出的"两层皮"缝就是这层原生底色）；有页面时页面自己画背景
        view.setValue(false, forKey: "drawsBackground")
        // 圆角与 .main 卡片同心（tokens.json radius.panel = 18，keep in sync）：原生视图
        // 浮在 SPA 之上，.main 的 overflow 裁剪管不到它，直角会盖住卡片的圆角
        view.wantsLayer = true
        view.layer?.cornerRadius = 18
        view.layer?.masksToBounds = true
        view.allowsMagnification = false
        view.isInspectable = true
        view.autoresizingMask = []
        // 页面 → 壳的拾取回话（按站隐藏用；见 BrowserHost+Hidden 的安全边界）
        pickerProxy.host = self
        scrollProxy.host = self
        configuration.userContentController.add(pickerProxy, name: "deepdivePicker")
        // 标题到了就推一次观察（KVO 是唯一能听见它的地方）
        titleObservation = view.observe(\.title, options: [.new]) { [weak self] _, _ in
            self?.publish()
        }
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
            zoom: Double(view.pageZoom),
            reader: readerOn,
            picking: picking
        )
    }

    /// 给下一次导航挂上按站隐藏的那段脚本（`WKUserScript`，文档开始就注入：不会先看见再消失）。
    /// 传空串 = 撤掉（这一站没有要藏的，或刚被恢复）。
    ///
    /// `WKUserContentController` 只能整批清（没有 removeUserScript:），而这个 controller 上
    /// 本来就只有这一条 user script（脚本注入是我们的，页面别想有），所以整批清正好。
    func armHiddenCSS(_ source: String) {
        let controller = view.configuration.userContentController
        controller.removeAllUserScripts()
        guard !source.isEmpty else { return }
        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        controller.addUserScript(script)
    }

    func publish() { onObservation?(observation()) }
}
