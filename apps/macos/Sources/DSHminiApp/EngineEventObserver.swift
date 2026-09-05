import AppKit
import Foundation

/// Native-side engine event subscription (SPEC-NOTIFICATIONS §3, option A):
/// the shell opens its own `ws://engine/api/events.mux` and derives
/// running / turn-finished / attention states without depending on the
/// frontend. Everything notifications, the bubble and the menu bar badge show
/// flows from here.
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
    /// Mux path drifted across engine versions (rc.2 = events.mux; alpha.2 =
    /// remote.mux, see PITFALLS). Probe candidates in order; the first one
    /// that survives upgrade+auth wins and is remembered for this boot.
    private var muxPathIndex = 0
    private static let muxPaths = ["/api/events.mux", "/api/remote.mux"]

    private init() {}

    func update(base: URL?) {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        self.base = base
        runningSessions.removeAll()
        pendingApprovals.removeAll()
        pendingQuestions.removeAll()
        titles.removeAll()
        reconnectDelay = 1.0
        muxPathIndex = 0
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
        let path = Self.muxPaths[min(muxPathIndex, Self.muxPaths.count - 1)]
        guard let url = URL(string: "ws://\(host):\(port)\(path)\(tokenQuery)") else { return }
        var request = URLRequest(url: url)
        if let cookie = EngineAuth.shared.currentCookieHeader {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        let session = URLSession(configuration: .ephemeral)
        self.session = session
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        // alpha.2 carries forwarded events on the $events internal stream —
        // open it right after the socket is up (remote.mux candidate only).
        if path == "/api/remote.mux" {
            let open: [String: Any] = ["type": "open", "streamId": UUID().uuidString,
                                       "endpoint": "", "payload": ["args": [:]]]
            if let data = try? JSONSerialization.data(withJSONObject: open) {
                task.send(.data(data)) { _ in }
            }
        }
        receive()
        EngineLog.shared.append("[observer] mux connected \(url.absoluteString)")
    }

    /// A path that cannot serve us closes within moments of connect; advance
    /// to the next candidate before the ordinary reconnect backoff.
    private func advanceMuxCandidate() {
        if muxPathIndex < Self.muxPaths.count - 1 {
            muxPathIndex += 1
            EngineLog.shared.append("[observer] mux path unavailable, falling back to \(Self.muxPaths[muxPathIndex])")
        }
    }

    private func receive() {
        let connectStart = Date()
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
                    // A failed first receive means the path/auth was rejected —
                    // try the next mux candidate before backing off.
                    if Date().timeIntervalSince(connectStart) < 2 {
                        self.advanceMuxCandidate()
                    }
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
        guard let raw = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { return }
        // Engine mux wraps logical frames in a server-request envelope
        // (`{type, payload}`); unwrap like the frontend does.
        let frame = (raw["payload"] as? [String: Any]) ?? raw
        guard let type = frame["type"] as? String else { return }
        switch type {
        case "session/event":
            guard let sessionId = frame["sessionId"] as? String,
                  let event = frame["event"] as? [String: Any],
                  let eventType = event["type"] as? String else { return }
            switch eventType {
            case "turn/start":
                // First task dispatch is the notification-authorization moment
                // (SPEC-NOTIFICATIONS §1.1 v2: never at app boot).
                NativeAlerts.requestAuthorizationIfNeeded()
                runningSessions.insert(sessionId)
                FloatingBubbleManager.shared.noteRunningStarted(sessionId: sessionId)
                publish()
            case "turn/end":
                runningSessions.remove(sessionId)
                // alpha.2 moved reason into an object ({kind:"completed"});
                // rc.2 used a plain string — accept both shapes.
                let reason: String
                if let raw = (event["data"] as? [String: Any])?["reason"] {
                    if let s = raw as? String { reason = s }
                    else if let d = raw as? [String: Any] { reason = d["kind"] as? String ?? "completed" }
                    else { reason = "completed" }
                } else { reason = "completed" }
                if reason == "completed" || reason == "cancelled" {
                    noteTurnFinished(sessionId: sessionId, failed: reason == "cancelled")
                }
                publish()
            default:
                break
            }
        case "approval/requested":
            // schema (events.schema.ts): approvalId 必有（铁律 9——契约字段
            // 直取，不做 UUID 兜底掩盖漂移）。
            guard let sessionId = frame["sessionId"] as? String,
                  let approvalId = frame["approvalId"] as? String else { return }
            pendingApprovals.insert(approvalId)
            let toolName = frame["toolName"] as? String ?? "工具调用"
            FloatingBubbleManager.shared.noteNeedsAttention()
            resolveTitle(sessionId: sessionId) { title in
                NativeAlerts.notifyApprovalNeeded(toolName: toolName, sessionTitle: title, sessionId: sessionId)
            }
            publish()
        case "approval/resolved":
            guard let approvalId = frame["approvalId"] as? String else { return }
            pendingApprovals.remove(approvalId)
            publish()
        case "question/requested":
            // schema（events.schema.ts:51）：载荷只有 {sessionId, questions[]}，
            // 没有 questionId——挂起身份 = 信封 rpcId（与前端 store 同一语义），
            // resolved 帧按 questionRpcId 配对移除。
            guard let sessionId = frame["sessionId"] as? String,
                  let rpcId = Self.questionId(raw: raw, frame: frame, type: type) else { return }
            pendingQuestions.insert(rpcId)
            FloatingBubbleManager.shared.noteNeedsAttention()
            // questions[] 首条的 question 字段（askUserQuestionItemSchema）
            // ——通知正文用真实提问。
            let questionText = (frame["questions"] as? [[String: Any]])?
                .compactMap { $0["question"] as? String }
                .first ?? "打开 DeepDive 查看并回答"
            resolveTitle(sessionId: sessionId) { title in
                NativeAlerts.notifyQuestionNeeded(questionText: questionText, sessionTitle: title, sessionId: sessionId)
            }
            publish()
        case "question/resolved":
            // schema（events.schema.ts:52）：{sessionId, questionRpcId, outcome}。
            // 缺了这条配对移除，一次提问后「需注意」状态会卡死到引擎重启。
            guard let rid = Self.questionId(raw: raw, frame: frame, type: type) else { return }
            pendingQuestions.remove(rid)
            publish()
        default:
            break
        }
    }

    /// question 帧的挂起身份（纯函数，XCTest 表驱动钉住 schema 配对语义）：
    /// requested 取**信封** rpcId（载荷没有 questionId——曾按猜读该字段，
    /// 每次插入都是随机 UUID，resolved 永远配不上对）；resolved 取
    /// questionRpcId。其余类型无 question 身份。
    static func questionId(raw: [String: Any], frame: [String: Any], type: String) -> String? {
        switch type {
        case "question/requested": return raw["rpcId"] as? String
        case "question/resolved": return frame["questionRpcId"] as? String
        default: return nil
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

    /// 通知用会话标题：先查缓存，未命中拉 session.list，最多等 1.5s。
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
            guard let items = (try? await EngineGateway.shared.call("session.list"))?.at("items")?.anyValue as? [[String: Any]] else {
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
