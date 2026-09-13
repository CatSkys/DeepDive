import XCTest
@testable import DeepDive

/// 移动端远程面的准入判定：设备 cookie 优先于一次性令牌、令牌落地即轮换、
/// 解绑后 cookie 立刻失效。这台 Mac 上的工作区（含执行命令）对局域网开放与否
/// 全看这几条，所以逐条钉死。
final class RemoteAccessTests: XCTestCase {
    private var savedEnabled: Any?

    override func setUp() {
        super.setUp()
        savedEnabled = UserDefaults.standard.object(forKey: RemoteAccess.enabledKey)
        clearDevices()
    }

    override func tearDown() {
        clearDevices()
        if let savedEnabled {
            UserDefaults.standard.set(savedEnabled, forKey: RemoteAccess.enabledKey)
        } else {
            UserDefaults.standard.removeObject(forKey: RemoteAccess.enabledKey)
        }
        super.tearDown()
    }

    // MARK: - 纯函数

    func testDeviceKindMapsUserAgent() {
        XCTAssertEqual(RemoteAccess.deviceKind(userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "iphone")
        XCTAssertEqual(RemoteAccess.deviceKind(userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0)"), "ipad")
        XCTAssertEqual(RemoteAccess.deviceKind(userAgent: "Mozilla/5.0 (Linux; Android 14)"), "android")
        XCTAssertEqual(RemoteAccess.deviceKind(userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "mac")
        XCTAssertEqual(RemoteAccess.deviceKind(userAgent: "curl/8.4.0"), "web")
        XCTAssertEqual(RemoteAccess.deviceKind(userAgent: ""), "web")
    }

    func testQueryValueReadsPairToken() {
        XCTAssertEqual(RemoteAccess.queryValue("pair=abc123", "pair"), "abc123")
        XCTAssertEqual(RemoteAccess.queryValue("a=1&pair=abc123&b=2", "pair"), "abc123")
        XCTAssertNil(RemoteAccess.queryValue("pair=", "pair"), "空值不算命中")
        XCTAssertNil(RemoteAccess.queryValue("other=1", "pair"))
        XCTAssertNil(RemoteAccess.queryValue("", "pair"))
    }

    func testCookieHeaderIsHttpOnlySameSiteLax() {
        let header = RemoteAccess.cookieHeader("dev-1")
        XCTAssertTrue(header.hasPrefix("\(RemoteAccess.cookieName)=dev-1;"))
        XCTAssertTrue(header.contains("HttpOnly"))
        // WebSocket 握手不受 CORS 约束，SameSite=Lax 是远程面 WS 的准入依据
        XCTAssertTrue(header.contains("SameSite=Lax"))
    }

    func testOriginMatchesHost() {
        XCTAssertTrue(BridgeServer.originMatchesHost("http://192.168.1.5:4321", host: "192.168.1.5:4321"))
        XCTAssertFalse(BridgeServer.originMatchesHost("http://192.168.1.5:4321", host: "192.168.1.9:4321"))
        XCTAssertFalse(BridgeServer.originMatchesHost("http://evil.example", host: "192.168.1.5:4321"))
        XCTAssertFalse(BridgeServer.originMatchesHost("http://192.168.1.5:4321", host: ""))
    }

    // MARK: - 准入

    func testPairingTokenAdmitsOnceThenRotates() throws {
        let token = RemoteAccess.shared.pairingToken
        let cookie = try XCTUnwrap(pairedCookie(RemoteAccess.shared.admit(request(query: "pair=\(token)"))))
        XCTAssertFalse(cookie.isEmpty)

        // 令牌落地即轮换：同一张二维码（截屏/拍屏拿到的）再用一次必须被拒
        XCTAssertTrue(isDenied(RemoteAccess.shared.admit(request(query: "pair=\(token)"))))
        XCTAssertNotEqual(RemoteAccess.shared.pairingToken, token)
    }

    func testPairedCookieAdmitsAndRevokeKillsIt() throws {
        let token = RemoteAccess.shared.pairingToken
        let cookie = try XCTUnwrap(pairedCookie(RemoteAccess.shared.admit(request(query: "pair=\(token)"))))

        // 已配对设备刷新页面时重放的是带 ?pair= 的旧 URL——cookie 优先，不该被
        // 已轮换的令牌拒掉
        if case .allowed = RemoteAccess.shared.admit(request(query: "pair=\(token)", cookie: cookie)) {} else {
            XCTFail("已配对 cookie 应放行")
        }

        let deviceId = try XCTUnwrap(cookieDeviceId(cookie))
        RemoteAccess.shared.revoke(deviceId: deviceId)
        XCTAssertTrue(isDenied(RemoteAccess.shared.admit(request(cookie: cookie))), "解绑后 cookie 立刻失效")
    }

    func testUnknownAndMissingCookieAreDenied() {
        XCTAssertTrue(isDenied(RemoteAccess.shared.admit(request())))
        XCTAssertTrue(isDenied(RemoteAccess.shared.admit(request(cookie: "\(RemoteAccess.cookieName)=nope"))))
        XCTAssertTrue(isDenied(RemoteAccess.shared.admit(request(cookie: "other=1"))))
        XCTAssertTrue(isDenied(RemoteAccess.shared.admit(request(query: "pair=wrong-token"))))
    }

    func testAdmittedDeviceLandsInStatusPayload() throws {
        let token = RemoteAccess.shared.pairingToken
        _ = try XCTUnwrap(pairedCookie(RemoteAccess.shared.admit(
            request(query: "pair=\(token)", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0)"))))

        let devices = try XCTUnwrap(RemoteAccess.shared.statusPayload()["devices"] as? [[String: Any]])
        XCTAssertEqual(devices.count, 1)
        XCTAssertEqual(devices.first?["kind"] as? String, "ipad")
        XCTAssertNotNil(devices.first?["pairedAt"] as? TimeInterval)
    }

    // MARK: - 夹具

    private func request(query: String = "", cookie: String? = nil,
                         userAgent: String = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") -> MiniHTTPServer.Request {
        var headers = ["user-agent": userAgent]
        if let cookie { headers["cookie"] = cookie }
        return MiniHTTPServer.Request(method: "GET", path: "/", query: query, headers: headers,
                                      body: Data(), rawHead: Data())
    }

    private func isDenied(_ admission: RemoteAccess.Admission) -> Bool {
        if case .denied = admission { return true }
        return false
    }

    private func pairedCookie(_ admission: RemoteAccess.Admission) -> String? {
        if case .paired(let cookie) = admission { return cookie }
        return nil
    }

    /// 从 Set-Cookie 值里取设备 id。
    private func cookieDeviceId(_ header: String) -> String? {
        guard let part = header.split(separator: ";").first else { return nil }
        let prefix = RemoteAccess.cookieName + "="
        guard part.hasPrefix(prefix) else { return nil }
        return String(part.dropFirst(prefix.count))
    }

    private func clearDevices() {
        let devices = RemoteAccess.shared.statusPayload()["devices"] as? [[String: Any]] ?? []
        for raw in devices {
            if let id = raw["id"] as? String { RemoteAccess.shared.revoke(deviceId: id) }
        }
        UserDefaults.standard.removeObject(forKey: RemoteAccess.devicesKey)
    }
}
