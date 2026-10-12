import XCTest
@testable import DeepDive

/// 审查面板的 git 解析层：porcelain v2 与 numstat 的 `-z` 记录形态、未跟踪文件的
/// 行数与二进制判定。取数层（fetchChanges/fetchDiff）要真仓库，不在这里覆盖。
final class GitChangesTests: XCTestCase {
    // MARK: - porcelain v2

    func testUnstagedModificationIncluded() {
        let out = GitChanges.parseStatusPorcelain("1 .M N... 100644 100644 100644 aaa bbb src/a.ts\0")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].kind, .modified)
        XCTAssertTrue(out[0].unstaged)
        XCTAssertEqual(out[0].path, "src/a.ts")
        XCTAssertNil(out[0].originalPath)
    }

    /// 纯暂存（X 动、Y 是 "."）不进未暂存档——那是「已暂存」档的将来。
    func testStagedOnlyExcluded() {
        let out = GitChanges.parseStatusPorcelain("1 M. N... 100644 100644 100644 aaa bbb src/a.ts\0")
        XCTAssertEqual(out.count, 1)
        XCTAssertFalse(out[0].unstaged)
    }

    /// 重命名：`-z` 下原路径是紧随其后的独立 NUL 字段，不在记录里。
    func testRenameTakesNextFieldAsOriginalPath() {
        let out = GitChanges.parseStatusPorcelain(
            "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\0old.ts\0")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].kind, .renamed)
        XCTAssertEqual(out[0].path, "new.ts")
        XCTAssertEqual(out[0].originalPath, "old.ts")
        XCTAssertFalse(out[0].unstaged)
    }

    func testUntrackedAlwaysUnstaged() {
        let out = GitChanges.parseStatusPorcelain("? fresh.ts\0")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].kind, .untracked)
        XCTAssertTrue(out[0].unstaged)
    }

    func testUnmergedIsConflicted() {
        let out = GitChanges.parseStatusPorcelain(
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/a.ts\0")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].kind, .conflicted)
        XCTAssertEqual(out[0].path, "src/a.ts")
    }

    /// `-z` 下路径不加引号，空格是字面量——切分限量才不会把索引切错。
    func testPathWithSpacesKeptWhole() {
        let out = GitChanges.parseStatusPorcelain("1 .M N... 100644 100644 100644 aaa bbb my docs/a b.ts\0")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].path, "my docs/a b.ts")
    }

    func testMultipleRecordsParsedInOrder() {
        let out = GitChanges.parseStatusPorcelain(
            "1 .M N... 100644 100644 100644 aaa bbb b.ts\0? a.ts\0")
        XCTAssertEqual(out.map(\.path), ["b.ts", "a.ts"])
    }

    // MARK: - numstat

    func testNumstatCounts() {
        let out = GitChanges.parseNumstat("20\t4\tfrontend/src/rich/sanitizeSvg.ts\0")
        XCTAssertEqual(out["frontend/src/rich/sanitizeSvg.ts"],
                       GitChanges.LineCount(added: 20, removed: 4, binary: false))
    }

    /// 二进制两列是 "-"，记 0 并置 binary（否则 UI 上会挂一个假的 "+0 −0"）。
    func testNumstatBinaryZeroed() {
        let out = GitChanges.parseNumstat("-\t-\tassets/logo.png\0")
        XCTAssertEqual(out["assets/logo.png"],
                       GitChanges.LineCount(added: 0, removed: 0, binary: true))
    }

    /// 重命名时路径字段为空，preimage/postimage 紧随其后；键取 postimage。
    func testNumstatRenameKeyedByPostimage() {
        let out = GitChanges.parseNumstat("3\t1\t\0old.ts\0new.ts\07\t0\tother.ts\0")
        XCTAssertEqual(out["new.ts"], GitChanges.LineCount(added: 3, removed: 1, binary: false))
        XCTAssertEqual(out["other.ts"], GitChanges.LineCount(added: 7, removed: 0, binary: false))
        XCTAssertNil(out["old.ts"])
    }

    func testNumstatValueCoercesNonNumeric() {
        XCTAssertEqual(GitChanges.numstatValue("-"), 0)
        XCTAssertEqual(GitChanges.numstatValue("12"), 12)
        XCTAssertEqual(GitChanges.numstatValue("?"), 0)
    }

    // MARK: - 未跟踪文件行数

    private func tempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("git-changes-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func testUntrackedLineCount() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("a.ts")
        try Data("one\ntwo\nthree\n".utf8).write(to: file)
        // 结尾换行是终止符，不算一行
        XCTAssertEqual(GitChanges.countUntrackedLines(at: file.path),
                       GitChanges.LineCount(added: 3, removed: 0, binary: false))

        try Data("one\ntwo".utf8).write(to: file) // 无结尾换行
        XCTAssertEqual(GitChanges.countUntrackedLines(at: file.path).added, 2)
    }

    /// 空文件是合法的空文本文件，0 行且**不是**二进制。
    func testEmptyUntrackedIsNotBinary() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("empty.ts")
        try Data().write(to: file)
        XCTAssertEqual(GitChanges.countUntrackedLines(at: file.path),
                       GitChanges.LineCount(added: 0, removed: 0, binary: false))
    }

    func testNullByteIsBinary() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("logo.png")
        try Data([0x89, 0x50, 0x00, 0x4E]).write(to: file)
        XCTAssertEqual(GitChanges.countUntrackedLines(at: file.path),
                       GitChanges.LineCount(added: 0, removed: 0, binary: true))
    }

    func testOversizedUntrackedTreatedAsBinary() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("big.bin")
        try Data(count: GitChanges.maxFileBytes + 1).write(to: file)
        XCTAssertTrue(GitChanges.countUntrackedLines(at: file.path).binary)
    }

    // MARK: - 取数层（真仓库）

    /// 跑一条 git 并在非零退出时带出 stderr——否则 seed 失败会表现成一堆莫名其妙的断言。
    @discardableResult
    private func git(_ args: [String], in dir: URL) -> String {
        let r = ProcessRunner.run(executable: "/usr/bin/git", arguments: args, workingDirectory: dir.path)
        XCTAssertEqual(r.status, 0, "git \(args) failed: \(r.output)")
        return r.output
    }

    /// fetchChanges 偶发 nil 的诊断锚（2026-10-12）：失败时带出**重跑**的 rev-parse
    /// 结果——概率性 nil（spawn 失败被记成 status -1 / git 闪失）的第一现场，省掉
    /// 下一次"凭空 nil"的排查；成功路径零成本。别在失败信息里只说"非 nil"。
    private func fetchChangesDiagnosed(_ path: String) -> GitChanges.ChangeSet? {
        let set = GitChanges.fetchChanges(at: path)
        if set == nil {
            let r = ProcessRunner.run(executable: GitChanges.executable,
                                      arguments: ["rev-parse", "--abbrev-ref", "HEAD"],
                                      workingDirectory: path, timeout: 10)
            XCTFail("fetchChanges 返回 nil；重跑 rev-parse：status=\(r.status) timedOut=\(r.timedOut) out=\(r.output.prefix(200))")
        }
        return set
    }

    /// 解析 fixture 盖不到命令接线那半：真跑一遍 git，验证 porcelain v2 与
    /// numstat 的 `-z` 记录形态、以及「未暂存」筛的是 Y 位。只用 init/add/status/
    /// diff ——都不需要 git 身份，机器上没配 user.name 也能跑。
    private func seedRepo() throws -> URL {
        let dir = try tempDir()
        git(["init", "-q", "."], in: dir)
        git(["add", "-A"], in: dir)
        for (name, body) in [("keep.ts", "a\nb\nc\n"), ("gone.ts", "x\n")] {
            try Data(body.utf8).write(to: dir.appendingPathComponent(name))
        }
        git(["add", "-A"], in: dir)
        git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], in: dir)
        return dir
    }

    func testFetchChangesOnlyReturnsUnstagedBucket() throws {
        let dir = try seedRepo()
        defer { try? FileManager.default.removeItem(at: dir) }
        // 改一个已跟踪文件 + 删一个 + 新增一个未跟踪文件
        try Data("a\nB\nc\n".utf8).write(to: dir.appendingPathComponent("keep.ts"))
        try FileManager.default.removeItem(at: dir.appendingPathComponent("gone.ts"))
        try Data("n\ne\nw\n".utf8).write(to: dir.appendingPathComponent("fresh.ts"))

        let set = try XCTUnwrap(fetchChangesDiagnosed(dir.path))
        XCTAssertFalse(set.branch.isEmpty)
        let byPath = Dictionary(uniqueKeysWithValues: set.files.map { ($0.path, $0) })
        XCTAssertEqual(Set(byPath.keys), ["keep.ts", "gone.ts", "fresh.ts"])
        XCTAssertEqual(byPath["keep.ts"]?.kind, .modified)
        XCTAssertEqual(byPath["keep.ts"]?.added, 1)
        XCTAssertEqual(byPath["keep.ts"]?.removed, 1)
        XCTAssertEqual(byPath["gone.ts"]?.kind, .deleted)
        // 未跟踪没有 numstat 条目，+N 由壳侧数行得出（内容 3 行）
        XCTAssertEqual(byPath["fresh.ts"]?.kind, .untracked)
        XCTAssertEqual(byPath["fresh.ts"]?.added, 3)
    }

    func testFetchChangesSkipsStagedOnlyFiles() throws {
        let dir = try seedRepo()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("a\nB\nc\n".utf8).write(to: dir.appendingPathComponent("keep.ts"))
        git(["add", "keep.ts"], in: dir)

        let set = try XCTUnwrap(fetchChangesDiagnosed(dir.path))
        // 改动已进索引，worktree 相对索引没变 → 不属于「未暂存」档
        XCTAssertTrue(set.files.isEmpty, "staged-only files leaked into the unstaged bucket")
    }

    func testFetchDiffKinds() throws {
        let dir = try seedRepo()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("a\nB\nc\n".utf8).write(to: dir.appendingPathComponent("keep.ts"))
        try Data("n\ne\nw\n".utf8).write(to: dir.appendingPathComponent("fresh.ts"))
        try Data([0x89, 0x50, 0x00, 0x4E]).write(to: dir.appendingPathComponent("logo.png"))

        let tracked = GitChanges.fetchDiff(at: dir.path, file: "keep.ts")
        XCTAssertEqual(tracked.kind, .patch)
        XCTAssertTrue(tracked.patch?.contains("@@") == true)
        // patch 里没有未改动行，正文靠 content 补
        XCTAssertEqual(tracked.content, "a\nB\nc\n")

        let untracked = GitChanges.fetchDiff(at: dir.path, file: "fresh.ts")
        XCTAssertEqual(untracked.kind, .untracked)
        XCTAssertEqual(untracked.content, "n\ne\nw\n")

        let binary = GitChanges.fetchDiff(at: dir.path, file: "logo.png")
        XCTAssertEqual(binary.kind, .binary)
    }

    func testFetchChangesOnNonRepoIsNil() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertNil(GitChanges.fetchChanges(at: dir.path))
        XCTAssertNil(GitChanges.fetchChanges(at: "/nonexistent/path"))
    }

    func testMissingFileTreatedAsBinary() {
        XCTAssertTrue(GitChanges.countUntrackedLines(at: "/nonexistent/nope.ts").binary)
    }
}
