import XCTest
@testable import DeepDive

/// 工作树管理面的钉子：porcelain 解析（多条目、detached、prunable/locked、branch 缺席）
/// 与两条 git 参数（新建带 -b；删除**不带 --force**）。夹具取自实机输出形状。
final class WorktreeAdminTests: XCTestCase {
    func testParseSingleEntry() {
        let text = """
        worktree /Users/me/proj
        HEAD 86ae71de2cb12c30fd86cbd1ee328ff2c76c12d7
        branch refs/heads/main

        """
        let list = WorktreeAdmin.parsePorcelain(text)
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0].path, "/Users/me/proj")
        XCTAssertEqual(list[0].head, "86ae71d")   // 只留短 id
        XCTAssertEqual(list[0].branch, "main")
        XCTAssertFalse(list[0].detached)
    }

    func testParseDetachedLockedPrunableAndMissingBranch() {
        let text = """
        worktree /Users/me/proj
        HEAD aaaa1111
        branch refs/heads/feature-x
        locked

        worktree /Users/me/proj-wt
        HEAD bbbb2222
        detached
        locked reason from user

        worktree /Users/me/gone
        HEAD cccc3333
        branch refs/heads/old
        prunable gitdir file points to non-existent location

        """
        let list = WorktreeAdmin.parsePorcelain(text)
        XCTAssertEqual(list.count, 3)
        XCTAssertEqual(list[0].branch, "feature-x")
        XCTAssertTrue(list[0].locked)
        XCTAssertTrue(list[1].detached)
        XCTAssertEqual(list[1].branch, "", "detached 没有 branch 行")
        XCTAssertTrue(list[2].prunable)
        XCTAssertEqual(list[2].branch, "old")
    }

    func testParseIgnoresUnknownKeysAndEmptyInput() {
        XCTAssertTrue(WorktreeAdmin.parsePorcelain("").isEmpty)
        let list = WorktreeAdmin.parsePorcelain("worktree /p\nHEAD 1\nsome-future-key value\n\n")
        XCTAssertEqual(list.map(\.path), ["/p"])
    }

    func testArguments() {
        XCTAssertEqual(
            WorktreeAdmin.addArguments(branch: "feat/x", path: "/tmp/repo-feat"),
            ["worktree", "add", "-b", "feat/x", "/tmp/repo-feat"],
        )
        // 不带 --force：工作树里有未提交改动时让 git 拒绝，不静默丢改动
        XCTAssertEqual(WorktreeAdmin.removeArguments(path: "/tmp/repo-feat"), ["worktree", "remove", "/tmp/repo-feat"])
    }
}
