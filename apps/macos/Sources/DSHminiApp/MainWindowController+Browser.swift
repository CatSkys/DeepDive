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
}
