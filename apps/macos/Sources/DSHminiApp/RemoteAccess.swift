import Foundation

/// 移动端远程访问的配对与设备台账——把同一台 Mac 上的工作区交给手机控制，
/// 安全边界全在这一层（HTTP 分发与中继复用 `BridgeServer`）。
///
/// 三道闸：① 默认关闭，只有用户在设置里显式开启才起局域网监听；
/// ② 一次性配对令牌——扫码落地成功即轮换，截屏/拍屏拿到的旧二维码立刻作废；
/// ③ 设备台账逐台解绑，cookie 只在台账里认。
///
/// 已配对设备靠自己的 cookie 长期可用（重开页面不再走令牌），所以令牌轮换
/// 不会把已连上的手机踢掉。
///
/// 监听地址固定 0.0.0.0、端口独立于回环桥：回环端口是桌面 WebView 的 origin
/// （PITFALLS §4.17），不能跟着远程访问开关变动。
final class RemoteAccess {
    static let shared = RemoteAccess()

    static let devicesKey = "deepdive.remote.devices"
    static let portKey = "deepdive.remote.port"
    static let enabledKey = "deepdive.remote.enabled"
    static let cookieName = "deepdive_device"
    /// 请求带 cookie 时更新 lastSeen 的最小间隔，避免每个静态资源都写盘。
    private static let lastSeenWriteInterval: TimeInterval = 60

    /// 一台已配对设备。kind 是 UA 归类（iphone/ipad/android/mac/web），
    /// 展示文案归前端 i18n，壳不产 UI 字符串。
    struct Device {
        let id: String
        let kind: String
        var pairedAt: Date
        var lastSeen: Date
    }

    enum Admission {
        case allowed
        /// 一次性令牌落地：放行，并由调用方回发设备 cookie。
        case paired(cookie: String)
        case denied
    }

    private let lock = NSLock()
    private var token = RemoteAccess.newToken()
    private var devices: [Device] = []
    private var server: MiniHTTPServer?
    /// 二维码缓存（键是链接；令牌轮换即失效重画）。
    private var qrCache: (url: String, data: String)?

    private init() {
        devices = Self.loadDevices()
    }

    // MARK: - 开关与监听

    var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    var isRunning: Bool { server != nil }

    /// 起局域网监听（幂等）。端口优先沿用记住的那个，被占才退回内核分配并
    /// 记住新值——二维码里的链接要能活过重启，端口就不能每次都变。
    @discardableResult
    func start() -> Bool {
        guard server == nil else { return true }
        let server = BridgeServer.shared.makeRemoteListener()
        let preferred = UInt16(clamping: UserDefaults.standard.integer(forKey: Self.portKey))
        var started = preferred != 0 && server.start(port: preferred, address: "0.0.0.0")
        if !started {
            started = server.start(port: 0, address: "0.0.0.0")
            if started {
                UserDefaults.standard.set(server.port, forKey: Self.portKey)
            }
        }
        guard started else {
            EngineLog.shared.append("[remote] listen failed on 0.0.0.0")
            return false
        }
        self.server = server
        UserDefaults.standard.set(true, forKey: Self.enabledKey)
        EngineLog.shared.append("[remote] listening on 0.0.0.0:\(server.port)")
        return true
    }

    func stop() {
        server?.stop()
        server = nil
        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        // 关掉即换令牌：下次开启的二维码与上一次无关。
        lock.lock()
        token = Self.newToken()
        lock.unlock()
        EngineLog.shared.append("[remote] stopped")
    }

    /// 刷新二维码（换令牌，不动已配对设备）。
    func rotateToken() {
        lock.lock()
        token = Self.newToken()
        lock.unlock()
    }

    func revoke(deviceId: String) {
        lock.lock()
        devices.removeAll { $0.id == deviceId }
        let snapshot = devices
        lock.unlock()
        Self.saveDevices(snapshot)
    }

    // MARK: - 准入

    /// 远程面的准入判定。顺序要紧：**先认设备 cookie 再认令牌**——已配对的
    /// 手机刷新页面时会重放带 `?pair=` 的旧 URL，若令牌优先，那次刷新会因为
    /// 令牌已轮换而被拒。
    func admit(_ request: MiniHTTPServer.Request) -> Admission {
        if let id = deviceId(fromCookie: request.headers["cookie"]), touch(deviceId: id) {
            return .allowed
        }
        guard let candidate = Self.queryValue(request.query, "pair") else { return .denied }
        lock.lock()
        guard !token.isEmpty, candidate == token else {
            lock.unlock()
            return .denied
        }
        // 令牌落地即轮换：这张二维码活到下一次配对为止。
        token = Self.newToken()
        let device = Device(id: Self.newToken(), kind: Self.deviceKind(userAgent: request.headers["user-agent"] ?? ""),
                            pairedAt: Date(), lastSeen: Date())
        devices.append(device)
        let snapshot = devices
        lock.unlock()
        Self.saveDevices(snapshot)
        EngineLog.shared.append("[remote] paired \(device.kind)")
        return .paired(cookie: Self.cookieHeader(device.id))
    }

    /// cookie 命中台账则记账并放行；未知 cookie 视为未配对。
    private func touch(deviceId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let index = devices.firstIndex(where: { $0.id == deviceId }) else { return false }
        let now = Date()
        guard now.timeIntervalSince(devices[index].lastSeen) > Self.lastSeenWriteInterval else { return true }
        devices[index].lastSeen = now
        Self.saveDevices(devices)
        return true
    }

    private func deviceId(fromCookie header: String?) -> String? {
        guard let header else { return nil }
        for part in header.split(separator: ";") {
            let trimmed = part.trimmingCharacters(in: .whitespaces)
            guard let eq = trimmed.firstIndex(of: "=") else { continue }
            guard trimmed[..<eq] == Self.cookieName else { continue }
            let value = String(trimmed[trimmed.index(after: eq)...])
            return value.isEmpty ? nil : value
        }
        return nil
    }

    /// 设备 cookie：HttpOnly 防脚本读，SameSite=Lax 让跨站页面带不上它
    /// （WebSocket 握手不受 CORS 约束，这条是远程面 WS 的准入依据）。
    static func cookieHeader(_ deviceId: String) -> String {
        "\(cookieName)=\(deviceId); Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000"
    }

    // MARK: - 状态快照（设置页数据源）

    /// 配对页 HTML：只有没配对成功的手机才会看到。这一页由壳直接吐给浏览器，
    /// 用不上前端的 i18n 词典，所以按壳记住的语言偏好就地取词。
    static var pairingPage: String {
        let zh = DSHAppPrefs.language == "zh"
        let title = zh ? "未配对" : "Not paired"
        let hint = zh ? "请在 Mac 上用 DeepDive 重新扫码或复制链接。"
                      : "Scan the QR code again in DeepDive on your Mac, or copy a fresh link."
        return """
        <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>DeepDive · \(title)</title>
        <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;\
        background:#0b0b0c;color:#e8e8ea;font:15px/1.6 -apple-system,system-ui,sans-serif">
        <div style="text-align:center;max-width:20em">
        <p style="font-size:17px;font-weight:600;margin:0 0 8px">\(title)</p>
        <p style="color:#9a9aa0;margin:0">\(hint)</p>
        </div></body>
        """
    }

    /// 当前配对令牌。只在设置页的二维码链接里露面；配对成功即轮换。
    var pairingToken: String {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    /// 给前端的状态快照（缺 URL 时 qr 为空串，前端据此隐藏二维码）。
    func statusPayload() -> [String: Any] {
        lock.lock()
        let snapshot = devices
        lock.unlock()
        let ip = Self.lanIPv4()
        let url = pairingURL(lanIp: ip)
        return [
            "on": isRunning,
            "port": server?.port ?? 0,
            "lanIp": ip ?? "",
            "url": url,
            "qr": qrDataURL(for: url),
            "devices": snapshot.map { device in
                [
                    "id": device.id,
                    "kind": device.kind,
                    "pairedAt": device.pairedAt.timeIntervalSince1970,
                    "lastSeen": device.lastSeen.timeIntervalSince1970,
                ]
            },
        ]
    }

    /// 二维码按 URL 缓存：状态轮询每 4s 拉一次快照，不必每拍重画一遍位图。
    private func qrDataURL(for url: String?) -> String {
        guard let url else { return "" }
        if let qrCache, qrCache.url == url { return qrCache.data }
        let data = QRCode.dataURL(text: url) ?? ""
        qrCache = (url, data)
        return data
    }

    private func pairingURL(lanIp: String?) -> String? {
        guard let server, let ip = lanIp else { return nil }
        return "http://\(ip):\(server.port)/?pair=\(pairingToken)"
    }

    // MARK: - 局域网地址

    /// 本机用于手机访问的 IPv4（优先 en0，即 Wi-Fi/有线主口）。
    static func lanIPv4() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let head else { return nil }
        defer { freeifaddrs(head) }
        var fallback: String?
        for entry in sequence(first: head, next: { $0.pointee.ifa_next }) {
            let flags = Int32(entry.pointee.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0,
                  let sa = entry.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: host)
            // 169.254.x.x 是链路本地自分配地址，手机连不上
            guard !ip.hasPrefix("169.254.") else { continue }
            if String(cString: entry.pointee.ifa_name) == "en0" { return ip }
            if fallback == nil { fallback = ip }
        }
        return fallback
    }

    // MARK: - 纯函数

    static func deviceKind(userAgent: String) -> String {
        let ua = userAgent.lowercased()
        if ua.contains("iphone") { return "iphone" }
        if ua.contains("ipad") { return "ipad" }
        if ua.contains("android") { return "android" }
        if ua.contains("macintosh") || ua.contains("mac os") { return "mac" }
        return "web"
    }

    /// 取 query 串里某个键的原始值（不做百分号解码：令牌是十六进制）。
    static func queryValue(_ query: String, _ key: String) -> String? {
        for pair in query.split(separator: "&") {
            guard let eq = pair.firstIndex(of: "="), pair[..<eq] == Substring(key) else { continue }
            let value = String(pair[pair.index(after: eq)...])
            return value.isEmpty ? nil : value
        }
        return nil
    }

    private static func newToken() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    // MARK: - 台账持久化

    private static func loadDevices() -> [Device] {
        guard let raw = UserDefaults.standard.string(forKey: devicesKey) else { return [] }
        guard let data = raw.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.compactMap { item in
            guard let id = item["id"] as? String, let kind = item["kind"] as? String,
                  let pairedAt = item["pairedAt"] as? TimeInterval,
                  let lastSeen = item["lastSeen"] as? TimeInterval else { return nil }
            return Device(id: id, kind: kind, pairedAt: Date(timeIntervalSince1970: pairedAt),
                          lastSeen: Date(timeIntervalSince1970: lastSeen))
        }
    }

    private static func saveDevices(_ devices: [Device]) {
        let list: [[String: Any]] = devices.map {
            ["id": $0.id, "kind": $0.kind,
             "pairedAt": $0.pairedAt.timeIntervalSince1970, "lastSeen": $0.lastSeen.timeIntervalSince1970]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: list),
              let raw = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(raw, forKey: devicesKey)
    }
}
