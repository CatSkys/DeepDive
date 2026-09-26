import XCTest
@testable import DeepDive

/// 浏览器缩放的钉子：档位表、上下限夹取，以及"按站点记住"的三条语义
/// （默认值兜底 / 记住 1 等于删键 / 关掉记忆就一律用默认值）。
///
/// 用独立的 UserDefaults suite：这些用例真的会写偏好，落到 `.standard` 会改掉本机的浏览器
/// 缩放设置（键名与默认值见 BrowserZoom.swift，测试不复制它们，只经 API 断言）。
final class BrowserZoomTests: XCTestCase {
    private let suiteName = "deepdive.tests.browserzoom"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
        defaults = UserDefaults(suiteName: suiteName)
        XCTAssertNotNil(defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    // MARK: - 档位与夹取

    func testClampKeepsZoomInsideRange() {
        XCTAssertEqual(BrowserZoom.clamp(0.1), BrowserZoom.range.lowerBound)
        XCTAssertEqual(BrowserZoom.clamp(9), BrowserZoom.range.upperBound)
        XCTAssertEqual(BrowserZoom.clamp(1.25), 1.25)
    }

    func testSteppedWalksTheLadderAndStopsAtEnds() {
        XCTAssertEqual(BrowserZoom.stepped(from: 1, up: true), 1.1)
        XCTAssertEqual(BrowserZoom.stepped(from: 1, up: false), 0.9)
        // 已经在最大/最小档：停在量程端点上，不再往上推
        XCTAssertEqual(BrowserZoom.stepped(from: 3, up: true), BrowserZoom.range.upperBound)
        XCTAssertEqual(BrowserZoom.stepped(from: 0.5, up: false), BrowserZoom.range.lowerBound)
    }

    // MARK: - 桥消息解析（跨端契约：键名与取值由前端定）

    func testParsesEveryShapeTheFrontendSends() {
        // 数值都是 NSNumber：桥就是这么交过来的，整数形态（下拉 100% 送 1）也必须接住
        XCTAssertEqual(BrowserZoom.command(["default": NSNumber(value: 1.5)]), .setDefault(1.5))
        XCTAssertEqual(BrowserZoom.command(["default": NSNumber(value: 1)]), .setDefault(1))
        XCTAssertEqual(BrowserZoom.command(["rememberSite": false]), .setRememberSite(false))
        XCTAssertEqual(BrowserZoom.command(["value": NSNumber(value: 0.8)]), .set(0.8))
        XCTAssertEqual(BrowserZoom.command(["action": "in"]), .step(up: true))
        XCTAssertEqual(BrowserZoom.command(["action": "out"]), .step(up: false))
        XCTAssertEqual(BrowserZoom.command(["action": "reset"]), .reset)
    }

    func testClampsValuesFromTheWire() {
        // SPA 送超量程的值不该原样落到 pageZoom 上
        XCTAssertEqual(BrowserZoom.command(["value": NSNumber(value: 40)]), .set(BrowserZoom.range.upperBound))
        XCTAssertEqual(BrowserZoom.command(["default": NSNumber(value: 0.01)]), .setDefault(BrowserZoom.range.lowerBound))
    }

    func testUnknownCommandIsDropped() {
        // 壳不认识就什么都不做（旧 SPA 连新壳、新 SPA 连旧壳都要能活）
        XCTAssertNil(BrowserZoom.command([:]))
        XCTAssertNil(BrowserZoom.command(["action": "zoomify"]))
        XCTAssertNil(BrowserZoom.command(["value": "1.5"]))
    }

    // MARK: - 按站点记住

    func testSiteWithoutMemoryFallsBackToDefault() {
        BrowserZoom.setDefaultZoom(1.25, defaults)
        XCTAssertEqual(BrowserZoom.forHost("example.com", defaults), 1.25)
        // 没有 host（空白页/未知地址）时也是默认值，不能崩也不能乱给
        XCTAssertEqual(BrowserZoom.forHost(nil, defaults), 1.25)
        XCTAssertEqual(BrowserZoom.forHost("", defaults), 1.25)
    }

    func testRememberedSiteValueWins() {
        BrowserZoom.setDefaultZoom(1.25, defaults)
        BrowserZoom.remember(1.5, host: "a.example", defaults)
        XCTAssertEqual(BrowserZoom.forHost("a.example", defaults), 1.5)
        // 别的站点不受影响
        XCTAssertEqual(BrowserZoom.forHost("b.example", defaults), 1.25)
    }

    func testRememberingOneClearsTheSiteKey() {
        // 1 就是"没改过"：留住它会让这个站点永远不再跟随默认缩放的变化
        BrowserZoom.setDefaultZoom(1.25, defaults)
        BrowserZoom.remember(1.5, host: "a.example", defaults)
        BrowserZoom.remember(1, host: "a.example", defaults)
        XCTAssertEqual(BrowserZoom.forHost("a.example", defaults), 1.25)
    }

    func testDefaultZoomOfOneClearsTheKey() {
        BrowserZoom.setDefaultZoom(1.5, defaults)
        BrowserZoom.setDefaultZoom(1, defaults)
        XCTAssertEqual(BrowserZoom.defaultZoom(defaults), 1)
    }

    func testDefaultZoomIsClampedAndRememberIsIgnoredWhenOff() {
        BrowserZoom.setDefaultZoom(99, defaults)
        XCTAssertEqual(BrowserZoom.defaultZoom(defaults), BrowserZoom.range.upperBound)

        BrowserZoom.setRemembersPerSite(false, defaults)
        BrowserZoom.remember(2, host: "a.example", defaults)
        XCTAssertEqual(BrowserZoom.forHost("a.example", defaults), BrowserZoom.range.upperBound)
        // 记着也没用：随时可以重新打开
        BrowserZoom.setRemembersPerSite(true, defaults)
        XCTAssertEqual(BrowserZoom.forHost("a.example", defaults), BrowserZoom.range.upperBound)
    }
}
