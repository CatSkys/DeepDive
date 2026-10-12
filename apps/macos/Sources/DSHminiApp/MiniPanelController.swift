import Cocoa
import WebKit

/// 迷你面板（`SPEC-SEMANTICS §6.1`）：贴屏缘常驻药丸 + 可展开条目列 + 命令卡。
/// 窗口配方沿悬浮球前例（`SPEC-NOTIFICATIONS §2.4`）；玻璃底板归原生一格所有
/// （`UI-SPEC §1.5`），条目列渲染归 web 薄入口（`?miniPanel=1`，同包同 token）。
/// 布局纪律：窗口每变一次态，container/玻璃/色调/webview 全部**显式**重排——
/// 不依赖 autoresizing（树② 的教训：容器不跟手，展开后内容挤在窗口角落）。
final class MiniPanelController {
    static let shared = MiniPanelController()

    /// 收起态窗口 bounds：8×44 玻璃小胶囊（右缘内贴）+ 左侧命中余量。
    static let tuckedSize = NSSize(width: 16, height: 48)
    /// 展开态窗口 bounds：右缘条目列（44）+ 左侧命令卡（树③ 接数据）。
    static let expandedSize = NSSize(width: 300, height: 560)

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
        EngineLog.shared.append("[miniPanel] \(on ? "expand" : "collapse")")
    }

    /// 主 SPA 推来快捷空间最近会话（命令卡数据锚点）；转发给迷你页面。
    func setQuickSession(_ sessionId: String?) {
        guard quickSessionId != sessionId else { return }
        quickSessionId = sessionId
        panel?.dispatch("miniPanelQuick", payload: ["sessionId": sessionId as Any])
    }
}

final class MiniPanelWindow: NSPanel, WKScriptMessageHandler {
    private let container = NSView(frame: .zero)
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
    }

    func apply(expanded: Bool) {
        currentExpanded = expanded
        let workArea = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let size = expanded ? MiniPanelController.expandedSize : MiniPanelController.tuckedSize
        let yOffset = UserDefaults.standard.double(forKey: "deepdive.miniPanel.yOffset")
        let y = min(max(workArea.midY + yOffset - size.height / 2, workArea.minY), workArea.maxY - size.height)
        setFrame(NSRect(origin: NSPoint(x: workArea.maxX - size.width, y: y), size: size), display: true)
        // 全部显式重排（autoresizing 不参与）：容器=窗口内容区；
        // 收起=玻璃+色调只铺 8×44 小胶囊；展开=玻璃先归零，等 web 推条目列 rect。
        container.setFrameSize(size)
        webView?.frame = container.bounds
        tone.isHidden = expanded
        if expanded {
            glass.frame = .zero
            tone.frame = .zero
        } else {
            let sliver = NSRect(x: size.width - 8, y: 2, width: 8, height: 44)
            glass.frame = sliver
            tone.frame = sliver
            tone.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.16).cgColor
        }
        pushState()
    }

    func setStripRect(_ rect: NSRect) {
        guard currentExpanded, let z = webView?.pageZoom else { return }
        // web CSS px（y 向下）→ 窗口 point（y 向上）；pageZoom 是两者间的系数（§9.2）。
        glass.frame = NSRect(
            x: frame.width - rect.maxX * z,
            y: frame.height - rect.maxY * z,
            width: rect.width * z,
            height: rect.height * z
        )
        EngineLog.shared.append("[miniPanel] strip rect \(glass.frame)")
    }

    private func pushState() {
        webView?.evaluateJavaScript(
            "window.__deepDiveHost && window.__deepDiveHost.dispatch('miniPanelState', { expanded: \(currentExpanded) })",
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
