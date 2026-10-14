import XCTest
@testable import DeepDive

/// 迷你面板窗的尺寸下限（2026-10-14 用户报"悬浮面板没有最小尺寸限制"）。
/// 面板页（#/mini）是照 ~500pt 宽的面板写的：窗口一旦能被拖到比页面还窄，页面横向溢出、
/// 被 html/body 的 `overflow:hidden` 裁在右缘——招呼语与输入框连同右簇的发送钮一起切掉。
/// 下限来自 ``PanelGeometry/minimumSize``（与设置页同一档设计常量，Atd 面板同值），
/// 这条锁住"它真的落在窗口上"——这正是移植时漏掉、被用户抓到的那一步。
final class QuickPanelWindowTests: XCTestCase {
    func testPanelCarriesTheDesignedMinimumSize() {
        let panel = QuickPanelController()
        let minimum = PanelGeometry.minimumSize(in: Screens.workAreaUnderCursor())
        XCTAssertEqual(panel.window.minSize.width, minimum.width)
        // 高度上 AppKit 会把标题栏加在设定值之上（写 400、读回 434）：不小于设计下限即可。
        XCTAssertGreaterThanOrEqual(panel.window.minSize.height, minimum.height)
    }
}
