import Foundation

/// Minimal threaded HTTP/1.1 server on 127.0.0.1 — the DSHmini bridge origin.
/// Short connections for static files and unary /api hops; WebSocket upgrades
/// are handed to the relay raw. POSIX sockets keep it dependency-free.
final class MiniHTTPServer {
    struct Request {
        let method: String
        let path: String
        let headers: [String: String]
        let body: Data
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
    private let socketQueue = DispatchQueue(label: "dshmini.bridge.accept")
    private var running = false
    private let callback: (Request) -> Stream

    var port: Int { Int(SocketProvider.localPort(of: listenFD)) }

    init(callback: @escaping (Request) -> Stream) {
        self.callback = callback
    }

    func start() -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        listenFD = fd
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
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
        guard let request = readRequest(client) else { return }
        switch callback(request) {
        case .response(let response):
            writeResponse(client, response)
            close(client)
        case .upgrade:
            // The relay owns the socket from here (handshake + bidirectional
            // pump); it closes both ends when the stream ends.
            upgradeHandler?(client, request)
            return
        }
    }

    private func readRequest(_ client: Int32) -> Request? {
        var buffer = Data()
        var scratch = [UInt8](repeating: 0, count: 8192)
        var headerEnd = -1
        while headerEnd < 0 {
            let n = recv(client, &scratch, scratch.count, 0)
            guard n > 0 else { return nil }
            buffer.append(contentsOf: scratch[0..<n])
            headerEnd = buffer.range(of: Data("\r\n\r\n".utf8))?.lowerBound ?? -1
            if buffer.count > 64 * 1024 { return nil }
        }
        guard let headerText = String(data: buffer.subdata(in: 0..<headerEnd), encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0])
        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }

        let bodyOffset = headerEnd + 4
        var body = buffer.count > bodyOffset ? buffer.subdata(in: bodyOffset..<buffer.count) : Data()
        if let contentLength = headers["content-length"].flatMap({ Int($0) }), contentLength > body.count {
            while body.count < contentLength {
                let n = recv(client, &scratch, scratch.count, 0)
                guard n > 0 else { return nil }
                body.append(contentsOf: scratch[0..<n])
            }
        }
        return Request(method: method, path: path, headers: headers, body: body)
    }

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
