import XCTest
@testable import DeepDive

/// 其他 Agent 配置读取（新手引导「迁移」步）：只验搬运语义——白名单、原文、缺失与
/// 超限都按"这家没有可导入配置"处理（绝不返回半份内容）。
final class AgentConfigScanTests: XCTestCase {
    private func makeHome() throws -> URL {
        let home = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("agent-scan-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        return home
    }

    private func write(_ home: URL, _ relative: String, _ text: String) throws {
        let url = home.appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    func testReadsWhitelistedFilesVerbatim() throws {
        let home = try makeHome()
        try write(home, ".zcode/v2/config.json", #"{"provider":{"deepseek":{"options":{"apiKey":"x"}}}}"#)
        try write(home, ".config/mimocode/mimocode.jsonc", "{ /* c */ }")
        let files = AgentConfigScan.read(home: home)
        XCTAssertEqual(files["zcode"], #"{"provider":{"deepseek":{"options":{"apiKey":"x"}}}}"#)
        XCTAssertEqual(files["mimocode"], "{ /* c */ }")
        XCTAssertNil(files["pi"], "未写入的来源不该出现")
        XCTAssertNil(files["opencode"])
    }

    func testSkipsMissingAndOversizedFiles() throws {
        let home = try makeHome()
        try write(home, ".pi/agent/models.json", String(repeating: " ", count: 1_200_000))
        let files = AgentConfigScan.read(home: home)
        XCTAssertNil(files["pi"], "超上限按不可导入处理，不截断")
    }

    func testCandidatesCoverTheFourWhitelistedSources() throws {
        let home = try makeHome()
        XCTAssertEqual(AgentConfigScan.candidates(home: home).map(\.source), ["zcode", "mimocode", "pi", "opencode"])
    }
}
