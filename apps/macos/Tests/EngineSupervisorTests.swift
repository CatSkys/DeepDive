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
            (EngineSupervisor.sessionMemorySkillName, EngineSupervisor.sessionMemorySkillMarkdown, "memory_note_write", EngineSupervisor.ensureSessionMemorySkill()),
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

    /// 机械门与落地确认脚本：随应用铺盘、可执行，证据逐字判定必须在解码后的
    /// 事件字段值上做（日志行是 JSON 转义态），仓库家的落地确认必须有允许清单红线。
    func testLessonGateAndLandScriptShape() {
        let gate = EngineSupervisor.lessonGateScript(node: "/tmp/node", fzstd: "/tmp/fzstd.mjs")
        XCTAssertTrue(gate.hasPrefix("#!/tmp/node"), "gate shebang 必须用传入的 node 绝对路径")
        XCTAssertTrue(gate.contains("lesson-gate.mjs <sessionId> <evidenceJSON> <home> <anchorJSON> [repoPath]"), "用法说明缺失")
        XCTAssertTrue(gate.contains(#"import { Decompress } from "/tmp/fzstd.mjs";"#), "fzstd 路径未写死")
        XCTAssertTrue(gate.contains("new Decompress("), "必须用流式 Decompress 解多帧")
        XCTAssertTrue(gate.contains("stringsOf"), "逐字判定必须解码 JSON 后对字段值比")
        XCTAssertTrue(gate.contains("JSON.stringify({ verbatim, anchorFound })"), "末行回执缺字段")
        let land = EngineSupervisor.lessonLandScript(node: "/tmp/node")
        XCTAssertTrue(land.hasPrefix("#!/tmp/node"), "land shebang 必须用传入的 node 绝对路径")
        XCTAssertTrue(land.contains("lesson-land.mjs <id> <home> <repoPath> <contentJSON>"), "用法说明缺失")
        XCTAssertTrue(land.contains("--grep="), "仓库家靠 git log --grep=<id> 定位落库提交")
        XCTAssertTrue(land.contains("files-outside-allowlist"), "触碰文件出允许清单必须有独立失败原因")
        XCTAssertTrue(land.contains("JSON.stringify({ id, landed, commit: null, files"), "DSH_HOME 家回执缺字段")
        let gateURL = EngineSupervisor.ensureLessonGateScript()
        let landURL = EngineSupervisor.ensureLessonLandScript()
        XCTAssertTrue(FileManager.default.fileExists(atPath: gateURL.path), gateURL.path)
        XCTAssertTrue(FileManager.default.fileExists(atPath: landURL.path), landURL.path)
        XCTAssertTrue(EngineSupervisor.lessonScriptURL("lesson-gate.mjs").path == gateURL.path, "lessonScriptURL 与铺盘位置必须一致")
    }

    /// 会话记忆插件：挂载面（inject/pre-step）、fail-open 纪律、笔记围栏（防注入）、
    /// 三工具与 new_context 的压缩通道都要在；铺盘位置与挂载名一致。
    func testSessionMemoryPluginShape() throws {
        let src = EngineSupervisor.sessionMemoryPluginSource
        XCTAssertTrue(src.contains("export const name = PLUGIN_NAME"))
        XCTAssertTrue(src.contains(#"export const inject = ["agents"]"#), "必须声明依赖")
        XCTAssertTrue(src.contains(#"ctx.on("agent/pre-step""#), "注入点：每轮第一个模型步前")
        XCTAssertTrue(src.contains("{ prepend: true }"), "注入必须前置（EverOS 同款）")
        XCTAssertTrue(src.contains("createUserMessage"), "消息构造照 dsh-llm")
        XCTAssertTrue(src.contains(#"kind: "plugin""#), "注入消息必须带 plugin 出处")
        XCTAssertTrue(src.contains("step !== 1"), "只在每轮第一步注入，不逐步重复")
        XCTAssertTrue(src.contains("failed open"), "fail-open：失败绝不挡用户轮次")
        XCTAssertTrue(src.contains("<session_memory>"), "笔记必须围栏成不可信证据")
        XCTAssertTrue(src.contains("neutralizeFences"), "围栏记号必须中和，防逃逸")
        for tool in ["memory_note_read", "memory_note_write", "new_context"] {
            XCTAssertTrue(src.contains("name: \"\(tool)\""), "缺工具 \(tool)")
        }
        XCTAssertTrue(src.contains("compactNow"), "new_context 走引擎压缩通道")
        // 引擎的 tools.register 在**注册时**就急切读 output.render（缺失即抛 TypeError），
        // 而注册发生在 agent/created，所以少了 output 会让**每次建会话都失败**
        //（2026-09-13 实机：session/create 报 "Cannot read properties of undefined
        // (reading 'render')"，记忆功能从未生效）。三个工具都必须声明 output。
        XCTAssertEqual(src.components(separatedBy: "output: { schema: TEXT_OUTPUT_SCHEMA, render: renderText }").count - 1, 3,
                       "三个工具都必须声明 output { schema, render }")
        XCTAssertTrue(src.contains("function renderText("), "缺 render 实现")
        XCTAssertTrue(src.contains("oneOf"), "output.schema 形状照 dsh-schedule")
        // presentCall 的返回也必须是引擎认得的卡片形状（dsh-schedule 的 present 同款）
        XCTAssertEqual(src.components(separatedBy: #"card: "generic""#).count - 1, 3, "presentCall 必须带 card")
        XCTAssertTrue(src.contains("ctx.agents.roots().includes"), "只挂 root agent（dsh-schedule 同款）")
        XCTAssertTrue(src.contains("DSH_HOME"), "笔记目录按 $DSH_HOME 解析")
        let availability = EngineSupervisor.ensureSessionMemoryPlugin()
        let url = EngineSupervisor.sessionMemoryPluginURL
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), url.path)
        XCTAssertTrue(EngineSupervisor.memoryDir.path.hasSuffix("deepdive/memory"))
        // 闭包链接 + 依赖自检：插件的 import 靠它解析，缺了不是"功能不可用"而是
        // **整棵插件树起不来**（2026-09-13 实机）。测试宿主没有随包 runtime 闭包，
        // 此时必须报 unavailable 且**不留悬空链接**——挂载判据据此不挂它。
        let closure = (Bundle.main.resourceURL?.appendingPathComponent("Runtime/dsh/node_modules"))?.path
        let link = url.deletingLastPathComponent().appendingPathComponent("node_modules").path
        if let closure, FileManager.default.fileExists(atPath: closure) {
            XCTAssertEqual(availability, .available)
            let dest = try FileManager.default.destinationOfSymbolicLink(atPath: link)
            XCTAssertEqual(dest, closure, "node_modules 链接必须直指随包安装闭包")
        } else {
            guard case .unavailable = availability else {
                return XCTFail("没有随包闭包时必须报 unavailable，不能报可挂载")
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: link), "不留悬空链接")
        }
        XCTAssertTrue(EngineSupervisor.sessionMemoryPluginSource.contains("DSH_HOME"), "笔记目录按 $DSH_HOME 解析")
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

    /// 自进化 / 会话记忆开关关着时，指路里不能出现对应那句；开着才在。
    /// 部署提示词的落点已从 overlay 的 personaPrefix 改为 AGENTS.md 托管块，见
    /// `DeploymentPromptTests` 与 `DeploymentPrompt` 头注（遮蔽实测：PITFALLS §7.7）。
    func testDeploymentPromptFollowsSwitches() {
        func text(_ evo: Bool, _ mem: Bool) -> String {
            DeploymentPrompt.body(evolutionEnabled: evo, sessionMemoryEnabled: mem).joined(separator: "\n")
        }
        let off = text(false, false)
        XCTAssertTrue(off.contains("deepdive-automation"))
        XCTAssertFalse(off.contains("deepdive-evolution"))
        XCTAssertFalse(off.contains("memory_note_write"))

        let evoOn = text(true, false)
        XCTAssertTrue(evoOn.contains("deepdive-automation") && evoOn.contains("deepdive-evolution"))
        XCTAssertFalse(evoOn.contains("memory_note_write"))

        let memOn = text(false, true)
        XCTAssertTrue(memOn.contains("memory_note_write"))
        XCTAssertFalse(memOn.contains("deepdive-evolution"))
    }

    /// 富输出围栏的指路恒在（与开关无关）：模型不被告知词表就永远不会用 widget。
    func testDeploymentPromptAlwaysListsRichOutputFences() {
        let off = DeploymentPrompt.body(evolutionEnabled: false, sessionMemoryEnabled: false).joined(separator: "\n")
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
        let withMemory = EngineSupervisor.enginePatchBody(sessionMemoryEnabled: true)
        XCTAssertTrue(withMemory.contains("- id: schedule"))
        XCTAssertTrue(withMemory.contains("@deepseek-ai/dsh-schedule"))
        XCTAssertTrue(withMemory.contains("id: deepdive-session-memory"))
        XCTAssertTrue(withMemory.contains("index.js"), "本地插件按绝对路径挂")
        XCTAssertFalse(withMemory.contains("system-prompt"), "personaPrefix 那条路到不了模型，别加回来")
        XCTAssertFalse(withMemory.contains("personaPrefix"))

        let withoutMemory = EngineSupervisor.enginePatchBody(sessionMemoryEnabled: false)
        XCTAssertTrue(withoutMemory.contains("- id: schedule"))
        XCTAssertFalse(withoutMemory.contains("deepdive-session-memory"))

        for line in withMemory.split(separator: "\n") where line.contains("name:") {
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
