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
        let host = BrowserHost()
        var seen: BrowserObservation?
        host.onObservation = { seen = $0 }
        host.resync()
        XCTAssertNotNil(seen, "resync 必须推一条观察，即使页面还是空的")
        XCTAssertEqual(seen?.url, "")
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
