import XCTest
import WebKit
@testable import DeepDive

/// 拦截与按站权限的钉子：桥消息解析（跨端契约）、按站暂停的读写、权限记忆的"问一次"逻辑。
/// 都用独立 UserDefaults suite——真机偏好不能被测试写过。
final class BrowserShieldTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName = ""

    override func setUp() {
        super.setUp()
        suiteName = "deepdive.tests.shield.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: - 桥契约

    func testParsesShieldMessages() {
        XCTAssertEqual(BrowserShield.command(["action": "sync"]), .sync)
        XCTAssertEqual(BrowserShield.command(["enabled": false]), .setEnabled(false))
        XCTAssertEqual(BrowserShield.command(["enabled": true]), .setEnabled(true))
        XCTAssertEqual(BrowserShield.command(["action": "pause", "host": "a.test"]), .pause("a.test"))
        XCTAssertEqual(BrowserShield.command(["action": "resume", "host": "a.test"]), .resume("a.test"))
        XCTAssertEqual(BrowserShield.command(["action": "forgetPaused"]), .forgetPaused)
        // 暂停/恢复缺 host：当不认识——别对着"当前站点"猜一个
        XCTAssertNil(BrowserShield.command(["action": "pause"]))
        XCTAssertNil(BrowserShield.command(["action": "resume"]))
        XCTAssertNil(BrowserShield.command([:]))
    }

    func testParsesPermissionMessages() {
        XCTAssertEqual(BrowserPermissions.command(["host": "a.test", "kind": "camera", "allow": true]),
                       .answer(host: "a.test", kind: "camera", allow: true))
        XCTAssertEqual(BrowserPermissions.command(["action": "forgetAll"]), .forgetAll)
        // 三个字段缺一不可（allow: false 与"没这个字段"必须分得开）
        XCTAssertNil(BrowserPermissions.command(["host": "a.test", "kind": "camera"]))
        XCTAssertNil(BrowserPermissions.command(["host": "", "kind": "camera", "allow": true]))
        XCTAssertNil(BrowserPermissions.command(["host": "a.test", "kind": "", "allow": true]))
        XCTAssertNil(BrowserPermissions.command([:]))
    }

    // MARK: - 按站暂停

    func testPauseIsPerHostAndDeduplicated() {
        let shield = BrowserShield.shared
        XCTAssertFalse(shield.isPaused(host: "a.test", defaults))
        shield.setPaused(true, host: "a.test", defaults)
        shield.setPaused(true, host: "a.test", defaults)   // 重复点不该记两条
        shield.setPaused(true, host: "b.test", defaults)
        XCTAssertTrue(shield.isPaused(host: "a.test", defaults))
        XCTAssertEqual(shield.pausedHosts(defaults), ["a.test", "b.test"])
        XCTAssertFalse(shield.isPaused(host: nil, defaults))
        // 恢复一个站点只影响它
        shield.setPaused(false, host: "a.test", defaults)
        XCTAssertEqual(shield.pausedHosts(defaults), ["b.test"])
        shield.forgetPaused(defaults)
        XCTAssertEqual(shield.pausedHosts(defaults), [])
    }

    func testShieldDefaultsToOnAndGetsADirtyKeyWhenOff() {
        let shield = BrowserShield.shared
        XCTAssertTrue(shield.enabled(defaults), "默认开（拦截是默认行为，不是要人去打开的开关）")
        shield.setEnabled(false, defaults)
        XCTAssertFalse(shield.enabled(defaults))
        XCTAssertNotNil(defaults.object(forKey: "deepdive.browser.shield.enabled"))
        shield.setEnabled(true, defaults)
        XCTAssertTrue(shield.enabled(defaults))
        XCTAssertNil(defaults.object(forKey: "deepdive.browser.shield.enabled"), "回到默认就删键")
    }

    // MARK: - 权限：记过的照记忆答，没记过的问一次

    func testRememberedChoiceAnswersWithoutAsking() {
        BrowserPermissions.remember(true, host: "a.test", kind: "camera", defaults)
        var asked = false
        var decision: WKPermissionDecision?
        BrowserPermissions.request(host: "a.test", type: .camera, defaults: defaults, ask: { _, _ in asked = true }) { decision = $0 }
        XCTAssertFalse(asked, "记过的不再问")
        XCTAssertEqual(decision, .grant)

        BrowserPermissions.remember(false, host: "a.test", kind: "microphone", defaults)
        BrowserPermissions.request(host: "a.test", type: .microphone, defaults: defaults, ask: { _, _ in asked = true }) { decision = $0 }
        XCTAssertFalse(asked)
        XCTAssertEqual(decision, .deny)
        XCTAssertEqual(BrowserPermissions.rememberedCount(defaults), 2)
        BrowserPermissions.forgetAll(defaults)
        XCTAssertEqual(BrowserPermissions.rememberedCount(defaults), 0)
    }

    func testOnlyOneQuestionAtATimeAndTheAnswerIsRemembered() {
        var askedHosts: [String] = []
        var first: WKPermissionDecision?
        var second: WKPermissionDecision?
        BrowserPermissions.request(host: "a.test", type: .camera, defaults: defaults, ask: { host, kind in
            askedHosts.append("\(host)|\(kind)")
        }) { first = $0 }
        // 第二个页面在第一个还没答时来问：直接拒（排队会让它莫名其妙地等）
        BrowserPermissions.request(host: "b.test", type: .microphone, defaults: defaults, ask: { host, _ in
            askedHosts.append(host)
        }) { second = $0 }
        XCTAssertEqual(askedHosts, ["a.test|camera"], "只问了第一个")
        XCTAssertEqual(second, .deny)

        BrowserPermissions.resolve(host: "a.test", kind: "camera", allow: true, defaults)
        XCTAssertEqual(first, .grant)
        XCTAssertEqual(BrowserPermissions.remembered(host: "a.test", kind: "camera", defaults), true, "答案按站点+种类记住")
        // 答完之后下一个页面才能问（这里的第二个已经拿到 deny 了，重新来一次）
        var third: WKPermissionDecision?
        BrowserPermissions.request(host: "b.test", type: .microphone, defaults: defaults, ask: { _, _ in }) { third = $0 }
        XCTAssertNil(third, "这一次要等回答")
        BrowserPermissions.resolve(host: "b.test", kind: "microphone", allow: false, defaults)
        XCTAssertEqual(third, .deny)
    }

    func testResolveIgnoresAnswersThatDoNotMatchThePendingQuestion() {
        var decision: WKPermissionDecision?
        BrowserPermissions.request(host: "a.test", type: .camera, defaults: defaults, ask: { _, _ in }) { decision = $0 }
        BrowserPermissions.resolve(host: "other.test", kind: "camera", allow: true, defaults)
        XCTAssertNil(decision, "不是那个问题的答案就不理")
        BrowserPermissions.resolve(host: "a.test", kind: "microphone", allow: true, defaults)
        XCTAssertNil(decision, "种类对不上也不理")
        BrowserPermissions.resolve(host: "a.test", kind: "camera", allow: false, defaults)
        XCTAssertEqual(decision, .deny)
    }

    // MARK: - 偏好快照必须 JSON 可写（启动崩过一次）

    func testPrefsPayloadIsJSONWritable() throws {
        // 2026-09-26 实测：`BrowserShield.shared.enabled` 少写调用括号 → 值是个闭包，
        // JSONSerialization 在 host-ready 那一刻抛异常，表现是"应用一启动就崩"。
        // 这一条就钉住"快照里只有 JSON 能写的类型"。
        let delegate = try XCTUnwrap(AppDelegate.shared, "测试宿主里 AppDelegate 应该在")
        let payload = delegate.prefsPayload()
        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload), "prefs 里混进了 JSON 写不了的值")
        XCTAssertTrue(payload["browserZoomRememberSite"] is Bool, "抽查一个：值要真是值，不是方法引用")
        XCTAssertTrue(JSONSerialization.isValidJSONObject(["enabled": BrowserShield.shared.enabled(), "paused": BrowserShield.shared.pausedHosts()]))
    }

    // MARK: - 规则表

    func testRuleListCompilesForReal() {
        // 规则是 JSON 手写的：写错不会有人报错，只会"什么都没挡"。真编译一遍才算数。
        let shield = BrowserShield.shared
        shield.compile()
        let done = expectation(description: "compiled")
        func poll(_ tries: Int) {
            if shield.isCompiled || tries > 200 {
                done.fulfill()
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { poll(tries + 1) }
        }
        poll(0)
        wait(for: [done], timeout: 30)
        XCTAssertTrue(shield.isCompiled, "规则表必须真的编译成功")
        XCTAssertNil(shield.trouble)
    }
}
