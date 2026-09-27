// 主 SPA 的透明浮层窗口与 JavaScript 弹窗策略；浏览器网页自身的弹窗不走这里。
import AppKit
import WebKit

// MARK: - WKUIDelegate（JS 原生弹窗：不弹系统窗，只落诊断）

/// 应用内**不允许出现系统弹窗**（用户定稿；前端的唯一弹窗入口是
/// `frontend/src/components/DialogHost.tsx`，报错面走引擎横幅/内置弹窗）。
/// 所以 JS 的 alert/confirm/prompt 一律不弹原生面板，只留一条诊断日志：
/// 静默 no-op 会让调用点看起来"点了没反应"（ctx-menu 重命名就这么死过一次），
/// 日志能把违反约定的调用点直接点名。confirm/prompt 按"取消"返回。
extension MainWindowController: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard webView === self.webView, navigationAction.targetFrame == nil,
              navigationAction.request.url?.absoluteString == "about:blank" else { return nil }
        browserPopup?.view.removeFromSuperview()
        let popup = BrowserPopupHost(configuration: configuration, source: webView)
        browserPopup = popup
        return popup.view
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        EngineLog.shared.append("[web] alert() ignored — use DialogHost: \(message.prefix(200))")
        completionHandler()
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        EngineLog.shared.append("[web] confirm() ignored (returns false) — use DialogHost: \(message.prefix(200))")
        completionHandler(false)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        EngineLog.shared.append("[web] prompt() ignored (returns nil) — use DialogHost: \(prompt.prefix(200))")
        completionHandler(nil)
    }
}
