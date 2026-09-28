import XCTest
@testable import DeepDive

/// 随应用发布的技能（AppSkills）的钉子：
/// - frontmatter 是**硬契约**——缺 name/description、或用了 legacy 键
///   （modelInvocable / userInvocable / disableModelInvocation），引擎只记一条 warn
///   然后整份忽略这个 skill，模型就再也看不到它；
/// - 退役清理只碰常量名单，用户自己的技能一个都不许动；
/// - 铺盘落在 <home>/skills/<名字>/SKILL.md（引擎的 skill-filesystem 按 rank 400 发现）。
final class AppSkillsTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("app-skills-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private func writeSkill(_ id: String, _ markdown: String) throws {
        let dir = home.appendingPathComponent("skills").appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try markdown.write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
    }

    private func skillIdsInHome() -> [String] {
        let root = home.appendingPathComponent("skills", isDirectory: true)
        let entries = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return entries.sorted()
    }

    func testPublishedSkillsShapeAndLocation() {
        AppSkills.install(in: home)

        for skill in AppSkills.published {
            XCTAssertTrue(skill.markdown.hasPrefix("---\n"), "\(skill.name) 缺 frontmatter")
            XCTAssertTrue(skill.markdown.contains("\nname: \(skill.name)\n"), "\(skill.name) name 不匹配")
            XCTAssertTrue(skill.markdown.contains("\ndescription: "), "\(skill.name) 缺 description")
            for legacy in ["modelInvocable", "userInvocable", "disableModelInvocation"] {
                XCTAssertFalse(skill.markdown.contains(legacy), "\(skill.name) 用了 legacy 键 \(legacy)：引擎会整份忽略")
            }
            let url = home.appendingPathComponent("skills/\(skill.name)/SKILL.md")
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), url.path)
        }

        // 自动化技能仍要带围栏 info string 与全六种计划形状（与 automation/protocol.ts 同一份契约）
        XCTAssertTrue(AppSkills.automationSkillMarkdown.contains("```automation"))
        for kind in ["hourly", "daily", "weekdays", "weekly", "monthly", "custom"] {
            XCTAssertTrue(AppSkills.automationSkillMarkdown.contains("\"kind\":\"\(kind)\""), "缺计划形状 \(kind)")
        }
    }

    /// 名字清单是前端"不给删除入口"的依据：必须与 `published` 同源，且覆盖每个被写回的技能。
    func testPublishedNamesCoverEveryRewrittenSkill() {
        XCTAssertEqual(
            AppSkills.publishedNames,
            ["deepdive-automation", "deepdive-browser"],
        )
        XCTAssertEqual(AppSkills.publishedNames, Set(AppSkills.published.map(\.name)))
    }

    /// 停发的技能不留盘（引擎自动发现技能根下的一切，留着就是继续教模型一个
    /// 没人消费的协议）；用户自己的技能与在发的技能一个都不许碰。
    func testRemoveRetiredOnlyDropsRetiredSkills() throws {
        try writeSkill("deepdive-evolution", "---\nname: deepdive-evolution\ndescription: 旧\n---\n正文")
        try writeSkill("deepdive-session-memory", "---\nname: deepdive-session-memory\ndescription: 旧\n---\n正文")
        try writeSkill(AppSkills.automationSkillName, "---\nname: deepdive-automation\ndescription: 在\n---\n正文")
        try writeSkill("mine", "---\nname: mine\ndescription: 自建\n---\n正文")

        XCTAssertEqual(AppSkills.removeRetired(in: home), ["deepdive-evolution", "deepdive-session-memory"])
        XCTAssertEqual(skillIdsInHome(), ["deepdive-automation", "mine"])
        // 幂等：再跑一次没有任何可删的
        XCTAssertEqual(AppSkills.removeRetired(in: home), [])
        XCTAssertEqual(skillIdsInHome(), ["deepdive-automation", "mine"])
    }

    /// `install` 每次启动重写正文（升级以应用内为准）并顺手清退役目录。
    func testInstallRewritesAndSweepsInOnePass() throws {
        try writeSkill(AppSkills.automationSkillName, "---\nname: deepdive-automation\ndescription: 旧版\n---\n旧正文")
        try writeSkill("deepdive-evolution", "---\nname: deepdive-evolution\ndescription: 旧\n---\n正文")

        XCTAssertEqual(AppSkills.install(in: home), ["deepdive-evolution"])
        let text = try String(
            contentsOf: home.appendingPathComponent("skills/deepdive-automation/SKILL.md"),
            encoding: .utf8,
        )
        XCTAssertEqual(text, AppSkills.automationSkillMarkdown)
    }
}
