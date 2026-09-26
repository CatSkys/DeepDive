// 浏览器全屏时的**悬浮输入框**：叠在浏览器 WKWebView 之上的一层透明 WKWebView。
//
// 为什么需要它：浏览器页是壳的原生视图，**恒画在 SPA 之上**（缩略图蒙层看不见就是这个
// 原因），HTML 浮不到页面上。壳在它上面再叠一层透明 webview，里面跑的仍是同一份 SPA
// （`?composer=<sid>`），渲染同一个 `Composer` 组件——能力与配色因此没有第二份实现。
//
// 三条要点：
//   · **透明**：壳侧关掉网页底色（`drawsBackground`，与主 SPA 那个 webview 同一配方），
//     页面自身（`[data-overlay]`）也不画底色，网页才能从胶囊四周透出来；
//   · **只吃胶囊那一块的点击**：整层是一块透明矩形，若不拦，透明处会把网页的点击与滚轮
//     全吞掉。所以页面把胶囊（含上方浮条）的 rect 报上来（`composer-pill`），`hitTest`
//     只在那块返回自己，其余返回 nil 让位给底下的网页；
//   · 位置由主 SPA 推（`composer-overlay`，含 rect）：它知道面板网页那一格的几何。

import AppKit
import WebKit

/// 只在自己那块"可点矩形"里收事件的透明 webview：其余地方对鼠标透明。
final class ComposerOverlayView: WKWebView {
    /// CSS px、本视图坐标里的可点矩形；空 = 整层都不收点击（还没量到胶囊时）。
    var interactiveRect: NSRect = .zero

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard interactiveRect.width > 1, interactiveRect.height > 1 else { return nil }
        return interactiveRect.contains(point) ? super.hitTest(point) : nil
    }
}

final class ComposerOverlayHost: NSObject {
    let view: ComposerOverlayView

    private var origin: NSPoint = .zero
    private var loadedSession: String?

    override init() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        view = ComposerOverlayView(frame: .zero, configuration: config)
        super.init()
        // 与主 SPA 那个 webview 同一套透明做法（MainWindowController 里那段是本仓的既定
        // 配方：`drawsBackground` 走 KVC 是公开 API 之外唯一能关掉网页自身底色的口）。
        view.setValue(false, forKey: "drawsBackground")
        view.underPageBackgroundColor = .clear
        view.allowsMagnification = false
        view.autoresizingMask = []
        view.alphaValue = 0
    }

    /// 主 SPA 说"现在该给哪个会话显示悬浮输入框"（nil = 收起）。
    func show(sessionId: String, rect: NSRect, contentHeight: CGFloat, zoom: CGFloat, origin host: String) {
        if loadedSession != sessionId {
            loadedSession = sessionId
            guard let url = URL(string: "\(host)/?composer=\(sessionId)") else { return }
            view.load(URLRequest(url: url))
        }
        place(rect: rect, contentHeight: contentHeight, zoom: zoom)
        view.alphaValue = 1
        // 页面可能还是"上次关掉"的状态：叫出来时通知它把卡片摆回来
        view.evaluateJavaScript("window.__deepDiveHost && window.__deepDiveHost.dispatch('chatShow', {})", completionHandler: nil)
    }

    func hide() {
        view.alphaValue = 0
        // 卡不在了就不该再收事件：留着旧矩形会让那一块网页点不动
        view.interactiveRect = .zero
    }

    /// 页面报上来的胶囊矩形（本视图坐标）→ 换算成 AppKit 坐标供 hitTest 用。
    func setPill(cssRect: NSRect, zoom: CGFloat) {
        let h = view.bounds.height
        view.interactiveRect = NSRect(
            x: cssRect.minX * zoom,
            y: h - (cssRect.minY + cssRect.height) * zoom,
            width: cssRect.width * zoom,
            height: cssRect.height * zoom
        )
    }

    private func place(rect: NSRect, contentHeight: CGFloat, zoom: CGFloat) {
        origin = NSPoint(x: rect.minX * zoom, y: contentHeight - (rect.minY + rect.height) * zoom)
        let frame = NSRect(x: origin.x, y: origin.y, width: rect.width * zoom, height: rect.height * zoom)
        if view.frame != frame { view.frame = frame }
    }
}
