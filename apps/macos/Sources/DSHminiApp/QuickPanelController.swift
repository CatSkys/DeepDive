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
        window.level = .normal

        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController = WKUserContentController()
        let wv = TitlebarAwareWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.allowsMagnification = false
        wv.isInspectable = true
        webView = wv

        // 窗底与主窗同源（WindowGlassView）：液态玻璃之上压深浅两档 tint（Raycast
        // 的"玻璃化 + 主题叠色"配方在我们的体系里就是这一层）——迷你面板此前用
        // GlassBackground 的裸玻璃（零叠色），壁纸大面积透上来（用户 2026-10-12
        // "这个面板太透了"），与 PITFALLS §4.27 铁律同一条：凡把底玻璃化，都得
        // 检查叠在上面的表面够不够实。WebView 透明铺在 tint 之上。
        glass = WindowGlassView()
        window.contentView = glass
        wv.frame = glass.bounds
        wv.autoresizingMask = [.width, .height]
        glass.addSubview(wv)
        self.window = window

        super.init()
        window.delegate = self
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.configuration.userContentController.add(self, name: "deepdive")
        wv.configuration.userContentController.add(self, name: "deepdiveHost")
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
        DispatchQueue.main.async { [weak self] in self?.applyAppearanceMode() }
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
    }

    /// 引擎就绪状态变化时重算 reload 标记（下次 load 生效；不主动重载页面）。
    func noteEngineReady() {
        if BridgeServer.shared.hasEngine { engineReadySeen = true }
    }

    /// Shell→迷你面板页：与 MainWindowController.pushHostCommand 同款（含 pending 暂存）。
    func pushHostCommand(_ cmd: String, payload: String) {
        guard webView.url != nil else {
            pendingHostCommand = (cmd, payload, Date())
            return
        }
        let js = "window.__deepDiveHost ? (window.__deepDiveHost.dispatch('\(cmd)', \(payload)), 'ok') : 'no-host'"
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            if (result as? String) != "ok" {
                self?.pendingHostCommand = (cmd, payload, Date())
            }
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
        pushHostCommand("themeChanged", payload: AppDelegate.jsonPayload(["dark": !light]))
    }

    // MARK: - WKScriptMessageHandler（页面 → 壳）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "deepdive" {
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
        flushPendingHostCommand()
        // Backup flush for the `host-ready` signal (handler may fire before
        // React mounts the hook; if it is still missing the command re-stages).
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.flushPendingHostCommand()
        }
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
