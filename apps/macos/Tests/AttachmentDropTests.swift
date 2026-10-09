// 前端拿不到路径，附件路径只能由壳读拖放板给出（`TitlebarAwareWebView`）——选择器与拖入
// 共用同一份载荷构造（`AppDelegate.attachmentItems`），这一条钉住它的形状：
// 图片带字节（≤ 内联上限）才有 isImage+base64；其余（普通文件、文件夹）只有路径，
// **不带字节、也没有大小门槛**——它们在 SPA 侧是 @ 引用，引擎宿主读盘。
import XCTest
@testable import DeepDive

final class AttachmentDropTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-attach-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    func testPlainFileCarriesPathOnly() throws {
        let file = dir.appendingPathComponent("设计文档.mobi")
        try Data("hello".utf8).write(to: file)

        let items = AppDelegate.attachmentItems(for: [file])
        XCTAssertEqual(items.count, 1)
        let item = try XCTUnwrap(items.first)
        XCTAssertEqual(item["path"] as? String, file.path)
        XCTAssertEqual(item["name"] as? String, "设计文档.mobi")
        XCTAssertEqual(item["isDir"] as? Bool, false)
        // 非图片一律不带字节：它们是引用，不该有"太大"这一说
        XCTAssertNil(item["base64"])
        XCTAssertNil(item["isImage"])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(item))
    }

    func testDirectoryIsFlaggedAndCarriesNoBytes() throws {
        let sub = dir.appendingPathComponent("notes")
        try FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)

        let item = try XCTUnwrap(AppDelegate.attachmentItems(for: [sub]).first)
        XCTAssertEqual(item["isDir"] as? Bool, true)
        XCTAssertNil(item["base64"])
    }

    func testImageCarriesInlineBytes() throws {
        let png = dir.appendingPathComponent("shot.png")
        let bytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        try bytes.write(to: png)

        let item = try XCTUnwrap(AppDelegate.attachmentItems(for: [png]).first)
        XCTAssertEqual(item["isImage"] as? Bool, true)
        XCTAssertEqual((item["base64"] as? String).flatMap { Data(base64Encoded: $0) }, bytes)
    }

    func testMixedDropKeepsOrder() throws {
        let file = dir.appendingPathComponent("a.txt")
        try Data("a".utf8).write(to: file)
        let sub = dir.appendingPathComponent("docs", isDirectory: true)
        try FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)

        let items = AppDelegate.attachmentItems(for: [file, sub])
        XCTAssertEqual(items.compactMap { $0["name"] as? String }, ["a.txt", "docs"])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(items))
    }
}
