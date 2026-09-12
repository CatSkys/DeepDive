import XCTest
@testable import DeepDive

/// 会话维护（取消归档 / 删除）的纯函数钉子：只改该改的键、结构不符不写、
/// 删目录只认 sessions/<bucket>/<sessionId> 这一层。
final class SessionAdminTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("session-admin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: home.appendingPathComponent("storages"), withIntermediateDirectories: true,
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private func write(_ state: [String: Any], to name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: state)
        try data.write(to: home.appendingPathComponent("storages/\(name)"))
    }

    private func read(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: home.appendingPathComponent("storages/\(name)"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private var workspaceState: [String: Any] {
        [
            "unit": ["name": "workspace", "version": 2],
            "global": ["initialized": true, "workspaceIds": ["w1"], "archivedSessionIds": ["a", "b", "c"]],
            "tables": ["sessions": ["keep": 1]],
        ]
    }

    // MARK: - 取消归档

    func testRemovingArchivedKeepsEverythingElse() throws {
        let next = try XCTUnwrap(SessionAdmin.removingArchived(["b"], from: workspaceState))
        let global = try XCTUnwrap(next["global"] as? [String: Any])
        XCTAssertEqual(global["archivedSessionIds"] as? [String], ["a", "c"])
        XCTAssertEqual(global["workspaceIds"] as? [String], ["w1"])
        XCTAssertEqual(next["tables"] as? [String: Any]? != nil, true)
    }

    func testUnarchiveWritesBackToDisk() throws {
        try write(workspaceState, to: "workspace.json")
        let result = SessionAdmin.unarchive(sessionIds: ["a", "c"], home: home)
        XCTAssertEqual(result.error, nil)
        XCTAssertEqual(Set(result.removed), ["a", "c"])
        let global = try XCTUnwrap(try read("workspace.json")["global"] as? [String: Any])
        XCTAssertEqual(global["archivedSessionIds"] as? [String], ["b"])
    }

    func testUnarchiveRefusesUnexpectedShape() throws {
        try write(["global": "not-an-object"], to: "workspace.json")
        let result = SessionAdmin.unarchive(sessionIds: ["a"], home: home)
        XCTAssertNotNil(result.error)
        XCTAssertTrue(result.removed.isEmpty)
        // 不写盘：原文件保持原样
        XCTAssertEqual(try read("workspace.json")["global"] as? String, "not-an-object")
    }

    // MARK: - 删除

    func testRemovingProjectionsToleratesMissingSessionsTable() {
        let state: [String: Any] = ["tables": [:]]
        XCTAssertEqual(SessionAdmin.removingProjections(["a"], from: state)?["tables"] as? [String: Any] != nil, true)
        XCTAssertNil(SessionAdmin.removingProjections(["a"], from: ["tables": "nope"]))
    }

    func testSessionDirectoriesScansOneBucketLevel() throws {
        let bucket = home.appendingPathComponent("sessions/--Users-x-proj--/s1", isDirectory: true)
        try FileManager.default.createDirectory(at: bucket, withIntermediateDirectories: true)
        let other = home.appendingPathComponent("sessions/--Users-x-proj--/s2", isDirectory: true)
        try FileManager.default.createDirectory(at: other, withIntermediateDirectories: true)
        let hits = SessionAdmin.sessionDirectories(in: home, sessionIds: ["s1", "nope"])
        XCTAssertEqual(hits.map(\.lastPathComponent), ["s1"])
    }

    func testDeleteRemovesLogDirectoryAndArchiveEntry() throws {
        try write(workspaceState, to: "workspace.json")
        try write(["tables": ["sessions": ["a": ["identity": [:] as [String: Any]], "z": 1]]], to: "session_projcache.json")
        let dir = home.appendingPathComponent("sessions/--bucket--/a", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "log".write(to: dir.appendingPathComponent("session.v3.jsonl.zstd"), atomically: true, encoding: .utf8)

        let result = SessionAdmin.delete(sessionIds: ["a"], home: home)
        XCTAssertEqual(result.error, nil)
        XCTAssertEqual(result.removed, ["a"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
        let global = try XCTUnwrap(try read("workspace.json")["global"] as? [String: Any])
        XCTAssertEqual(global["archivedSessionIds"] as? [String], ["b", "c"])
        let sessions = try XCTUnwrap((try read("session_projcache.json")["tables"] as? [String: Any])?["sessions"] as? [String: Any])
        XCTAssertNil(sessions["a"])
        XCTAssertNotNil(sessions["z"])
    }
}
