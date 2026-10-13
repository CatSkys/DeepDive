import AppKit
import WebKit

// 迷你面板（产品概念）的窗口与控制器：一个独立的简洁会话面板——没有边栏，
// 只有 52pt 拖拽条 + 会话内容 + 输入区，数据源是快捷会话空间。窗体形制照 Atd
// 的主面板（授权复制）：NSPanel + 液态玻璃底板 + 透明 WebView，每次召唤 dock 到
// 光标屏右下角、尺寸记忆、位置不记。它只管窗口与显隐；会话数据/命令执行仍走
// 主 SPA 的 store（本页是同一 SPA 的 #/mini 分支）。
// 启动器（屏缘药丸/胶囊）是另一族窗口，在 MiniPanel/（Atd 同名移植）。

/// Atd `ShellPanel` 的复刻：非激活 NSPanel，但能拿键盘；常驻隐身保 WebKit 满速。
final class QuickPanelWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class QuickPanelController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    /// 快捷会话默认空间的目录（D14）：引擎 workspace/create 只收已存在的绝对
    /// 路径（~ 不展开），目录由壳保证存在、注册由 SPA 幂等做。
    static var quickWorkspaceDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("DeepDive/快捷会话", isDirectory: true)
    }

    /// 用户拖拽结束才记尺寸（Atd 同款：只在 windowDidEndLiveResize 写）。
    private static let widthKey = "deepdive.quickPanel.width"
    private static let heightKey = "deepdive.quickPanel.height"

    let window: QuickPanelWindow
    let webView: TitlebarAwareWebView
    /// 窗口底板（主窗 WindowGlassView 同款）：液态玻璃 + 深浅两档 tint。
    let glass: WindowGlassView
    /// 面板里那几块**原生玻璃件**（命令中心卡、右上胶囊、输入框）：系统真 Liquid Glass，
    /// 网页那侧对应元素不再自己画背景/模糊/投影/圆角，只留布局（见 theme.css 面板作用域）。
    /// 按页面上报的矩形摆位（`mini-cc-frame` / `mini-glass` 两份 rect 表）。
    private let cardGlass = WindowGlassView(surface: .floating)
    private let capsuleGlass = WindowGlassView(surface: .floating)
    private let composerGlass = WindowGlassView(surface: .floating)
    /// 卡片的**内容**住在第二块透明 webview 里（`?minicc=1` 那一页）：玻璃垫在 webview
    /// 之下，能糊到的只有它下面的东西——卡片内容若与面板页同处一块 webview，面板正文会
    /// 盖在玻璃上，卡片看着就是透明的（用户 2026-10-13 报"面板透明啦"）。分成两块之后
    /// 玻璃正下方是面板页正文（该被糊掉的正是它），卡片内容在玻璃之上。
    private var cardWeb: WKWebView!
    /// 卡片当前是不是"该显示"（淡入途中也算 true）：每 300ms 一条矩形上报必须幂等，
    /// 否则入场会被反复重播（FrostSurface 同款纪律）。
    private var cardVisible = false
    /// 卡片进出的时长（秒）：页面按 token（`--dur-fast`）报来，壳里不写第二份。
    private var cardMotion: TimeInterval = 0.12
    /// 卡片那一页的地址（同一 SPA 包，`?minicc=1`）：load(bridgeURL:) 时记下。
    private var cardURL: URL?
    /// 上一次推给卡片页的脸（模式 + 会话 id）：差分推送，别每个节拍都 evaluateJavaScript。
    private var pushedFace = ""
    /// 迷你面板页 → 壳（host-ready / set-pref / miniPanel.* 系列）。转发给
    /// AppDelegate.handleHostMessage；主窗与迷你面板各持一条，靠消息类型区分归属。
    var onHostMessage: (([String: Any]) -> Void)?
    /// Shell→frontend：与 MainWindowController 同款 pending 暂存（host 未挂载时不丢）。
    private var pendingHostCommand: (cmd: String, payload: String, stagedAt: Date)?
    /// Feeds the window's visible-but-empty toolbar (Tahoe large-corner class, 见 EmptyToolbarDelegate)。
    private let emptyToolbarDelegate = EmptyToolbarDelegate()
    private var appearanceObservation: NSKeyValueObservation?

    /// 引擎就绪后的 reload 标记（MainWindowController.urlMarkingEngineReady 同款）。
    private var engineReadySeen = false

    override init() {
        let window = QuickPanelWindow(
            contentRect: NSRect(origin: .zero, size: NSSize(width: 500, height: 680)),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.acceptsMouseMovedEvents = true
        let toolbar = NSToolbar(identifier: "DeepDiveQuickPanelTitlebar")
        toolbar.delegate = emptyToolbarDelegate
        window.toolbar = toolbar
        window.titlebarSeparatorStyle = .none
        window.isReleasedWhenClosed = false
        window.isExcludedFromWindowsMenu = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.hidesOnDeactivate = false
        window.becomesKeyOnlyIfNeeded = false
        window.collectionBehavior = [.fullScreenNone, .moveToActiveSpace]
        window.animationBehavior = .none
        // 快捷对话面**默认置顶所有窗口**（用户 2026-10-13 定稿：面板的属性是快捷对话，
        // 所以它压在所有页面之上）。隐藏仍走 alpha 0（见下方常驻隐身），不靠层级让位。
        window.level = .floating

        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController = WKUserContentController()
        let wv = TitlebarAwareWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.allowsMagnification = false
        wv.isInspectable = true
        webView = wv

        // 窗底与主窗同源（WindowGlassView）：迷你面板走 .panel 档——整窗都是玻璃面、
        // 无内容卡兜底，tint 比主窗深一档，玻璃之上再叠一段窗内磨砂（糊两遍，面板档
        // 配方见 WindowGlassView）。底图语义是系统采样面板之下的真实画面，不读壁纸
        // 文件。WebView 透明铺在最上层。
        glass = WindowGlassView(surface: .panel)
        window.contentView = glass
        wv.frame = glass.bounds
        wv.autoresizingMask = [.width, .height]
        glass.addSubview(wv)
        // 三层，自下而上：面板页 webview → 卡片那块原生玻璃 → 卡片的透明 webview。
        // 顺序错了必出两件事之一：玻璃盖住卡片内容，或面板正文盖在玻璃上（用户报的
        // "面板透明啦"）。三块玻璃件都先藏起来，等页面报矩形再摆。
        let cardConfig = WKWebViewConfiguration()
        cardConfig.defaultWebpagePreferences.allowsContentJavaScript = true
        let cardWeb = WKWebView(frame: .zero, configuration: cardConfig)
        cardWeb.setValue(false, forKey: "drawsBackground")
        cardWeb.underPageBackgroundColor = .clear
        cardWeb.allowsMagnification = false
        cardWeb.autoresizingMask = []
        cardWeb.alphaValue = 0
        cardWeb.isHidden = true
        self.cardWeb = cardWeb
        let pieces: [WindowGlassView] = [cardGlass, capsuleGlass, composerGlass]
        for piece in pieces {
            piece.autoresizingMask = []
            piece.alphaValue = 0
            piece.isHidden = true
        }
        // 三块玻璃件都在面板页 webview 之上、卡片页之下（层序见上面那段注释）。
        // **漏挂就是"没有材质"**：网页侧这些元素的 CSS 底/模糊已删（材质归原生），
        // 挂不上就只剩透明的布局与图标（2026-10-13 用户报"胶囊和输入框怎么没了"）。
        for piece in [capsuleGlass, composerGlass, cardGlass] {
            glass.addSubview(piece, positioned: .above, relativeTo: wv)
        }
        glass.addSubview(cardWeb, positioned: .above, relativeTo: cardGlass)
        self.window = window

        super.init()
        window.delegate = self
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.configuration.userContentController.add(self, name: "deepdive")
        wv.configuration.userContentController.add(self, name: "deepdiveHost")
        // 卡片页与面板页用**同名**两条桥，消息按"哪块 webview 发来的"分流（见
        // userContentController）；注册必须等 super.init 之后（那时才能把 self 交出去）。
        cardWeb.configuration.userContentController.add(self, name: "deepdive")
        cardWeb.configuration.userContentController.add(self, name: "deepdiveHost")
        cardWeb.navigationDelegate = self
        // 标题栏拖拽条（MainWindowController 的自绘条配方）：迷你面板没有自己的
        // 拖放源，文件夹投递不接（body 无侧栏、附件走输入区）。
        // 常驻隐身（Atd 同款：alpha 0 保 WebKit 计时器满速；不用 orderOut）。
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.orderFrontRegardless()
        // appearance=system 时跟随系统明暗翻转。
        appearanceObservation = window.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            self?.applyAppearanceMode()
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.applyAppearanceMode()
            // 首帧就把灯压到头部中心线：窗口从没 key 过时上面那条 delegate 不会触发
            // （常驻隐身 + orderFrontRegardless 的召唤前状态）。
            WindowHeaderLine.alignTrafficLights(in: self.window)
        }
    }

    // MARK: - summon（Atd dockAtCursor + show）

    /// 每次召唤都重新 dock：光标屏工作区右下角、16pt 边距；尺寸用上次记忆的。
    func dockAtCursor() {
        let workArea = Screens.workAreaUnderCursor()
        let savedW = UserDefaults.standard.double(forKey: Self.widthKey)
        let savedH = UserDefaults.standard.double(forKey: Self.heightKey)
        let size = savedW > 0 && savedH > 0
            ? WindowSize(width: savedW, height: savedH)
            : PanelGeometry.defaultSize
        let frame = NSRect(PanelGeometry.dockedFrame(in: workArea, size: size))
        window.setFrame(frame, display: false)
        window.minSize = NSSize(
            width: min(PanelGeometry.minimumSize.width, workArea.width),
            height: min(PanelGeometry.minimumSize.height, workArea.height))
    }

    /// 显隐开关（⌥Space / 胶囊 logo 钮 / Dock 点击共用）。
    func togglePanel() {
        if isVisible { hidePanel() } else { showPanel() }
    }

    var isVisible: Bool {
        window.alphaValue > 0 && !window.ignoresMouseEvents && !window.isMiniaturized
    }

    func showPanel() {
        // 召唤前记住前台应用（giveUpKey 用）；此时还没激活自己。
        previousApp = NSWorkspace.shared.frontmostApplication
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.alphaValue = 0
        window.ignoresMouseEvents = false
        window.orderFrontRegardless()
        window.makeKey()
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.12
                self.window.animator().alphaValue = 1
            }
        }
        focusComposerSoon()
    }

    func hidePanel() {
        // 卡片那块原生玻璃不必单独藏：它是本窗的子视图，窗口 alpha 归零它跟着一起没了
        // （真去藏它反而有害——页面还开着卡、下一次矩形上报要 300ms 才来，那半秒里
        // 卡是没有面的）。
        guard window.alphaValue > 0 else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.10
            self.window.animator().alphaValue = 0
        }, completionHandler: {
            guard !self.isVisible else { return }
            self.window.ignoresMouseEvents = true
        })
        // 焦点归还：迷你面板是 nonactivatingPanel，常驻不 orderOut——上一前台应用
        // （召唤前的活跃应用）要回来接键盘，否则它还在前台却丢了 key。
        giveUpKeyToPreviousApp()
    }

    /// 召唤前记住前台应用，隐藏时把它请回来（Atd onGaveUpKey 的语义）。
    private var previousApp: NSRunningApplication?

    private func giveUpKeyToPreviousApp() {
        guard let app = previousApp, !app.isTerminated, app != NSRunningApplication.current else { return }
        app.activate(options: [])
        previousApp = nil
    }

    /// 键盘要进输入框：页面收到 quickPanelFocus 后聚焦自己的输入区
    /// （Atd use-panel-window 聚焦 [data-panel-autofocus] 的同语义；钩子未挂载
    /// 时 pushHostCommand 自己会暂存，页面就绪后 flush）。
    private func focusComposerSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.window.makeKey()
            self?.pushHostCommand("quickPanelFocus", payload: "{}")
        }
    }

    // MARK: - URL + bridge

    /// 迷你面板加载同一 SPA 的 #/mini 分支；engine=ready 由主窗同款逻辑决定。
    func load(bridgeURL: URL?) {
        guard let bridgeURL,
              var comps = URLComponents(url: bridgeURL, resolvingAgainstBaseURL: false) else { return }
        var items = (comps.queryItems ?? []).filter { $0.name != "engine" }
        if BridgeServer.shared.hasEngine, engineReadySeen {
            items.append(URLQueryItem(name: "engine", value: "ready"))
        }
        comps.queryItems = items
        comps.fragment = "/mini"
        guard let url = comps.url else { return }
        webView.load(URLRequest(url: url))

        // 命令中心卡那一页：同一个包、同一个 engine 旗标，多一个 `?minicc=1`、不带 fragment。
        // 什么时候真加载见 loadCardIfNeeded（首次开卡那一刻）——面板常驻隐身，别在召唤前
        // 白发一页。
        var cardComps = comps
        cardComps.fragment = nil
        cardComps.queryItems = items + [URLQueryItem(name: "minicc", value: "1")]
        cardURL = cardComps.url
    }

    /// 引擎就绪状态变化时重算 reload 标记（下次 load 生效；不主动重载页面）。
    func noteEngineReady() {
        if BridgeServer.shared.hasEngine { engineReadySeen = true }
    }

    /// Shell→迷你面板页：与 MainWindowController.pushHostCommand 同款（含 pending 暂存）。
    func pushHostCommand(_ cmd: String, payload: String, to target: WKWebView? = nil) {
        let target = target ?? webView
        guard target.url != nil else {
            // 暂存只服务面板页（卡片页由 loadCardIfNeeded 保证先加载再推脸）
            if target === webView { pendingHostCommand = (cmd, payload, Date()) }
            return
        }
        let js = "window.__deepDiveHost ? (window.__deepDiveHost.dispatch('\(cmd)', \(payload)), 'ok') : 'no-host'"
        target.evaluateJavaScript(js) { [weak self] result, _ in
            // 暂存（15s 内重放）只服务面板页：卡片页由 loadCardIfNeeded 之后那次 didFinish
            // 复位 pushedFace 重推，走不到这条暂存位（混进去会把它重放给面板页）。
            guard target === self?.webView, (result as? String) != "ok" else { return }
            self?.pendingHostCommand = (cmd, payload, Date())
        }
    }

    /// 暂存命令的时效（与主窗同款：15s 内才值得重放）。
    private static let stagedCommandLifetime: TimeInterval = 15

    private func flushPendingHostCommand() {
        guard let (cmd, payload, stagedAt) = pendingHostCommand else { return }
        pendingHostCommand = nil
        guard Date().timeIntervalSince(stagedAt) <= Self.stagedCommandLifetime else {
            EngineLog.shared.append("[bridge] quick panel dropped stale staged host command \(cmd)")
            return
        }
        pushHostCommand(cmd, payload: payload)
    }

    // MARK: - 外观（与 MainWindowController.applyAppearanceMode 同源解析）

    func applyAppearanceMode() {
        let mode = DSHAppPrefs.appearance
        let light = mode == "light" || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua)
        let appearance: NSAppearance? = mode == "system" ? nil : NSAppearance(named: light ? .aqua : .darkAqua)
        window.appearance = appearance
        webView.appearance = appearance
        // 液态玻璃的 tint 按明暗换档（主窗 glass.applyAppearance 同一句；退回分支
        // 的 vibrancy tint 也走这里——见 WindowGlassView.applyAppearance）。
        glass.applyAppearance(light: light)
        let pieces: [WindowGlassView] = [cardGlass, capsuleGlass, composerGlass]
        for piece in pieces {
            piece.applyAppearance(light: light)
        }
        pushHostCommand("themeChanged", payload: AppDelegate.jsonPayload(["dark": !light]))
    }

    // MARK: - WKScriptMessageHandler（页面 → 壳）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // 卡片页那两条桥只服务"用户要关"这一件事：开合的事实源在面板页（胶囊按钮在那儿），
        // 卡片按了 Esc 就报上来、由这里转发回面板页收卡。**不转发给 AppDelegate**——那一层
        // 认的是主窗/面板页那套消息，卡片页没有它的活。
        if message.name == "deepdiveHost",
           userContentController === cardWeb?.configuration.userContentController {
            if let body = message.body as? [String: Any], body["type"] as? String == "mini-cc-close" {
                hideCard()
                pushHostCommand("miniCCClosed", payload: "{}", to: cardWeb)
                pushHostCommand("miniCCClosed", payload: "{}")
            }
            return
        }
        if message.name == "deepdive" {
            // 几块原生玻璃的矩形表（页面 → 壳）：卡片那块的几何与圆角，口径与 composer-pill
            // 完全一致（CSS 视口坐标 y-down、圆角按实际渲染值报来、时长按 token 报来）。
            if let body = message.body as? [String: Any], let type = body["type"] as? String {
                if type == "mini-cc-frame" { placeCard(body); return }
                if type == "mini-glass" { placeGlassPieces(body); return }
            }
            // 标题栏控件矩形表（titlebar.ts 同一协议：{type:"titlebar-rects", rects:[{x,y,w,h}]}）。
            if let body = message.body as? [String: Any], body["type"] as? String == "titlebar-rects" {
                let rects: [NSRect] = ((body["rects"] as? [[String: Any]]) ?? []).map { d in
                    NSRect(
                        x: d["x"] as? Double ?? 0,
                        y: d["y"] as? Double ?? 0,
                        width: d["w"] as? Double ?? 0,
                        height: d["h"] as? Double ?? 0
                    )
                }
                webView.setTitlebarControlRects(rects)
            }
            return
        }
        if message.name == "deepdiveHost", let body = message.body as? [String: Any] {
            onHostMessage?(body)
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 卡片页刚加载完：它还没挂桥，之前那次推脸必然落空——复位后由下一个矩形节拍重推
        // （面板页那几条走的是暂存位，与这里无关）。
        guard webView === cardWeb else {
            flushPendingHostCommand()
            // Backup flush for the `host-ready` signal (handler may fire before
            // React mounts the hook; if it is still missing the command re-stages).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.flushPendingHostCommand()
            }
            return
        }
        pushedFace = ""
    }

    // MARK: - 面板里的原生玻璃件（几何跟着页面上报的矩形走）

    /// 页面报来的 CSS 视口矩形 → 本层坐标（y 翻转 + 缩放，与顶条 rect 表同一套换算）。
    private func hostFrame(cssRect css: NSRect) -> NSRect {
        let zoom = webView.pageZoom
        let host = webView.frame
        return NSRect(
            x: host.minX + css.minX * zoom,
            y: host.minY + host.height - (css.minY + css.height) * zoom,
            width: css.width * zoom,
            height: css.height * zoom
        )
    }

    private func cssRect(_ body: [String: Any]?) -> NSRect? {
        guard let d = body else { return nil }
        let r = NSRect(
            x: d["x"] as? Double ?? 0,
            y: d["y"] as? Double ?? 0,
            width: d["w"] as? Double ?? 0,
            height: d["h"] as? Double ?? 0
        )
        return r.width > 1 && r.height > 1 ? r : nil
    }

    /// 命令中心卡（`mini-cc-frame`）：`frame` 为 nil/空 = 收起。
    private func placeCard(_ body: [String: Any]) {
        guard let css = cssRect(body["frame"] as? [String: Any]) else {
            hideCard()
            return
        }
        let frame = hostFrame(cssRect: css)
        cardGlass.frame = frame
        cardWeb.frame = frame
        if let radius = body["radius"] as? Double { cardGlass.setRadius(radius * webView.pageZoom) }
        if let ms = body["durationMs"] as? Double, ms > 0 { cardMotion = ms / 1000 }
        loadCardIfNeeded()
        showCard()
        pushFace(mode: body["mode"] as? String, sessionId: body["sessionId"] as? String)
    }

    /// 右上胶囊与输入框那两块（`mini-glass`）：一件一条 rect，空 = 藏。
    private func placeGlassPieces(_ body: [String: Any]) {
        let pieces: [(WindowGlassView, String)] = [(capsuleGlass, "capsule"), (composerGlass, "composer")]
        for (piece, key) in pieces {
            guard let spec = body[key] as? [String: Any],
                  let css = cssRect(spec["rect"] as? [String: Any]) else {
                piece.isHidden = true
                continue
            }
            piece.frame = hostFrame(cssRect: css)
            if let radius = spec["radius"] as? Double { piece.setRadius(radius * webView.pageZoom) }
            piece.isHidden = false
            piece.alphaValue = 1
        }
    }

    private func loadCardIfNeeded() {
        guard cardWeb.url == nil, let url = cardURL else { return }
        cardWeb.load(URLRequest(url: url))
    }

    /// 开卡/换脸时把"哪张脸"推给卡片页（含会话 id：设置那排行集按脸给）；没变就不推。
    private func pushFace(mode: String?, sessionId: String?) {
        guard let mode, !mode.isEmpty else { return }
        let sig = "\(mode)|\(sessionId ?? "")"
        guard sig != pushedFace else { return }
        pushedFace = sig
        pushHostCommand(
            "miniCCFace",
            payload: AppDelegate.jsonPayload(["mode": mode, "sessionId": sessionId ?? NSNull()]),
            to: cardWeb
        )
    }

    /// 淡入（幂等）。只做入场：离场要页面把 DOM 留到动画跑完才不闪，收益不值那份编排
    /// 复杂度——收起直接藏，两边同时消失看不出过程。
    private func showCard() {
        guard !cardVisible else { return }
        cardVisible = true
        let layer: [NSView] = [cardGlass, cardWeb]
        for view in layer {
            if view.isHidden {
                view.alphaValue = 0
                view.isHidden = false
            }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = cardMotion
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                view.animator().alphaValue = 1
            }
        }
    }

    private func hideCard() {
        cardVisible = false
        let layer: [NSView] = [cardGlass, cardWeb]
        for view in layer {
            view.alphaValue = 0
            view.isHidden = true
        }
        pushedFace = ""
    }

    // MARK: - NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hidePanel()
        return false
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        UserDefaults.standard.set(window.frame.width, forKey: Self.widthKey)
        UserDefaults.standard.set(window.frame.height, forKey: Self.heightKey)
    }

    /// 头部行与红绿灯同一条中心线（主窗同款：WindowHeaderLine；面板头部行按这条线
    /// 排在内边距 16 处，见 theme.css 面板作用域那条注释）。尺寸/聚焦变化后重压一次
    /// ——内容视图高度变了，落点就跟着变。
    func windowDidResize(_ notification: Notification) {
        WindowHeaderLine.alignTrafficLights(in: window)
    }

    func windowDidBecomeKey(_ notification: Notification) {
        WindowHeaderLine.alignTrafficLights(in: window)
    }

    func windowDidChangeScreen(_ notification: Notification) {
        dockToSavedWorkArea()
    }

    /// 屏幕参数变化：仍在 dock 位就跟着新工作区重新 dock（PanelGeometry.follow）。
    private func dockToSavedWorkArea() {
        let frame = ScreenRect(window.frame)
        let (kept, _) = PanelGeometry.follow(frame, docked: nil, workArea: Screens.workArea(containing: frame))
        window.setFrame(NSRect(kept), display: true)
    }
}
