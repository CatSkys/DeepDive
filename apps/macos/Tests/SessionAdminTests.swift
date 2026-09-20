import XCTest
@testable import DeepDive

/// 会话维护（取消归档 / 删除）的纯函数与落账的钉子：
/// 只改该改的键、结构不符不写盘、删目录只认 sessions/<bucket>/<sessionId>、
/// 落账（下次启动空窗期）幂等且成功后清登记。
final class SessionAdminTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("session-admin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: home.appendingPathComponent("storages"), withIntermediateDirectories: true,
        )
        UserDefaults.standard.removeObject(forKey: "deepdive.pendingSessionAdmin")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
        UserDefaults.standard.removeObject(forKey: "deepdive.pendingSessionAdmin")
    }

    private func write(_ state: [String: Any], to name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: state)
        try data.write(to: home.appendingPathComponent("storages/\(name)"))
    }

    private func read(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: home.appendingPathComponent("storages/\(name)"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func makeSessionDir(_ id: String) throws -> URL {
        let dir = home.appendingPathComponent("sessions/--bucket--/\(id)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "log".write(to: dir.appendingPathComponent("session.v3.jsonl.zstd"), atomically: true, encoding: .utf8)
        return dir
    }

    /// 投影缓存文档（per-record：storages/session_projcache/sessions/<id>.json）。
    @discardableResult
    private func makeProjectionDoc(_ id: String) throws -> URL {
        let dir = home.appendingPathComponent("storages/session_projcache/sessions", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("\(id).json")
        try "{}".write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    private var workspaceState: [String: Any] {
        [
            "unit": ["name": "workspace", "version": 2],
            "global": ["initialized": true, "workspaceIds": ["w1"], "archivedSessionIds": ["a", "b", "c"]],
            "tables": ["sessions": ["keep": 1]],
        ]
    }

    // MARK: - 纯函数

    func testRemovingArchivedKeepsEverythingElse() throws {
        let next = try XCTUnwrap(SessionAdmin.removingArchived(["b"], from: workspaceState))
        let global = try XCTUnwrap(next["global"] as? [String: Any])
        XCTAssertEqual(global["archivedSessionIds"] as? [String], ["a", "c"])
        XCTAssertEqual(global["workspaceIds"] as? [String], ["w1"])
        XCTAssertNotNil(next["tables"])
    }

    func testSessionDirectoriesScansOneBucketLevel() throws {
        _ = try makeSessionDir("s1")
        _ = try makeSessionDir("s2")
        let hits = SessionAdmin.sessionDirectories(in: home, sessionIds: ["s1", "nope"])
        XCTAssertEqual(hits.map(\.lastPathComponent), ["s1"])
    }

    func testProjectionDocumentsMatchPerRecordLayoutOnly() throws {
        _ = try makeProjectionDoc("a")
        // 同名但非 json / 非目标 id 的一律不动
        let stray = home.appendingPathComponent("storages/session_projcache/sessions/a.txt")
        try "x".write(to: stray, atomically: true, encoding: .utf8)
        let hits = SessionAdmin.projectionDocuments(in: home, sessionIds: ["a", "ghost"])
        XCTAssertEqual(hits.map(\.lastPathComponent), ["a.json"])
    }

    // MARK: - 立即删目录（不重启引擎）

    func testDeleteDirectoriesIsImmediateAndIdempotentForMissing() throws {
        let dir = try makeSessionDir("x")
        let doc = try makeProjectionDoc("x")
        let result = SessionAdmin.deleteDirectories(sessionIds: ["x", "ghost"], home: home)
        XCTAssertEqual(result.error, nil)   // 不存在的 id 不算错
        XCTAssertEqual(result.removed, ["x"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: doc.path))
    }

    // MARK: - 下次启动空窗期落账

    func testApplyPendingWritesArchiveAndProjectionAndClearsPending() throws {
        try write(workspaceState, to: "workspace.json")
        let doc = try makeProjectionDoc("a")
        let keep = try makeProjectionDoc("z")
        let dir = try makeSessionDir("a")
        SessionAdmin.remember(unarchived: ["a", "b"], removed: ["a"])
        let result = try XCTUnwrap(SessionAdmin.applyPending(home: home))
        XCTAssertEqual(result.error, nil)
        XCTAssertEqual(result.removed, ["a"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
        let global = try XCTUnwrap(try read("workspace.json")["global"] as? [String: Any])
        XCTAssertEqual(global["archivedSessionIds"] as? [String], ["c"])   // a、b 都摘掉
        XCTAssertFalse(FileManager.default.fileExists(atPath: doc.path))   // 投影文档随删除一起走
        XCTAssertTrue(FileManager.default.fileExists(atPath: keep.path))
        // 落账后清登记：下一次启动不再重复处理
        XCTAssertNil(SessionAdmin.applyPending(home: home))
    }

    func testApplyPendingRefusesUnexpectedShapeAndKeepsPending() throws {
        try write(["global": "not-an-object"], to: "workspace.json")
        SessionAdmin.remember(unarchived: ["a"], removed: [])
        let result = try XCTUnwrap(SessionAdmin.applyPending(home: home))
        XCTAssertNotNil(result.error)
        XCTAssertEqual(try read("workspace.json")["global"] as? String, "not-an-object")  // 不写盘
        XCTAssertNotNil(SessionAdmin.applyPending(home: home))                            // 登记未清，下轮再试
    }
}
