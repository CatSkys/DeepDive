import XCTest
@testable import DeepDive

/// 引擎版本门（SPEC-ENGINE-RUNTIME §3.4）：非 bundled 入口的版本一致性判定与
/// 版本探测解析。门本身是纯函数，独立钉住；pin 的来源（随包资源）另有一例。
final class EngineVersionTests: XCTestCase {
    /// 会话格式 V3 单行道：异版本外部入口必须被拒，文案要同时给出两侧版本，
    /// 用户才知道该装回哪一个。
    func testGateRejectsMismatchedExternalVersion() throws {
        let copy = try XCTUnwrap(EngineVersion.gateNonBundled(pin: "1.2.3", found: "1.1.1", path: "/opt/homebrew/bin/dsh"))
        XCTAssertTrue(copy.contains("1.1.1"))
        XCTAssertTrue(copy.contains("1.2.3"))
        XCTAssertTrue(copy.contains("/opt/homebrew/bin/dsh"))
    }

    func testGateAllowsMatchingExternalVersion() {
        XCTAssertNil(EngineVersion.gateNonBundled(pin: "1.2.3", found: "1.2.3", path: "/usr/local/bin/dsh"))
    }

    /// 未嵌入引擎的构建（make dev）没有 pin 可比：不设门，交开发流程自理
    /// （对照实验隔离走 DSHMINI_SUPPORT_DIR）。
    func testGateSkippedWithoutPinnedVersion() {
        XCTAssertNil(EngineVersion.gateNonBundled(pin: nil, found: "1.1.1", path: "/opt/homebrew/bin/dsh"))
        XCTAssertNil(EngineVersion.gateNonBundled(pin: "", found: nil, path: "/opt/homebrew/bin/dsh"))
    }

    /// `--version` 跑不出结果（非 dsh、挂了、超时）同样按拒启处理：无法识别
    /// 版本的入口不得去开 V3 home。
    func testGateRejectsUnknownExternalVersion() throws {
        let copy = try XCTUnwrap(EngineVersion.gateNonBundled(pin: "1.2.3", found: nil, path: "/usr/local/bin/dsh"))
        XCTAssertTrue(copy.contains("/usr/local/bin/dsh"))
        XCTAssertTrue(copy.contains("1.2.3"))
    }

    /// 随包 pin 来自 project.yml 的资源拷贝（scripts/dsh-runtime-version.txt）：
    /// 漏挂或留空都会让版本门静默失效，故断言存在且形如版本号（不内联具体值，
    /// 版本号的事实源始终是引脚文件）。
    func testAppBundleCarriesPinnedVersion() throws {
        let pin = try XCTUnwrap(EngineVersion.pinnedVersion, "随包 pin 缺失：检查 project.yml 的资源拷贝")
        XCTAssertNotNil(pin.range(of: #"^\d+\.\d+"#, options: .regularExpression), "pin 不像版本号：\(pin)")
    }

    /// 探索解析：dsh 把版本打到 stderr、node bin.js 打到 stdout，两路合并后
    /// 顺序不保证；警告行在前时不能被当成版本号。
    func testProbeParsesVersionTokenFromNoisyOutput() throws {
        let script = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dsh-probe-\(UUID().uuidString)")
        try "#!/bin/sh\necho 'npm warn deprecated' >&2\necho '0.0.0-probe'\n".write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        defer { try? FileManager.default.removeItem(at: script) }

        XCTAssertEqual(EngineVersion.probeExecutableVersion(script), "0.0.0-probe")
    }

    func testProbeReturnsNilForUnrunnableEntry() {
        XCTAssertNil(EngineVersion.probeExecutableVersion(URL(fileURLWithPath: "/nonexistent/dsh-probe")))
    }
}
