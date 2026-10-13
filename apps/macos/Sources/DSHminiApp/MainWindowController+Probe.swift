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
    func probeMeasure(selectors: [String], props: [String], points: [[Double]], completion: @escaping (String?) -> Void) {
        guard let script = UiProbe.script(selectors: selectors, props: props, points: points) else { return completion(nil) }
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
    ///
    /// 另带 `overlay`：悬浮输入框那层透明 webview 的显隐与**可点矩形**。它是网页之上
    /// 的合成层，可点矩形之外透传——矩形留着旧值就是一个看不见的死区（页面量不出来，
    /// 只有这里能证），故把 isVisible/alpha/interactiveRect 一并报出。
    /// 同一块还有 `frost`：卡片下面那块原生磨砂的几何与圆角（它必须与 hitRect 重合、
    /// 圆角与卡片一致，否则表现为"网页上多出一块压着的磨砂"或方角露在圆角外）。
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
        // 托管材质（网页里 `-apple-visual-effect` 的 glass 档）在 macOS 上是应用进程里的
        // 一个 CAHostingLayer，由 WebKit 的 WKMaterialHostingSupport 造、WebKit 把它的
        // bounds/position 设成**元素自己那层**的几何。网页侧只量得到 DOM 盒、看不到它，
        // 所以"材质板比元素大"这类事故只有这里能给出像素级证据（量元素盒与宿主层的差）。
        facts["materialHostingLayers"] = materialHostingLayers()
        facts["overlay"] = [
            "visible": composerOverlay.isVisible,
            "alpha": Double(composerOverlay.view.alphaValue),
            "hitRect": [
                "x": Double(composerOverlay.view.interactiveRect.origin.x),
                "y": Double(composerOverlay.view.interactiveRect.origin.y),
                "w": Double(composerOverlay.view.interactiveRect.size.width),
                "h": Double(composerOverlay.view.interactiveRect.size.height),
            ],
            "frost": [
                "hidden": composerOverlay.frost.isHidden,
                "alpha": Double(composerOverlay.frost.alphaValue),
                "radius": Double(composerOverlay.frost.layer?.cornerRadius ?? 0),
                "rect": frame(composerOverlay.frost) ?? [:],
            ] as [String: Any],
        ] as [String: Any]
        return facts
    }

    /// 走一遍 webView 的层树，报出所有"材质宿主层"（类名带 Hosting 的 CALayer）的几何。
    /// 判据用类名而不是名字：WebCore 侧给结构层起的名字（`material hosting: …`）不保证
    /// 传到 UI 进程这块远程层上，而 CAHostingLayer 这个类名是 macOS 侧的宿主层实现。
    /// 同时报一份有尺寸的层清单（前 24 个），名字/类名认不出来时还能人工定位。
    private func materialHostingLayers() -> [String: Any] {
        guard let root = webView.layer else { return ["found": 0, "hint": "webView 还没有 layer"] }
        var hosts: [[String: Any]] = []
        var dump: [[String: Any]] = []
        func walk(_ layer: CALayer, depth: Int) {
            guard depth <= 24, dump.count < 24 else { return }
            let cls = NSStringFromClass(type(of: layer))
            let bounds = layer.bounds
            if bounds.width > 0, bounds.height > 0 {
                dump.append(["d": depth, "cls": cls, "name": layer.name ?? "",
                             "w": Double(bounds.width), "h": Double(bounds.height),
                             "x": Double(layer.frame.origin.x), "y": Double(layer.frame.origin.y)])
            }
            if cls.localizedCaseInsensitiveContains("hosting") || (layer.name ?? "").contains("material hosting") {
                hosts.append(["d": depth, "cls": cls, "name": layer.name ?? "",
                              "w": Double(bounds.width), "h": Double(bounds.height),
                              "x": Double(layer.frame.origin.x), "y": Double(layer.frame.origin.y),
                              "radius": Double(layer.cornerRadius)])
            }
            for sub in layer.sublayers ?? [] { walk(sub, depth: depth + 1) }
        }
        walk(root, depth: 0)
        return ["found": hosts.count, "hosts": hosts, "layers": dump]
    }
}
