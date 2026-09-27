import XCTest
@testable import DeepDive

/// 「对话」按钮 toggle 的状态机：显隐事实源在 ComposerOverlayHost.isVisible，
/// 按钮的 toggle 与卡片自己的 ×（hide）共用这一份，怎么关都不会失同步。
final class ComposerOverlayHostTests: XCTestCase {
    private let rect = NSRect(x: 0, y: 0, width: 300, height: 200)

    private func toggle(_ host: ComposerOverlayHost) {
        host.toggle(sessionId: "s1", rect: rect, contentHeight: 800, zoom: 1, origin: "http://127.0.0.1:1")
    }

    func testToggleFlipsVisibilityBothWays() {
        let host = ComposerOverlayHost()
        XCTAssertFalse(host.isVisible)
        toggle(host)   // 隐藏态 → 叫出来
        XCTAssertTrue(host.isVisible)
        toggle(host)   // 可见态 → 收起（按钮的"再点一次关闭"）
        XCTAssertFalse(host.isVisible)
    }

    func testCardCloseThenToggleStillOpens() {
        // 卡片自己的 × 走 hide：状态归零，下一次 toggle 仍是"叫出来"，不会吃掉一次
        let host = ComposerOverlayHost()
        toggle(host)
        XCTAssertTrue(host.isVisible)
        host.hide()
        XCTAssertFalse(host.isVisible)
        toggle(host)
        XCTAssertTrue(host.isVisible)
    }
}
