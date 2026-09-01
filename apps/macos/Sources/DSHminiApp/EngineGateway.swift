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
        case transport(Int)
        case methodUnavailable
        case rpc(code: String, message: String)

        var errorDescription: String? {
            switch self {
            case .noEngine: return "引擎未启动"
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
            throw GatewayError.noEngine
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Engine browser-auth cookie (see EngineAuth — alpha.2+ requirement).
        if let cookie = EngineAuth.shared.currentCookieHeader {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        let envelope: [String: Any] = [
            "type": "client-request",
            "rpcId": UUID().uuidString,
            "method": method,
            "payload": payload,
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

    // MARK: - capability probing (§4.2)

    /// True when the method exists on this engine. Unknown methods are probed
    /// once with an empty payload: a 404 / gateway-unavailable answer means
    /// "absent"; ANY other answer (success or an argument error) means the
    /// method exists. Never throws into the UI.
    func probe(_ method: String) async -> Bool {
        lock.lock()
        if let known = capabilities[method] {
            lock.unlock()
            return known
        }
        lock.unlock()
        let available: Bool
        do {
            _ = try await call(method, payload: [:])
            available = true
        } catch GatewayError.methodUnavailable {
            available = false
        } catch GatewayError.noEngine {
            available = false
        } catch {
            available = true // method exists; the empty payload just was invalid
        }
        lock.lock()
        capabilities[method] = available
        lock.unlock()
        return available
    }

    /// Version-sensitive (§4.1 note): endpoint name drifted across versions.
    func openSettingsDocument() async -> Bool {
        for method in ["settings.openDocument", "settings.openSettingsDocument"] {
            if await probe(method) {
                _ = try? await call(method, payload: [:])
                return true
            }
        }
        return false
    }
}
