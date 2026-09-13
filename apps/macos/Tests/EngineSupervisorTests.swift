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
    func testSkillsShapeAndLocation() {
        // 两个技能同一套纪律：frontmatter 必带 name/description、不能用 legacy 键，
        // 正文里得有各自的围栏 info string 与落点指路。
        let skills: [(name: String, md: String, fence: String, url: URL)] = [
            (EngineSupervisor.automationSkillName, EngineSupervisor.automationSkillMarkdown, "```automation", EngineSupervisor.ensureAutomationSkill()),
            (EngineSupervisor.evolutionSkillName, EngineSupervisor.evolutionSkillMarkdown, "```lesson", EngineSupervisor.ensureEvolutionSkill()),
        ]
        for skill in skills {
            XCTAssertTrue(skill.md.hasPrefix("---\n"), "\(skill.name) 缺 frontmatter")
            XCTAssertTrue(skill.md.contains("\nname: \(skill.name)\n"), "\(skill.name) name 不匹配")
            XCTAssertTrue(skill.md.contains("\ndescription: "), "\(skill.name) 缺 description")
            for legacy in ["modelInvocable", "userInvocable", "disableModelInvocation"] {
                XCTAssertFalse(skill.md.contains(legacy), "\(skill.name) 用了 legacy 键 \(legacy)：引擎会整份忽略")
            }
            XCTAssertTrue(skill.md.contains(skill.fence), "\(skill.name) 缺围栏 info string")
            XCTAssertTrue(skill.url.path.hasSuffix("skills/\(skill.name)/SKILL.md"), skill.url.path)
            XCTAssertTrue(FileManager.default.fileExists(atPath: skill.url.path))
        }
        // 自动化技能仍要带全六种计划形状（与 automation/protocol.ts 同一份契约）
        for kind in ["hourly", "daily", "weekdays", "weekly", "monthly", "custom"] {
            XCTAssertTrue(EngineSupervisor.automationSkillMarkdown.contains("\"kind\":\"\(kind)\""), "缺计划形状 \(kind)")
        }
        // 自进化技能的细则不在技能里，指路仓库政策文件（一事一家）
        XCTAssertTrue(EngineSupervisor.evolutionSkillMarkdown.contains("docs/EVOLUTION-POLICY.md"))
    }

    /// 效果校验器：随应用铺盘、可执行、路径写死（shebang 直指随包 node——会话里
    /// node 未必在 PATH 上）、末行必须是机器可读回执（before/after 两个数），
    /// 判定口径才落得下来。
    func testLessonVerifyScriptShape() throws {
        let body = EngineSupervisor.lessonVerifyScript(node: "/tmp/node", fzstd: "/tmp/fzstd.mjs")
        XCTAssertTrue(body.hasPrefix("#!/tmp/node"), "shebang 必须用传入的 node 绝对路径")
        XCTAssertTrue(body.contains(#"import { Decompress } from "/tmp/fzstd.mjs";"#), "fzstd 路径未写死")
        // 会话日志是多帧 zstd：一次性 decompress 只解第一帧（实测只得到 1 行），必须走流式
        XCTAssertTrue(body.contains("new Decompress("), "必须用流式 Decompress 解多帧")
        XCTAssertTrue(body.contains("DSH_HOME"), "未按 $DSH_HOME 定位会话目录")
        XCTAssertTrue(body.contains("lesson-verify.mjs <id> <signature> <windowDays> <landedISO> <metric>"), "用法说明缺失")
        XCTAssertTrue(body.contains("{ id, before, after }"), "末行回执少字段")
        // steps 口径：只数按签名匹配的会话、按均值（SPEC §6 指标 B），不是全会话加总
        XCTAssertTrue(body.contains("if (!sessionMatched) continue;"), "steps 必须按签名匹配会话收敛")
        XCTAssertTrue(body.contains("before / sessionsBefore"), "steps 必须是均值口径")
        // 铺出来的必须是**转义后**的 JS 源码：Swift 多行串里写 \n 会变成真换行，脚本直接语法错
        XCTAssertTrue(body.contains("text.split(\"\\n\")"), "换行转义被吃掉了")
        let url = EngineSupervisor.ensureLessonVerifyScript()
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), url.path)
        let perms = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(perms?.intValue, 0o755, "铺出来的校验器必须可执行")
    }

    /// 自进化开关关着时，装配里不能出现那行自进化指路（新会话里模型也就不知道
    /// 可以提经验）；开着才追加，且自动化指路恒在。
    func testSystemPromptPrefixFollowsEvolutionSwitch() {
        let off = EngineSupervisor.systemPromptPrefix(evolutionEnabled: false)
        XCTAssertTrue(off.contains("deepdive-automation"))
        XCTAssertFalse(off.contains("deepdive-evolution"))
        let on = EngineSupervisor.systemPromptPrefix(evolutionEnabled: true)
        XCTAssertTrue(on.contains("deepdive-automation") && on.contains("deepdive-evolution"))
        XCTAssertFalse(EngineSupervisor.enginePatchBody(evolutionEnabled: false).contains("deepdive-evolution"))
        XCTAssertTrue(EngineSupervisor.enginePatchBody(evolutionEnabled: true).contains("deepdive-evolution"))
    }

    /// 引擎 overlay patch 的形状：写坏了引擎 boot 时 fail-loud 起不来，所以两段
    /// 都得在——schedule 工具 insert + 会话侧自动化协议的 system-prompt 前缀；
    /// 提示词里的引号/换行经 JSON 转义成 YAML 流标量后必须仍是**单行**。
    func testEnginePatchCarriesScheduleInsertAndAutomationPrompt() throws {
        let body = EngineSupervisor.enginePatchBody(evolutionEnabled: true)
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
