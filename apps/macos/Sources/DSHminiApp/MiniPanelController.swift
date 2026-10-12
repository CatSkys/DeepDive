import Cocoa
import WebKit

/// 迷你面板（`SPEC-SEMANTICS §6.1`）：贴屏缘常驻药丸 + 可展开条目列 + 命令卡。
/// 窗口配方沿悬浮球前例（`SPEC-NOTIFICATIONS §2.4`）；玻璃底板归原生一格所有
/// （`UI-SPEC §1.5`），条目列渲染归 web 薄入口（`?miniPanel=1`，同包同 token）。
/// 布局纪律：窗口每变一次态，container/玻璃/色调/webview 全部**显式**重排——
/// 不依赖 autoresizing（树② 的教训：容器不跟手，展开后内容挤在窗口角落）。
final class MiniPanelController: NSObject {
    static let shared = MiniPanelController()

    override init() {
        super.init()
        // App 激活即清「后台完成未读」（悬浮球同款语义，SPEC-NOTIFICATIONS §2.1）。
        NotificationCenter.default.addObserver(
            self, selector: #selector(appBecameActive),
            name: NSApplication.didBecomeActiveNotification, object: nil
        )
    }

    @objc private func appBecameActive() {
        guard unseen else { return }
        unseen = false
        pushStatus()
    }

    // MARK: - 会话状态面（悬浮球退役承接，SPEC-NOTIFICATIONS §2）

    private(set) var running = false
    private(set) var attention = false
    private(set) var unseen = false
    /// 点击聚焦目标（最近需注意/刚完成的会话；每次完成覆盖，不做"只在 nil 时设一次"）。
    private(set) var focusSessionId: String?

    func noteRunningStarted(sessionId: String) {
        unseen = false
        pushStatus()
    }

    func noteNeedsAttention() {
        guard !attention else { return }
        attention = true
        pushStatus()
    }

    func noteTurnFinished(sessionId: String, appInactive: Bool) {
        if appInactive { unseen = true }
        focusSessionId = sessionId
        pushStatus()
    }

    func sync(running: Bool, attention: Bool) {
        self.running = running
        self.attention = attention
        pushStatus()
    }

    func clearFocus() {
        focusSessionId = nil
        unseen = false
        pushStatus()
    }

    private func pushStatus() {
        panel?.dispatch(
            "miniPanelStatus",
            payload: ["running": running, "attention": attention, "unseen": unseen]
        )
    }

    /// 「迷你面板」开关（设置 → 通知，接管悬浮球行；新键默认开，悬浮球旧键作废）。
    func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "deepdive.miniPanel.enabled")
        if on { show() } else { panel?.orderOut(nil) }
    }

    /// 收起态窗口 bounds：8×44 玻璃小胶囊（右缘内贴）+ 左侧命中余量。
    static let tuckedSize = NSSize(width: 16, height: 48)
    /// 展开态窗口 bounds：右缘条目列（44）+ 左侧命令卡（树③ 接数据）。
    static let expandedSize = NSSize(width: 300, height: 560)

    /// 药丸贴边（树④）：拖动后吸附到主屏最近缘；y 偏移记偏好。
    var side: String {
        UserDefaults.standard.string(forKey: "deepdive.miniPanel.side") ?? "right"
    }

    /// 快捷会话默认空间的目录（D14）：引擎 `workspace/create` 只收**已存在的绝对
    /// 路径**（`~` 不展开，workspace/src/index.ts create 实锤），目录由壳保证存在；
    /// 注册由 SPA 首启幂等做（workspace/create 已注册即返回既有）。
    static var quickWorkspaceDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("DeepDive/快捷会话", isDirectory: true)
    }

    private var panel: MiniPanelWindow?
    private(set) var expanded = false
    /// 快捷空间最近会话（主 SPA 推来，迷你面板命令卡的数据源锚点）。
    private(set) var quickSessionId: String?

    /// 「迷你面板」开关（偏好位；设置行在树⑤ 随悬浮球退役一起接）。
    var enabled: Bool {
        UserDefaults.standard.object(forKey: "deepdive.miniPanel.enabled") == nil
            ? true
            : UserDefaults.standard.bool(forKey: "deepdive.miniPanel.enabled")
    }

    /// 药丸常驻：应用启动即贴边；显隐不随热键（§4.1 二次更正）。
    func show() {
        guard enabled else { return }
        if panel == nil { panel = MiniPanelWindow() }
        panel?.apply(expanded: false)
        // 不抢前台：nonactivating 面板显形，前台应用保持原样。
        panel?.orderFrontRegardless()
    }

    /// ⌥Space（§4.1）：收起 ↔ 展开。
    func toggleExpanded() {
        guard enabled, panel != nil else { return }
        setExpanded(!expanded)
    }

    func setExpanded(_ on: Bool) {
        guard enabled, expanded != on else { return }
        expanded = on
        panel?.apply(expanded: on)
        panel?.setOutsideClickCollapse(on)
        EngineLog.shared.append("[miniPanel] \(on ? "expand" : "collapse")")
    }

    /// 主 SPA 推来快捷空间最近会话（命令卡数据锚点）；转发给迷你页面。
    func setQuickSession(_ sessionId: String?) {
        guard quickSessionId != sessionId else { return }
        quickSessionId = sessionId
        panel?.dispatch("miniPanelQuick", payload: ["sessionId": sessionId as Any])
    }
}

/// 内容容器：拖动抓取区（收起态的小胶囊）在本层拦截，其余落给 webview。
/// WKWebView 会吃掉 mouseDown，`isMovableByWindowBackground` 对它无效——
/// 抓取走显式 rect（与 Atd 的"页面报拖拽区、壳起原生拖拽"同谱系）。
final class MiniPanelContainerView: NSView {
    var dragRect: NSRect = .zero
    private let grabber = NSView(frame: .zero)

    override func hitTest(_ point: NSPoint) -> NSView? {
        if dragRect.contains(convert(point, from: nil)) { return grabber }
        return super.hitTest(point)
    }

    func setDragRect(_ rect: NSRect) {
        dragRect = rect
        grabber.frame = rect
    }
}

/// 抓取视图：mouseDown 交给窗口原生效拖拽；未移动的松手按点击算（展开）。
final class MiniPanelGrabberView: NSView {
    var onClick: (() -> Void)?
    private var downLocation: NSPoint?

    override func mouseDown(with event: NSEvent) {
        downLocation = NSEvent.mouseLocation
        window?.performDrag(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        window?.performDrag(with: event)
    }

    override func mouseUp(with event: NSEvent) {
        if let down = downLocation {
            let moved = hypot(down.x - NSEvent.mouseLocation.x, down.y - NSEvent.mouseLocation.y)
            if moved < 3 { onClick?() } // 原位松手 = 点击（Atd 的点击展开语义）
        }
        downLocation = nil
    }
}

final class MiniPanelWindow: NSPanel, WKScriptMessageHandler {
    private let container = MiniPanelContainerView(frame: .zero)
    private let glass = WindowGlassView(frame: .zero)
    /// 收起态小胶囊的色调层（Atd pill-v2：纯玻璃小胶囊在纯色壁纸上不可见，
    /// 玻璃内加一层 labelColor 中性色调，轮廓随胶囊）。
    private let tone = NSView(frame: .zero)
    private var webView: WKWebView?
    /// 当前态的镜像：host-ready（页面加载/重载）时重放给页面。
    private var currentExpanded = false

    init() {
        super.init(
            contentRect: NSRect(origin: .zero, size: MiniPanelController.tuckedSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
        setAccessibilityIdentifier("deepdive.miniPanel")

        container.wantsLayer = true
        glass.autoresizingMask = []
        container.addSubview(glass)
        tone.wantsLayer = true
        tone.autoresizingMask = []
        container.addSubview(tone)
        let grabber = MiniPanelGrabberView(frame: .zero)
        grabber.onClick = {
            let mini = MiniPanelController.shared
            mini.setExpanded(true)
            if let sid = mini.focusSessionId {
                mini.clearFocus()
                NSApp.activate(ignoringOtherApps: true)
                AppDelegate.shared?.showMainWindow()
                AppDelegate.shared?.pushNavigateToSession(sid)
            }
        }
        container.addSubview(grabber)

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "deepdiveHost")
        let wv = WKWebView(frame: container.bounds, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.autoresizingMask = []
        container.addSubview(wv)
        webView = wv
        contentView = container

        if let base = BridgeServer.shared.url {
            var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
            comps.percentEncodedQuery = (comps.percentEncodedQuery.map { $0 + "&" } ?? "") + "miniPanel=1"
            wv.load(URLRequest(url: comps.url!))
        }

        // 拖完吸附：以窗口中心 y 记偏移，x 吸附到所在屏最近缘（Atd 的拖动语义）。
        NotificationCenter.default.addObserver(
            self, selector: #selector(snapAfterMove),
            name: NSWindow.didMoveNotification, object: self
        )
        observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            // 系统明暗翻转（appearance=system）：下次 apply 一并重定档，玻璃与页面同拍。
            self?.apply(expanded: self?.currentExpanded ?? false)
        }
    }

    private var clickMonitor: Any?

    @objc private func snapAfterMove() {
        guard !currentExpanded else { return } // 展开态不拖（树④ 只做收起态拖动）
        guard let screen = screen else { return }
        let workArea = screen.visibleFrame
        let midX = frame.midX
        let toLeft = abs(frame.minX - workArea.minX) <= abs(workArea.maxX - frame.maxX)
        let side = toLeft ? "left" : "right"
        UserDefaults.standard.set(side, forKey: "deepdive.miniPanel.side")
        let yOffset = frame.midY - workArea.midY
        UserDefaults.standard.set(yOffset, forKey: "deepdive.miniPanel.yOffset")
        EngineLog.shared.append("[miniPanel] snap side=\(side) yOffset=\(Int(yOffset))")
        apply(expanded: false)
    }

    /// 展开期间监听窗口外点击 → 收起（Atd 语义）；收起即撤监视。
    func setOutsideClickCollapse(_ on: Bool) {
        if on, clickMonitor == nil {
            clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] _ in
                guard let self, self.currentExpanded, !self.frame.contains(NSEvent.mouseLocation) else { return }
                MiniPanelController.shared.setExpanded(false)
            }
        } else if !on, let monitor = clickMonitor {
            NSEvent.removeMonitor(monitor)
            clickMonitor = nil
        }
    }

    func apply(expanded: Bool) {
        currentExpanded = expanded
        let workArea = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let size = expanded ? MiniPanelController.expandedSize : MiniPanelController.tuckedSize
        let side = MiniPanelController.shared.side
        let yOffset = UserDefaults.standard.double(forKey: "deepdive.miniPanel.yOffset")
        let y = min(max(workArea.midY + yOffset - size.height / 2, workArea.minY), workArea.maxY - size.height)
        let x = side == "left" ? workArea.minX : workArea.maxX - size.width
        let target = NSRect(origin: NSPoint(x: x, y: y), size: size)
        // 全部显式重排（autoresizing 不参与）：容器=窗口内容区；
        // 收起=玻璃+色调只铺 8×44 小胶囊；展开=玻璃先归零，等 web 推条目列 rect。
        container.setFrameSize(size)
        webView?.frame = container.bounds
        tone.isHidden = expanded
        let sliver = NSRect(x: side == "left" ? 0 : size.width - 8, y: 2, width: 8, height: 44)
        let nativeTarget = expanded ? NSRect.zero : sliver
        tone.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.16).cgColor
        container.setDragRect(expanded ? .zero : sliver)
        // 外观与主窗同一解析（MainWindowController.applyAppearanceMode 同源）：
        // 玻璃材质与页面 tokens 都吃 appearance——不同步就会出现亮色图标压暗玻璃。
        let mode = DSHAppPrefs.appearance
        let light = mode == "light" || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua)
        let appearance: NSAppearance? = mode == "system" ? nil : NSAppearance(named: light ? .aqua : .darkAqua)
        self.appearance = appearance
        webView?.appearance = appearance
        glass.applyAppearance(light: light)
        // 窗口与原生件同拍动画（0.22s ease-out）；页面内部过渡由 CSS 负责。
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.22
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            ctx.allowsImplicitAnimation = true
            animator().setFrame(target, display: true)
            glass.animator().frame = nativeTarget
            tone.animator().frame = nativeTarget
        }, completionHandler: nil)
        pushState()
    }

    func setStripRect(_ rect: NSRect) {
        guard currentExpanded, let z = webView?.pageZoom else { return }
        // web CSS px（y 向下）→ 窗口 point（y 向上）：只有 Y 翻转，X 两端同为向右
        // 增长（此前写成 width - maxX 的水平镜像，玻璃被铺到对侧——日志实锤）。
        // 尺寸按展开态终值算，不用动画中的 frame（rect 推送与 0.22s 动画赛跑，
        // 用动画中的宽度会算出负坐标）。
        glass.frame = NSRect(
            x: rect.minX * z,
            y: MiniPanelController.expandedSize.height - rect.maxY * z,
            width: rect.width * z,
            height: rect.height * z
        )
        EngineLog.shared.append("[miniPanel] strip rect \(glass.frame)")
    }

    private func pushState() {
        let side = MiniPanelController.shared.side
        webView?.evaluateJavaScript(
            "window.__deepDiveHost && window.__deepDiveHost.dispatch('miniPanelState', { expanded: \(currentExpanded), side: '\(side)' })",
            completionHandler: nil
        )
    }

    /// 壳 → 迷你页面（命令卡数据等）。
    func dispatch(_ cmd: String, payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "window.__deepDiveHost && window.__deepDiveHost.dispatch('\(cmd)', \(json))",
            completionHandler: nil
        )
    }

    // MARK: - web → 壳（deepdiveHost 通道）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "host-ready":
            pushState()
            if let sid = MiniPanelController.shared.quickSessionId {
                dispatch("miniPanelQuick", payload: ["sessionId": sid])
            }
        case "miniPanelStrip":
            if let r = body["rect"] as? [String: Double],
               let x = r["x"], let y = r["y"], let w = r["width"], let h = r["height"] {
                setStripRect(NSRect(x: x, y: y, width: w, height: h))
            }
        case "miniPanel.expand":
            MiniPanelController.shared.setExpanded(true)
        case "miniPanel.collapse":
            MiniPanelController.shared.setExpanded(false)
        case "miniPanel.action":
            let kind = body["kind"] as? String
            EngineLog.shared.append("[miniPanel] action \(kind ?? "?")")
            MiniPanelController.shared.setExpanded(false)
            switch kind {
            case "openSession":
                // 命令卡运行：命令已在迷你页经引擎执行，本体跳到那条快捷会话看结果。
                NSApp.activate(ignoringOtherApps: true)
                AppDelegate.shared?.showMainWindow()
                if let sid = body["sessionId"] as? String {
                    AppDelegate.shared?.pushNavigateToSession(sid)
                }
            default:
                // openMain / newSession / commands(无会话时的空态点按)
                NSApp.activate(ignoringOtherApps: true)
                AppDelegate.shared?.showMainWindow()
                if kind == "newSession" {
                    AppDelegate.shared?.pushHostCommand("openQuickSession", payload: nil)
                }
            }
        default:
            break
        }
    }
}
