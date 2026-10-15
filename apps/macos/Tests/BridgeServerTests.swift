import XCTest
@testable import DeepDive

/// 静态文件服务的路径穿越守卫（R-002）：先 percent-decode 再标准化再前缀
/// 检查，编码或裸 `../` 都不得逃出 web root。
final class BridgeServerTests: XCTestCase {
    let root = URL(fileURLWithPath: "/tmp/deepdive-static-root", isDirectory: true).standardizedFileURL

    func testResolvesIndexAndAssets() throws {
        let index = try XCTUnwrap(BridgeServer.staticFileURL(for: "/", root: root))
        XCTAssertEqual(index.decoded, "/index.html")
        XCTAssertEqual(index.url.lastPathComponent, "index.html")
        let asset = try XCTUnwrap(BridgeServer.staticFileURL(for: "/assets/app.js", root: root))
        XCTAssertEqual(asset.url.path, root.appendingPathComponent("assets/app.js").standardizedFileURL.path)
    }

    func testRejectsTraversal() {
        XCTAssertNil(BridgeServer.staticFileURL(for: "/../secret.txt", root: root))
        XCTAssertNil(BridgeServer.staticFileURL(for: "/%2e%2e/secret.txt", root: root))  // 编码点号
        XCTAssertNil(BridgeServer.staticFileURL(for: "/foo/../../secret.txt", root: root))
        XCTAssertNil(BridgeServer.staticFileURL(for: "/..", root: root))
    }
}
