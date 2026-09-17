import XCTest
@testable import DeepDive

/// MCP server 落盘的钉子：块内往返、空表移除块、与插件开关块**共存不互伤**、
/// 以及名字/必填项校验（校验不过时一个字节都不写）。
final class McpServerAdminTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("mcp-admin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private func stdio(_ name: String, enabled: Bool = true) -> McpServerAdmin.Server {
        .init(rowId: McpServerAdmin.rowId(of: name), name: name, transport: "stdio",
              command: "npx", args: ["-y", "@x/y"], url: "", enabled: enabled)
    }

    func testComposeParseRoundTrip() {
        let servers = [stdio("alpha"), stdio("beta", enabled: false)]
        let text = McpServerAdmin.compose(existing: "", servers: servers)
        XCTAssertEqual(McpServerAdmin.parse(text), servers)
    }

    func testHttpTransportKeepsUrlAndDropsCommand() {
        let server = McpServerAdmin.Server(rowId: "mcp-remote", name: "remote", transport: "http",
                                          command: "", args: [], url: "https://example.com/mcp", enabled: true)
        let text = McpServerAdmin.compose(existing: "", servers: [server])
        XCTAssertEqual(McpServerAdmin.parse(text), [server])
        XCTAssertTrue(text.contains("\"transport\":\"http\""))
        XCTAssertFalse(text.contains("command"))
    }

    func testEmptyListRemovesTheBlockOnly() throws {
        let foreign = "- id: my-own\n  config:\n    port: 1\n"
        let once = McpServerAdmin.compose(existing: foreign, servers: [stdio("alpha")])
        let stripped = McpServerAdmin.compose(existing: once, servers: [])
        XCTAssertEqual(stripped, "- id: my-own\n  config:\n    port: 1")
        XCTAssertFalse(stripped.contains(McpServerAdmin.marker.begin))
    }

    /// 两个托管块同住一份文件：写 MCP 不能碰坏插件开关块，反之亦然。
    func testCoexistsWithPluginSwitchBlock() throws {
        let withSwitches = PluginPatchAdmin.compose(existing: "", toggles: [.init(rowId: "hmr", disabled: true)])
        let withBoth = McpServerAdmin.compose(existing: withSwitches, servers: [stdio("alpha")])
        XCTAssertEqual(PluginPatchAdmin.parseManaged(withBoth), [.init(rowId: "hmr", disabled: true)])
        XCTAssertEqual(McpServerAdmin.parse(withBoth), [stdio("alpha")])
        // 反向：先有 MCP，再拨开关
        let after = PluginPatchAdmin.compose(existing: withBoth, toggles: [.init(rowId: "hmr", disabled: false)])
        XCTAssertEqual(McpServerAdmin.parse(after), [stdio("alpha")])
        XCTAssertEqual(PluginPatchAdmin.parseManaged(after), [.init(rowId: "hmr", disabled: false)])
    }

    func testValidateRejectsBadInput() {
        XCTAssertNotNil(McpServerAdmin.validate([stdio("alpha"), stdio("alpha")]))       // 重名
        XCTAssertNotNil(McpServerAdmin.validate([stdio("has space")]))                   // 非法字符
        XCTAssertNotNil(McpServerAdmin.validate([.init(rowId: "mcp-a", name: "a", transport: "stdio",
                                                        command: "  ", args: [], url: "", enabled: true)]))
        XCTAssertNotNil(McpServerAdmin.validate([.init(rowId: "mcp-a", name: "a", transport: "http",
                                                        command: "", args: [], url: "", enabled: true)]))
        XCTAssertNil(McpServerAdmin.validate([stdio("alpha")]))
    }

    func testSaveRefusesInvalidWithoutWriting() throws {
        let error = McpServerAdmin.save([stdio("bad name")], in: home)
        XCTAssertNotNil(error)
        XCTAssertFalse(FileManager.default.fileExists(atPath: McpServerAdmin.fileURL(home: home).path))
    }

    func testSaveThenRead() throws {
        XCTAssertNil(McpServerAdmin.save([stdio("alpha"), stdio("beta", enabled: false)], in: home))
        let rows = McpServerAdmin.servers(in: home)
        XCTAssertEqual(rows.map(\.name), ["alpha", "beta"])
        XCTAssertEqual(rows.map(\.enabled), [true, false])
    }
}
