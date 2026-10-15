import Foundation

/// Engine browser-auth handshake (SPEC-ENGINE-RUNTIME §4 版本韧性,实测
/// 0.1.2-rc.1): `dsh web:` prints a root URL whose `?token=` mints a signed,
/// authority-bound session cookie (303 + Set-Cookie). Every later `/api` hop —
/// unary RPC and the events WebSocket — is authenticated by that cookie alone.
/// The shell performs the exchange once per engine boot and shares the
/// resulting `Cookie` header with the bridge relay, the gateway client and the
/// event observer. On engines without browser auth (rc.2) the 303 never comes
/// and the header stays nil — same behavior as before.
///
/// Exchange mechanics: Foundation drops the 303's Set-Cookie when auto-
/// following the redirect (实测 macOS 26；curl 同请求正常），so the exchange
/// disables redirect following and reads the Set-Cookie off the 303 itself.
/// The minted credential never enters any cookie storage — it lives only in
/// this header string (AUD-038 的隔离诉求由此结构性成立).
final class EngineAuth {
    static let shared = EngineAuth()

    /// "name=value" for the current engine boot, or nil.
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
        // 不跟随重定向的会话（见类注释：303 的 Set-Cookie 需在重定向前截获）。
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirectDelegate(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        do {
            // 引擎契约（client-connection authorizeIndex）：GET / 带 token →
            // 303 + 恰一枚 Set-Cookie（authority 绑定、HttpOnly、SameSite=Strict）。
            let (_, response) = try await session.data(from: base)
            guard let http = response as? HTTPURLResponse else { throw ExchangeError.transport }
            let setCookie = http.value(forHTTPHeaderField: "Set-Cookie")
            if http.statusCode == 303, let setCookie, !setCookie.isEmpty {
                // "name=value; attrs…" → 取首对 name=value 作为 Cookie 头。
                let pair = setCookie.split(separator: ";", maxSplits: 1).first.map(String.init) ?? ""
                guard pair.contains("=") else { throw ExchangeError.malformedCookie }
                // 回验：带 cookie 直取根路径，200 才算握手成立（也覆盖 token
                // 失效/authority 不符等一切被引擎拒绝的情形）。
                var verify = URLRequest(url: URL(string: "/", relativeTo: base)?.absoluteURL ?? base)
                verify.setValue(pair, forHTTPHeaderField: "Cookie")
                let (_, verifyResponse) = try await session.data(for: verify)
                let code = (verifyResponse as? HTTPURLResponse)?.statusCode ?? -1
                if code == 200 {
                    lock.lock()
                    cookieHeader = pair
                    lock.unlock()
                    EngineLog.shared.append("[auth] engine cookie exchange ok")
                } else {
                    EngineLog.shared.append("[auth] engine cookie rejected on verification (HTTP \(code))")
                }
                return
            }
            // rc.2 无浏览器鉴权：根路径直接 200、无 Set-Cookie。
            EngineLog.shared.append("[auth] engine cookie exchange yielded no cookie (older engine without browser auth)")
        } catch {
            // 交换失败（引擎不可达/网络错误）≠ 旧引擎无 cookie，分开落日志
            EngineLog.shared.append("[auth] engine cookie exchange FAILED: \(error.localizedDescription)")
        }
    }

    var currentCookieHeader: String? {
        lock.lock(); defer { lock.unlock() }
        return cookieHeader
    }

    private enum ExchangeError: Error {
        case transport, malformedCookie
    }
}

/// URLSession delegate that refuses HTTP redirects (data(from:) then surfaces
/// the redirect response itself).
private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void,
    ) {
        completionHandler(nil)
    }
}
