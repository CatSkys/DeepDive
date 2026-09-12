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
        server.relayHandler = { [weak self] fd, request, partial in
            self?.relayStreaming(fd, request, partial)
        }
        // 端口即网页 origin：固定端口是 SPA 的 localStorage（会话覆盖集、用量
        // 缓存、自动化任务）能跨启动保留的前提——端口一变 WebKit 就换一套存储。
        // 记住的端口被占（别的进程/上个实例没退干净）时退回内核分配。
        let preferred = UInt16(clamping: DSHAppPrefs.bridgePort)
        var started = server.start(port: preferred)
        if !started, preferred != 0 {
            EngineLog.shared.append("[bridge] port \(preferred) unavailable; falling back to an ephemeral port")
            started = server.start()
        }
        guard started else { return false }
        self.server = server
        DSHAppPrefs.setBridgePort(server.port)
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

        // Frontend diagnostics channel. Must precede the engineBase guard
        // (AUD-037a)：引擎挂掉期间恰是前端最需要上报错误的时候，503 前置
        // 会把诊断全吞掉。
        if request.method == "POST", request.path == "/__deepdive_error" {
            let body = String(data: request.body, encoding: .utf8) ?? ""
            EngineLog.shared.append("[web] " + body)
            return .response(.init(status: 204))
        }

        // SPA + assets must load regardless of engine state: the credentials
        // cold start (engine never boots until a key is configured) is exactly
        // when the first-run setup UI is needed; gating static on engineBase
        // bricked every fresh install into a black window (PITFALLS §5.6).
        // Engine-backed routes (/api/* unary 与 /api-import/* 导入面板) 之外
        // 全部走静态。
        if !request.path.hasPrefix("/api") {
            return .response(serveStatic(request))
        }

        guard let engineBase else {
            return .response(.init(status: 503))
        }

        // WebSocket upgrade (engine's events.mux/host): blind relay.
        // events.* (rc.2) and remote.mux (alpha.2) both blind-relay.
        if request.headers["upgrade"]?.lowercased() == "websocket",
           request.path.hasPrefix("/api/events") || request.path.hasPrefix("/api/remote.mux") {
            return .upgrade(.init(status: 101))
        }

        // 大文件上传（§2）：超过 1MB 的 uploadFileBinary 不整段缓冲，交盲直通
        if request.path == "/api/session/uploadFileBinary",
           (request.contentLength ?? 0) > Self.streamRelayThreshold {
            return .relay
        }

        // API hop — unary relay.
        return .response(relayUnary(request, engineBase: engineBase))
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

        // Bidirectional blind pump — single thread polling both fds.
        // fd 属主（AUD-071 再修，2026-09-10 实机事故）：此前两条 detached 泵线程
        // 各自「close 自己 + shutdown 对侧」，但对侧线程可能已先行 close 该 fd——
        // 内核将 fd 号复用给新 accept 的连接后，迟到的 shutdown 关掉的是别人的
        // socket，受害连接表面健康、快照后一帧不再到达（帧级日志钉死）。
        // 单线程 poll 双 fd 是盲中继的最简形态：任一侧 EOF/错误都在同一线程内
        // 依次 shutdown+close 两个 fd，不存在跨线程 fd 信号，整类竞态消失。
        Thread.detachNewThread {
            var buf = [UInt8](repeating: 0, count: 8192)
            var fds: [pollfd] = [
                pollfd(fd: upstream, events: Int16(POLLIN), revents: 0),
                pollfd(fd: client, events: Int16(POLLIN), revents: 0),
            ]
            pump: while true {
                if poll(&fds, 2, -1) <= 0 { break }
                for i in 0..<2 {
                    if fds[i].revents == 0 { continue }
                    let n = recv(fds[i].fd, &buf, buf.count, 0)
                    if n <= 0 { break pump }
                    var sent = 0
                    while sent < n {
                        let m = buf.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
                            send(fds[1 - i].fd, ptr.baseAddress!.advanced(by: sent), n - sent, 0)
                        }
                        if m <= 0 { break pump }
                        sent += m
                    }
                    fds[i].revents = 0
                }
            }
            shutdown(client, Int32(SHUT_RDWR))
            shutdown(upstream, Int32(SHUT_RDWR))
            close(upstream)
            close(client)
        }
    }

    /// 超过此体积的 uploadFileBinary 走盲直通（其余 unary 仍整段缓冲）。
    private static let streamRelayThreshold = 1 * 1024 * 1024

    // MARK: - 大 body 盲直通（§2 大文件上传）

    /// uploadFileBinary 直通：把 client 的请求（头块 + 已缓冲首段 + 剩余字节）
    /// 原样泵给引擎（带鉴权 cookie 与 Connection: close），再把引擎响应泵回
    /// client。全程固定大小缓冲，无内存放大。
    private func relayStreaming(_ client: Int32, _ request: MiniHTTPServer.Request, _ partial: Data) {
        func sendAll(_ fd: Int32, _ data: Data) -> Bool {
            var sent = 0
            return data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Bool in
                while sent < data.count {
                    let n = send(fd, ptr.baseAddress!.advanced(by: sent), data.count - sent, 0)
                    if n <= 0 { return false }
                    sent += n
                }
                return true
            }
        }
        func writeRaw(_ fd: Int32, status: Int, body: Data) {
            let text = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
            _ = sendAll(fd, Data(text.utf8)) && sendAll(fd, body)
        }
        func writeError(_ fd: Int32, _ status: Int) {
            writeRaw(fd, status: status, body: Data())
        }
        guard let engineBase,
              let host = engineBase.host, let port = engineBase.port,
              let declared = request.contentLength, declared >= 0 else {
            writeError(client, 502)
            close(client)
            return
        }
        // 连接引擎
        let upstream = socket(AF_INET, SOCK_STREAM, 0)
        guard upstream >= 0 else { writeError(client, 502); close(client); return }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(port).bigEndian
        addr.sin_addr.s_addr = inet_addr(host)
        let rc = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sp in
                connect(upstream, sp, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard rc == 0 else { close(upstream); writeError(client, 502); close(client); return }

        // 组转发头：原样 method/target + 引擎 token 查询 + Connection: close
        var query = engineBase.query ?? ""
        if !request.query.isEmpty { query += query.isEmpty ? request.query : "&" + request.query }
        let cookie = EngineAuth.shared.currentCookieHeader
        var head = "\(request.method) \(request.path)\(query.isEmpty ? "" : "?\(query)") HTTP/1.1\r\n"
        head += "Host: \(host):\(port)\r\n"
        head += "Content-Type: application/octet-stream\r\n"
        head += "Content-Length: \(declared)\r\n"
        head += "Connection: close\r\n"
        if let cookie { head += "Cookie: \(cookie)\r\n" }
        head += "\r\n"

        guard sendAll(upstream, Data(head.utf8)) && (partial.isEmpty || sendAll(upstream, partial)) else {
            close(upstream); writeError(client, 502); close(client); return
        }

        // 泵剩余 body：client → upstream，直到凑满 declared
        var received = partial.count
        var scratch = [UInt8](repeating: 0, count: 256 * 1024)
        while received < declared {
            let n = recv(client, &scratch, scratch.count, 0)
            if n <= 0 { break }
            var sent = 0
            while sent < n {
                let m = scratch.withUnsafeBytes { ptr -> Int in
                    send(upstream, ptr.baseAddress!.advanced(by: sent), n - sent, 0)
                }
                if m <= 0 { break }
                sent += m
            }
            if sent < n { break }
            received += n
        }
        // body 收满即半关写端，促使引擎尽快回响应
        shutdown(upstream, Int32(SHUT_WR))

        // 引擎响应 → client（Connection: close，泵到引擎 EOF）
        var respScratch = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = recv(upstream, &respScratch, respScratch.count, 0)
            if n <= 0 { break }
            var sent = 0
            while sent < n {
                let m = respScratch.withUnsafeBytes { ptr -> Int in
                    send(client, ptr.baseAddress!.advanced(by: sent), n - sent, 0)
                }
                if m <= 0 { break }
                sent += m
            }
            if sent < n { break }
        }
        close(upstream)
        close(client)
    }

    // MARK: - unary relay

    private func relayUnary(_ request: MiniHTTPServer.Request, engineBase: URL) -> MiniHTTPServer.Response {
        // Re-attach the engine's boot token: relative resolution against the
        // ready URL drops its query, and the engine (0.1.2-alpha.2+) rejects
        // tokenless gateway calls with "unauthorized". Client query params
        // (0.1.5 /api/file?path=… 等) merge after the token.
        var query = engineBase.query ?? ""
        if !request.query.isEmpty {
            query += query.isEmpty ? request.query : "&" + request.query
        }
        let querySuffix = query.isEmpty ? "" : "?\(query)"
        guard let engineURL = URL(string: request.path + querySuffix, relativeTo: engineBase) else {
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
        // AUD-037b：引擎挂起时 dataTask 可能永不出回调，无限 wait 会把这条
        // 桥线程永久钉死——超时按 502 网关错误返回。
        if semaphore.wait(timeout: .now() + 30) == .timedOut {
            return .init(status: 502)
        }
        return result
    }


    // MARK: - static

    private func serveStatic(_ request: MiniHTTPServer.Request) -> MiniHTTPServer.Response {
        // AUD-075：webRoot 缺失是 bundle 配置坏了，唯一安全的处置是整体 503；
        // 兜底到 home 目录等于把整个 ~ 托管给本机回环请求，方向危险且
        // 违反「不做掩盖问题的兜底」。
        guard let webRoot else {
            EngineLog.shared.append("[static] webRoot not configured — refusing to serve anything")
            return .init(status: 503)
        }
        let root = webRoot.standardizedFileURL
        guard let resolved = Self.staticFileURL(for: request.path, root: root),
              let data = try? Data(contentsOf: resolved.url) else {
            EngineLog.shared.append("[static] MISS \(request.path.removingPercentEncoding ?? request.path) (root=\(root.path))")
            return .init(status: 404)
        }
        let decoded = resolved.decoded
        var response = MiniHTTPServer.Response(status: 200)
        response.body = data
        let ext = resolved.url.pathExtension
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

    /// Resolve a static request path under root: percent-decode, resolve `..`
    /// via standardization, then require the result under root+/. A raw client
    /// can send unencoded `../` and a string-prefix check on the unresolved
    /// path would hand out files outside the web root. Static + pure so the
    /// traversal guard is unit-testable; nil means the path escapes root.
    static func staticFileURL(for path: String, root: URL) -> (url: URL, decoded: String)? {
        var rel = path
        if rel == "/" { rel = "/index.html" }
        let decoded = rel.removingPercentEncoding ?? rel
        let fileURL = root.appendingPathComponent(String(decoded.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/") else { return nil }
        return (fileURL, decoded)
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
