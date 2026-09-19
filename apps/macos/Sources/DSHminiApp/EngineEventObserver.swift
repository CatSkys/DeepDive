import AppKit
import Foundation

/// Native-side engine event subscription (SPEC-NOTIFICATIONS §3, option A):
/// the shell opens its own `ws://engine/api/remote.mux`, opens the `$events`
/// forwarded-event stream on it, and derives running / turn-finished /
/// attention states without depending on the frontend. Everything
/// notifications, the bubble and the menu bar badge show flows from here.
///
/// 0.1.2 wire (PITFALLS §4.6): approvals and questions arrive as waterfall
/// frames (`approval/request`, `user-questions/request`). This observer is
/// notification-only — it answers every waterfall with `next` so the SPA
/// stays the sole decision maker (the gateway resolves an event only when
/// ALL connected clients answered `next`).
final class EngineEventObserver {
    static let shared = EngineEventObserver()

    /// Derived state, consumed by FloatingBubbleManager / StatusItemController.
    private(set) var runningSessions = Set<String>()
    private(set) var pendingApprovals = Set<String>()
    private(set) var pendingQuestions = Set<String>()

    var needsAttention: Bool { !pendingApprovals.isEmpty || !pendingQuestions.isEmpty }
    var isRunning: Bool { !runningSessions.isEmpty }

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var base: URL?
    private var reconnectDelay = 1.0
    private var titles: [String: String] = [:]
    /// SessionId → 最近一次 agent 错误消息（api-session/error），running 转
    /// false 时消费一次用于「失败完成」通知，转 true 时清空。
    private var lastErrors: [String: String] = [:]
    /// $events 世代身份（ready 帧给出，应答 waterfall 的必填字段）。
    private var eventClientId: String?
    private var eventsStreamId = ""

    private init() {}

    func update(base: URL?) {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        self.base = base
        runningSessions.removeAll()
        pendingApprovals.removeAll()
        pendingQuestions.removeAll()
        titles.removeAll()
        lastErrors.removeAll()
        eventClientId = nil
        reconnectDelay = 1.0
        publish()
        if base != nil {
            connect()
        }
    }

    // MARK: - connection

    private func connect() {
        guard let base, let host = base.host, let port = base.port else { return }
        // The engine enforces its boot cookie post-upgrade (alpha.2+); without
        // it the mux connects then is closed immediately.
        let tokenQuery = base.query.map { "?\($0)" } ?? ""
        guard let url = URL(string: "ws://\(host):\(port)/api/remote.mux\(tokenQuery)") else { return }
        var request = URLRequest(url: url)
        if let cookie = EngineAuth.shared.currentCookieHeader {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        let session = URLSession(configuration: .ephemeral)
        self.session = session
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        // Forwarded events ride the $events internal stream on remote.mux —
        // open it with the standard empty-args payload right after connect.
        // 帧必须是文本（引擎 mux 只解析 text message，二进制帧会被直接断连）。
        eventsStreamId = "events-\(UUID().uuidString)"
        let open: [String: Any] = ["type": "open", "streamId": eventsStreamId,
                                   "endpoint": "$events", "payload": ["args": [:]]]
        if let data = try? JSONSerialization.data(withJSONObject: open),
           let text = String(data: data, encoding: .utf8) {
            task.send(.string(text)) { _ in }
        }
        receive()
        EngineLog.shared.append("[observer] mux connected \(url.absoluteString)")
    }

    private func receive() {
        task?.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let message):
                    self.reconnectDelay = 1.0
                    if case .string(let text) = message {
                        self.consume(text)
                    }
                    self.receive()
                case .failure(let error):
                    // 瞬时断开（引擎重启/睡眠/启动期抖动）只按普通断连退避重连——
                    // 路径由引擎引脚唯一决定（0.1.2 = remote.mux），不做「快速
                    // 失败即换路径」的猜测式回退（曾把瞬时断连误判成路径不可用，
                    // 永久落到已消亡的 events.mux 上 30s 循环掉线）。
                    EngineLog.shared.append("[observer] mux dropped: \(error.localizedDescription); reconnect in \(Int(self.reconnectDelay))s")
                    self.retry()
                }
            }
        }
    }

    private func retry() {
        guard base != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + reconnectDelay) { [weak self] in
            guard let self, self.base != nil, self.task == nil || !(self.task?.state == .running) else { return }
            self.connect()
        }
        reconnectDelay = min(30.0, reconnectDelay * 2)
    }

    // MARK: - frame consumption

    private func consume(_ text: String) {
        guard let raw = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let type = raw["type"] as? String else { return }
        // remote.mux 只承载逻辑流帧（open 由本端发；error/end 见下）。
        switch type {
        case "item":
            guard (raw["streamId"] as? String) == eventsStreamId,
                  let value = raw["value"] as? [String: Any] else { return }
            consumeEventValue(value)
        case "error", "end":
            // $events 流异常终止：整条 WS 重连（重开新世代）。
            if (raw["streamId"] as? String) == eventsStreamId {
                task?.cancel(with: .goingAway, reason: nil)
                retry()
            }
        default:
            break
        }
    }

    private func consumeEventValue(_ value: [String: Any]) {
        guard let kind = value["type"] as? String else { return }
        switch kind {
        case "ready":
            eventClientId = value["clientId"] as? String
        case "emit":
            guard let event = value["event"] as? String,
                  let args = value["args"] as? [Any] else { return }
            consumeEmit(event: event, args: args)
        case "waterfall":
            consumeWaterfall(value)
        case "cancel":
            // 引擎侧取消挂起交互：按 eventId 移除，两端集合共用同一身份。
            if let eventId = value["eventId"] as? String {
                pendingApprovals.remove(eventId)
                pendingQuestions.remove(eventId)
                publish()
            }
        default:
            break
        }
    }

    private func consumeEmit(event: String, args: [Any]) {
        switch event {
        case "api-session/status":
            // args = [sessionId, running]（SessionControllerTypes 事件声明）。
            guard let pair = Self.statusArgs(args) else { return }
            applyStatus(sessionId: pair.sessionId, running: pair.running)
        case "api-session/error":
            // args = [sessionId, message]：记录供 running=false 时判定失败完成。
            if let sessionId = args.first as? String, let message = args.dropFirst().first as? String {
                lastErrors[sessionId] = message
            }
        case "api-session/removed":
            if let sessionId = args.first as? String {
                runningSessions.remove(sessionId)
                publish()
            }
        default:
            break
        }
    }

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

    private func applyStatus(sessionId: String, running: Bool) {
        if running {
            // First task dispatch is the notification-authorization moment
            // (SPEC-NOTIFICATIONS §1.1 v2: never at app boot).
            NativeAlerts.requestAuthorizationIfNeeded()
            runningSessions.insert(sessionId)
            lastErrors[sessionId] = nil
            FloatingBubbleManager.shared.noteRunningStarted(sessionId: sessionId)
        } else {
            let wasRunning = runningSessions.remove(sessionId) != nil
            if wasRunning {
                let failedReason = lastErrors.removeValue(forKey: sessionId)
                noteTurnFinished(sessionId: sessionId, failed: failedReason != nil)
            }
        }
        publish()
    }

    private func consumeWaterfall(_ value: [String: Any]) {
        guard let identity = Self.waterfallIdentity(value) else { return }
        let (event, eventId, sessionId) = identity
        switch event {
        case "approval/request":
            // request = {toolName, callId?, reason?}（user-approval 契约）。
            let request = value["request"] as? [String: Any] ?? [:]
            let toolName = request["toolName"] as? String ?? "工具调用"
            pendingApprovals.insert(eventId)
            FloatingBubbleManager.shared.noteNeedsAttention()
            answerNext(eventId: eventId)
            resolveTitle(sessionId: sessionId) { title in
                NativeAlerts.notifyApprovalNeeded(toolName: toolName, sessionTitle: title, sessionId: sessionId)
            }
            publish()
        case "user-questions/request":
            // request = {questions:[{id, question, …}]}（AskUserQuestionRequestEvent）。
            let request = value["request"] as? [String: Any] ?? [:]
            let questionText = (request["questions"] as? [[String: Any]])?
                .compactMap { $0["question"] as? String }
                .first ?? "打开 DeepDive 查看并回答"
            pendingQuestions.insert(eventId)
            FloatingBubbleManager.shared.noteNeedsAttention()
            answerNext(eventId: eventId)
            resolveTitle(sessionId: sessionId) { title in
                NativeAlerts.notifyQuestionNeeded(questionText: questionText, sessionTitle: title, sessionId: sessionId)
            }
            publish()
        default:
            break
        }
    }

    /// 通知-only 客户端永不决策：一律回 `next`（引擎仅在**所有**客户端都回
    /// next 时才落 next，SPA 的 result/rejected 照常生效）。
    private func answerNext(eventId: String) {
        guard let clientId = eventClientId else { return }
        Task { @MainActor in
            _ = try? await EngineGateway.shared.call(
                "$events/result",
                payload: ["clientId": clientId, "eventId": eventId, "outcome": ["kind": "next"]]
            )
        }
    }

    private func noteTurnFinished(sessionId: String, failed: Bool) {
        let appInactive = !NSApp.isActive
        FloatingBubbleManager.shared.noteTurnFinished(sessionId: sessionId, appInactive: appInactive)
        if appInactive, !failed {
            resolveTitle(sessionId: sessionId) { title in
                NativeAlerts.notifyTurnFinished(sessionTitle: title, sessionId: sessionId)
            }
        }
    }

    /// 通知用会话标题：先查缓存，未命中拉 session/list，最多等 1.5s。
    /// 超时兜底取 id 尾 6 位——id 前缀是固定字面量（sessio…），取头无区分度。
    /// 真实标题才进缓存；兜底不缓存，避免一次超时污染后续通知。
    private func resolveTitle(sessionId: String, completion: @escaping (String) -> Void) {
        if let cached = titles[sessionId] {
            completion(cached)
            return
        }
        var settled = false
        let settle: (String, Bool) -> Void = { title, isReal in
            guard !settled else { return }
            settled = true
            if isReal { self.titles[sessionId] = title }
            completion(title)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            settle(Self.fallbackTitle(sessionId), false)
        }
        Task { @MainActor in
            // session/list 声明必填保留参 `_request`（空对象；前端同款）——空参调用
            // 被参数校验拒绝，try? 吞掉后必然走超时兜底，通知标题永远是「会话 062bbf」
            guard let items = (try? await EngineGateway.shared.call("session/list", payload: ["_request": [:]]))?.at("items")?.anyValue as? [[String: Any]] else {
                return // 拉取失败/超时由兜底接管
            }
            for item in items where (item["sessionId"] as? String) == sessionId {
                let proj = (item["projections"] as? [String: Any])?["values"] as? [String: Any] ?? [:]
                if let title = proj["title"] as? String, !title.isEmpty {
                    settle(title, true)
                }
            }
            // 列表无此会话或无投影标题 → 超时兜底接管
        }
    }

    private static func fallbackTitle(_ sessionId: String) -> String {
        "会话 " + sessionId.suffix(6)
    }

    private func publish() {
        FloatingBubbleManager.shared.sync(running: isRunning, attention: needsAttention)
        StatusItemController.shared?.setActivity(running: isRunning, attention: needsAttention)
    }
}
