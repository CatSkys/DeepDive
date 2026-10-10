// EngineEventObserver 的纯解析层（从 EngineEventObserver.swift 拆出，行数
// 棘轮）：帧载荷的形状判定与通知标题兜底，XCTest 表驱动钉住；连接回调共用
// 的串行后台队列也在这里（帧解析不占主线程，语义应用仍回主队列）。
import Foundation

extension EngineEventObserver {
    /// 连接回调与帧解析共用：串行（保帧序）、后台。
    static let parseQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "app.deepdive.engine-events.parse"
        queue.maxConcurrentOperationCount = 1
        return queue
    }()

    /// api-session/status 的 args 解析（纯函数，XCTest 表驱动钉住形状）：
    /// [sessionId, running] 二元组，缺一或类型不符返回 nil（不猜）。
    static func statusArgs(_ args: [Any]) -> (sessionId: String, running: Bool)? {
        guard let sessionId = args.first as? String,
              let running = args.dropFirst().first as? Bool else { return nil }
        return (sessionId, running)
    }

    /// waterfall 帧的身份三元组（纯函数，XCTest 钉住）：event + eventId +
    /// agentId（会话身份）。挂起集合与 cancel 帧统一用 eventId 配对。
    static func waterfallIdentity(_ value: [String: Any]) -> (event: String, eventId: String, sessionId: String)? {
        guard let event = value["event"] as? String,
              let eventId = value["eventId"] as? String,
              let sessionId = value["agentId"] as? String else { return nil }
        return (event, eventId, sessionId)
    }

    static func fallbackTitle(_ sessionId: String) -> String {
        "会话 " + sessionId.suffix(6)
    }
}
