import XCTest
import WebKit
@testable import DeepDive

/// 注释窗口的几何契约：窗口永远比注释内容大一圈（投影要的那圈透明边），玻璃与内容严格
/// 落在内容矩形上。这两条错了都不会报错——错了只是玻璃跟注释错位、或者影子被窗口裁掉。
final class TooltipWindowTests: XCTestCase {
    private func makeWindow() -> TooltipWindow {
        TooltipWindow(configuration: WKWebViewConfiguration())
    }

    func testPlaceInsetTheContentByTheShadowMargin() {
        let window = makeWindow()
        let size = NSSize(width: 120, height: 30)
        let origin = NSPoint(x: 400, y: 500)
        window.place(size: size, origin: origin, radius: 15)

        let inset = TooltipWindow.shadowInset
        XCTAssertEqual(window.frame.origin.x, origin.x - inset)
        XCTAssertEqual(window.frame.origin.y, origin.y - inset)
        XCTAssertEqual(window.frame.width, size.width + inset * 2)
        XCTAssertEqual(window.frame.height, size.height + inset * 2)
        // 玻璃与内容同矩形、且在窗口坐标系里内缩了那一圈
        let inner = NSRect(x: inset, y: inset, width: size.width, height: size.height)
        XCTAssertEqual(window.glass.frame, inner)
        XCTAssertEqual(window.web.frame, inner)
    }

    func testWindowNeverTakesEventsOrFocus() {
        let window = makeWindow()
        XCTAssertTrue(window.ignoresMouseEvents)
        XCTAssertFalse(window.canBecomeKey)
        XCTAssertFalse(window.canBecomeMain)
    }
}

/// 注释消息的分流：壳侧只有一处解释类型（三块页面 + 注释页自己都汇到 `handleMessage`）。
final class TooltipControllerTests: XCTestCase {
    func testHandleMessageClaimsOnlyTooltipTypes() {
        let controller = TooltipController()
        XCTAssertTrue(controller.handleMessage(["type": "tooltip-hide"], from: nil))
        XCTAssertFalse(controller.handleMessage(["type": "titlebar-rects"], from: nil))
        XCTAssertFalse(controller.handleMessage(["type": "mini-cc-frame"], from: nil))
        XCTAssertFalse(controller.handleMessage([:], from: nil))
    }
}
