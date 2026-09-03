import XCTest
@testable import DeepDive

/// 设置面板的动态 JSON 树：路径读写与 diff→ops（R-002）。ops 只触碰用户
/// 真正改到的路径是 settings.update 防串写的前提（SPEC-SETTINGS §3.2）。
final class JSONValueTests: XCTestCase {
    let doc: JSONValue = .object([
        "provider": .string("deepseek"),
        "count": .int(3),
        "ratio": .double(0.5),
        "enabled": .bool(true),
        "nested": .object(["a": .object(["b": .int(1)])]),
        "items": .array([.string("x"), .string("y")]),
    ])

    func testAt() {
        XCTAssertEqual(doc.at("provider"), .string("deepseek"))
        XCTAssertEqual(doc.at("nested.a.b"), .int(1))
        XCTAssertEqual(doc.at("items.1"), .string("y"))
        XCTAssertNil(doc.at("items.2"))       // 数组越界
        XCTAssertNil(doc.at("nested.a.z"))    // 缺键
        XCTAssertNil(doc.at("provider.x"))    // 标量下继续取路径
    }

    func testSettingCreatesPathAndKeepsSiblings() {
        let updated = doc.setting("nested.a.c", to: .int(9))
        XCTAssertEqual(updated.at("nested.a.c"), .int(9))
        XCTAssertEqual(updated.at("nested.a.b"), .int(1))
        XCTAssertEqual(updated.at("count"), .int(3))
        let fresh = JSONValue.object([:]).setting("x.y", to: .bool(true))
        XCTAssertEqual(fresh.at("x.y"), .bool(true))
    }

    func testDiffOpsOnlyTouchesChangedPaths() {
        let new = doc
            .setting("count", to: .int(4))      // 叶子改动 → set
            .unsetting("ratio")                  // 删除 → unset
            .setting("nested.a.b", to: .int(2))  // 深层叶子改动 → set 在叶子上
        let ops = JSONValue.diffOps(from: doc, to: new)
        let setPaths = Set(ops.filter { ($0["op"] as? String) == "set" }.compactMap { $0["path"] as? String })
        let unsetPaths = Set(ops.filter { ($0["op"] as? String) == "unset" }.compactMap { $0["path"] as? String })
        XCTAssertEqual(setPaths, ["count", "nested.a.b"])
        XCTAssertEqual(unsetPaths, ["ratio"])
    }

    func testDiffOpsIdenticalIsEmpty() {
        XCTAssertTrue(JSONValue.diffOps(from: doc, to: doc).isEmpty)
    }

    func testDiffReplacesArrayWhole() {
        let old = JSONValue.object(["items": .array([.int(1), .int(2)])])
        let new = JSONValue.object(["items": .array([.int(1), .int(3)])])
        let ops = JSONValue.diffOps(from: old, to: new)
        XCTAssertEqual(ops.count, 1)
        XCTAssertEqual(ops[0]["op"] as? String, "set")
        XCTAssertEqual(ops[0]["path"] as? String, "items")
    }

    func testInitDistinguishesBoolIntDouble() throws {
        let v = try JSONValue(data: Data(#"{"b":true,"i":1,"d":0.5,"n":null}"#.utf8))
        XCTAssertEqual(v.at("b"), .bool(true))
        XCTAssertEqual(v.at("i"), .int(1))
        XCTAssertEqual(v.at("d"), .double(0.5))
        XCTAssertEqual(v.at("n"), .null)
    }
}
