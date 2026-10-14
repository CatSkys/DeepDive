import XCTest
@testable import DeepDive

/// 应用更新（AppUpdater.swift）与壳→前端 `updateState` 载荷的契约。
/// 桥的键名是跨进程契约（docs/ARCHITECTURE.md §2 通信矩阵），改这里要同步
/// frontend/src/host.ts 的 narrowUpdateState——本文件把它钉住。
final class AppUpdaterTests: XCTestCase {
    func testPayloadCarriesVersionsAndSupport() {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: "1.2.4", canUpdate: true
        )
        XCTAssertEqual(payload["currentVersion"] as? String, "1.2.3")
        XCTAssertEqual(payload["readyVersion"] as? String, "1.2.4")
        XCTAssertEqual(payload["canUpdate"] as? Bool, true)
    }

    /// 没有待装更新时给 null 而不是空串：前端据此区分「没有待装的一份」与
    /// 「有待装但版本号读不到」。
    func testMissingReadyVersionIsNull() {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: nil, canUpdate: false
        )
        XCTAssertTrue(payload["readyVersion"] is NSNull)
        XCTAssertEqual(payload["canUpdate"] as? Bool, false)
    }

    /// 载荷要真的能 JSON 化——桥推的就是 JSONSerialization 的产物，
    /// NSNull 是它唯一认的 null。
    func testPayloadIsJSONSerializable() throws {
        let payload = AppUpdater.statusPayload(
            currentVersion: "1.2.3", readyVersion: nil, canUpdate: true
        )
        let data = try JSONSerialization.data(withJSONObject: payload)
        let back = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(back?["currentVersion"] as? String, "1.2.3")
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
