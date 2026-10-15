import Foundation

/// Minimal threaded HTTP/1.1 server — the DeepDive bridge origin (loopback by
/// default；移动端远程面另起一个局域网监听，见 `RemoteAccess`).
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
        /// 超过缓冲上限、已落到临时文件的 body（上传面）：转发方从文件流式送出，
        /// 桥里不出现第二份全量缓冲。响应写完由服务器删掉这个文件。
        var bodyFile: URL?
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
    }

    /// Set once at start; responsible for the handshake relay + byte pump.
    var upgradeHandler: ((Int32, Request) -> Void)?

    private var listenFD: Int32 = -1
    private let socketQueue = DispatchQueue(label: "deepdive.bridge.accept")
    private var running = false
    private let callback: (Request) -> Stream

    var port: Int { Int(SocketProvider.localPort(of: listenFD)) }

    init(callback: @escaping (Request) -> Stream) {
        self.callback = callback
    }

    /// port = 0 由内核分配；给定端口则固定监听它（被占时调用方可退回 0）。
    /// address 默认回环：只有移动端远程面（`RemoteAccess`）显式传 "0.0.0.0"，
    /// 其余调用方一律不暴露到局域网。
    func start(port: UInt16 = 0, address: String = "127.0.0.1") -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        listenFD = fd
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr(address)
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
        // 后立刻设接收/发送超时，recv 超时返回 -1，readRequest 按 EOF 处理断开；
        // 慢读者（不 send 的连接）也不会把这条线程钉死（send 超时 → -1，发完
        // 即断）。空闲 keep-alive 连接被同一个 15s 收口。
        var tv = timeval(tv_sec: 15, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var stv = timeval(tv_sec: 30, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &stv, socklen_t(MemoryLayout<timeval>.size))
        // HTTP/1.1 默认 keep-alive：同一连接顺序处理多条请求，静态/策略面的
        // 每请求「新 TCP + 新线程」开销消失（冷启动 index + assets 一百多个请求
        // 落到一条复用连接上）。管线化不支持：一请求一响应、发完才读下一条。
        var alive = true
        while alive {
            guard let (headRequest, partial) = readRequestHead(client) else {
                break
            }
            let declared = headRequest.contentLength ?? partial.count
            // 超过**缓冲**上限：上传面落临时文件（几百 MB 的文件整段进内存就是把内存吃光），
            // 其余路径维持显式 413——那些面的 body 本来就小，超了说明客户端不对。
            let spool = declared > Self.maxBodyBytes && Self.spoolsBody(path: headRequest.path)
            if declared > Self.maxBodyBytes && !spool {
                // 客户端可能仍在发 body，响应先写后关，XHR 侧按 413/网络错误归到上传失败。
                _ = writeResponse(client, Response(status: 413), keepAlive: false)
                break
            }
            var body = Data()
            var bodyFile: URL?
            var sink: FileHandle?
            if spool {
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("dsh-bridge-body-\(UUID().uuidString)")
                guard FileManager.default.createFile(atPath: url.path, contents: nil),
                      let handle = try? FileHandle(forWritingTo: url) else {
                    _ = writeResponse(client, Response(status: 500), keepAlive: false)
                    break
                }
                bodyFile = url
                sink = handle
            } else {
                body = partial
            }
            try? sink?.write(contentsOf: partial)
            var scratch = [UInt8](repeating: 0, count: 64 * 1024)
            var read = partial.count
            while read < declared {
                let n = recv(client, &scratch, scratch.count, 0)
                guard n > 0 else { break }
                read += n
                if let sink {
                    try? sink.write(contentsOf: Data(scratch[0..<n]))
                } else {
                    body.append(contentsOf: scratch[0..<n])
                }
            }
            try? sink?.close()
            let request = Request(method: headRequest.method, path: headRequest.path, query: headRequest.query,
                                  headers: headRequest.headers, body: body, bodyFile: bodyFile,
                                  rawHead: headRequest.rawHead)
            let wantsClose = request.headers["connection"]?.lowercased() == "close"
            switch callback(request) {
            case .response(let response):
                let sent = writeResponse(client, response, keepAlive: !wantsClose)
                // 发送失败（对端死/30s 慢读者）：连接告废，不再攒请求。
                alive = wantsClose ? false : sent
            case .upgrade:
                // The relay owns the socket from here (handshake + bidirectional
                // pump); it closes both ends when the stream ends.
                upgradeHandler?(client, request)
                return
            }
            // 落盘的 body 用完即删（转发是同步的，到这里已经送出去了）
            if let url = bodyFile { try? FileManager.default.removeItem(at: url) }
        }
        close(client)
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

    /// 单请求 body 的**缓冲**上限（32MB）：小于它整段进内存转发；超过它只有上传面
    /// （`spoolsBody`）落临时文件后流式转发——**这不是大小上限**，附件多大都发得出去
    /// （用户 2026-10-09："引擎没有就加啊…不应该有大小限制"）。其余 /api 面的 body
    /// 本来就小，超了照旧回 413（说明客户端不对，别悄悄缓冲）。
    private static let maxBodyBytes = 32 * 1024 * 1024

    /// 允许"超上限落盘、流式转发"的路径：引擎的字节上传面（DSH-WIRE §5）。
    /// 那个路由本来就是流式收字节的（`handleFileUploadHttp` 逐块落盘），是桥在整段缓冲。
    private static func spoolsBody(path: String) -> Bool {
        path == "/api/session/uploadFileBinary"
    }

    /// 写响应：keep-alive 时声明同一连接可续（面不去掉再读下一条），且**回执
    /// 是否完整送达**——SO_SNDTIMEO 兜住的慢读者/半死连接返回 false，调用方
    /// 据此断开不给它续。发送逐段推进直到送完（旧实现单次 send 丢弃返回值，
    /// 大响应可能静默截断）。
    @discardableResult
    private func writeResponse(_ client: Int32, _ response: Response, keepAlive: Bool = true) -> Bool {
        var head = "HTTP/1.1 \(response.status) \(statusText(response.status))\r\n"
        head += "Content-Type: \(response.headers["content-type"] ?? "application/json")\r\n"
        head += "Connection: \(keepAlive ? "keep-alive" : "close")\r\n"
        for (key, value) in response.headers where key != "content-type" {
            head += "\(key): \(value)\r\n"
        }
        head += "Content-Length: \(response.body.count)\r\n"
        head += "\r\n"
        return Self.sendAll(client, Data(head.utf8)) && Self.sendAll(client, response.body)
    }

    /// 把 data 全部发出去（中断/超时即 false）。单一发送路径，调用方好收尾。
    static func sendAll(_ fd: Int32, _ data: Data) -> Bool {
        var sent = 0
        while sent < data.count {
            let n = data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
                send(fd, ptr.baseAddress!.advanced(by: sent), data.count - sent, 0)
            }
            guard n > 0 else { return false }
            sent += n
        }
        return true
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
