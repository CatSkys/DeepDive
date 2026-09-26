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

// MARK: - 缩放 / 查找 / 浏览器键盘

extension MainWindowController {
    /// 浏览器页里的键盘：**页面优先**（参考实现的 `pageFirst`，`App.swift:782-793`）——
    /// 只有我们真的要接的组合才吞掉，其余原样放给 WebKit（否则编辑器里打字会出系统提示音）。
    ///
    /// 为什么必须由壳监视：网页是另一个 WKWebView，焦点在它身上时 SPA 收不到键；而浏览器
    /// 的 ⌘L/⌘F/⌘R/⌘[/⌘]/⌘± 是"人会用"的基本盘。
    func installBrowserKeyMonitor() {
        guard browserKeyMonitor == nil else { return }
        browserKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.browserViewHasFocus() else { return event }
            guard event.modifierFlags.contains(.command),
                  !event.modifierFlags.contains(.control),
                  !event.modifierFlags.contains(.option) else { return event }
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            let shift = event.modifierFlags.contains(.shift)
            let command: String?
            switch key {
            case "l": command = "address"
            case "f": command = "find"
            case "g": command = shift ? "findPrevious" : "findNext"
            case "r": command = "reload"
            case "[": command = "back"
            case "]": command = "forward"
            case "=", "+": command = "zoomIn"
            case "-", "_": command = "zoomOut"
            case "0": command = "zoomReset"
            default: command = nil
            }
            guard let command else { return event }
            self.pushHostCommand("browserKey", payload: AppDelegate.jsonPayload(["key": command]))
            return nil
        }
    }

    /// 焦点是否落在浏览器视图里（找 responder 链，而不是比 firstResponder 本身——
    /// WebKit 的焦点常常在内部的 content view 上）。
    private func browserViewHasFocus() -> Bool {
        var responder: NSResponder? = window?.firstResponder
        while let current = responder {
            if current === browser.view { return true }
            responder = current.nextResponder
        }
        return false
    }

    /// SPA 发来的缩放命令（工具栏/快捷键/设置页三处共用一条消息；解析见 BrowserZoom.command）。
    func handleBrowserZoom(_ body: [String: Any]) {
        switch BrowserZoom.command(body) {
        // 「浏览器」设置页写回（frontend/src/prefs.ts）：两者的落点都在 UserDefaults，因为壳要在
        // `didCommit`（第一帧之前）读它们——留在 SPA 里就晚了。改完立刻作用到当前页。
        case .setDefault(let value):
            BrowserZoom.setDefaultZoom(value)
            browser.applyRememberedZoom()
        case .setRememberSite(let on):
            BrowserZoom.setRemembersPerSite(on)
            browser.applyRememberedZoom()
        case .set(let value):
            browser.setZoom(value)
        case .step(let up):
            browser.stepZoom(up: up)
        case .reset:
            browser.resetZoom()
        case nil:
            EngineLog.shared.append("[browser] unknown zoom command")
        }
    }

    /// SPA 发来的页内查找（`browser-find`）：`forward` 缺省为 true，空 query 即取消。
    func handleBrowserFind(_ body: [String: Any]) {
        let text = body["query"] as? String ?? ""
        let forward = body["forward"] as? Bool ?? true
        browser.find(text, forward: forward) { [weak self] found in
            self?.pushHostCommand("browserFindResult", payload: AppDelegate.jsonPayload(["found": found, "query": text]))
        }
    }
}
