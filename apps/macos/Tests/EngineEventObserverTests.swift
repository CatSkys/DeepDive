import XCTest
@testable import DeepDive

/// 0.1.2 wire 纯函数语义钉（EngineEventObserver）：
/// ①api-session/status 的 args 形状 [sessionId, running]；
/// ②waterfall 帧身份三元组 event/eventId/agentId——挂起集合与 cancel 帧
/// 统一以 eventId 配对（旧 rc.2 的信封 rpcId 配对语义已随协议消亡）。
final class EngineEventObserverTests: XCTestCase {
    // MARK: - statusArgs

    func testStatusArgsParsesSessionIdAndRunning() {
        let parsed = EngineEventObserver.statusArgs(["s1", true])
        XCTAssertEqual(parsed?.sessionId, "s1")
        XCTAssertEqual(parsed?.running, true)
        XCTAssertEqual(EngineEventObserver.statusArgs(["s2", false])?.running, false)
    }

    func testStatusArgsRejectsMalformedShapesWithoutGuessing() {
        XCTAssertNil(EngineEventObserver.statusArgs([]))
        XCTAssertNil(EngineEventObserver.statusArgs(["s1"])) // 缺 running
        XCTAssertNil(EngineEventObserver.statusArgs(["s1", "yes"])) // 非布尔
        XCTAssertNil(EngineEventObserver.statusArgs([42, true])) // 非字符串 id
    }

    // MARK: - waterfallIdentity

    func testWaterfallIdentityExtractsEventEventIdAndAgentId() {
        let frame: [String: Any] = [
            "type": "waterfall", "event": "approval/request",
            "eventId": "ev-1", "agentId": "s1",
            "request": ["toolName": "Bash"],
        ]
        let identity = EngineEventObserver.waterfallIdentity(frame)
        XCTAssertEqual(identity?.event, "approval/request")
        XCTAssertEqual(identity?.eventId, "ev-1")
        XCTAssertEqual(identity?.sessionId, "s1")
    }

    func testWaterfallIdentityReturnsNilOnMissingFields() {
        // 缺任一身份字段 → nil（调用方 return），绝不以兜底值掩盖漂移
        XCTAssertNil(EngineEventObserver.waterfallIdentity(["event": "approval/request", "eventId": "ev-1"]))
        XCTAssertNil(EngineEventObserver.waterfallIdentity(["event": "approval/request", "agentId": "s1"]))
        XCTAssertNil(EngineEventObserver.waterfallIdentity(["eventId": "ev-1", "agentId": "s1"]))
        XCTAssertNil(EngineEventObserver.waterfallIdentity(["type": "emit", "event": "api-session/status"]))
    }
}
