// 宿主的零件：槽位（`BrowserSlot`）、推给 SPA 的观察（`BrowserObservation`）、以及那个
// "可以不收点击"的 WKWebView（`BrowserHostView`）。
//
// 它们与宿主分开的理由是**职责**：宿主负责接线（配置、导航、观察、命令），这些都是被接线
// 推来推去的形状与零件；文件也因此各自留在 300 行以内。

import AppKit
import WebKit

/// 收点击可控的浏览器视图：`acceptsInput == false` 时整格对鼠标透明。
final class BrowserHostView: WKWebView {
    var acceptsInput = true

    override func hitTest(_ point: NSPoint) -> NSView? {
        acceptsInput ? super.hitTest(point) : nil
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

