// 透明 WKWebView 提供网页之上的合成层；卡片那块**磨砂底由原生层给**
// （`FrostSurface`，见该文件的"为什么不是 CSS"）——两个 WKWebView 之间
// `backdrop-filter` 采不到下面那个的网页，模糊只能在原生层做。

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
    /// 卡片正下方那块原生磨砂（插在叠加层之下、浏览器之上）。
    let frost = FrostSurface()

    private var origin: NSPoint = .zero
    private var loadedSession: String?

    /// 叠加层当前是否可见：「对话」按钮 toggle 的翻转依据。卡片自己的 × 走
    /// hide()，状态只在这一个地方记，SPA 不留第二份（会失同步）。
    private(set) var isVisible = false

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

    /// 挂到窗口：叠加层铺上去，磨砂块紧贴它**下面**（浏览器之上）。层序只在这一处定，
    /// 磨砂块跑到叠加层之上就会盖住卡片自己的内容。
    func install(in parent: NSView) {
        parent.addSubview(view)
        parent.addSubview(frost, positioned: .below, relativeTo: view)
    }

    /// 主 SPA 说"现在该给哪个会话显示悬浮输入框"（nil = 收起）。
    func show(sessionId: String, rect: NSRect, contentHeight: CGFloat, zoom: CGFloat, origin host: String) {
        if loadedSession != sessionId {
            loadedSession = sessionId
            guard let url = URL(string: "\(host)/?composer=\(sessionId)") else { return }
            view.load(URLRequest(url: url))
        }
        place(rect: rect, contentHeight: contentHeight, zoom: zoom)
        // 页面报上可点矩形之前整层不收点击：这一层是透明 webview，留着上一轮（或上一个
        // 会话）的旧矩形就是一个看不见的死区，压在会话框右端（停止钮/排队行操作钮）。
        // 新页面挂载后 300ms 内会自己报回来（ComposerOverlay 的 report 轮询）。
        view.interactiveRect = .zero
        // 磨砂块同样等矩形：跟旧的走会先闪一块贴在网页上的磨砂，等页面报回来再摆。
        hideFrost()
        view.alphaValue = 1
        // 页面可能还是"上次关掉"的状态：叫出来时通知它把卡片摆回来
        view.evaluateJavaScript("window.__deepDiveHost && window.__deepDiveHost.dispatch('chatShow', {})", completionHandler: nil)
        isVisible = true
    }

    func hide() {
        view.alphaValue = 0
        // 卡不在了就不该再收事件：留着旧矩形会让那一块网页点不动
        view.interactiveRect = .zero
        hideFrost()
        isVisible = false
    }

    private func hideFrost() {
        frost.isHidden = true
        frost.frame = .zero
    }

    /// 「对话」按钮的开关：按壳自己记的可见性翻转——卡片被 × 关过的话下一次
    /// 点击仍是"叫出来"，不会吃掉一次。
    func toggle(sessionId: String, rect: NSRect, contentHeight: CGFloat, zoom: CGFloat, origin host: String) {
        if isVisible {
            hide()
        } else {
            show(sessionId: sessionId, rect: rect, contentHeight: contentHeight, zoom: zoom, origin: host)
        }
    }

    /// 页面报上来的卡片矩形（CSS px、本视图内坐标）→ **父视图坐标**的可点矩形。
    ///
    /// `hitTest(_:)` 收到的是**父视图坐标系**里的点，所以这里必须把视图自身的 frame 位移
    /// 算进去、并按视图高度翻转 Y（页面是左上原点、y 向下）。漏了位移或翻错方向都不会报错，
    /// 只表现为"卡片点不动、别的某一块反而把网页点击吃掉"——实测用户报"关闭键没用"就是这个。
    ///
    /// 磨砂块用的是同一套换算结果（同一个矩形），所以它与"可点矩形"永远重合：卡片之外的
    /// 网页照旧点得动，磨砂也不会多出半块压住页面。
    func setPill(cssRect: NSRect, zoom: CGFloat, radius: CGFloat) {
        let frame = view.frame
        view.interactiveRect = NSRect(
            x: frame.minX + cssRect.minX * zoom,
            y: frame.minY + frame.height - (cssRect.minY + cssRect.height) * zoom,
            width: cssRect.width * zoom,
            height: cssRect.height * zoom
        )
        frost.frame = view.interactiveRect
        frost.setRadius(radius * zoom)
        frost.isHidden = view.interactiveRect.width <= 1 || view.interactiveRect.height <= 1
    }

    private func place(rect: NSRect, contentHeight: CGFloat, zoom: CGFloat) {
        origin = NSPoint(x: rect.minX * zoom, y: contentHeight - (rect.minY + rect.height) * zoom)
        let frame = NSRect(x: origin.x, y: origin.y, width: rect.width * zoom, height: rect.height * zoom)
        if view.frame != frame { view.frame = frame }
    }
}
