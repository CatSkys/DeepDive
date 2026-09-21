import XCTest
@testable import DeepDive

/// 自有组合部署面的钉子：装包 + 把 dsh.profile.bundles 收敛成"自有组合在前、
/// 社区与用户自加的在后面、上游两层摘掉"，且幂等、不动用户手改的其余字段。
final class ProfileComposerTests: XCTestCase {
    private var home: URL!
    private var bundledDir: URL!

    override func setUpWithError() throws {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("profile-composer-\(UUID().uuidString)", isDirectory: true)
        home = base.appendingPathComponent("home", isDirectory: true)
        bundledDir = base.appendingPathComponent("EngineProfile", isDirectory: true)
        try FileManager.default.createDirectory(at: bundledDir, withIntermediateDirectories: true)
        try writeBundle(version: "1.0.0")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home.deletingLastPathComponent())
    }

    private var profileDir: URL { home.appendingPathComponent("profiles/web", isDirectory: true) }
    private var manifestURL: URL { profileDir.appendingPathComponent("package.json") }
    private var deployedURL: URL {
        profileDir.appendingPathComponent("node_modules/\(ProfileComposer.bundleName)")
    }

    private func writeBundle(version: String) throws {
        let manifest: [String: Any] = [
            "name": ProfileComposer.bundleName,
            "version": version,
            "dsh": ["bundle": ["patch": "./cordis.patch.yml"]],
        ]
        let data = try JSONSerialization.data(withJSONObject: manifest)
        try data.write(to: bundledDir.appendingPathComponent("package.json"))
        try "probe".write(to: bundledDir.appendingPathComponent("cordis.patch.yml"), atomically: true, encoding: .utf8)
    }

    private func writeManifest(_ config: [String: Any]) throws {
        try FileManager.default.createDirectory(at: profileDir, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: manifestURL)
    }

    private func manifest() throws -> [String: Any] {
        let data = try Data(contentsOf: manifestURL)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func bundles() throws -> [String] {
        let dsh = try XCTUnwrap(try manifest()["dsh"] as? [String: Any])
        let profile = try XCTUnwrap(dsh["profile"] as? [String: Any])
        return try XCTUnwrap(profile["bundles"] as? [String])
    }

    /// 旧版本壳写进去的默认元组：迁移必须把上游两层摘掉，社区插件逐字保留。
    func testMigratesUpstreamTupleAndKeepsCommunityBundles() throws {
        try writeManifest([
            "name": "dsh-profile-web",
            "private": true,
            "dependencies": ["dsh-chat-import": "^0.8.0"],
            "dsh": ["profile": ["bundles": [
                "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-chat-import",
            ], "patchReload": "live"]],
        ])

        XCTAssertTrue(ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir))
        XCTAssertEqual(try bundles(), [ProfileComposer.bundleName, "dsh-chat-import"])
        // 组合在前是硬要求：bundles 的次序就是补丁层的叠放次序。
        XCTAssertTrue(FileManager.default.fileExists(atPath: deployedURL.appendingPathComponent("cordis.patch.yml").path))
    }

    /// 用户自己挂的第三方插件不是"退役层"，不能被迁移顺手清掉。
    func testKeepsUserSuppliedBundles() throws {
        try writeManifest([
            "private": true,
            "dsh": ["profile": ["bundles": ["browser-jev", "@everos-ai/dsh-plugin"]], "other": ["keep": true]],
        ])

        ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir)
        XCTAssertEqual(try bundles(), [ProfileComposer.bundleName, "browser-jev", "@everos-ai/dsh-plugin"])
        let dsh = try XCTUnwrap(try manifest()["dsh"] as? [String: Any])
        XCTAssertEqual(dsh["other"] as? [String: Bool], ["keep": true])
    }

    /// 幂等：第二次调用零写入（mtime 不变），否则每次启动都在动用户的 profile。
    func testSecondRunIsANoOp() throws {
        try writeManifest(["private": true, "dsh": ["profile": ["bundles": [ProfileComposer.bundleName]]]])
        ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir)
        let first = try FileManager.default.attributesOfItem(atPath: manifestURL.path)[.modificationDate] as? Date

        XCTAssertFalse(ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir))
        let second = try FileManager.default.attributesOfItem(atPath: manifestURL.path)[.modificationDate] as? Date
        XCTAssertEqual(first, second)
    }

    /// 用户显式设过 patchReload 就保留他的选择（热重载是这个产品在用的模式，但不能替他改）。
    func testPreservesExplicitPatchReload() throws {
        try writeManifest(["private": true, "dsh": ["profile": ["bundles": [], "patchReload": "startup"]]])

        ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir)
        let dsh = try XCTUnwrap(try manifest()["dsh"] as? [String: Any])
        let profile = try XCTUnwrap(dsh["profile"] as? [String: Any])
        XCTAssertEqual(profile["patchReload"] as? String, "startup")
    }

    /// 版本变化要重铺目录（组合内容变了），但清单不必重写。
    func testRedeploysOnVersionChange() throws {
        try writeManifest(["private": true, "dsh": ["profile": ["bundles": [ProfileComposer.bundleName]]]])
        ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir)

        try writeBundle(version: "1.1.0")
        XCTAssertTrue(ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir))
        let marker = profileDir.appendingPathComponent(".deepdive-engine-profile-version")
        XCTAssertEqual(try String(contentsOf: marker, encoding: .utf8), "1.1.0")
    }

    /// 随包组合缺失（未嵌入引擎的开发构建）只跳过，不能因此崩在启动路径上。
    func testSkipsWhenBundledCompositionIsAbsent() throws {
        try FileManager.default.removeItem(at: bundledDir)

        XCTAssertFalse(ProfileComposer.ensureInstalled(in: home, bundledDir: bundledDir))
        XCTAssertFalse(FileManager.default.fileExists(atPath: manifestURL.path))
    }
}
