import XCTest
@testable import DeepDive

/// 注释落位的钉子：偏好边居中、放不下翻面、越界夹回可视区。
///
/// 屏幕坐标是 y 向上的（AppKit 那套）：`top` 在这一侧是"注释在锚点**上方**"，和页面里
/// `data-tip-pos="top"` 的语义一致（页面那边 y 向下，换算在 TooltipController 里完成）。
final class TipPlacementTests: XCTestCase {
    private let screen = NSRect(x: 0, y: 0, width: 1000, height: 800)
    private let anchor = NSRect(x: 400, y: 300, width: 40, height: 20)
    private let size = NSSize(width: 120, height: 30)
    private let gap: CGFloat = 8

    func testTopSitsAboveTheAnchorCentered() {
        let frame = TipPlacement.frame(anchor: anchor, size: size, side: "top", gap: gap, limits: screen)
        XCTAssertEqual(frame.minY, anchor.maxY + gap)
        XCTAssertEqual(frame.midX, anchor.midX)
    }

    func testBottomSitsBelowTheAnchor() {
        let frame = TipPlacement.frame(anchor: anchor, size: size, side: "bottom", gap: gap, limits: screen)
        XCTAssertEqual(frame.maxY, anchor.minY - gap)
        XCTAssertEqual(frame.midX, anchor.midX)
    }

    func testLeftAndRightCenterVertically() {
        let left = TipPlacement.frame(anchor: anchor, size: size, side: "left", gap: gap, limits: screen)
        XCTAssertEqual(left.maxX, anchor.minX - gap)
        XCTAssertEqual(left.midY, anchor.midY)
        let right = TipPlacement.frame(anchor: anchor, size: size, side: "right", gap: gap, limits: screen)
        XCTAssertEqual(right.minX, anchor.maxX + gap)
        XCTAssertEqual(right.midY, anchor.midY)
    }

    func testTopFlipsToBottomWhenThereIsNoRoomAbove() {
        // 锚点贴着屏顶：上方放不下，落到下方
        let nearTop = NSRect(x: 400, y: 780, width: 40, height: 20)
        let frame = TipPlacement.frame(anchor: nearTop, size: size, side: "top", gap: gap, limits: screen)
        XCTAssertEqual(frame.maxY, nearTop.minY - gap)
    }

    func testBottomFlipsToTopWhenThereIsNoRoomBelow() {
        let nearBottom = NSRect(x: 400, y: 4, width: 40, height: 20)
        let frame = TipPlacement.frame(anchor: nearBottom, size: size, side: "bottom", gap: gap, limits: screen)
        XCTAssertEqual(frame.minY, nearBottom.maxY + gap)
    }

    func testClampsBackInsideLimits() {
        // 锚点贴着右边缘：居中会被推出可视区，夹回来但不出界
        let huggingRight = NSRect(x: 980, y: 300, width: 20, height: 20)
        let frame = TipPlacement.frame(anchor: huggingRight, size: size, side: "top", gap: gap, limits: screen)
        XCTAssertLessThanOrEqual(frame.maxX, screen.maxX)
        XCTAssertGreaterThanOrEqual(frame.minX, screen.minX)
    }

    func testUnknownSideFallsBackToTop() {
        let frame = TipPlacement.frame(anchor: anchor, size: size, side: "sideways", gap: gap, limits: screen)
        XCTAssertEqual(frame.minY, anchor.maxY + gap)
    }

    func testOversizedTooltipSticksToTheLowerLeftCorner() {
        // 注释比可视区还大：夹取不许把上界算成负数（否则框会跑到可视区外）
        let huge = NSSize(width: 1200, height: 900)
        let frame = TipPlacement.frame(anchor: anchor, size: huge, side: "top", gap: gap, limits: screen)
        XCTAssertEqual(frame.minX, screen.minX)
        XCTAssertEqual(frame.minY, screen.minY)
    }
}
