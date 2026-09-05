import Foundation

/// Engine browser-auth handshake (SPEC-ENGINE-RUNTIME §4 版本韧性,实测
/// 0.1.2-alpha.2): `dsh web:` prints a root URL whose `?token=` mints a
/// signed, authority-bound session cookie (303 + Set-Cookie). Every later
/// `/api` hop — unary RPC and the events WebSocket — is authenticated by that
/// cookie alone; a token on an `/api` path authenticates nothing. The shell
/// performs the exchange once per engine boot and shares the resulting
/// `Cookie` header with the bridge relay, the gateway client and the event
/// observer. On engines without browser auth (rc.2) the exchange simply
/// yields no cookie and the header is omitted — same behavior as before.
final class EngineAuth {
    static let shared = EngineAuth()

    /// "name=value; name2=value2" for the current engine boot, or nil.
    private(set) var cookieHeader: String?

    private let lock = NSLock()

    private init() {}

    func update(base: URL?) {
        lock.lock()
        cookieHeader = nil
        lock.unlock()
    }

    /// Runs the root-URL token→cookie exchange and stores the header. Callers
    /// must re-run this when the engine base changes, BEFORE consumers start.
    func exchangeNow(for base: URL) async {
        lock.lock()
        cookieHeader = nil
        lock.unlock()
        // Cookie 捕获需要 cookie storage，ephemeral 默认丢 cookie；必须挂
        // 自建私有罐而非 .shared——引擎会话凭据不落进进程共享罐（默认
        // session 会全局读写 .shared，等于把凭据暴露给无关请求）（AUD-038）。
        let storage = HTTPCookieStorage()
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        config.httpCookieStorage = storage
        let session = URLSession(configuration: config)
        do {
            _ = try await session.data(from: base)
        } catch {
            session.finishTasksAndInvalidate()
            // 交换失败（引擎不可达/网络错误）≠ 旧引擎无 cookie，分开落日志
            EngineLog.shared.append("[auth] engine cookie exchange FAILED: \(error.localizedDescription)")
            return
        }
        session.finishTasksAndInvalidate()
        let cookies = storage.cookies(for: base) ?? []
        let header = cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        lock.lock()
        cookieHeader = header.isEmpty ? nil : header
        let ok = cookieHeader != nil
        lock.unlock()
        EngineLog.shared.append("[auth] engine cookie exchange \(ok ? "ok" : "yielded no cookie (older engine without browser auth)")")
    }

    var currentCookieHeader: String? {
        lock.lock(); defer { lock.unlock() }
        return cookieHeader
    }
}
