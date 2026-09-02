import Foundation

/// DSHmini bridge: the same-origin frontend seat.
///
/// Serves the self-built SPA (dark glass, UI-SPEC) and forwards the engine's
/// own `/api` gateway. Forwarding goes out through URLSession without a
/// browser `Origin`, which the engine's trust fence explicitly accepts
/// (loopback Host + no origin ⇒ allowed; a browser cross-origin fetch would
/// carry a mismatching Origin and be refused). SSE (`events.mux`/`events.host`)
/// is plain HTTP, so one hop covers both unary RPC and the event stream.
final class BridgeServer {
    static let shared = BridgeServer()

    private var server: MiniHTTPServer?
    private var engineBase: URL?
    private var webRoot: URL?
    private let session = URLSession(configuration: .ephemeral)

    private init() {}

    func configure(webRoot: URL?) {
        self.webRoot = webRoot
    }

    func setEngine(_ base: URL?) {
        engineBase = base
    }

    @discardableResult
    func start() -> Bool {
        guard server == nil else { return true }
        let server = MiniHTTPServer { [weak self] request in
            self?.route(request) ?? .response(.init(status: 500))
        }
        server.upgradeHandler = { [weak self] fd, request in
            self?.wsRelay(fd, request)
        }
        guard server.start() else { return false }
        self.server = server
        EngineLog.shared.append("[bridge] listening on 127.0.0.1:\(server.port)")
        return true
    }

    var url: URL? {
        guard let server else { return nil }
        return URL(string: "http://127.0.0.1:\(server.port)/")
    }

    // MARK: - routing

    private func route(_ request: MiniHTTPServer.Request) -> MiniHTTPServer.Stream {
        // Same-origin gate: a browser page from elsewhere must not reach the
        // bridge (CSRF / drive-by WebSocket). Exact scheme+host+port match —
        // a suffix match like `hasSuffix(":\(port)")` would let any page
        // served on the same port number through, and WebSocket framing is
        // not subject to CORS, so it could read the whole event stream.
        // No-origin (dev tools, our URLSession relay) is fine.
        if let origin = request.headers["origin"], origin != "http://127.0.0.1:\(server?.port ?? 0)" {
            return .response(.init(status: 403))
        }

        guard let engineBase else {
            return .response(.init(status: 503))
        }

        // Frontend diagnostics channel.
        if request.method == "POST", request.path == "/__deepdive_error" {
            let body = String(data: request.body, encoding: .utf8) ?? ""
            EngineLog.shared.append("[web] " + body)
            return .response(.init(status: 204))
        }

        // WebSocket upgrade (engine's events.mux/host): blind relay.
        // events.* (rc.2) and remote.mux (alpha.2) both blind-relay.
        if request.headers["upgrade"]?.lowercased() == "websocket",
           request.path.hasPrefix("/api/events") || request.path.hasPrefix("/api/remote.mux") {
            return .upgrade(.init(status: 101))
        }

        // API hop — unary relay.
        if request.path.hasPrefix("/api/") {
            return .response(relayUnary(request, engineBase: engineBase))
        }
        return .response(serveStatic(request))
    }

    // MARK: - WebSocket blind relay (upgrade + bidirectional pump)

    private func wsRelay(_ client: Int32, _ request: MiniHTTPServer.Request) {
        guard let engineBase else {
            close(client)
            return
        }
        guard let host = engineBase.host, let port = engineBase.port,
              let key = request.headers["sec-websocket-key"] else {
            close(client)
            return
        }

        // Raw connect to the engine.
        let upstream = socket(AF_INET, SOCK_STREAM, 0)
        guard upstream >= 0 else { close(client); return }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(port).bigEndian
        addr.sin_addr.s_addr = inet_addr(host)
        let rc = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sp in
                connect(upstream, sp, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard rc == 0 else { close(upstream); close(client); return }

        // Forward the upgrade without the browser Origin (engine trust fence),
        // re-attaching the boot cookie (alpha.2+ enforces it post-upgrade).
        let tokenQuery = engineBase.query.map { "?\($0)" } ?? ""
        var cookieLine = ""
        if let cookie = EngineAuth.shared.currentCookieHeader {
            cookieLine = "Cookie: \(cookie)\r\n"
        }
        let up = "GET \(request.path)\(tokenQuery) HTTP/1.1\r\nHost: \(host):\(port)\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: \(key)\r\nSec-WebSocket-Version: 13\r\n\(cookieLine)\r\n"
        let upData = Data(up.utf8)
        var sent = 0
        while sent < upData.count {
            let n = upData.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
                send(upstream, ptr.baseAddress!.advanced(by: sent), upData.count - sent, 0)
            }
            if n <= 0 { EngineLog.shared.append("[ws] uphead send failed n=\(n)"); close(upstream); close(client); return }
            sent += n
        }


        // Pump the engine's response head verbatim (carries Sec-WebSocket-Accept).
        var head = Data()
        var scratch = [UInt8](repeating: 0, count: 4096)
        var pollFD = pollfd(fd: upstream, events: Int16(POLLIN), revents: 0)
        while head.range(of: Data("\r\n\r\n".utf8)) == nil {
            let pr = poll(&pollFD, 1, 3000)
            if pr <= 0 { close(upstream); close(client); return }
            let n = recv(upstream, &scratch, scratch.count, 0)
            guard n > 0 else { EngineLog.shared.append("[ws] uphead recv fail n=\(n)"); close(upstream); close(client); return }
            head.append(contentsOf: scratch[0..<n])
        }
        let sentHead = head.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
            send(client, ptr.baseAddress, ptr.count, 0)
        }

        // Bidirectional blind pump — one buffer per thread (no sharing).
        Thread.detachNewThread {
            var buf = [UInt8](repeating: 0, count: 8192)
            while true {
                let n = recv(upstream, &buf, buf.count, 0)
                if n <= 0 { break }
                _ = buf.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
                    send(client, ptr.baseAddress, n, 0)
                }
            }
            close(upstream)
            close(client)
        }
        Thread.detachNewThread {
            var buf = [UInt8](repeating: 0, count: 8192)
            while true {
                let n = recv(client, &buf, buf.count, 0)
                if n <= 0 { break }
                _ = buf.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
                    send(upstream, ptr.baseAddress, n, 0)
                }
            }
            close(upstream)
            close(client)
        }
    }

    // MARK: - unary relay

    private func relayUnary(_ request: MiniHTTPServer.Request, engineBase: URL) -> MiniHTTPServer.Response {
        // Re-attach the engine's boot token: relative resolution against the
        // ready URL drops its query, and the engine (0.1.2-alpha.2+) rejects
        // tokenless gateway calls with "unauthorized".
        let query = engineBase.query.map { "?\($0)" } ?? ""
        guard let engineURL = URL(string: request.path + query, relativeTo: engineBase) else {
            return .init(status: 400)
        }
        var urlRequest = URLRequest(url: engineURL)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body.isEmpty ? nil : request.body
        if let contentType = request.headers["content-type"] {
            urlRequest.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        // Engine browser-auth cookie (alpha.2+): minted once per boot by
        // EngineAuth; without it the gateway answers 401.
        if let cookie = EngineAuth.shared.currentCookieHeader {
            urlRequest.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        let semaphore = DispatchSemaphore(value: 0)
        var result = MiniHTTPServer.Response(status: 502)
        session.dataTask(with: urlRequest) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse else { return }
            result.status = http.statusCode
            result.body = data ?? Data()
            let mime = http.value(forHTTPHeaderField: "Content-Type") ?? "application/json"
            result.headers["content-type"] = mime
        }.resume()
        semaphore.wait()
        return result
    }


    // MARK: - static

    private func serveStatic(_ request: MiniHTTPServer.Request) -> MiniHTTPServer.Response {
        let root = (webRoot ?? FileManager.default.homeDirectoryForCurrentUser).standardizedFileURL
        var rel = request.path
        if rel == "/" { rel = "/index.html" }
        // Percent-decode, then resolve `..` before the containment check — a
        // raw client can send unencoded `../` and a string-prefix check on the
        // unresolved path would hand out files outside the web root.
        let decoded = rel.removingPercentEncoding ?? rel
        let fileURL = root.appendingPathComponent(String(decoded.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: fileURL) else {
            EngineLog.shared.append("[static] MISS \(decoded) (root=\(root.path))")
            return .init(status: 404)
        }
        var response = MiniHTTPServer.Response(status: 200)
        response.body = data
        let ext = fileURL.pathExtension
        response.headers["content-type"] = mimeType(for: ext)
        // Cache policy: hashed assets (/assets/*) are immutable — cache hard.
        // Everything else (index.html first of all) must revalidate on every
        // load, or WKWebView keeps serving a stale SPA after a bundle update
        // (user-visible as "my fix isn't there" after relaunch).
        if decoded.hasPrefix("/assets/") {
            response.headers["cache-control"] = "public, max-age=31536000, immutable"
        } else {
            response.headers["cache-control"] = "no-cache"
        }
        return response
    }

    private func mimeType(for ext: String) -> String {
        switch ext {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
