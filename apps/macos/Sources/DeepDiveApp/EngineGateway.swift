import Foundation

/// Native client for the engine's HTTP gateway (same `client-request` envelope
/// the web frontend uses, sent from Swift so the settings window needs no
/// WebView). Carries the SPEC-ENGINE-RUNTIME §4.2 capability probe: methods
/// beyond the stable surface are probed once, cached for the session, and a
/// missing method degrades gracefully instead of throwing into the UI.
final class EngineGateway {
    static let shared = EngineGateway()

    enum GatewayError: LocalizedError {
        case noEngine
        case badURL
        case transport(Int)
        case methodUnavailable
        case rpc(code: String, message: String)

        var errorDescription: String? {
            switch self {
            case .noEngine: return "引擎未启动"
            case .badURL: return "引擎网关地址无效"
            case .transport(let status): return "引擎传输错误 HTTP \(status)"
            case .methodUnavailable: return "该方法在当前引擎版本不可用"
            case .rpc(let code, let message): return "\(code): \(message)"
            }
        }

        var isMethodUnavailable: Bool {
            if case .methodUnavailable = self { return true }
            return false
        }

        var isRevisionConflict: Bool {
            if case .rpc(let code, _) = self { return code == "settings/conflict" }
            return false
        }
    }

    private let session = URLSession(configuration: .ephemeral)
    /// 附件上传单独一条 session：走后台队列，别和网关那条共享状态（大文件慢慢传）。
    private let uploadSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 600
        config.timeoutIntervalForResource = 3600
        return URLSession(configuration: config)
    }()
    private let lock = NSLock()
    private var baseURL: URL?
    /// method → available? Cached for this engine session; reset on base change
    /// so an upgraded engine's new capabilities appear without an app restart.
    private var capabilities: [String: Bool] = [:]

    private init() {}

    func update(base: URL?) {
        lock.lock()
        baseURL = base
        capabilities.removeAll()
        lock.unlock()
    }

    private func currentBase() -> URL? {
        lock.lock(); defer { lock.unlock() }
        return baseURL
    }

    // MARK: - core call

    @discardableResult
    func call(_ method: String, payload: [String: Any] = [:]) async throws -> JSONValue {
        guard let base = currentBase() else { throw GatewayError.noEngine }
        // Keep the boot token (see BridgeServer.relayUnary — alpha.2+ auth).
        let query = base.query.map { "?\($0)" } ?? ""
        guard let url = URL(string: "api/" + method + query, relativeTo: base) else {
            // URL 构造失败是壳侧问题，不能冒充"引擎未启动"（AUD-036）
            throw GatewayError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Engine browser-auth cookie (see EngineAuth — alpha.2+ requirement).
        if let cookie = EngineAuth.shared.currentCookieHeader {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        // 0.1.2 wire（PITFALLS §4.6）：端点为 `<命名空间>/<方法>` 斜杠形，
        // 具名参数必须包成 {args:{…}}，信封 method 必须与端点字符串一致。
        let envelope: [String: Any] = [
            "type": "client-request",
            "rpcId": UUID().uuidString,
            "method": method,
            "payload": ["args": payload],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: envelope)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayError.transport(-1) }
        if http.statusCode == 404 { throw GatewayError.methodUnavailable }
        guard http.statusCode == 200 else { throw GatewayError.transport(http.statusCode) }
        guard let full = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = full["result"] as? [String: Any] else {
            throw GatewayError.transport(http.statusCode)
        }
        if result["ok"] as? Bool == true {
            return JSONValue(result["value"] ?? NSNull())
        }
        let err = result["error"] as? [String: Any] ?? [:]
        let code = err["code"] as? String ?? "rpc"
        let message = err["message"] as? String ?? "unknown"
        switch code {
        case "gateway/invocation-unavailable", "gateway/definition-unavailable":
            throw GatewayError.methodUnavailable
        default:
            throw GatewayError.rpc(code: code, message: message)
        }
    }

    // MARK: - 附件：按路径流式上传（不走 SPA，也就没有桥的单请求缓冲上限）

    /// 把本地文件**流式**送给引擎的字节上传面（`/api/session/uploadFileBinary`）。
    ///
    /// 为什么由壳来做：SPA 那侧要传字节，只能整段塞进一次请求（桥按缓冲上限处理），
    /// 或者把整个文件 base64 进一条桥消息——两者都随文件大小线性吃内存。壳这里用
    /// `uploadTask(fromFile:)`，URLSession 自己按块读盘，**内存与文件大小无关**，
    /// 几百 MB 的附件照样发得出去（用户 2026-10-09："不应该有大小限制"）。
    /// 返回引擎的回执（`{receiptId, file:{name,bytes,…}}`）。
    func uploadFile(at url: URL, sessionId: String, name: String?) async throws -> [String: Any] {
        guard let base = currentBase() else { throw GatewayError.noEngine }
        var query = base.query ?? ""
        let params = [("sessionId", sessionId), ("name", name ?? url.lastPathComponent)]
            .map { "\($0.0)=\($0.1.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.1)" }
            .joined(separator: "&")
        query += query.isEmpty ? params : "&" + params
        guard let target = URL(string: "api/session/uploadFileBinary?\(query)", relativeTo: base) else {
            throw GatewayError.badURL
        }
        var request = URLRequest(url: target)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let cookie = EngineAuth.shared.currentCookieHeader {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await uploadSession.upload(for: request, fromFile: url)
        guard let http = response as? HTTPURLResponse else { throw GatewayError.transport(-1) }
        if http.statusCode == 413 { throw GatewayError.rpc(code: "too-large", message: "超过上传上限") }
        guard http.statusCode == 200 else { throw GatewayError.transport(http.statusCode) }
        guard let full = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayError.transport(http.statusCode)
        }
        if full["ok"] as? Bool == true { return full["value"] as? [String: Any] ?? [:] }
        let err = full["error"] as? [String: Any] ?? [:]
        throw GatewayError.rpc(code: err["code"] as? String ?? "upload-failed",
                              message: err["message"] as? String ?? "上传失败")
    }

    // MARK: - capability probing (§4.2)

    /// True when the method exists on this engine. Unknown methods are probed
    /// once with an empty payload: a 404 / gateway-unavailable answer means
    /// "absent"; ANY other answer (success or an argument error) means the
    /// method exists. Only definitive answers are cached — noEngine / badURL
    /// say nothing about the method (the engine may just not be up this boot),
    /// so they return false WITHOUT caching (AUD-036). Never throws into the UI.
    func probe(_ method: String) async -> Bool {
        lock.lock()
        if let known = capabilities[method] {
            lock.unlock()
            return known
        }
        lock.unlock()
        var available = false
        var cacheable = true
        do {
            _ = try await call(method, payload: [:])
            available = true
        } catch GatewayError.methodUnavailable {
            available = false
        } catch GatewayError.noEngine, GatewayError.badURL {
            available = false
            cacheable = false
        } catch {
            available = true // method exists; the empty payload just was invalid
        }
        if cacheable {
            lock.lock()
            capabilities[method] = available
            lock.unlock()
        }
        return available
    }

    /// Version-sensitive (§4.1 note): endpoint name drifted across versions.
    func openSettingsDocument() async -> Bool {
        for method in ["settings/openSettingsDocument", "settings.openDocument"] {
            if await probe(method) {
                _ = try? await call(method, payload: [:])
                return true
            }
        }
        return false
    }
}
