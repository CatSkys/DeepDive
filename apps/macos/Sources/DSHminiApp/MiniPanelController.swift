import Cocoa
import WebKit

/// 迷你面板（`SPEC-SEMANTICS §6.1`）：贴屏缘常驻药丸 + 可展开条目列。
/// 窗口配方沿悬浮球前例（`SPEC-NOTIFICATIONS §2.4`）；玻璃底板归原生一格所有
/// （`UI-SPEC §1.5`），药丸命中区与条目列渲染归 web 薄入口（`?miniPanel=1`，同包同 token）。
/// 树②：药丸与条目列、⌥Space 展开/收起；命令卡数据与快捷会话落点在树③，
/// 拖动吸附树④，状态点树⑤（承接悬浮球）。
final class MiniPanelController {
    static let shared = MiniPanelController()

    /// 收起态窗口 bounds：8×44 玻璃小胶囊（右缘内贴）+ 左侧命中余量。
    static let tuckedSize = NSSize(width: 16, height: 48)
    /// 展开态窗口 bounds：右缘条目列（44）+ 左侧命令卡区（树③ 落数据与几何）。
    static let expandedSize = NSSize(width: 300, height: 560)

    private var panel: MiniPanelWindow?
    private(set) var expanded = false

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

    fileprivate func setExpanded(_ on: Bool) {
        guard enabled, expanded != on else { return }
        expanded = on
        panel?.apply(expanded: on)
    }
}

final class MiniPanelWindow: NSPanel, WKScriptMessageHandler {
    private let glass = WindowGlassView(frame: .zero)
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

        let container = NSView(frame: NSRect(origin: .zero, size: MiniPanelController.tuckedSize))
        container.wantsLayer = true
        glass.frame = container.bounds
        glass.autoresizingMask = [.width, .height]
        container.addSubview(glass)

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "deepdiveHost")
        let wv = WKWebView(frame: container.bounds, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        wv.underPageBackgroundColor = .clear
        wv.autoresizingMask = [.width, .height]
        container.addSubview(wv)
        webView = wv
        contentView = container

        if let base = BridgeServer.shared.url {
            var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
            comps.percentEncodedQuery = (comps.percentEncodedQuery.map { $0 + "&" } ?? "") + "miniPanel=1"
            wv.load(URLRequest(url: comps.url!))
        }
    }

    /// 收起=玻璃只铺 8×44 小胶囊；展开=玻璃铺条目列（rect 由 web 布局后经
    /// `miniPanelStrip` 推来——条目列几何唯一来源在页面，壳只跟随，§4.23 同谱系）。
    func apply(expanded: Bool) {
        currentExpanded = expanded
        let workArea = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let size = expanded ? MiniPanelController.expandedSize : MiniPanelController.tuckedSize
        let yOffset = UserDefaults.standard.double(forKey: "deepdive.miniPanel.yOffset")
        let y = min(max(workArea.midY + yOffset - size.height / 2, workArea.minY), workArea.maxY - size.height)
        setFrame(NSRect(origin: NSPoint(x: workArea.maxX - size.width, y: y), size: size), display: true)
        glass.frame = expanded ? .zero : NSRect(x: size.width - 8, y: 2, width: 8, height: 44)
        pushState()
    }

    private func pushState() {
        webView?.evaluateJavaScript(
            "window.__deepDiveHost && window.__deepDiveHost.dispatch('miniPanelState', { expanded: \(currentExpanded) })",
            completionHandler: nil
        )
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
    }

    // MARK: - web → 壳（deepdiveHost 通道；mini 页只发这四条）

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "host-ready":
            pushState() // 页面加载/重载后重放当前态
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
            MiniPanelController.shared.setExpanded(false)
            NSApp.activate(ignoringOtherApps: true)
            AppDelegate.shared?.showMainWindow()
            // kind == "newSession" 的快捷会话落点（快捷空间新草稿）在树③ 接线。
        default:
            break
        }
    }
}
