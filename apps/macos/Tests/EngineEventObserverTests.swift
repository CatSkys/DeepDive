import XCTest
@testable import DeepDive

/// question 帧挂起身份的 schema 配对语义（AUD-069 回归钉）：
/// 引擎 schema（events.schema.ts:51-52）——requested 载荷无 questionId，
/// 身份在 server-request 信封的 rpcId；resolved 按 questionRpcId 配对。
/// 曾按猜读 frame["questionId"]（恒 nil → 随机 UUID 兜底），resolved 又
/// 未处理，pending 只进不出，「需注意」卡死到引擎重启。
final class EngineEventObserverTests: XCTestCase {
    private func frame(_ payload: [String: Any], envelopeRpcId: String? = nil) -> (raw: [String: Any], frame: [String: Any]) {
        var raw = payload
        if let envelopeRpcId {
            raw = ["type": "server-request", "rpcId": envelopeRpcId, "payload": payload]
        }
        return (raw, payload)
    }

    func testRequestedIdentityIsEnvelopeRpcIdNotPayloadField() {
        // 载荷故意带上一个不存在的 questionId 键形状（旧代码读过它）
        let (raw, fr) = frame(
            ["type": "question/requested", "sessionId": "s1", "questions": [["question": "选哪个？"]]],
            envelopeRpcId: "rpc-1"
        )
        XCTAssertEqual(EngineEventObserver.questionId(raw: raw, frame: fr, type: "question/requested"), "rpc-1")
    }

    func testResolvedIdentityIsQuestionRpcId() {
        let (raw, fr) = frame(
            ["type": "question/resolved", "sessionId": "s1", "questionRpcId": "rpc-1", "outcome": "answered"]
        )
        XCTAssertEqual(EngineEventObserver.questionId(raw: raw, frame: fr, type: "question/resolved"), "rpc-1")
    }

    func testUnwrappedRequestedStillUsesFrameRpcIdFallback() {
        // 未包信封的裸帧（旧引擎/直连调试面）：rpcId 落在帧自身
        let fr: [String: Any] = ["type": "question/requested", "sessionId": "s1", "rpcId": "rpc-2", "questions": []]
        XCTAssertEqual(EngineEventObserver.questionId(raw: fr, frame: fr, type: "question/requested"), "rpc-2")
    }

    func testMissingIdentityReturnsNilInsteadOfGuessing() {
        // 无 rpcId 的 requested：显式 nil（调用方 return），绝不随机 UUID 掩盖
        let fr: [String: Any] = ["type": "question/requested", "sessionId": "s1", "questions": []]
        XCTAssertNil(EngineEventObserver.questionId(raw: fr, frame: fr, type: "question/requested"))
        XCTAssertNil(EngineEventObserver.questionId(raw: fr, frame: fr, type: "turn/start"))
    }
}
