// 透明 WKWebView 只提供网页之上的合成层；卡片表面由前端使用稳定的浮层底色绘制，
// 不依赖跨 WKWebView 的 backdrop-filter。

import AppKit
import WebKit

/// 只在自己那块"可点矩形"里收事件的透明 webview：其余地方对鼠标透明。
final class ComposerOverlayView: WKWebView {
    /// 父视图 point 坐标里的可点矩形；空时整层不收点击。
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

    /// 页面报上来的卡片矩形（CSS px、本视图内坐标）→ **父视图坐标**的可点矩形。
    ///
    /// `hitTest(_:)` 收到的是**父视图坐标系**里的点，所以这里必须把视图自身的 frame 位移
    /// 算进去、并按视图高度翻转 Y（页面是左上原点、y 向下）。漏了位移或翻错方向都不会报错，
    /// 只表现为"卡片点不动、别的某一块反而把网页点击吃掉"——实测用户报"关闭键没用"就是这个。
    func setPill(cssRect: NSRect, zoom: CGFloat) {
        let frame = view.frame
        view.interactiveRect = NSRect(
            x: frame.minX + cssRect.minX * zoom,
            y: frame.minY + frame.height - (cssRect.minY + cssRect.height) * zoom,
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
