import XCTest
@testable import DeepDive

/// 引擎 stdout 的字节级行切分（AUD-018 修复钉）：完整行逐条出、撕裂的多字节
/// 序列留在缓冲等下一片——整段缓冲解码失败丢全部行的旧病不再复发。
final class EngineSupervisorTests: XCTestCase {
    func testDrainsCompleteLinesAndKeepsTornTail() {
        var buf = Data("dsh web: http://127.0.0.1:5173\n第一行".utf8)
        XCTAssertEqual(EngineSupervisor.drainLines(&buf), ["dsh web: http://127.0.0.1:5173"])
        XCTAssertEqual(buf, Data("第一行".utf8)) // 无换行的尾巴整段保留

        // 撕裂的多字节序列（🎯 4 字节只到前 2 字节）：只保尾部，不丢已完整行
        var torn = Data("就绪\n".utf8)
        let emoji = Data("🎯".utf8)
        torn.append(emoji.prefix(2))
        XCTAssertEqual(EngineSupervisor.drainLines(&torn), ["就绪"])
        XCTAssertEqual(torn, emoji.prefix(2))

        // 后半片到达后整行恢复
        torn.append(emoji.suffix(2))
        torn.append(Data("\n完成\n".utf8))
        XCTAssertEqual(EngineSupervisor.drainLines(&torn), ["🎯", "完成"])
        XCTAssertTrue(torn.isEmpty)
    }

    func testEmptyLinesPreservedAndCarriageReturnsKept() {
        var buf = Data("a\r\n\nb\n".utf8)
        XCTAssertEqual(EngineSupervisor.drainLines(&buf), ["a\r", "", "b"])
        XCTAssertTrue(buf.isEmpty)
    }

    // MARK: - 引擎启动工作区解析（PITFALLS §4.13：cwd 绝不落到用户主目录）

    private func makeHarnessHome(with workspacesJSON: String?) throws -> URL {
        let home = FileManager.default.temporaryDirectory
            .appendingPathComponent("ws-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: home.appendingPathComponent("storages"), withIntermediateDirectories: true)
        if let workspacesJSON {
            try workspacesJSON.data(using: .utf8)?
                .write(to: home.appendingPathComponent("storages/workspace.json"))
        }
        return home
    }

    private func wsJSON(ids: [String], rows: [String: [String: Any]]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [
            "global": ["workspaceIds": ids],
            "tables": ["workspaces": rows],
        ])
        return String(data: data, encoding: .utf8)!
    }

    /// 自动化协议住在 skill 里（system-prompt 只留一行指路）：skill 文件的
    /// frontmatter 是硬契约——缺 name/description、或用了 legacy 键（
    /// modelInvocable / userInvocable / disableModelInvocation）会**抛错**，
    /// 引擎只记一条 warn 然后静默忽略整个 skill，模型就再也看不到它。
    func testAutomationSkillShapeAndLocation() {
        let md = EngineSupervisor.automationSkillMarkdown
        XCTAssertTrue(md.hasPrefix("---\n"), "缺 frontmatter")
        XCTAssertTrue(md.contains("\nname: \(EngineSupervisor.automationSkillName)\n"))
        XCTAssertTrue(md.contains("\ndescription: "))
        for legacy in ["modelInvocable", "userInvocable", "disableModelInvocation"] {
            XCTAssertFalse(md.contains(legacy), "frontmatter 用了 legacy 键 \(legacy)：引擎会整份忽略")
        }
        // 六种计划形状与围栏 info string 都得在正文里（与 protocol.ts 同一份契约）
        XCTAssertTrue(md.contains("```automation"))
        for kind in ["hourly", "daily", "weekdays", "weekly", "monthly", "custom"] {
            XCTAssertTrue(md.contains("\"kind\":\"\(kind)\"") || md.contains("\"kind\":\"\(kind)\""), "缺计划形状 \(kind)")
        }
        let url = EngineSupervisor.ensureAutomationSkill()
        XCTAssertTrue(url.path.hasSuffix("skills/\(EngineSupervisor.automationSkillName)/SKILL.md"), url.path)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    /// 引擎 overlay patch 的形状：写坏了引擎 boot 时 fail-loud 起不来，所以两段
    /// 都得在——schedule 工具 insert + 会话侧自动化协议的 system-prompt 前缀；
    /// 提示词里的引号/换行经 JSON 转义成 YAML 流标量后必须仍是**单行**。
    func testEnginePatchCarriesScheduleInsertAndAutomationPrompt() throws {
        let body = EngineSupervisor.enginePatchBody()
        XCTAssertTrue(body.contains("- id: schedule"))
        XCTAssertTrue(body.contains("@deepseek-ai/dsh-schedule"))
        let prefixLine = try XCTUnwrap(body.split(separator: "\n").first { $0.contains("personaPrefix:") })
        XCTAssertTrue(prefixLine.contains("automation"), "协议说明缺失")
        XCTAssertTrue(prefixLine.hasPrefix("    personaPrefix: \""))
        XCTAssertTrue(prefixLine.hasSuffix("\""), "值没有被引号包住——YAML 流标量会破")
        XCTAssertFalse(prefixLine.contains("\t"))
    }

    func testFirstRegisteredWorkspaceFollowsIdOrderAndIgnoresInvalid() throws {
        let a = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("ws-a-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: a, withIntermediateDirectories: true)
        let home = try makeHarnessHome(with: wsJSON(
            ids: ["idA", "idB"],
            rows: [
                "idA": ["path": a.path],
                "idB": ["path": "/nonexistent/ws-b"],
            ],
        ))
        // workspaceIds[0] 定序；其行存在且路径有效才可用，无效时整体回 nil
        // （不跳到 idB——顺序语义与侧栏一致）。
        XCTAssertEqual(EngineSupervisor.firstRegisteredWorkspace(home: home)?.path, a.path)
        let badFirst = try makeHarnessHome(with: wsJSON(
            ids: ["idA", "idB"],
            rows: ["idA": ["path": "/nonexistent/ws-a"], "idB": ["path": a.path]],
        ))
        XCTAssertNil(EngineSupervisor.firstRegisteredWorkspace(home: badFirst))
    }

    func testFirstRegisteredWorkspaceToleratesMissingGarbageAndEmpty() throws {
        XCTAssertNil(EngineSupervisor.firstRegisteredWorkspace(home: try makeHarnessHome(with: nil)))
        XCTAssertNil(EngineSupervisor.firstRegisteredWorkspace(home: try makeHarnessHome(with: "not json")))
        XCTAssertNil(EngineSupervisor.firstRegisteredWorkspace(home: try makeHarnessHome(with: wsJSON(ids: [], rows: [:]))))
    }

    func testResolveLaunchWorkspacePrefersExplicitThenRegistered() throws {
        let explicit = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let registered = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("ws-r-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: registered, withIntermediateDirectories: true)
        let home = try makeHarnessHome(with: wsJSON(ids: ["r"], rows: ["r": ["path": registered.path]]))
        XCTAssertEqual(
            EngineSupervisor.resolveLaunchWorkspace(explicit: explicit, home: home),
            explicit,
        )
        XCTAssertEqual(
            EngineSupervisor.resolveLaunchWorkspace(explicit: nil, home: home),
            registered,
        )
    }
}
