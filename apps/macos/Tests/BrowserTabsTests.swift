import XCTest
@testable import DeepDive

/// 标签模型与休眠门槛的钉子：桥消息解析（跨端契约，拼错只会静默不生效）、
/// 增删选的不变式（永远留一个空白标签）、睡着/唤醒的记账。
final class BrowserTabsTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""

    override func setUp() {
        super.setUp()
        suiteName = "deepdive.tests.browsertabs.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: - `browser-tabs` 桥消息（前端 BrowserTabStrip.tsx 与 prefs.ts 决定形状）

    func testParsesTabActions() {
        XCTAssertEqual(BrowserTabs.command(["action": "new"]), .newTab(nil))
        XCTAssertEqual(BrowserTabs.command(["action": "new", "url": "https://a.test"]), .newTab("https://a.test"))
        XCTAssertEqual(BrowserTabs.command(["action": "select", "id": "t2"]), .select("t2"))
        XCTAssertEqual(BrowserTabs.command(["action": "close", "id": "t2"]), .close("t2"))
    }

    func testDropsActionsWithoutTheIDTheyNeed() {
        // id 是动作的必需项：缺了就当不认识，别悄悄对"当前标签"下手
        XCTAssertNil(BrowserTabs.command(["action": "select"]))
        XCTAssertNil(BrowserTabs.command(["action": "close"]))
        XCTAssertNil(BrowserTabs.command(["action": "switch"]))
        XCTAssertNil(BrowserTabs.command([:]))
    }

    func testSleepMinutesArrivesAsNumberFromTheBridge() {
        // 桥把 JS number 交成 NSNumber：整数值（下拉开 30）也必须认得——`as? Int` 在
        // NSNumber 形态下同样成立，但 `as? Double` 才能同时收 30 与 0.5，所以两边都用它。
        // 注意：Swift 字面量 Int 不是这条 wire 的形状（`as? Double` 不收 Int），测试按 NSNumber 造。
        XCTAssertEqual(BrowserTabs.command(["sleepMinutes": NSNumber(value: 30)]), .setSleepMinutes(30))
        XCTAssertEqual(BrowserTabs.command(["sleepMinutes": NSNumber(value: 5)]), .setSleepMinutes(5))
        XCTAssertEqual(BrowserTabs.command(["sleepMinutes": NSNumber(value: 0)]), .setSleepMinutes(0))
        // 设置项优先于动作：两者同帧时以门槛为准（前端不会这么发，但不该解析成动作）
        XCTAssertEqual(BrowserTabs.command(["sleepMinutes": NSNumber(value: 15), "action": "new"]), .setSleepMinutes(15))
    }

    // MARK: - 休眠门槛的读写

    func testSleepMinutesDefaultsToThirtyAndClamps() {
        XCTAssertEqual(BrowserTabs.sleepMinutes(defaults), BrowserTabs.defaultSleepMinutes)
        BrowserTabs.setSleepMinutes(5, defaults)
        XCTAssertEqual(BrowserTabs.sleepMinutes(defaults), 5)
        // 0 = 关（合法值，不能被当成"没设过"）
        BrowserTabs.setSleepMinutes(0, defaults)
        XCTAssertEqual(BrowserTabs.sleepMinutes(defaults), 0)
        BrowserTabs.setSleepMinutes(9_999, defaults)
        XCTAssertEqual(BrowserTabs.sleepMinutes(defaults), 240)
        BrowserTabs.setSleepMinutes(-3, defaults)
        XCTAssertEqual(BrowserTabs.sleepMinutes(defaults), 0)
    }

    func testSettingTheDefaultBackRemovesTheKey() {
        // 默认值不留脏数据（与 BrowserZoom 同一条）
        BrowserTabs.setSleepMinutes(30, defaults)
        XCTAssertNil(defaults.object(forKey: "deepdive.browser.tabs.sleepMinutes"))
    }

    // MARK: - 增删选

    func testAttachStartsWithOneBlankTab() {
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        XCTAssertEqual(tabs.tabs.count, 1)
        XCTAssertEqual(tabs.activeId, tabs.tabs[0].id)
        XCTAssertEqual(tabs.active.url, "")
        XCTAssertFalse(tabs.active.asleep)
    }

    func testClosingTheActiveTabSelectsTheOneAfterIt() {
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        let first = tabs.active.id
        let second = tabs.newTab(url: "https://example.com").id
        let third = tabs.newTab(url: "https://example.org").id
        XCTAssertEqual(tabs.activeId, third)

        tabs.close(id: third)
        // 没有右边就接左边
        XCTAssertEqual(tabs.activeId, second)
        XCTAssertEqual(tabs.tabs.map(\.id), [first, second])

        tabs.close(id: second)
        XCTAssertEqual(tabs.activeId, first)
    }

    func testClosingTheLastTabLeavesABlankOne() {
        // 关掉最后一个不是"没有浏览器"，是回到空白页——不变式靠这条守住
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        tabs.newTab(url: "https://example.com")
        let left = tabs.tabs.map(\.id)
        for id in left { tabs.close(id: id) }
        XCTAssertEqual(tabs.tabs.count, 1)
        XCTAssertEqual(tabs.active.url, "")
        XCTAssertFalse(left.contains(tabs.active.id), "留下的必须是新的空白标签")
    }

    func testClosingABackgroundTabKeepsTheActiveOne() {
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        let background = tabs.active.id
        let active = tabs.newTab(url: "https://example.com").id
        tabs.close(id: background)
        XCTAssertEqual(tabs.activeId, active)
        XCTAssertEqual(tabs.tabs.count, 1)
    }

    func testUnknownTabCommandsAreIgnored() {
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        let before = tabs.tabs.map(\.id)
        tabs.select(id: "nope")
        tabs.close(id: "nope")
        XCTAssertEqual(tabs.tabs.map(\.id), before)
    }

    // MARK: - 睡着/唤醒的记账

    func testSleepDiscardsTheHostAndKeepsTheMirror() {
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        let tab = tabs.active
        // 唤醒没有 interactionState 时按镜像重开；测试里指空白页，不打真网络
        tab.url = "about:blank"
        tab.title = "Example"
        XCTAssertNotNil(tab.awakeHost)

        tab.fallAsleep(memory: nil, cover: "png")
        XCTAssertTrue(tab.asleep)
        XCTAssertNil(tab.awakeHost, "睡着就是宿主还给系统——这才是内存收益")
        XCTAssertEqual(tab.cover, "png", "封面留着：唤醒时先铺它盖住空档")

        tab.awake()
        XCTAssertFalse(tab.asleep)
        XCTAssertNotNil(tab.awakeHost)
        XCTAssertEqual(tab.url, "about:blank", "镜像留着，唤醒瞬间 SPA 不至于退回空态")
    }

    func testListPayloadMarksActiveAndAsleep() {
        let tabs = BrowserTabs()
        tabs.attach(to: NSView())
        let first = tabs.active
        first.title = "A"
        tabs.newTab(url: "https://example.com")
        let payload = tabs.listPayload()
        XCTAssertEqual(payload.count, 2)
        XCTAssertEqual(payload[0]["title"] as? String, "A")
        XCTAssertEqual(payload[0]["active"] as? Bool, false)
        XCTAssertEqual(payload[1]["active"] as? Bool, true)
        // 镜像以页面回报为准：WebKit 一接请求就把地址规范化（补上尾斜杠）
        XCTAssertEqual(payload[1]["url"] as? String, "https://example.com/")
    }
}
