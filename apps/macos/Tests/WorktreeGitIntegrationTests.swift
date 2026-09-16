import XCTest
@testable import DeepDive

/// 工作树生命周期跑**真 git**（临时仓库）：验证 `addArguments`/`removeArguments` 拼出来的
/// 命令真的能被 git 接受、`parsePorcelain` 能读回 git 自己列出来的条目，以及删除在有未
/// 提交改动时确实被 git 拒绝（我们不带 --force 的那条纪律）。纯解析的单测在
/// `WorktreeAdminTests`，这里只钉"命令与真实 git 对得上"。
final class WorktreeGitIntegrationTests: XCTestCase {
    private var root: URL!
    private var repo: URL!

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("worktree-git-\(UUID().uuidString)", isDirectory: true)
        repo = root.appendingPathComponent("proj", isDirectory: true)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        try git(["init", "--quiet", "-b", "main"])
        try "hello\n".write(to: repo.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
        try git(["add", "README.md"])
        // 提交身份显式给，免得依赖这台机器的全局 git 配置
        try git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "--quiet", "-m", "init"])
    }

    override func tearDownWithError() throws {
        // 工作树可能还在仓库里注册着：先 prune 再删，免得 git 的元数据残留
        _ = try? git(["worktree", "prune"])
        try? FileManager.default.removeItem(at: root)
    }

    @discardableResult
    private func git(_ args: [String], in directory: URL? = nil, allowFailure: Bool = false) throws -> String {
        let result = ProcessRunner.run(
            executable: "/usr/bin/git", arguments: args, workingDirectory: (directory ?? repo).path,
        )
        if !allowFailure {
            XCTAssertEqual(result.status, 0, "git \(args.joined(separator: " ")) 失败：\(result.output)")
        }
        return result.output
    }

    func testAddListRemoveAgainstRealGit() throws {
        let tree = root.appendingPathComponent("proj-wt", isDirectory: true)
        XCTAssertEqual(
            WorktreeAdmin.addArguments(branch: "worktree-test", path: tree.path),
            ["worktree", "add", "-b", "worktree-test", tree.path],
        )
        try git(WorktreeAdmin.addArguments(branch: "worktree-test", path: tree.path))

        let listed = WorktreeAdmin.parsePorcelain(try git(["worktree", "list", "--porcelain"]))
        XCTAssertEqual(listed.count, 2, "主工作树 + 新建的那个：\(listed)")
        // git 回的是 realpath（/var → /private/var），所以按解析后的路径比对
        let real = { (path: String) in URL(fileURLWithPath: path).resolvingSymlinksInPath().path }
        XCTAssertEqual(real(listed[0].path), real(repo.path))
        XCTAssertEqual(listed[0].branch, "main")
        XCTAssertEqual(real(listed[1].path), real(tree.path))
        XCTAssertEqual(listed[1].branch, "worktree-test")
        XCTAssertEqual(listed[1].head.count, 7, "HEAD 收成短 id")
        XCTAssertFalse(listed[1].locked)

        try git(WorktreeAdmin.removeArguments(path: tree.path))
        XCTAssertEqual(WorktreeAdmin.parsePorcelain(try git(["worktree", "list", "--porcelain"])).count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: tree.path))
    }

    func testRemoveIsRefusedWhileTheWorktreeHasUncommittedChanges() throws {
        let tree = root.appendingPathComponent("proj-dirty", isDirectory: true)
        try git(WorktreeAdmin.addArguments(branch: "dirty-branch", path: tree.path))
        try "dirty\n".write(to: tree.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        let result = ProcessRunner.run(
            executable: "/usr/bin/git",
            arguments: WorktreeAdmin.removeArguments(path: tree.path),
            workingDirectory: repo.path,
        )
        XCTAssertNotEqual(result.status, 0, "有未提交改动时 git 必须拒绝（我们不带 --force）")
        XCTAssertTrue(result.output.contains("modified") || result.output.contains("untracked"), result.output)
        XCTAssertTrue(FileManager.default.fileExists(atPath: tree.path), "拒绝之后工作树还在")
    }
}
