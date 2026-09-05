import XCTest
@testable import DeepDive

/// 空间格图标探测：约定文件名优先级（icon > logo > favicon）、缺失回落
/// nil、超限文件跳过（WorkspaceIcon）。
final class WorkspaceIconTests: XCTestCase {
    private func tempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ws-icon-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func testPrefersIconPngOverLogo() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("logo".utf8).write(to: dir.appendingPathComponent("logo.png"))
        try Data("icon".utf8).write(to: dir.appendingPathComponent("icon.png"))
        let hit = WorkspaceIcon.probe(in: dir)
        XCTAssertEqual(hit?.data, Data("icon".utf8))
        XCTAssertEqual(hit?.mime, "image/png")
    }

    func testMissingIconsReturnNil() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertNil(WorkspaceIcon.probe(in: dir))
    }

    func testOversizedFileSkipped() throws {
        let dir = try tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data(count: WorkspaceIcon.maxBytes + 1).write(to: dir.appendingPathComponent("icon.png"))
        try Data("tiny".utf8).write(to: dir.appendingPathComponent("logo.svg"))
        let hit = WorkspaceIcon.probe(in: dir)
        XCTAssertEqual(hit?.mime, "image/svg+xml")
    }
}
