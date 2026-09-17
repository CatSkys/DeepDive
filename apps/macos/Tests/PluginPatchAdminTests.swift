import XCTest
@testable import DeepDive

/// 插件开关落账面的钉子：托管段合成/切分/解析，以及写盘后读回与"拨回默认即删文件"。
/// 最关键的一条纪律：**段外内容逐字保留** —— home 层是机器本地偏好，用户也可能手写它。
final class PluginPatchAdminTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("plugin-patch-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private var patchURL: URL { PluginPatchAdmin.fileURL(home: home) }

    // MARK: - compose / strip / parse

    func testComposeWrapsTogglesInMarkers() {
        let text = PluginPatchAdmin.compose(existing: "", toggles: [.init(rowId: "hmr", disabled: true)])
        XCTAssertTrue(text.contains(PluginPatchAdmin.marker.begin))
        XCTAssertTrue(text.contains(PluginPatchAdmin.marker.end))
        XCTAssertTrue(text.contains("- id: \"hmr\"\n  disabled: true"))
    }

    func testComposeKeepsForeignContentVerbatim() {
        let foreign = "- id: my-own\n  config:\n    port: 1\n"
        let text = PluginPatchAdmin.compose(existing: foreign, toggles: [.init(rowId: "hmr", disabled: true)])
        XCTAssertTrue(text.hasPrefix("- id: my-own\n  config:\n    port: 1"))
        XCTAssertTrue(text.contains("- id: \"hmr\""))
    }

    func testComposeWithNoTogglesDropsOnlyTheManagedSection() {
        let foreign = "- id: my-own\n  config:\n    port: 1\n"
        let once = PluginPatchAdmin.compose(existing: foreign, toggles: [.init(rowId: "hmr", disabled: true)])
        let stripped = PluginPatchAdmin.compose(existing: once, toggles: [])
        XCTAssertEqual(stripped, "- id: my-own\n  config:\n    port: 1")
        XCTAssertFalse(stripped.contains(PluginPatchAdmin.marker.begin))
    }

    func testParseManagedRoundTripsBothDirections() {
        let toggles = [PluginPatchAdmin.Toggle(rowId: "a", disabled: true), .init(rowId: "b", disabled: false)]
        let text = PluginPatchAdmin.compose(existing: "", toggles: toggles)
        XCTAssertEqual(PluginPatchAdmin.parseManaged(text), toggles.sorted { $0.rowId < $1.rowId })
    }

    func testParseIgnoresForeignRows() {
        let text = "- id: \"mine\"\n  disabled: true\n"
        XCTAssertTrue(PluginPatchAdmin.parseManaged(text).isEmpty)
    }

    /// 半个标记（用户手删过）：切到标记处为止，不猜它的边界。
    func testStripManagedHandlesHalfMarker() {
        let broken = "- id: a\n  config: 1\n" + PluginPatchAdmin.marker.begin + "\n- id: b\n"
        XCTAssertEqual(ManagedPatchBlock.strip(broken, marker: PluginPatchAdmin.marker), "- id: a\n  config: 1")
    }

    // MARK: - 磁盘往返

    func testSetWritesAndReadsBack() throws {
        XCTAssertNil(PluginPatchAdmin.set(rowId: "hmr", disabled: true, in: home))
        XCTAssertEqual(PluginPatchAdmin.toggles(in: home), [.init(rowId: "hmr", disabled: true)])
        XCTAssertTrue(FileManager.default.fileExists(atPath: patchURL.path))
    }

    func testSetOverwritesSameRowInsteadOfAppending() throws {
        XCTAssertNil(PluginPatchAdmin.set(rowId: "hmr", disabled: true, in: home))
        XCTAssertNil(PluginPatchAdmin.set(rowId: "a", disabled: true, in: home))
        XCTAssertEqual(
            PluginPatchAdmin.toggles(in: home),
            [PluginPatchAdmin.Toggle(rowId: "a", disabled: true), .init(rowId: "hmr", disabled: true)],
        )
        // 同一行再拨回来是覆盖而不是追加：对默认禁用的行，这一步就是「打开」
        XCTAssertNil(PluginPatchAdmin.set(rowId: "hmr", disabled: false, in: home))
        XCTAssertEqual(
            PluginPatchAdmin.toggles(in: home),
            [PluginPatchAdmin.Toggle(rowId: "a", disabled: true), .init(rowId: "hmr", disabled: false)],
        )
    }

    func testSetPreservesUserAuthoredPatchContent() throws {
        let foreign = "# 我自己写的\n- id: my-own\n  config:\n    port: 1\n"
        try foreign.write(to: patchURL, atomically: true, encoding: .utf8)
        XCTAssertNil(PluginPatchAdmin.set(rowId: "hmr", disabled: true, in: home))
        let text = try String(contentsOf: patchURL, encoding: .utf8)
        XCTAssertTrue(text.contains("# 我自己写的"))
        XCTAssertTrue(text.contains("- id: my-own"))
        XCTAssertEqual(PluginPatchAdmin.toggles(in: home), [.init(rowId: "hmr", disabled: true)])
    }
}
