import XCTest
@testable import DeepDive

/// 提取文字结果卡的落位（`AnnotationToolbarLayout.card`）：贴在工具条下方、横向以工具条
/// 中线对齐；下方放不下翻到上方，四个方向都夹在显示器内（卡在哪儿都得看得见、够得着）。
final class ExtractCardPlacementTests: XCTestCase {
    private let display = CGRect(x: 0, y: 0, width: 1200, height: 1200)
    private let size = CGSize(width: 396, height: 268)
    private let toolbar = CGRect(x: 600, y: 500, width: 400, height: 40)

    func testHangsBelowTheToolbarCenteredOnIt() {
        let frame = AnnotationToolbarLayout.card(size, under: toolbar, within: display)
        XCTAssertEqual(frame.minY, toolbar.maxY + 8)
        XCTAssertEqual(frame.midX, toolbar.midX)
        XCTAssertEqual(frame.size, size)
    }

    func testFlipsAboveWhenThereIsNoRoomBelow() {
        let low = CGRect(x: 600, y: 1100, width: 400, height: 40)
        let frame = AnnotationToolbarLayout.card(size, under: low, within: display)
        XCTAssertEqual(frame.maxY, low.minY - 8)
    }

    func testStaysInsideTheDisplayAtTheRightEdge() {
        let corner = CGRect(x: 1180, y: 500, width: 20, height: 40)
        let frame = AnnotationToolbarLayout.card(size, under: corner, within: display)
        XCTAssertGreaterThanOrEqual(frame.minX, display.minX + 8)
        XCTAssertLessThanOrEqual(frame.maxX, display.maxX - 8)
    }
}
