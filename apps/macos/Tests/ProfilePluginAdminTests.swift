import XCTest
@testable import DeepDive

/// 插件卸载面的钉子：从 profile 的 dependencies 与 dsh.profile.bundles 两处摘掉，
/// 用户手改过的其余字段逐字保留，随应用发布的插件拒绝卸载（删了下次启动会回来）。
final class ProfilePluginAdminTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("profile-plugin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: profileDir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private var profileDir: URL { ProfilePluginAdmin.profileDir(in: home) }
    private var manifestURL: URL { profileDir.appendingPathComponent("package.json") }

    private func writeManifest(deps: [String: String], bundles: [String], extra: [String: Any] = [:]) throws {
        var config: [String: Any] = [
            "name": "dsh-profile-web",
            "private": true,
            "dependencies": deps,
            "dsh": ["profile": ["bundles": bundles, "patchReload": "live"]],
        ]
        for (k, v) in extra { config[k] = v }
        let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: manifestURL)
    }

    private func manifest() throws -> [String: Any] {
        let data = try Data(contentsOf: manifestURL)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testUninstallRemovesFromDependenciesAndBundles() throws {
        try writeManifest(
            deps: ["@everos-ai/dsh-plugin": "link:/tmp/x", "dsh-chat-import": "^0.8.0"],
            bundles: ["@deepseek-ai/dsh-base", "@everos-ai/dsh-plugin", "dsh-chat-import"],
        )
        XCTAssertNil(ProfilePluginAdmin.uninstall(moduleName: "@everos-ai/dsh-plugin", dshHome: home))
        let config = try manifest()
        let deps = try XCTUnwrap(config["dependencies"] as? [String: String])
        XCTAssertNil(deps["@everos-ai/dsh-plugin"])
        XCTAssertEqual(deps["dsh-chat-import"], "^0.8.0")
        let dsh = try XCTUnwrap(config["dsh"] as? [String: Any])
        let profile = try XCTUnwrap(dsh["profile"] as? [String: Any])
        let bundles = try XCTUnwrap(profile["bundles"] as? [String])
        XCTAssertEqual(bundles, ["@deepseek-ai/dsh-base", "dsh-chat-import"])
        // 其余字段原样保留
        XCTAssertEqual(profile["patchReload"] as? String, "live")
        XCTAssertEqual(config["name"] as? String, "dsh-profile-web")
    }

    func testUninstallRefusesBundledPlugin() throws {
        try writeManifest(deps: [ChatImportPlugin.pluginName: "^0.8.0"], bundles: [ChatImportPlugin.pluginName])
        let error = ProfilePluginAdmin.uninstall(moduleName: ChatImportPlugin.pluginName, dshHome: home)
        XCTAssertNotNil(error)
        // 拒绝时一个字节都不该动
        let deps = try XCTUnwrap(try manifest()["dependencies"] as? [String: String])
        XCTAssertEqual(deps[ChatImportPlugin.pluginName], "^0.8.0")
    }

    func testUninstallRefusesUnknownPlugin() throws {
        try writeManifest(deps: ["foo": "^1.0.0"], bundles: ["foo"])
        XCTAssertNotNil(ProfilePluginAdmin.uninstall(moduleName: "bar", dshHome: home))
    }

    func testUninstallReportsMissingManifest() {
        XCTAssertNotNil(ProfilePluginAdmin.uninstall(moduleName: "foo", dshHome: home))
    }

    func testBundledNamesCoverChatImport() {
        XCTAssertTrue(ProfilePluginAdmin.bundledPluginNames.contains(ChatImportPlugin.pluginName))
    }
}
