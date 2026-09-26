// 主窗口的浏览器接线（侧栏浏览器的原生载体）：槽位换算、导航命令分发。
//
// 独立成扩展文件而不是继续塞 MainWindowController：那份已是 600+ 行的存量文件，
// 新逻辑不往上堆（AGENTS.md）。宿主实例 `browser` 是主类的存储属性（Swift 的扩展放不了
// 存储属性），槽位状态则存在 BrowserHost 自己身上，所以这里不必碰主类的私有成员。

import AppKit
import WebKit

extension MainWindowController {
    /// 原生视图槽位（frontend/src/nativeSlot.ts）：把 CSS px 的 rect 交给 BrowserHost，
    /// 由它按 pageZoom 换算成 AppKit 的 frame 摆位。
    func handleNativeSlot(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              body["type"] as? String == "native-slot",
              body["id"] as? String == "browser" else { return }
        let d = (body["rect"] as? [String: Any]) ?? [:]
        let slot = BrowserSlot(
            rect: NSRect(
                x: d["x"] as? Double ?? 0,
                y: d["y"] as? Double ?? 0,
                width: d["w"] as? Double ?? 0,
                height: d["h"] as? Double ?? 0
            ),
            visible: body["visible"] as? Bool ?? false,
            interactive: body["interactive"] as? Bool ?? false
        )
        browser.setSlot(slot, contentHeight: browserContainerHeight, zoom: browserZoom)
    }

    /// SPA 的人工操作（地址栏/后退/前进/刷新）：与 agent 的控制面走同一个 BrowserHost。
    func handleBrowserNav(_ body: [String: Any]) {
        EngineLog.shared.append("[browser] nav \(body["action"] as? String ?? "?")")
        switch body["action"] as? String {
        case "load": browser.load(body["url"] as? String ?? "")
        case "back": browser.goBack()
        case "forward": browser.goForward()
        case "reload": browser.reload()
        default: break
        }
    }

    /// 浏览器全屏时的悬浮输入框（`composer-overlay`）：显示/收起那一层透明 webview。
    /// rect 由 SPA 算（它知道面板网页那一格的几何）；会话为 nil 表示收起。
    func handleComposerOverlay(_ body: [String: Any]) {
        guard let sessionId = body["sessionId"] as? String else {
            composerOverlay.hide()
            return
        }
        let d = (body["rect"] as? [String: Any]) ?? [:]
        let rect = NSRect(
            x: d["x"] as? Double ?? 0,
            y: d["y"] as? Double ?? 0,
            width: d["w"] as? Double ?? 0,
            height: d["h"] as? Double ?? 0
        )
        composerOverlay.show(
            sessionId: sessionId,
            rect: rect,
            contentHeight: browserContainerHeight,
            zoom: browserZoom,
            origin: spaOrigin
        )
    }

    /// 叠加层页面报上来的"可点矩形"（`composer-pill`）：胶囊之外要透传点击给网页。
    func handleComposerPill(_ body: [String: Any]) {
        let d = (body["rect"] as? [String: Any]) ?? [:]
        composerOverlay.setPill(
            cssRect: NSRect(
                x: d["x"] as? Double ?? 0,
                y: d["y"] as? Double ?? 0,
                width: d["w"] as? Double ?? 0,
                height: d["h"] as? Double ?? 0
            ),
            zoom: browserZoom
        )
    }

    /// SPA 索要缩略图预览（`browser-shot`）：回报一张缩小的快照。
    /// 面板收起时那一格显示它——WKWebView 没法"缩小放进去"（见 BrowserHost.previewShot）。
    func handleBrowserShot() {
        browser.previewShot(width: 480) { [weak self] base64 in
            guard let self, let base64 else { return }
            self.pushHostCommand("browserShot", payload: AppDelegate.jsonPayload(["png": base64]))
        }
    }

    /// SPA 挂载浏览器页时取一次当前观察（`browser-sync`）：观察是"变化才推"的，
    /// 面板关着时 agent 导航过的那一条对后挂载的 SPA 就丢了——不补这一次，SPA 会以为
    /// 浏览器是空的（走空态、连槽位都不推，壳里已经打开的页面因此看不见）。
    func handleBrowserSync() {
        browser.resync()
    }
}
