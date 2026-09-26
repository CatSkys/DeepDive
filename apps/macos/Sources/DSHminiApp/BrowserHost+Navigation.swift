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
    /// 弹窗不开原生窗口：白名单内的在同一个视图里加载（官方 Desktop 是开成侧栏新页，
    /// 本仓只有一个浏览器视图，等价做法是就地导航）。
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, BrowserHost.allowed(url) {
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}
