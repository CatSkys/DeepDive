import XCTest
import WebKit
@testable import DeepDive

/// 按站隐藏的钉子：记忆（含按站键的归一化）、注入的 CSS/脚本**在真 WKWebView 里真的藏住了元素**、
/// 以及拾取那一路（脚本回话 → 弱代理 → 宿主回调）。
final class BrowserHiddenTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""
    private let storeKey = "deepdive.browser.hidden"
    private var saved: String??

    override func setUp() {
        super.setUp()
        suiteName = "deepdive.tests.hidden.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        // BrowserHidden 读的是 .standard：把真机上的那份挪开，测完放回去
        saved = UserDefaults.standard.string(forKey: storeKey)
        UserDefaults.standard.removeObject(forKey: storeKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: storeKey)
        if let previous = saved, let value = previous {
            UserDefaults.standard.set(value, forKey: storeKey)
        }
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: - 记忆

    func testHideIsPerSiteAndDeduplicated() {
        let hidden = BrowserHidden.shared
        hidden.hide(selector: ".ad", label: "广告", host: "www.a.test")
        hidden.hide(selector: ".ad", label: "广告", host: "a.test")   // 同一条（www 归一化）
        hidden.hide(selector: ".nav", label: "导航", host: "a.test")
        XCTAssertEqual(hidden.veils(host: "a.test").map(\.selector), [".ad", ".nav"])
        XCTAssertEqual(hidden.veils(host: "www.a.test").count, 2)
        XCTAssertEqual(hidden.totalCount(), 2)
        XCTAssertTrue(hidden.css(host: "a.test").hasPrefix(".ad, .nav"))
        XCTAssertTrue(hidden.css(host: "a.test").contains("display: none"))
        XCTAssertEqual(hidden.css(host: "other.test"), "")

        hidden.restore(selector: ".ad", host: "a.test")
        XCTAssertEqual(hidden.veils(host: "a.test").map(\.selector), [".nav"])
        hidden.restoreAll(host: "a.test")
        XCTAssertEqual(hidden.totalCount(), 0)
        XCTAssertEqual(hidden.css(host: "a.test"), "")
    }

    func testNormalizeMatchesTheReferenceRuler() {
        let hidden = BrowserHidden.shared
        XCTAssertEqual(hidden.normalize("WWW.Example.COM"), "example.com")
        XCTAssertEqual(hidden.normalize("example.com"), "example.com")
        XCTAssertEqual(hidden.normalize("www.www.example.com"), "www.example.com")
    }

    // MARK: - 注入真的藏住了东西（真 WKWebView）

    @MainActor
    func testInjectedCSSCRewritesDisplay() async throws {
        let host = BrowserHost(configuration: BrowserHost.configuration(store: .nonPersistent()))
        let ready = expectation(description: "loaded")
        host.view.loadHTMLString("""
        <html><body><div class="ad">ad</div><div class="keep">keep</div></body></html>
        """, baseURL: URL(string: "https://a.test/"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { ready.fulfill() }
        await fulfillment(of: [ready], timeout: 10)

        var injected = false
        host.evaluate(BrowserHidden.injectScript(".ad { display: none !important; }", selectors: [".ad"])) { _ in injected = true }
        let done = expectation(description: "injected")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { done.fulfill() }
        await fulfillment(of: [done], timeout: 10)
        XCTAssertTrue(injected)

        var result = ""
        host.evaluate("(function(){var ad=document.querySelector('.ad'),keep=document.querySelector('.keep');return getComputedStyle(ad).display+'|'+getComputedStyle(keep).display+'|'+!!document.getElementById('deepdive-veils');})()") { text in
            result = text
        }
        let read = expectation(description: "read")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { read.fulfill() }
        await fulfillment(of: [read], timeout: 10)
        XCTAssertEqual(result, "none|block|true")
    }

    @MainActor
    func testHidingWorksUnderAStrictCSP() async throws {
        // 严格 CSP（style-src 不给 unsafe-inline）会拦掉注入的 <style> 元素——实测真机也是这样，
        // 所以脚本同时直接改匹配元素的 CSSOM（"脚本写 inline style"不受 style-src 管）。
        let host = BrowserHost(configuration: BrowserHost.configuration(store: .nonPersistent()))
        let ready = expectation(description: "loaded")
        host.view.loadHTMLString("""
        <html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'"></head>
        <body><div class="ad">ad</div><div class="keep">keep</div></body></html>
        """, baseURL: URL(string: "https://a.test/"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { ready.fulfill() }
        await fulfillment(of: [ready], timeout: 10)

        let script = BrowserHidden.injectScript(".ad { display: none !important; }", selectors: [".ad"])
        host.evaluate(script) { _ in }
        var result = ""
        host.evaluate("(function(){var ad=document.querySelector('.ad'),keep=document.querySelector('.keep');return getComputedStyle(ad).display+'|'+getComputedStyle(keep).display+'|'+ad.hasAttribute('data-deepdive-veiled');})()") { result = $0 }
        let read = expectation(description: "read")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { read.fulfill() }
        await fulfillment(of: [read], timeout: 10)
        XCTAssertEqual(result, "none|block|true", "严格 CSP 下也得真藏住（靠 CSSOM 那条路）")

        // 撤销：不再给任何选择器 → 按标记放回来
        host.evaluate(BrowserHidden.injectScript("", selectors: [])) { _ in }
        var restored = ""
        host.evaluate("(function(){var ad=document.querySelector('.ad');return getComputedStyle(ad).display+'|'+ad.hasAttribute('data-deepdive-veiled');})()") { restored = $0 }
        let done = expectation(description: "restored")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done.fulfill() }
        await fulfillment(of: [done], timeout: 10)
        XCTAssertEqual(restored, "block|false")
    }

    // MARK: - 拾取那一路：脚本回话 → 弱代理 → 宿主回调

    @MainActor
    func testPickerScriptReportsTheClickedElement() async throws {
        let host = BrowserHost(configuration: BrowserHost.configuration(store: .nonPersistent()))
        let ready = expectation(description: "loaded")
        host.view.loadHTMLString("""
        <html><body><div id="banner">促销</div><p class="story">正文</p></body></html>
        """, baseURL: URL(string: "https://a.test/"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { ready.fulfill() }
        await fulfillment(of: [ready], timeout: 10)

        var picked: (String, String)?
        host.onPicked = { selector, label in picked = (selector, label) }
        host.startPicking()
        let picking = expectation(description: "picking")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { picking.fulfill() }
        await fulfillment(of: [picking], timeout: 10)
        XCTAssertTrue(host.picking)

        // 真点不了（测试里没有鼠标）：派发一个真事件，走的还是脚本自己那条 click 监听
        host.evaluate("(function(){var el=document.getElementById('banner');el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return 'clicked';})()") { _ in }
        let clicked = expectation(description: "clicked")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { clicked.fulfill() }
        await fulfillment(of: [clicked], timeout: 10)

        XCTAssertEqual(picked?.0, "#banner")
        XCTAssertEqual(picked?.1, "div：促销")
        XCTAssertFalse(host.picking, "点完就退出拾取模式")
    }

    @MainActor
    func testPickerEscapeCancels() async throws {
        let host = BrowserHost(configuration: BrowserHost.configuration(store: .nonPersistent()))
        let ready = expectation(description: "loaded")
        host.view.loadHTMLString("<html><body><p>x</p></body></html>", baseURL: URL(string: "https://a.test/"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { ready.fulfill() }
        await fulfillment(of: [ready], timeout: 10)

        var cancelled = false
        var picked = false
        host.onPickCancelled = { cancelled = true }
        host.onPicked = { _, _ in picked = true }
        host.startPicking()
        host.evaluate("(function(){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 'esc';})()") { _ in }
        let done = expectation(description: "esc")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done.fulfill() }
        await fulfillment(of: [done], timeout: 10)

        XCTAssertTrue(cancelled)
        XCTAssertFalse(picked)
        XCTAssertFalse(host.picking)
    }

    func testPickerIgnoresMessagesWhenNotPicking() {
        // 页面能往壳里发消息的只有这一条通道：不在拾取模式时一律不理
        let host = BrowserHost(configuration: BrowserHost.configuration(store: .nonPersistent()))
        var picked = false
        host.onPicked = { _, _ in picked = true }
        host.pickerReplied(["selector": "#evil", "label": "evil"])
        XCTAssertFalse(picked)
        host.pickerReplied("not a dictionary")
        XCTAssertFalse(picked)
    }
}
