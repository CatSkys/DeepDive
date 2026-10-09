// 宿主的零件：槽位（`BrowserSlot`）、推给 SPA 的观察（`BrowserObservation`）、以及那个
// "可以不收点击"的 WKWebView（`BrowserHostView`）。
//
// 它们与宿主分开的理由是**职责**：宿主负责接线（配置、导航、观察、命令），这些都是被接线
// 推来推去的形状与零件；文件也因此各自留在 300 行以内。

import AppKit
import WebKit

/// 站点键的归一化：**一处尺子**（小写、去掉 `www.`）。按站记忆（缩放/拦截/隐藏/权限）都该用它，
/// 不然 `www.x.com` 与 `x.com` 会被当成两个站点。
enum BrowserHosts {
    static func normalize(_ host: String) -> String {
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }
}

/// 收点击可控的浏览器视图：`acceptsInput == false` 时整格对鼠标透明。
final class BrowserHostView: WKWebView {
    var acceptsInput = true

    override func hitTest(_ point: NSPoint) -> NSView? {
        acceptsInput ? super.hitTest(point) : nil
    }

    // 拖放是**另一条通道**：AppKit 找拖放目标不看 hitTest，只看"谁的矩形盖住了这点 +
    // 谁注册了这些类型"（WebKit 的内部视图自己注册了文件类型），所以一块 alpha 0 的
    // webview 照样能把整窗的文件拖入吃掉。让位态（收点击=false）必须在这里也拒绝一次，
    // 否则它会把落在它矩形里的拖入吞掉、下面的 SPA 永远收不到（"拖文件导入"整个失效，
    // 用户 2026-10-09 报）。闲置态另有一条更彻底的处置：整个舞台退到 SPA 之下，
    // 见 MainWindowController.restackBrowserStage。
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        acceptsInput ? super.draggingEntered(sender) : []
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        acceptsInput ? super.draggingUpdated(sender) : []
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        acceptsInput ? super.performDragOperation(sender) : false
    }
}

/// 前端推上来的槽位：CSS px 的 rect + 可见/收点击标志。
struct BrowserSlot {
    var rect: NSRect
    var visible: Bool
    var interactive: Bool

    /// 换算成 AppKit 的 frame：横向与尺寸乘 pageZoom（CSS px → point），y 轴翻转用
    /// **当前**内容高度（不缓存高度，窗口尺寸变化就不会过期）。
    func frame(contentHeight: CGFloat, zoom: CGFloat) -> NSRect {
        NSRect(
            x: rect.minX * zoom,
            y: contentHeight - (rect.minY + rect.height) * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom
        )
    }
}

/// 把浏览器舞台摆到 SPA webView 的上面或下面（规则与理由见
/// `MainWindowController.restackBrowserStage`）。抽成自由函数是为了能用普通视图把层序
/// 钉在测试里——窗口控制器本身在测试里起不来。两个视图不同父时什么都不做。
func stackBrowserStage(_ stage: NSView, relativeTo webView: NSView, visible: Bool) {
    guard let parent = stage.superview, parent === webView.superview else { return }
    parent.addSubview(stage, positioned: visible ? .above : .below, relativeTo: webView)
}

/// 推给 SPA 的浏览器观察（前端 useNativeBrowser 的 NativeBrowserState 同形）。
struct BrowserObservation {
    var url: String = ""
    var title: String = ""
    var loading: Bool = false
    var canGoBack: Bool = false
    var canGoForward: Bool = false
    var error: Bool = false
    /// 当前页面的缩放（pageZoom；SPA 的缩放控件与「浏览器」设置页读它）
    var zoom: Double = 1
    /// 这一页是不是"阅读模式"那一版（页面已经被换过，只能靠重载退出）
    var reader: Bool = false
    /// 正在等人在页面上点一个元素（按站隐藏的拾取）
    var picking: Bool = false

    var payload: [String: Any] {
        [
            "url": url, "title": title, "loading": loading,
            "canGoBack": canGoBack, "canGoForward": canGoForward, "error": error,
            "zoom": zoom, "reader": reader, "picking": picking,
        ]
    }
}

