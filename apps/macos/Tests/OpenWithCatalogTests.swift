import XCTest
@testable import DeepDive

/// 「打开方式」目录（全屏预览页右上选择器的数据源）：列表/默认项/图标
/// dataURL 的实际产出形状——这些字段直接过桥给前端，形状错了前端就渲染不出。
final class OpenWithCatalogTests: XCTestCase {
    private var probe: URL!

    override func setUpWithError() throws {
        probe = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("open-with-probe-\(UUID().uuidString).txt")
        try "probe".write(to: probe, atomically: true, encoding: .utf8)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: probe)
    }

    func testListingForTextFileCarriesAppsWithIconsAndDefault() throws {
        let listing = try XCTUnwrap(OpenWithCatalog.listing(forPath: probe.path))
        XCTAssertFalse(listing.apps.isEmpty)
        XCTAssertLessThanOrEqual(listing.apps.count, OpenWithCatalog.limit)
        for app in listing.apps {
            XCTAssertTrue(app.id.hasSuffix(".app"), "id 必须是 .app 绝对路径：\(app.id)")
            XCTAssertFalse(app.name.isEmpty)
            XCTAssertTrue(app.icon.hasPrefix("data:image/png;base64,"), "图标必须是 PNG dataURL")
        }
        // 默认 App 必须落在候选集里（前端用它初始化触发钮的图标）
        XCTAssertTrue(listing.apps.contains { $0.id == listing.defaultId })
    }

    func testListingReturnsNilForMissingFile() {
        XCTAssertNil(OpenWithCatalog.listing(forPath: "/definitely/not/here.txt"))
    }

    func testPayloadShapeMatchesBridgeContract() throws {
        let listing = try XCTUnwrap(OpenWithCatalog.listing(forPath: probe.path))
        let payload = OpenWithCatalog.payload(listing, reqId: "r1")
        XCTAssertEqual(payload["reqId"] as? String, "r1")
        XCTAssertEqual(payload["defaultId"] as? String, listing.defaultId)
        let apps = try XCTUnwrap(payload["apps"] as? [[String: Any]])
        XCTAssertEqual(apps.count, listing.apps.count)
        XCTAssertEqual(apps.first?["id"] as? String, listing.apps.first?.id)
        XCTAssertEqual(apps.first?["name"] as? String, listing.apps.first?.name)
        XCTAssertEqual(apps.first?["icon"] as? String, listing.apps.first?.icon)
    }
}
