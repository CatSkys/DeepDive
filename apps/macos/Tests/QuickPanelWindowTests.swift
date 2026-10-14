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

    /// ⌥Space 的判据（2026-10-14 用户报"有时候我要按两次，一次隐藏一次唤出"）：
    /// 面板不置顶（SPEC-SEMANTICS §6.1），被别的应用或自家主窗盖住时 `isVisible` 仍是 true
    /// ——盲判它就会把第一次按键吃成"收一扇看不见的窗"。只有"开着 + 拿着键盘 + 应用在前台"
    /// 才是收起，其余一律唤出/带到前台。
    func testHotKeyDismissesOnlyWhenPanelIsOpenAndKeyAndAppIsActive() {
        XCTAssertTrue(QuickPanelController.hotKeyDismisses(isOpen: true, isKeyWindow: true, appIsActive: true))
        XCTAssertFalse(QuickPanelController.hotKeyDismisses(isOpen: true, isKeyWindow: false, appIsActive: true))
        XCTAssertFalse(QuickPanelController.hotKeyDismisses(isOpen: true, isKeyWindow: true, appIsActive: false))
        XCTAssertFalse(QuickPanelController.hotKeyDismisses(isOpen: false, isKeyWindow: false, appIsActive: true))
    }

    /// 失焦收起的判据：键盘走了就收（点到别处、切走应用）；**我们自己还有活的窗拿走的键盘不算**
    /// ——输入区 ＋ 的附件选择器、截图的 overlay，它们干完都要回到面板页（PITFALLS §8.6bis），
    /// 面板收了就没人接那一投。**置顶那一档（命令中心「面板置顶」）是唯一的例外**：开着它，
    /// 点到别处也不收——那正是「除非开启指定」那句话里的"指定"。
    func testLosingKeyDismissesUnlessPinnedOrOneOfOurOwnToolsTookIt() {
        XCTAssertTrue(QuickPanelController.dismissesOnLosingKey(stillKey: false, toolTookKey: false, pinned: false))
        XCTAssertFalse(QuickPanelController.dismissesOnLosingKey(stillKey: true, toolTookKey: false, pinned: false))
        XCTAssertFalse(QuickPanelController.dismissesOnLosingKey(stillKey: false, toolTookKey: true, pinned: false))
        XCTAssertFalse(QuickPanelController.dismissesOnLosingKey(stillKey: false, toolTookKey: false, pinned: true))
    }

    /// 置顶抬窗口层级（面板默认是普通层级——2026-10-13 复盘收回的那条不变）：
    /// 「面板置顶」打开后要压在普通窗口之上，但仍低于药丸与注释窗（它们不该被面板盖住）。
    func testPinnedPanelRaisesTheLevelButStaysUnderThePill() {
        let normal = QuickPanelController.panelLevel(pinned: false)
        let pinned = QuickPanelController.panelLevel(pinned: true)
        XCTAssertEqual(normal, ShellWindowLevel.main)
        XCTAssertGreaterThan(pinned.rawValue, normal.rawValue)
        XCTAssertLessThan(pinned.rawValue, ShellWindowLevel.miniPanel.rawValue)
    }
}
