import XCTest
@testable import DeepDive

/// MCP 落盘面的钉子：JSON 源读写（0600）、patch 块生成（含 `!!js` 密钥引用）、
/// 环境变量注入表、与插件开关块共存、以及校验不过时一个字节都不写。
final class McpServerAdminTests: XCTestCase {
    private var support: URL!
    private var home: URL!

    override func setUpWithError() throws {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("mcp-admin-\(UUID().uuidString)", isDirectory: true)
        support = base.appendingPathComponent("support", isDirectory: true)
        home = base.appendingPathComponent("harness", isDirectory: true)
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: support.deletingLastPathComponent())
    }

    private func stdio(_ name: String, env: [String] = [], enabled: Bool = true) -> McpServerAdmin.Server {
        .init(rowId: McpServerAdmin.rowId(of: name), name: name, transport: "stdio",
              command: "npx", args: ["-y", "@x/y"], url: "", env: env, headers: [], enabled: enabled)
    }

    private func store(_ servers: [McpServerAdmin.Server], secrets: [String: [String: String]] = [:]) -> McpServerAdmin.Store {
        .init(servers: servers, secrets: secrets)
    }

    // MARK: - patch 块

    func testComposeWritesInsertRowWithSecretReference() {
        let text = McpServerAdmin.compose(existing: "", servers: [stdio("github", env: ["GITHUB_TOKEN"])])
        XCTAssertTrue(text.contains("- insert:"))
        XCTAssertTrue(text.contains("- id: \"mcp-github\""))
        XCTAssertTrue(text.contains("name: \"@deepseek-ai/dsh-mcp-client\""))
        XCTAssertTrue(text.contains("disabled: false"))
        XCTAssertTrue(text.contains("serverName: \"github\""))
        // 值只能是环境变量引用 —— 绝不把密钥写进 patch 文件
        XCTAssertTrue(text.contains("GITHUB_TOKEN: !!js process.env.MCP_GITHUB_GITHUB_TOKEN"))
    }

    func testComposeUsesStreamableHttpKeys() {
        let server = McpServerAdmin.Server(rowId: "mcp-web", name: "web", transport: "streamable-http",
                                           command: "", args: [], url: "https://x/mcp",
                                           env: [], headers: ["Authorization"], enabled: true)
        let text = McpServerAdmin.compose(existing: "", servers: [server])
        XCTAssertTrue(text.contains("transport: \"streamable-http\""))
        XCTAssertTrue(text.contains("url: \"https://x/mcp\""))
        XCTAssertTrue(text.contains("Authorization: !!js process.env.MCP_WEB_Authorization"))
        XCTAssertFalse(text.contains("command:"))
    }

    func testEmptyListRemovesBlockOnly() {
        let foreign = "- id: my-own\n  config:\n    port: 1\n"
        let once = McpServerAdmin.compose(existing: foreign, servers: [stdio("a")])
        let stripped = McpServerAdmin.compose(existing: once, servers: [])
        XCTAssertEqual(stripped, "- id: my-own\n  config:\n    port: 1")
    }

    /// 两个托管块同住一份文件：写 MCP 不能碰坏插件开关块，反之亦然。
    func testCoexistsWithPluginSwitchBlock() {
        let withSwitches = PluginPatchAdmin.compose(existing: "", toggles: [.init(rowId: "hmr", disabled: true)])
        let withBoth = McpServerAdmin.compose(existing: withSwitches, servers: [stdio("alpha")])
        XCTAssertEqual(PluginPatchAdmin.parseManaged(withBoth), [.init(rowId: "hmr", disabled: true)])
        XCTAssertTrue(withBoth.contains("mcp-alpha"))
        let after = PluginPatchAdmin.compose(existing: withBoth, toggles: [.init(rowId: "hmr", disabled: false)])
        XCTAssertTrue(after.contains("mcp-alpha"))
        XCTAssertEqual(PluginPatchAdmin.parseManaged(after), [.init(rowId: "hmr", disabled: false)])
    }

    // MARK: - 源文件与密钥

    func testSaveLoadRoundTripAndPermissions() throws {
        let servers = [stdio("github", env: ["GITHUB_TOKEN"]), stdio("alpha", enabled: false)]
        let secrets = ["github": ["GITHUB_TOKEN": "ghp_secret"]]
        XCTAssertNil(McpServerAdmin.save(store(servers, secrets: secrets), in: support, harnessHome: home))
        let back = McpServerAdmin.load(in: support)
        XCTAssertEqual(back.servers, servers)
        XCTAssertEqual(back.secrets, secrets)
        // 密钥文件必须是 0600
        let perms = try FileManager.default.attributesOfItem(atPath: McpServerAdmin.storeURL(in: support).path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(perms?.int16Value, 0o600)
        // patch 文件里不能出现密钥的值
        let patch = try String(contentsOf: PluginPatchAdmin.fileURL(home: home), encoding: .utf8)
        XCTAssertFalse(patch.contains("ghp_secret"))
    }

    func testEnvironmentFlattensSecretsWithServerPrefix() {
        let servers = [stdio("github", env: ["GITHUB_TOKEN"]), stdio("my-server", env: ["API_KEY"])]
        let secrets = ["github": ["GITHUB_TOKEN": "a"], "my-server": ["API_KEY": "b"]]
        XCTAssertNil(McpServerAdmin.save(store(servers, secrets: secrets), in: support, harnessHome: home))
        XCTAssertEqual(
            McpServerAdmin.environment(in: support),
            ["MCP_GITHUB_GITHUB_TOKEN": "a", "MCP_MY_SERVER_API_KEY": "b"],
        )
    }

    func testValidateRejectsBadInput() {
        XCTAssertNotNil(McpServerAdmin.validate([stdio("dup"), stdio("dup")]))                       // 重名
        XCTAssertNotNil(McpServerAdmin.validate([stdio("has space")]))                                // 非法字符
        XCTAssertNotNil(McpServerAdmin.validate([stdio(String(repeating: "x", count: 33))]))          // 超 32 字
        XCTAssertNotNil(McpServerAdmin.validate([stdio("")]))                                         // 空名
        XCTAssertNil(McpServerAdmin.validate([stdio("ok-name_1")]))
    }

    func testSaveRefusesInvalidWithoutWriting() {
        XCTAssertNotNil(McpServerAdmin.save(store([stdio("bad name")]), in: support, harnessHome: home))
        XCTAssertFalse(FileManager.default.fileExists(atPath: McpServerAdmin.storeURL(in: support).path))
    }
}
