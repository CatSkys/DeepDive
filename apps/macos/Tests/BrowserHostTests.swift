import XCTest
@testable import DeepDive

/// 侧栏浏览器壳侧的钉子：槽位换算（CSS px → AppKit frame）、协议白名单、
/// 组合行正文、以及控制面的 token 校验。
final class BrowserHostTests: XCTestCase {
    // MARK: - 槽位换算

    func testSlotFrameFlipsYAndScalesByPageZoom() {
        // 内容高 800、槽位 CSS 矩形 (10, 100, 300, 200)、缩放 1
        let slot = BrowserSlot(rect: NSRect(x: 10, y: 100, width: 300, height: 200), visible: true, interactive: false)
        let frame = slot.frame(contentHeight: 800, zoom: 1)
        XCTAssertEqual(frame.minX, 10)
        // y 翻转：底边 = 800 − (100 + 200)
        XCTAssertEqual(frame.minY, 500)
        XCTAssertEqual(frame.width, 300)
        XCTAssertEqual(frame.height, 200)
    }

    func testSlotFrameScalesEverythingByZoom() {
        let slot = BrowserSlot(rect: NSRect(x: 10, y: 100, width: 300, height: 200), visible: true, interactive: true)
        let frame = slot.frame(contentHeight: 800, zoom: 2)
        XCTAssertEqual(frame.minX, 20)
        // 缩放同样作用于 y：底边 = 800 − (100 + 200) × 2
        XCTAssertEqual(frame.minY, 200)
        XCTAssertEqual(frame.width, 600)
        XCTAssertEqual(frame.height, 400)
    }

    func testSlotFrameUsesCurrentContentHeight() {
        // 同一个 CSS 槽位在窗口变矮后必须落在新的底边（高度不缓存，这是刻意的）
        let slot = BrowserSlot(rect: NSRect(x: 0, y: 0, width: 100, height: 50), visible: true, interactive: true)
        XCTAssertEqual(slot.frame(contentHeight: 400, zoom: 1).minY, 350)
        XCTAssertEqual(slot.frame(contentHeight: 300, zoom: 1).minY, 250)
    }

    // MARK: - 协议白名单（官方 parseBrowserAddress 的壳侧等价物）

    func testAllowedProtocols() {
        XCTAssertTrue(BrowserHost.allowed(URL(string: "https://example.com")!))
        XCTAssertTrue(BrowserHost.allowed(URL(string: "http://127.0.0.1:8080/x")!))
        XCTAssertTrue(BrowserHost.allowed(URL(string: "about:blank")!))
    }

    func testRefusedProtocols() {
        for bad in ["file:///etc/passwd", "data:text/html,x", "blob:https://a/b", "javascript:alert(1)"] {
            XCTAssertFalse(BrowserHost.allowed(URL(string: bad)!), bad)
        }
        // about: 只放行精确的空白页，别的一律拒
        XCTAssertFalse(BrowserHost.allowed(URL(string: "about:config")!))
    }

    // MARK: - 观察重推（SPA 挂载浏览器页时经 browser-sync 主动要一次）

    func testResyncPublishesAnObservation() {
        // 观察只在导航事件里推；resync 是"面板后挂载"补那一次的唯一入口。空白页面也要发
        // （url 为空是有效事实：SPA 据此走空态），不能静默什么都不做。
        let host = BrowserHost(configuration: BrowserHost.configuration(store: .nonPersistent()))
        var seen: BrowserObservation?
        host.onObservation = { seen = $0 }
        host.resync()
        XCTAssertNotNil(seen, "resync 必须推一条观察，即使页面还是空的")
        XCTAssertEqual(seen?.url, "")
    }

    // MARK: - UA 身份尾巴（按 UA 认浏览器的站点）

    func testSafariIdentityCarriesBothTokens() {
        // WKWebView 默认 UA 只有引擎与系统，缺 `Version/x.y` 与 `Safari/x` 两个身份标记
        // ——B 站首页据此把我们判成"未知/过旧浏览器"并跳到提示页（实测）。这里钉住"两个
        // 标记都在"，且版本号不是空串（取本机 Safari 的真实版本或系统大版本）。
        let identity = BrowserUserAgent.safariIdentity
        XCTAssertTrue(identity.hasPrefix("Version/"), identity)
        XCTAssertTrue(identity.hasSuffix(" Safari/605.1.15"), identity)
        let version = identity.dropFirst("Version/".count).split(separator: " ").first.map(String.init) ?? ""
        XCTAssertFalse(version.isEmpty)
        XCTAssertNotEqual(version, "0")
    }


    // MARK: - 悬浮输入框叠加层（浏览器全屏时浮在网页之上）

    func testPillRectMapsIntoSupersuperCoordinatesAndHitTests() {
        // hitTest 收到的点是**父视图坐标**：漏掉视图自身 frame 的位移、或 Y 翻错方向，
        // 都不会报错，只表现为"卡片点不动、别的某块反而吃掉网页点击"——实测用户报
        // "关闭键没用"。这里把换算结果与 hitTest 的真行为一起钉住。
        let host = ComposerOverlayHost()
        let parent = NSView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800))
        parent.addSubview(host.view)
        host.view.frame = NSRect(x: 100, y: 400, width: 600, height: 300)   // 面板那一格
        // 页面里卡片在 (20,100) 100x50（左上原点、y 向下）
        host.setPill(cssRect: NSRect(x: 20, y: 100, width: 100, height: 50), zoom: 1)

        // 父坐标 = 视图位移 + 视图高度翻转：y = 400 + 300 - (100+50) = 550
        XCTAssertEqual(host.view.interactiveRect, NSRect(x: 120, y: 550, width: 100, height: 50))
        // 卡片中心点命中自己；卡片外（含原来会被镜像命中的位置）必须穿透给网页
        XCTAssertNotNil(host.view.hitTest(NSPoint(x: 170, y: 575)))
        XCTAssertNil(host.view.hitTest(NSPoint(x: 170, y: 425)))
        // 隐藏后不该再吃任何点击（卡不在了，旧矩形会让那块网页点不动）
        host.hide()
        XCTAssertNil(host.view.hitTest(NSPoint(x: 170, y: 575)))
    }

    func testOverlayIsTransparentAndStartsHidden() {
        // 透明是这个方案的前提：不透明就会盖住底下的网页那一整条带。
        let host = ComposerOverlayHost()
        // 比颜色空间没意义（sRGB 与 Generic Gray 的 clear 不等价）——要的是"透"
        XCTAssertEqual(host.view.underPageBackgroundColor.alphaComponent, 0)
        XCTAssertEqual(host.view.alphaValue, 0)
    }

    // MARK: - 组合行（app 自有 overlay 里的内置 MCP server）

    func testPatchRowPinsPathsAndSecretReferences() {
        let paths = BrowserUseInstaller.Paths(
            node: URL(fileURLWithPath: "/App/Contents/Resources/Runtime/node"),
            server: URL(fileURLWithPath: "/Users/x/Library/Application Support/DeepDive/browser-use/browser-use-server.mjs")
        )
        let row = BrowserUseInstaller.patchRow(paths: paths)
        XCTAssertTrue(row.contains("- id: mcp-browser"))
        XCTAssertTrue(row.contains("name: '@deepseek-ai/dsh-mcp-client'"))
        XCTAssertTrue(row.contains("serverName: deepdive-browser"))
        XCTAssertTrue(row.contains("transport: stdio"))
        // 路径写死成绝对路径（每次启动重算），密钥只写引用、值不落 patch 文件
        XCTAssertTrue(row.contains("\"/App/Contents/Resources/Runtime/node\""))
        XCTAssertTrue(row.contains("browser-use-server.mjs\"]"))
        XCTAssertTrue(row.contains("DEEPDIVE_BROWSER_URL: !!js process.env.DEEPDIVE_BROWSER_URL"))
        XCTAssertTrue(row.contains("DEEPDIVE_BROWSER_TOKEN: !!js process.env.DEEPDIVE_BROWSER_TOKEN"))
    }

    func testEnginePatchBodyWithoutBrowserKeepsOnlySchedule() {
        // 控制面装不上时组合里少一行，引擎照常起
        let body = EngineSupervisor.enginePatchBody(browserUse: nil)
        XCTAssertTrue(body.contains("- id: schedule"))
        XCTAssertFalse(body.contains("mcp-browser"))
    }

    func testEnginePatchBodyWithBrowserAddsRow() {
        let paths = BrowserUseInstaller.Paths(
            node: URL(fileURLWithPath: "/n"),
            server: URL(fileURLWithPath: "/s.mjs")
        )
        let body = EngineSupervisor.enginePatchBody(browserUse: paths)
        XCTAssertTrue(body.contains("- id: schedule"))
        XCTAssertTrue(body.contains("- id: mcp-browser"))
        // insert 缩进：行必须在 `- insert:` 之下
        XCTAssertTrue(body.contains("\n- insert:\n"))
    }

    // MARK: - 控制面环境变量

    func testEnvironmentCarriesBridgeURLAndToken() {
        let env = BrowserUseInstaller.environment(bridgeURL: URL(string: "http://127.0.0.1:56034")!)
        XCTAssertEqual(env["DEEPDIVE_BROWSER_URL"], "http://127.0.0.1:56034")
        XCTAssertEqual(env["DEEPDIVE_BROWSER_TOKEN"], BrowserControl.token)
        XCTAssertEqual(env["DEEPDIVE_BROWSER_TOKEN"]?.count, 32)
    }

    func testEnvironmentIsEmptyWithoutBridge() {
        XCTAssertTrue(BrowserUseInstaller.environment(bridgeURL: nil).isEmpty)
    }

    private func controlRequest(token: String?, body: String) -> MiniHTTPServer.Request {
        MiniHTTPServer.Request(
            method: "POST",
            path: "/browser-control",
            query: "",
            headers: token.map { ["authorization": "Bearer \($0)"] } ?? [:],
            body: Data(body.utf8),
            rawHead: Data()
        )
    }

    func testControlRejectsMissingOrWrongToken() {
        XCTAssertEqual(BrowserControl.handle(controlRequest(token: nil, body: "{}")).status, 403)
        XCTAssertEqual(BrowserControl.handle(controlRequest(token: "nope", body: "{}")).status, 403)
    }

    func testControlRejectsMalformedBodyWithToken() {
        let response = BrowserControl.handle(controlRequest(token: BrowserControl.token, body: "not json"))
        XCTAssertEqual(response.status, 200)
        let body = String(data: response.body, encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains("malformed command"))
    }
}
