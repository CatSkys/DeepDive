// WKWebView 的导航与弹窗代理：协议白名单、下载拒绝、错误标记、观察重推。
// 拆出来的理由同 BrowserHost+ZoomFind.swift（职责：主体管驱动，这份管事件）。
import AppKit
import WebKit

extension BrowserHost: WKNavigationDelegate {
    /// 提交时先按记忆的缩放排好版（第一帧之前），再见人。
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        applyRememberedZoom()
        publish()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        lastError = false
        // 换页就是退出阅读模式（那一版是就地换过 DOM 的，新页面自然是原版）；
        // 拾取也一起收——要点的那个元素已经不在页面上了
        readerOn = false
        picking = false
        publish()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        publish()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        lastError = true
        publish()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lastError = true
        publish()
    }

    /// 协议闸：白名单外一律取消（file:/data:/blob/javascript: 都不放行）。
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        // 顺带按**目标站点**加减拦截规则：规则从加上的那一刻起对后续请求生效，所以必须在请求
        // 发出去之前（这里）做，而不是页面提交之后
        // **只对主框架做**：这个回调子框架导航也会来（页面里的 iframe 到处都是），
        // 照着 iframe 的 host 重挂会把主站点刚设好的"本站暂停拦截"翻回去、把按站隐藏整张换掉。
        if navigationAction.targetFrame?.isMainFrame ?? true {
            BrowserShield.shared.tune(view.configuration.userContentController, for: url.host)
            // 按站隐藏：导航开始前把这一站要藏的脚本挂上（文档开始就注入）
            if let host = url.host { armHiddenCSS(BrowserHidden.shared.script(host: host)) }
        }
        // about:blank 是 WebKit 自己的空白页，放行；其余按白名单
        decisionHandler(BrowserHost.allowed(url) ? .allow : .cancel)
    }

    /// 下载：不落地、不弹存盘面板（官方 Desktop 同样 deny downloads）。
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }
}

extension BrowserHost: WKUIDelegate {
    /// 网页要摄像头/麦克风：按站记忆 + 没记过就问一次（WebKit 挂着页面等这个决定）。
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        BrowserPermissions.request(host: origin.host, type: type, ask: { [weak self] host, kind in
            self?.onPermissionAsk?(host, kind)
        }, handler: decisionHandler)
    }

    /// 弹窗不开原生窗口，也不占掉当前这一页：白名单内的地址交给标签集合开成**新标签**
    /// （参考实现同一取舍：`target=_blank` 的链接不该把手上这页顶掉）。
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, BrowserHost.allowed(url) {
            onPopup?(url.absoluteString)
        }
        return nil
    }
}
