import XCTest
@testable import DeepDive

/// 技能管理面的钉子：frontmatter 解析（含引号、缺键、无 frontmatter）、
/// 清单只认一层目录、删除只允许技能根下带 SKILL.md 的那一层。
final class SkillAdminTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("skill-admin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: home.appendingPathComponent("skills"), withIntermediateDirectories: true,
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private func writeSkill(_ id: String, _ markdown: String) throws {
        let dir = home.appendingPathComponent("skills").appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try markdown.write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
    }

    // MARK: - frontmatter

    func testFrontmatterReadsQuotedAndPlainValues() {
        let head = SkillAdmin.frontmatter("""
        ---
        name: my-skill
        description: "带引号的说明：还能含冒号"
        ---

        # 正文
        """)
        XCTAssertEqual(head["name"], "my-skill")
        XCTAssertEqual(head["description"], "带引号的说明：还能含冒号")
    }

    func testFrontmatterRequiresLeadingFence() {
        XCTAssertTrue(SkillAdmin.frontmatter("# 只有正文\nname: x").isEmpty)
    }

    func testFrontmatterStopsAtClosingFence() {
        let head = SkillAdmin.frontmatter("---\nname: a\n---\nname: b")
        XCTAssertEqual(head["name"], "a")
    }

    // MARK: - 清单

    func testListReportsMissingRequiredKeys() throws {
        try writeSkill("good", "---\nname: good\ndescription: 能用\n---\n正文")
        try writeSkill("broken", "---\nname: broken\n---\n正文")
        try writeSkill("nofence", "# 没有 frontmatter")
        try FileManager.default.createDirectory(
            at: home.appendingPathComponent("skills/not-a-skill"), withIntermediateDirectories: true,
        )

        let skills = SkillAdmin.list(in: home)
        XCTAssertEqual(skills.map(\.id), ["broken", "good", "nofence"]) // 按目录名排序，无 SKILL.md 的目录不列
        XCTAssertEqual(skills[0].missing, ["description"])
        XCTAssertEqual(skills[0].title, "broken")
        XCTAssertTrue(skills[1].missing.isEmpty)
        XCTAssertEqual(skills[1].detail, "能用")
        // 没有 frontmatter：标题回退目录名，两个必填键都算缺
        XCTAssertEqual(skills[2].title, "nofence")
        XCTAssertEqual(skills[2].missing, ["name", "description"])
    }

    func testManagedNamesCoverTheSkillsTheAppRewrites() {
        XCTAssertEqual(
            SkillAdmin.managedNames,
            ["deepdive-automation", "deepdive-evolution", "deepdive-session-memory"],
        )
    }

    // MARK: - 删除

    func testRemoveDeletesOnlyDirectChildWithManifest() throws {
        try writeSkill("mine", "---\nname: mine\ndescription: 自建\n---\n正文")
        let target = home.appendingPathComponent("skills/mine")

        XCTAssertNil(SkillAdmin.remove(directory: target.path, home: home))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
    }

    func testRemoveRefusesRootAndNestedAndManifestless() throws {
        try writeSkill("mine", "---\nname: mine\ndescription: 自建\n---\n正文")
        let nested = home.appendingPathComponent("skills/mine")
        try FileManager.default.createDirectory(at: nested.appendingPathComponent("inner"), withIntermediateDirectories: true)

        XCTAssertNotNil(SkillAdmin.remove(directory: home.appendingPathComponent("skills").path, home: home))
        XCTAssertNotNil(SkillAdmin.remove(directory: nested.appendingPathComponent("inner").path, home: home))
        XCTAssertNotNil(SkillAdmin.remove(directory: home.appendingPathComponent("skills/elsewhere").path, home: home))
        XCTAssertTrue(FileManager.default.fileExists(atPath: nested.path), "拒删时不许动到目录")
    }

    // MARK: - create

    func testCreateWritesSkillManifest() throws {
        XCTAssertNil(SkillAdmin.create(name: "my-skill", description: "带冒号：与引号\"的说明", home: home))
        let manifest = home.appendingPathComponent("skills/my-skill/SKILL.md")
        let text = try String(contentsOf: manifest, encoding: .utf8)
        // 写出去的 frontmatter 必须能被自己的解析器读回（含冒号与引号）
        let head = SkillAdmin.frontmatter(text)
        XCTAssertEqual(head["name"], "my-skill")
        XCTAssertEqual(head["description"], "带冒号：与引号\"的说明")
    }

    func testCreateRefusesDuplicatesReservedAndBadNames() throws {
        XCTAssertNil(SkillAdmin.create(name: "dup", description: "x", home: home))
        XCTAssertNotNil(SkillAdmin.create(name: "dup", description: "x", home: home))
        XCTAssertNotNil(SkillAdmin.create(name: "has/slash", description: "x", home: home))
        XCTAssertNotNil(SkillAdmin.create(name: "   ", description: "x", home: home))
        let reserved = try XCTUnwrap(SkillAdmin.managedNames.first)
        XCTAssertNotNil(SkillAdmin.create(name: reserved, description: "x", home: home))
    }
}
