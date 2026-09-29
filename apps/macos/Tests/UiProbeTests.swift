import XCTest
@testable import DeepDive

/// 量化探针（TODO §19）：闸门与"只回数据"两件事要能机械地守住。
/// 真窗口里量得到量不到由实机自证，单测只钉住不依赖窗口的那部分。
final class UiProbeTests: XCTestCase {
    private func probeRequest(body: String, token: String?) -> MiniHTTPServer.Request {
        MiniHTTPServer.Request(
            method: "POST",
            path: "/__probe",
            query: "",
            headers: token.map { ["authorization": "Bearer \($0)"] } ?? [:],
            body: Data(body.utf8),
            rawHead: Data()
        )
    }

    private func withProvider(_ body: @escaping ([String], [String], @escaping (String?) -> Void) -> Void,
                              _ test: () throws -> Void) rethrows {
        UiProbe.measureProvider = body
        defer { UiProbe.measureProvider = nil }
        try test()
    }

    /// handle 会派发到主线程再等结果（provider 异步），所以调用方必须在主线程之外——
    /// 桥的连接线程天然满足，单测宿主是主线程，得自己借一条。
    private func offMain(_ body: @escaping () -> Void) {
        let finished = expectation(description: "off-main")
        DispatchQueue.global().async {
            body()
            finished.fulfill()
        }
        wait(for: [finished], timeout: 10)
    }

    func testRejectsMissingOrWrongToken() {
        XCTAssertEqual(UiProbe.handle(probeRequest(body: #"{"selectors":[".a"]}"#, token: nil)).status, 403)
        XCTAssertEqual(UiProbe.handle(probeRequest(body: #"{"selectors":[".a"]}"#, token: "nope")).status, 403)
    }

    func testReportsUnavailableWhenNoWindowInstalled() {
        // provider 没装（窗口控制器还没建）时按"取不到"回：不能崩，也不能空回 200。
        // 注意测试宿主就是真实 App，真跑起来时窗口控制器已经把 provider 装上了，
        // 所以这里要显式摘掉再验（用完装回去，别影响后面的用例）。
        let installed = UiProbe.measureProvider
        UiProbe.measureProvider = nil
        defer { UiProbe.measureProvider = installed }
        let response = UiProbe.handle(probeRequest(body: #"{"selectors":[".a"]}"#, token: UiProbe.token))
        XCTAssertEqual(response.status, 503)
    }

    func testPassesOnlySelectorsAndPropsThrough() {
        var seen: [(selectors: [String], props: [String])] = []
        var status = 0
        withProvider({ selectors, props, done in
            seen.append((selectors, props))
            done(#"{"ok":true,"native":{},"nodes":[]}"#)
        }) {
            offMain {
                status = UiProbe.handle(self.probeRequest(
                    body: #"{"selectors":[".a",".b"],"props":["width"]}"#, token: UiProbe.token)).status
            }
        }
        XCTAssertEqual(status, 200)
        XCTAssertEqual(seen.count, 1)
        XCTAssertEqual(seen[0].selectors, [".a", ".b"])
        XCTAssertEqual(seen[0].props, ["width"])
    }

    func testCapsSelectorCount() {
        var count = 0
        withProvider({ selectors, _, done in
            count = selectors.count
            done(#"{"ok":true,"native":{},"nodes":[]}"#)
        }) {
            offMain {
                let many = (0..<64).map { ".s\($0)" }
                let body = String(decoding: try! JSONSerialization.data(withJSONObject: ["selectors": many]), as: UTF8.self)
                _ = UiProbe.handle(self.probeRequest(body: body, token: UiProbe.token))
            }
        }
        XCTAssertEqual(count, 32, "选择器数要有上限：这是量界面的口，不是批处理口")
    }

    func testRejectsEmptySelectorList() {
        // 空选择器不该白跑一趟 provider
        var called = false
        withProvider({ _, _, done in called = true; done("{}") }) {
            offMain { _ = UiProbe.handle(self.probeRequest(body: #"{"selectors":[]}"#, token: UiProbe.token)) }
        }
        XCTAssertFalse(called)
    }

    /// 脚本必须只量不改：出现动作类调用就说明有人往里塞了行为。
    func testScriptIsReadOnly() throws {
        let js = try XCTUnwrap(UiProbe.script(selectors: [".a"], props: ["width"]))
        for forbidden in ["click(", "dispatchEvent", "location", "fetch(", "eval("] {
            XCTAssertFalse(js.contains(forbidden), "取数脚本里不该出现 \(forbidden)")
        }
        XCTAssertTrue(js.contains("getBoundingClientRect"))
        XCTAssertTrue(js.contains("getComputedStyle"))
    }

    /// 选择器是内联进脚本的 JSON 字面量：带引号的输入必须被转义进字符串里，
    /// 断言的是"引号被转义了"（`\"` 出现在载荷之前），而不是"载荷消失了"——
    /// 载荷本身当然还在字符串里，只是变成了惰性的数据。
    func testScriptEscapesSelectors() throws {
        let js = try XCTUnwrap(UiProbe.script(selectors: ["\"; alert(1); //"], props: ["width"]))
        // JSONSerialization 还会把 / 转义成 \/，所以只断言到分号为止
        XCTAssertTrue(js.contains("\\\"; alert(1);"), "引号应被 JSON 转义进字符串字面量")
    }
}
