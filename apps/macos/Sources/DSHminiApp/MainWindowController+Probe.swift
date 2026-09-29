import AppKit
import WebKit

// 量化探针的窗口侧（TODO §19）：UiProbe 只管闸门与协议，量界面这件事在这里做——
// webView 与原生层都在这个类里。桥是单例、窗口控制器不是，所以 provider 由
// MainWindowController 装（与 BrowserControl.tabsProvider 同因）。
//
// 本文件只做两件事：量 webView 里的节点（rect + computed style），报原生层的真实
// 几何（窗口、两块 WKWebView、侧栏浏览器视图——JS 量不到的那半边）。只读：不改
// DOM、不点击、不导航。

// MARK: - 量化探针取数（UiProbe 的窗口侧实现）

extension MainWindowController {
    /// 一次探针取数：原生层事实（JS 量不到的那半边）＋ webview 里的节点矩形与
    /// computed style。整体在主线程跑（webView 只能在主线程动），由 UiProbe.handle
    func probeMeasure(selectors: [String], props: [String], completion: @escaping (String?) -> Void) {
        guard let script = UiProbe.script(selectors: selectors, props: props) else { return completion(nil) }
        // evaluateJavaScript 不阻塞，回调在主线程——所以这里直接续上，不等它。
        webView.evaluateJavaScript(script) { result, _ in
            let nodes = (result as? String)
                .flatMap { $0.data(using: .utf8) }
                .flatMap { try? JSONSerialization.jsonObject(with: $0) }
            let payload: [String: Any] = [
                "ok": true,
                "native": self.nativeFacts(),
                "nodes": nodes ?? [],
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return completion(nil) }
            completion(String(data: data, encoding: .utf8))
        }
    }

    /// 原生层事实：窗口与两块 webview 的真实几何、外观、缩放。窗口坐标（不是屏幕
    /// 坐标）——页面里量到的 rect 也是窗口坐标，两边可直接相减对位。
    private func nativeFacts() -> [String: Any] {
        func frame(_ view: NSView?) -> [String: Any]? {
            guard let view else { return nil }
            let r = view.convert(view.bounds, to: nil)
            return ["x": Double(r.origin.x), "y": Double(r.origin.y),
                    "w": Double(r.size.width), "h": Double(r.size.height)]
        }
        var facts: [String: Any] = [
            "appearance": window?.effectiveAppearance.name.rawValue ?? "",
            "pageZoom": Double(webView.pageZoom),
        ]
        for (key, view) in [("glass", glass as NSView?), ("webview", webView as NSView?), ("browserWebview", browserView)] {
            if let f = frame(view) { facts[key] = f }
        }
        return facts
    }
}
