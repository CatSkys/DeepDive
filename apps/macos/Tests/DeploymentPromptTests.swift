import XCTest
@testable import DeepDive

/// 部署提示词落点的钉子：写进 `<DSH_HOME>/AGENTS.md` 的托管块，**段外逐字保留**
/// ——这个文件用户在别处也会写，整段重写会把用户的内容抹掉。
final class DeploymentPromptTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("deployment-prompt-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private var agentsURL: URL { home.appendingPathComponent("AGENTS.md") }

    private func text() throws -> String {
        try String(contentsOf: agentsURL, encoding: .utf8)
    }

    /// 文件不存在时创建，并且内容真的进了块内。
    func testCreatesFileAndWritesTheBlock() throws {
        XCTAssertTrue(DeploymentPrompt.ensureInstalled(in: home))

        let body = try text()
        XCTAssertTrue(body.contains(DeploymentPrompt.marker.begin))
        XCTAssertTrue(body.contains(DeploymentPrompt.marker.end))
        XCTAssertTrue(body.contains("deepdive-automation"))
        XCTAssertTrue(body.contains("mermaid"))
    }

    /// 段外内容逐字保留——用户自己写的规则就住在这个文件里，抹掉等于删他的知识。
    func testPreservesContentOutsideTheBlock() throws {
        let mine = "# 用户自己写的\n\n- 2026-09-20 教训：别把 `--deepseek` 和 `--ds` 混用。"
        try mine.write(to: agentsURL, atomically: true, encoding: .utf8)

        DeploymentPrompt.ensureInstalled(in: home)

        let body = try text()
        XCTAssertTrue(body.contains(mine), "段外内容必须原样留下")
        XCTAssertTrue(body.contains("deepdive-automation"))
    }

    /// 用户内容在块之后时同样保留，且再写一次只动块、不追加第二个块。
    func testRewritesOnlyTheBlock() throws {
        let before = "- 2026-09-19 教训：先说结论。\n"
        let after = "\n## 我自己的一节\n\n内容不许动。\n"
        try (before + "\n" + after).write(to: agentsURL, atomically: true, encoding: .utf8)

        DeploymentPrompt.ensureInstalled(in: home)

        let body = try text()
        XCTAssertTrue(body.contains("2026-09-19 教训：先说结论。"))
        XCTAssertTrue(body.contains("内容不许动。"))
        // 标记只该有一对，别每次追加一个块。
        XCTAssertEqual(body.components(separatedBy: DeploymentPrompt.marker.begin).count, 2)
        XCTAssertEqual(body.components(separatedBy: DeploymentPrompt.marker.end).count, 2)
    }

    /// 幂等：同样内容再调一次零写入（否则每次启动都在动用户的文件）。
    func testSecondCallIsANoOp() throws {
        DeploymentPrompt.ensureInstalled(in: home)
        let first = try FileManager.default.attributesOfItem(atPath: agentsURL.path)[.modificationDate] as? Date

        XCTAssertFalse(DeploymentPrompt.ensureInstalled(in: home))
        let second = try FileManager.default.attributesOfItem(atPath: agentsURL.path)[.modificationDate] as? Date
        XCTAssertEqual(first, second)
    }
}
