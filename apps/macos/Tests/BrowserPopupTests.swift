// 验证同源浮层文档共享 React 可访问的 DOM，以及原生命中区域的坐标换算。
import AppKit
import WebKit
import XCTest
@testable import DeepDive

final class BrowserPopupTests: XCTestCase {
    func testPopupSharesOpenerDOMAndSitsAbovePage() {
        let controller = PopupDelegate()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400),
                              styleMask: [.titled], backing: .buffered, defer: false)
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        let source = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        window.contentView!.addSubview(source)
        source.uiDelegate = controller
        let loaded = expectation(description: "source loaded")
        controller.loaded = { loaded.fulfill() }
        source.navigationDelegate = controller
        source.loadHTMLString("<html><body>source</body></html>", baseURL: URL(string: "http://localhost/"))
        wait(for: [loaded], timeout: 10)
        let opened = expectation(description: "same-origin popup DOM")
        source.evaluateJavaScript("""
            window.popup = window.open('about:blank', 'deepdive-browser-popup');
            popup.document.body.innerHTML = '<button id="item">menu</button>';
            popup.document.getElementById('item').onclick = () => { window.selected = true; };
            popup.document.getElementById('item').click();
            window.selected === true && popup.document.body.textContent === 'menu';
            """) { result, error in
            XCTAssertNil(error)
            XCTAssertEqual(result as? Bool, true)
            opened.fulfill()
        }
        wait(for: [opened], timeout: 10)
        let popup = controller.popup!
        XCTAssertTrue(window.contentView!.subviews.last === popup.view)
        popup.setRects([NSRect(x: 400, y: 10, width: 160, height: 200)])
        let inside = popup.view.convert(NSPoint(x: 450, y: 50), to: window.contentView)
        let outside = popup.view.convert(NSPoint(x: 450, y: 300), to: window.contentView)
        XCTAssertNotNil(popup.view.hitTest(inside))
        XCTAssertNil(popup.view.hitTest(outside))
        let closed = expectation(description: "popup closes")
        source.evaluateJavaScript("popup.close()") { _, error in
            XCTAssertNil(error)
            closed.fulfill()
        }
        wait(for: [closed], timeout: 10)
    }
}

private final class PopupDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    var popup: BrowserPopupHost?
    var loaded: (() -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded?() }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let host = BrowserPopupHost(configuration: configuration, source: webView)
        popup = host
        return host.view
    }
}
