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
        let skills: [(name: String, md: String, fence: String, url: URL)] = [
            (EngineSupervisor.automationSkillName, EngineSupervisor.automationSkillMarkdown, "```automation", EngineSupervisor.ensureAutomationSkill()),
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
    }

    /// EverOS 提取密钥的桥：用户配过就不覆盖，没配才用引擎那把 key；解析不出不猜。
    func testEverOSKeyBridge() {
        let creds = """
        version: 1
        refs:
          DEEPSEEK_API_KEY: "sk-abc123"
          KIMI_CODING_API_KEY: "other"
        records:
          x:
            kind: y
        """
        XCTAssertEqual(EverOSKeyBridge.apiKeyFromCredentials(creds), "sk-abc123")
        // 只在 refs 段里找：换成顶层同名键不该命中
        XCTAssertNil(EverOSKeyBridge.apiKeyFromCredentials("DEEPSEEK_API_KEY: \"sk-top\""))
        XCTAssertNil(EverOSKeyBridge.apiKeyFromCredentials("refs:\n  DEEPSEEK_API_KEY: \"\""), "空值当没有")

        let emptyToml = "[llm]\nmodel = \"deepseek-chat\"\napi_key = \"\"\n"
        XCTAssertNil(EverOSKeyBridge.llmApiKeyFromToml(emptyToml), "空 api_key 视为未配置")
        let filledToml = "[llm]\napi_key = 'user-owned'\n\n[embedding]\napi_key = \"other\"\n"
        XCTAssertEqual(EverOSKeyBridge.llmApiKeyFromToml(filledToml), "user-owned")
        XCTAssertNil(EverOSKeyBridge.llmApiKeyFromToml("[embedding]\napi_key = \"other\"\n"), "只看 [llm] 段")

        // 规则：用户配过 → 不覆盖；没配 → 用引擎那把；凭据缺失 → nil（不猜）
        XCTAssertNil(EverOSKeyBridge.resolveApiKey(credentialsYaml: creds, everosToml: filledToml))
        XCTAssertEqual(EverOSKeyBridge.resolveApiKey(credentialsYaml: creds, everosToml: emptyToml), "sk-abc123")
        XCTAssertNil(EverOSKeyBridge.resolveApiKey(credentialsYaml: nil, everosToml: emptyToml))
        XCTAssertEqual(EverOSKeyBridge.resolveApiKey(credentialsYaml: creds, everosToml: nil), "sk-abc123")
    }

    /// 富输出围栏的指路恒在（与开关无关）：模型不被告知词表就永远不会用 widget。
    func testDeploymentPromptAlwaysListsRichOutputFences() {
        let off = DeploymentPrompt.body().joined(separator: "\n")
        XCTAssertTrue(off.contains("mermaid") && off.contains("svg") && off.contains("widget"))
        // 偏好必须写在提示词里：2026-09-16 用户说"画个 svg"，模型直接落了一份 .svg 文件
        // （产物卡有、对话里没围栏）——"没显示"的真因，别退回只说"可以用围栏"。
        // 注：那次修复补的就是这句，而当时它经 personaPrefix 注入、到不了模型，
        // 所以从未生效过；改落点后才真正到达（PITFALLS §7.7）。
        XCTAssertTrue(off.contains("deliverable"), "要区分「对话里看」与「产出文件」")
        XCTAssertTrue(off.contains("inline fence"))
    }

    /// 引擎 overlay patch 的形状：写坏了引擎 boot 时 fail-loud 起不来，所以 insert
    /// 段的形状是钉子。**且它不再带 `system-prompt` 行**——那条路被 agent preset 的
    /// `dsh-persona` 遮蔽（PITFALLS §7.7），而且它对 config 是整体替换，会顺手打掉
    /// web 层设的 personaSuffix。部署提示词改落 AGENTS.md，这条断言防它被加回来。
    func testEnginePatchCarriesOnlyAssemblyInserts() {
        let body = EngineSupervisor.enginePatchBody()
        XCTAssertTrue(body.contains("- id: schedule"))
        XCTAssertTrue(body.contains("@deepseek-ai/dsh-schedule"))
        XCTAssertFalse(body.contains("system-prompt"), "personaPrefix 那条路到不了模型，别加回来")
        XCTAssertFalse(body.contains("personaPrefix"))

        for line in body.split(separator: "\n") where line.contains("name:") {
            XCTAssertFalse(line.contains("\t"), "YAML 流标量不能有制表符")
        }
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

    /// 兜底工作区不许落在受保护目录（~/Documents 等）：首启在那里建目录会弹系统
    /// 授权框，而它出现在主窗口之前、主线程上——忽略就卡死启动，拒绝则引擎连
    /// cwd 都进不去（PITFALLS §4.8 / §7.1.2）。锁死在家目录下的 DeepDive。
    func testResolveLaunchWorkspaceFallbackStaysOutOfProtectedFolders() throws {
        let home = try makeHarnessHome(with: nil)
        let resolved = EngineSupervisor.resolveLaunchWorkspace(explicit: nil, home: home)
        XCTAssertEqual(resolved.lastPathComponent, "DeepDive")
        XCTAssertEqual(resolved.deletingLastPathComponent(), FileManager.default.homeDirectoryForCurrentUser)
        XCTAssertFalse(resolved.path.contains("/Documents/"))
    }

    /// Intel Mac 上引擎起不来时用户读到的那句话。本机是 Apple 芯片、装不了"内核
    /// 拒绝执行的架构"，所以钉的是**判定与文案**（真实错误形制照 Process.run 实测：
    /// NSPOSIXErrorDomain + errno 86）。别的失败原因必须回 nil，交给原有文案——
    /// 这条不许吞掉 ENOEXEC（非可执行）之类的其他启动失败。
    func testArchMismatchCopyOnlyFiresForBadCPUType() {
        let asProcessRunGives = NSError(
            domain: NSPOSIXErrorDomain,
            code: Int(POSIXErrorCode.EBADARCH.rawValue),
            userInfo: nil,
        )
        let message = EngineSupervisor.archMismatchCopy(asProcessRunGives)
        XCTAssertNotNil(message)
        XCTAssertTrue(message?.contains("Apple 芯片") == true)
        XCTAssertTrue(message?.contains("Intel") == true)
        XCTAssertEqual(message, EngineSupervisor.archMismatchCopy(POSIXError(.EBADARCH)))

        XCTAssertNil(EngineSupervisor.archMismatchCopy(POSIXError(.ENOEXEC)))
        XCTAssertNil(EngineSupervisor.archMismatchCopy(POSIXError(.EACCES)))
    }
}
