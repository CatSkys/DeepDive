import Foundation

/// Minimal threaded HTTP/1.1 server on 127.0.0.1 — the DSHmini bridge origin.
/// Short connections for static files and unary /api hops; WebSocket upgrades
/// are handed to the relay raw. POSIX sockets keep it dependency-free.
final class MiniHTTPServer {
    struct Request {
        let method: String
        let path: String
        /// "?" 后的原始查询串（无 "?" 为空串）。/api 转发时并进引擎 URL
        /// （0.1.5 的 /api/file?path=… 与 uploadFileBinary?sessionId=… 依赖）。
        let query: String
        let headers: [String: String]
        let body: Data
        /// 原始请求头块（含请求行，CRLF 结尾）。流式直通转发时原样重放。
        let rawHead: Data
        /// Content-Length 声明值（无头时 nil）。
        var contentLength: Int? {
            headers["content-length"].flatMap { Int($0) }
        }
    }

    struct Response {
        var status: Int = 200
        var headers: [String: String] = [:]
        var body: Data = Data()
    }

    enum Stream {
        case response(Response)
        /// WebSocket-style upgrade: the raw client socket is handed to
        /// `upgradeHandler`; the connection stays open.
        case upgrade(Response)
        /// 大 body 盲直通：raw client socket + 已缓冲的请求头/首段 body 交给
        /// relayHandler；转发器边收边泵到引擎，不整段缓冲（§2 大文件上传）。
        case relay
    }

    /// 超过此体积的 uploadFileBinary 交由 relayHandler 盲直通（其余全量缓冲）。
    static let streamRelayThreshold = 1 * 1024 * 1024

    /// Set once at start; responsible for the handshake relay + byte pump.
    var upgradeHandler: ((Int32, Request) -> Void)?
    var relayHandler: ((Int32, Request, Data) -> Void)?

    private var listenFD: Int32 = -1
    private let socketQueue = DispatchQueue(label: "deepdive.bridge.accept")
    private var running = false
    private let callback: (Request) -> Stream

    var port: Int { Int(SocketProvider.localPort(of: listenFD)) }

    init(callback: @escaping (Request) -> Stream) {
        self.callback = callback
    }

    /// port = 0 由内核分配；给定端口则固定监听它（被占时调用方可退回 0）。
    func start(port: UInt16 = 0) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        listenFD = fd
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
                bind(fd, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { close(fd); return false }
        guard listen(fd, 16) == 0 else { close(fd); return false }

        running = true
        socketQueue.async { [weak self] in
            while let self, self.running {
                var clientAddr = sockaddr()
                var len = socklen_t(MemoryLayout<sockaddr>.size)
                let client = accept(self.listenFD, &clientAddr, &len)
                if client < 0 { continue }
                Thread.detachNewThread { self.handle(client) }
            }
        }
        return true
    }

    func stop() {
        running = false
        if listenFD >= 0 {
            shutdown(listenFD, SHUT_RDWR)
            close(listenFD)
            listenFD = -1
        }
    }

    // MARK: - per-connection

    private func handle(_ client: Int32) {
        // AUD-037b：慢连接/半开连接每条都会挂死一个 detached 线程——accept
        // 后立刻设接收超时，recv 超时返回 -1，readRequest 按 EOF 处理断开。
        var tv = timeval(tv_sec: 15, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        // 统一头优先读取；大 body（uploadFileBinary）交盲直通泵（不整段缓冲）。
        guard let (headRequest, partial) = readRequestHead(client) else {
            close(client)
            return
        }
        let wantsRelay = headRequest.path == "/api/session/uploadFileBinary"
            && (headRequest.contentLength ?? 0) > Self.streamRelayThreshold
        if wantsRelay {
            relayHandler?(client, headRequest, partial)
            // relayHandler 接管 socket（收满 body + 泵回响应 + close）
            return
        }
        // 常规路径：补读剩余 body 到声明长度
        var body = partial
        let declared = headRequest.contentLength ?? body.count
        var scratch = [UInt8](repeating: 0, count: 8192)
        while body.count < declared {
            let n = recv(client, &scratch, scratch.count, 0)
            guard n > 0 else { break }
            body.append(contentsOf: scratch[0..<n])
        }
        let request = Request(method: headRequest.method, path: headRequest.path, query: headRequest.query,
                              headers: headRequest.headers, body: body, rawHead: headRequest.rawHead)
        switch callback(request) {
        case .response(let response):
            writeResponse(client, response)
            close(client)
        case .upgrade:
            // The relay owns the socket from here (handshake + bidirectional
            // pump); it closes both ends when the stream ends.
            upgradeHandler?(client, request)
            return
        case .relay:
            close(client)
        }
    }

    /// 头优先读取：收齐请求头块即返回（首段 body 一并带回，剩余 body 由
    /// relayHandler 从 client 继续收）。头解析失败返回 nil。
    private func readRequestHead(_ client: Int32) -> (Request, Data)? {
        var buffer = Data()
        var scratch = [UInt8](repeating: 0, count: 8192)
        var headerEnd = -1
        while headerEnd < 0 {
            let n = recv(client, &scratch, scratch.count, 0)
            guard n > 0 else { return nil }
            buffer.append(contentsOf: scratch[0..<n])
            headerEnd = buffer.range(of: Data("\r\n\r\n".utf8))?.lowerBound ?? -1
            if buffer.count > 256 * 1024 { return nil }
        }
        let bodyStart = headerEnd + 4
        let head = buffer.subdata(in: 0..<headerEnd)
        let partial = buffer.count > bodyStart ? buffer.subdata(in: bodyStart..<buffer.count) : Data()
        guard let headerText = String(data: head, encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0])
        let target = String(parts[1])
        var path = target
        var query = ""
        if let q = target.firstIndex(of: "?") {
            path = String(target[..<q])
            query = String(target[target.index(after: q)...])
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }
        let request = Request(method: method, path: path, query: query, headers: headers,
                              body: partial, rawHead: head)
        return (request, partial)
    }

    /// 单请求 body 上限（32MB）：覆盖附件 base64 上传，拒绝内存放大。
    private static let maxBodyBytes = 32 * 1024 * 1024

    private func writeResponse(_ client: Int32, _ response: Response) {
        var head = "HTTP/1.1 \(response.status) \(statusText(response.status))\r\n"
        head += "Content-Type: \(response.headers["content-type"] ?? "application/json")\r\n"
        head += "Connection: close\r\n"
        for (key, value) in response.headers where key != "content-type" {
            head += "\(key): \(value)\r\n"
        }
        head += "Content-Length: \(response.body.count)\r\n"
        head += "\r\n"
        let headerData = Data(head.utf8)
        headerData.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
            _ = send(client, ptr.baseAddress, ptr.count, 0)
        }
        response.body.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
            _ = send(client, ptr.baseAddress, ptr.count, 0)
        }
    }

    private func statusText(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 204: return "No Content"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 500: return "Internal Server Error"
        default: return "OK"
        }
    }
}

enum SocketProvider {
    static func localPort(of fd: Int32) -> UInt16 {
        var addr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        var result: UInt16 = 0
        withUnsafeMutablePointer(to: &addr) { ptr in
            let raw = UnsafeMutableRawPointer(ptr)
            raw.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
                if getsockname(fd, sockaddrPtr, &len) == 0 {
                    let portPtr = raw.advanced(by: MemoryLayout<sockaddr_in>.offset(of: \.sin_port)!).assumingMemoryBound(to: UInt16.self)
                    result = UInt16(bigEndian: portPtr.pointee)
                }
            }
        }
        return result
    }
}
