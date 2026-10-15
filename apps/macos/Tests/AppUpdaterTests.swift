import XCTest
@testable import DeepDive

/// 应用更新（AppUpdater.swift）与壳→前端 `updateState` 载荷的契约。
/// 桥的键名是跨进程契约（docs/ARCHITECTURE.md §2 通信矩阵），改这里要同步
/// frontend/src/host.ts 的 narrowUpdateState——本文件把它钉住。
final class AppUpdaterTests: XCTestCase {
    func testPayloadCarriesVersionsAndSupport() {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: "1.2.4", downloadingVersion: nil,
            readyDate: "2026-10-14T01:04:50Z",
            readyNotes: "## 本版变更\n\n- 修了更新的退出", canUpdate: true
        )
        XCTAssertEqual(payload["currentVersion"] as? String, "1.2.3")
        XCTAssertEqual(payload["readyVersion"] as? String, "1.2.4")
        XCTAssertEqual(payload["readyDate"] as? String, "2026-10-14T01:04:50Z")
        XCTAssertEqual(payload["readyNotes"] as? String, "## 本版变更\n\n- 修了更新的退出")
        XCTAssertEqual(payload["canUpdate"] as? Bool, true)
    }

    /// 下载期那一份也要上桥：界面靠它显示「正在下载 x」，不然整段下载是空白的。
    func testPayloadCarriesDownloadingVersion() {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: nil, downloadingVersion: "1.2.4",
            readyDate: nil, readyNotes: nil, canUpdate: true
        )
        XCTAssertEqual(payload["downloadingVersion"] as? String, "1.2.4")
        XCTAssertTrue(payload["readyVersion"] is NSNull)
    }

    /// 没有待装更新时给 null 而不是空串：前端据此区分「没有待装的一份」与
    /// 「有待装但版本号读不到」。
    func testMissingReadyVersionIsNull() {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: nil, downloadingVersion: nil,
            readyDate: nil, readyNotes: nil,
            canUpdate: false
        )
        XCTAssertTrue(payload["readyVersion"] is NSNull)
        XCTAssertTrue(payload["downloadingVersion"] is NSNull)
        XCTAssertEqual(payload["canUpdate"] as? Bool, false)
    }

    /// 说明与日期**独立地**可以为空：说明是发布链另传的一份资产，要再拉一次才到
    /// （那一版没附说明、或拉失败，卡片就少一段正文与日期，版本号照常在）。
    func testNotesAndDateAreIndependentlyNullable() {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: "1.2.4", downloadingVersion: nil,
            readyDate: nil, readyNotes: nil,
            canUpdate: true
        )
        XCTAssertEqual(payload["readyVersion"] as? String, "1.2.4")
        XCTAssertTrue(payload["readyDate"] is NSNull)
        XCTAssertTrue(payload["readyNotes"] is NSNull)
    }

    /// 载荷要真的能 JSON 化——桥推的就是 JSONSerialization 的产物，
    /// NSNull 是它唯一认的 null。
    func testPayloadIsJSONSerializable() throws {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: nil, downloadingVersion: nil,
            readyDate: nil, readyNotes: nil,
            canUpdate: true
        )
        let data = try JSONSerialization.data(withJSONObject: payload)
        let back = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(back?["currentVersion"] as? String, "1.2.3")
    }

    /// 两份菜单（App 菜单 / 状态栏）那一项「更新」的文案与可用性都取这一处——
    /// 三态各钉一句，改文案时这两处不会各飘一边。
    func testMenuItemTitleAndActionabilityPerState() {
        XCTAssertEqual(AppUpdater.menuTitle(for: .check), "检查更新…")
        XCTAssertEqual(AppUpdater.menuTitle(for: .downloading("1.2.4")), "正在下载 1.2.4…")
        XCTAssertEqual(AppUpdater.menuTitle(for: .restart("1.2.4")), "重启以更新（1.2.4）")
        // 下载中那项是状态展示而非入口：点它没有意义，菜单里禁用。
        XCTAssertTrue(AppUpdater.MenuState.check.isActionable)
        XCTAssertTrue(AppUpdater.MenuState.restart("1.2.4").isActionable)
        XCTAssertFalse(AppUpdater.MenuState.downloading("1.2.4").isActionable)
    }

    /// 版本号读的是 bundle 的 marketing version（事实源 apps/macos/project.yml），
    /// 不是写死的常量——所以它必须是 x.y.z 形状。
    func testAppVersionIsBundleMarketingVersion() {
        let parts = AppUpdater.appVersion.split(separator: ".")
        XCTAssertEqual(parts.count, 3, "读到的版本号是 '\(AppUpdater.appVersion)'")
        XCTAssertTrue(parts.allSatisfy { Int($0) != nil })
    }

    /// 测试宿主是 Debug 构建：Debug 不更新（`make dev` 跑的是开发包，被 Release
    /// 覆盖掉等于白改），所以菜单里也不摆「检查更新…」。Release 侧由
    /// `make package` 出来的包实证。
    func testDebugBuildDoesNotUpdate() {
        XCTAssertFalse(AppUpdater.isSupported)
    }
}
