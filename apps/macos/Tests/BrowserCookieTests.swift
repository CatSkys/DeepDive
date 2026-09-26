import XCTest
import CommonCrypto
import SQLite3
import WebKit
@testable import DeepDive

/// cookie 导入这一块的钉子：三种库的解析（含 Chromium 的 AES 与 Safari 的二进制格式）、
/// 来源发现、以及"写进 store 真的进去了"（用真 WebKit 的 cookie store 验）。
final class BrowserCookieTests: XCTestCase {
    private var root: URL!
    /// store 测试用的固定标识：每次 setUp 先清掉上一轮的残留
    private let testStoreID = UUID(uuidString: "B0A1C2D3-E4F5-4061-8273-849506172839")!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("dd-cookie-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        removeTestStore()
    }

    override func tearDownWithError() throws {
        removeTestStore()
        try? FileManager.default.removeItem(at: root)
    }

    /// 测试用的 store：把内容清空（删目录那支 API 的 Swift 名字与可用性都别扭，
    /// 而这里要的只是"每轮从干净的开始"）。
    private func removeTestStore() {
        let done = expectation(description: "clean store")
        BrowserDataStore.clear(WKWebsiteDataStore(forIdentifier: testStoreID)) { done.fulfill() }
        wait(for: [done], timeout: 20)
    }

    // MARK: - cookie → NSHTTPCookie

    func testHttpOnlySurvivesThePropertyDictionary() {
        // HttpOnly 不在 NSHTTPCookie 的公开属性里，靠自定义属性键。写错的表现是"导入成功但
        // 会话 cookie 变成脚本可读"——不报错，所以钉住它。
        let cookie = BrowserCookie(name: "sid", value: "v", domain: ".example.com", path: "/",
                                   secure: true, httpOnly: true, expires: Date(timeIntervalSince1970: 1_800_000_000))
        let http = cookie.httpCookie
        XCTAssertEqual(http?.name, "sid")
        XCTAssertEqual(http?.domain, ".example.com")
        XCTAssertTrue(http?.isSecure == true)
        XCTAssertTrue(http?.isHTTPOnly == true)
        XCTAssertNotNil(http?.expiresDate)
        XCTAssertFalse(BrowserCookie(name: "a", value: "b", domain: "e.com", path: "", secure: false, httpOnly: false, expires: nil).httpCookie?.isHTTPOnly == true)
    }

    // MARK: - Chromium 的 AES

    func testChromiumUnwrapRoundTrips() {
        let key = ChromiumCookieCrypto.stretch("correct horse battery staple")
        XCTAssertEqual(key.count, 16)
        XCTAssertEqual(ChromiumCookieCrypto.unwrap(seal("hunter2", key: key), key: key), "hunter2")
        // 老档案没有 v10 前缀：本来就是明文
        XCTAssertEqual(ChromiumCookieCrypto.unwrap(Data("plain".utf8), key: key), "plain")
        // 解不开的密文给 nil，不猜
        XCTAssertNil(ChromiumCookieCrypto.unwrap(Data("v10garbage".utf8), key: key))
    }

    func testChromiumUnwrapDropsTheSiteHashPrefix() {
        // 新版在密码前面写 32 字节站点哈希；解出来是二进制的，不是合法 UTF-8
        let key = ChromiumCookieCrypto.stretch("pw")
        let blob = seal(String(repeating: "x", count: 32) + "hunter2", key: key)
        // 直接按 UTF-8 解会失败吗？全 ASCII 时不会——所以这条只钉"有前缀时也要能把值剥出来"
        XCTAssertTrue(ChromiumCookieCrypto.unwrap(blob, key: key)?.hasSuffix("hunter2") == true)
    }

    func testChromiumCookiesReadFromSqlite() throws {
        let key = ChromiumCookieCrypto.stretch("pw")
        let file = root.appendingPathComponent("Cookies")
        let db = try open(db: file, sql: """
        CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB, path TEXT,
                              expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER);
        """)
        try insert(db, "INSERT INTO cookies VALUES (?,?,?,?,?,?,?)", [
            ".example.com", "sid", seal("secret", key: key), "/", 13_300_000_000_000_000 as Int64, 1 as Int64, 1 as Int64,
        ])
        sqlite3_close(db)

        let cookies = try chromiumCookies(at: file, key: key)
        XCTAssertEqual(cookies.count, 1)
        XCTAssertEqual(cookies[0].name, "sid")
        XCTAssertEqual(cookies[0].value, "secret")
        XCTAssertEqual(cookies[0].domain, ".example.com")
        XCTAssertTrue(cookies[0].secure)
        XCTAssertTrue(cookies[0].httpOnly)
        // 1601 纪元的微秒 → 2022 年附近（只钉量级，不钉那一秒）
        XCTAssertEqual(cookies[0].expires?.timeIntervalSince1970 ?? 0, 1_655_000_000, accuracy: 20_000_000)
    }

    // MARK: - Firefox

    func testFirefoxCookiesReadFromSqlite() throws {
        let file = root.appendingPathComponent("cookies.sqlite")
        let db = try open(db: file, sql: """
        CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT,
                                  expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER);
        """)
        try insert(db, "INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?)", [
            ".example.org", "token", "abc", "/", 1_800_000_000 as Int64, 0 as Int64, 1 as Int64,
        ])
        sqlite3_close(db)

        let cookies = try firefoxCookies(at: file)
        XCTAssertEqual(cookies.first?.name, "token")
        XCTAssertEqual(cookies.first?.value, "abc")
        XCTAssertEqual(cookies.first?.expires, Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertFalse(cookies.first?.secure == true)
        XCTAssertTrue(cookies.first?.httpOnly == true)
    }

    // MARK: - Safari 的 binarycookies

    func testSafariCookiesReadFromBinaryFile() throws {
        let file = root.appendingPathComponent("Cookies.binarycookies")
        try binaryCookies([
            (domain: ".example.com", name: "a", path: "/", value: "1", secure: true, httpOnly: true, expires: 700_000_000),
            (domain: "example.com", name: "b", path: "/x", value: "2", secure: false, httpOnly: false, expires: 0),
        ]).write(to: file)

        let cookies = try safariCookies(at: file)
        XCTAssertEqual(cookies.count, 2)
        XCTAssertEqual(cookies[0].name, "a")
        XCTAssertEqual(cookies[0].domain, ".example.com")
        XCTAssertEqual(cookies[0].value, "1")
        XCTAssertTrue(cookies[0].secure)
        XCTAssertTrue(cookies[0].httpOnly)
        XCTAssertEqual(cookies[0].expires, Date(timeIntervalSinceReferenceDate: 700_000_000))
        XCTAssertEqual(cookies[1].name, "b")
        XCTAssertEqual(cookies[1].path, "/x")
        XCTAssertNil(cookies[1].expires, "到期 0 = 会话 cookie")
    }

    func testUnreadableSafariFileIsReportedAsPermission() throws {
        let source = BrowserCookieSource(id: "safari", name: "Safari", kind: .safari, root: root)
        let file = root.appendingPathComponent("Cookies.binarycookies")
        try Data("cook".utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: file.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path) }
        XCTAssertThrowsError(try source.read()) { error in
            XCTAssertEqual(error as? BrowserCookieSource.Trouble, .permission)
        }
    }

    // MARK: - 来源发现

    func testInstalledFindsOnlyBrowsersWithCookieFiles() throws {
        let support = root.appendingPathComponent("Application Support")
        let home = root.appendingPathComponent("home")
        try FileManager.default.createDirectory(at: support.appendingPathComponent("Google/Chrome/Default"), withIntermediateDirectories: true)
        try Data().write(to: support.appendingPathComponent("Google/Chrome/Default/Cookies"))
        try Data().write(to: support.appendingPathComponent("Google/Chrome/Default/Other"))   // 不是 cookie 库
        try FileManager.default.createDirectory(at: support.appendingPathComponent("BraveSoftware/Brave-Browser"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: support.appendingPathComponent("Firefox/Profiles/abc.default"), withIntermediateDirectories: true)
        try Data().write(to: support.appendingPathComponent("Firefox/Profiles/abc.default/cookies.sqlite"))

        let found = BrowserCookieSource.installed(home: home, applicationSupport: support)
        XCTAssertEqual(found.map(\.id), ["chrome", "firefox"], "只有真有 cookie 库的才算装")
        XCTAssertEqual(try found[0].cookieFiles().count, 1)
        XCTAssertEqual(try found[1].cookieFiles().count, 1)
    }

    func testUnlistableSourceIsListedButMarkedBlocked() throws {
        // macOS 14 起"别的应用的数据"是一道独立 TCC 闸：目录列不出来时**不能**当成"没装"
        // （否则设置页会说"没检测到可导入的浏览器"）。列出来 + blocked + 导入给 permission。
        let support = root.appendingPathComponent("Application Support")
        let chrome = support.appendingPathComponent("Google/Chrome")
        try FileManager.default.createDirectory(at: chrome, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: chrome.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: chrome.path) }

        let found = BrowserCookieSource.installed(home: root, applicationSupport: support)
        XCTAssertEqual(found.map(\.id), ["chrome"], "读不动也要列出来")
        let payload = BrowserCookies.payload(found)
        let entry = (payload["sources"] as? [[String: Any]])?.first
        XCTAssertEqual(entry?["blocked"] as? Bool, true, "要标出来，别等人点了导入才报错")
        XCTAssertThrowsError(try found[0].read()) { error in
            XCTAssertEqual(error as? BrowserCookieSource.Trouble, .permission)
        }
    }

    func testChromiumWithoutKeychainKeySaysSoInsteadOfCoughing() throws {
        // 用不存在的 keychain 项：SecItemCopyMatching 回 errSecItemNotFound（不弹窗），
        // 导入必须给"拿不到密钥"这个码，而不是空数组或崩溃
        let support = root.appendingPathComponent("Application Support")
        try FileManager.default.createDirectory(at: support.appendingPathComponent("Google/Chrome/Default"), withIntermediateDirectories: true)
        try Data().write(to: support.appendingPathComponent("Google/Chrome/Default/Cookies"))
        let source = BrowserCookieSource.installed(home: root, applicationSupport: support)[0]
        var patched = source
        patched = BrowserCookieSource(id: source.id, name: source.name,
                                      kind: .chromium(BrowserCookieSource.SafeStorage(service: "dd-no-such-service", account: "nope")),
                                      root: source.root)
        XCTAssertThrowsError(try patched.read()) { error in
            XCTAssertEqual(error as? BrowserCookieSource.Trouble, .noKey)
        }
    }

    // MARK: - 桥契约

    func testParsesBrowserCookiesMessages() {
        XCTAssertEqual(BrowserCookies.command(["action": "sources"]), .sources)
        XCTAssertEqual(BrowserCookies.command(["action": "import", "source": "chrome"]), .importSource("chrome"))
        XCTAssertEqual(BrowserCookies.command(["action": "clear"]), .clear)
        XCTAssertNil(BrowserCookies.command(["action": "import"]), "import 缺 source：当不认识，别猜一个来源")
        XCTAssertNil(BrowserCookies.command(["action": "wipe"]))
        XCTAssertNil(BrowserCookies.command([:]))
    }

    // MARK: - 真 store：写进去了，而且与 default 隔离

    func testImportWritesIntoTheBrowserStoreOnly() throws {
        let support = root.appendingPathComponent("Application Support")
        try FileManager.default.createDirectory(at: support.appendingPathComponent("Firefox/Profiles/p"), withIntermediateDirectories: true)
        let db = try open(db: support.appendingPathComponent("Firefox/Profiles/p/cookies.sqlite"), sql: """
        CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT,
                                  expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER);
        """)
        try insert(db, "INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?)", [
            "127.0.0.1", "ddimport", "yes", "/", 1_900_000_000 as Int64, 0 as Int64, 1 as Int64,
        ])
        sqlite3_close(db)

        let source = BrowserCookieSource.installed(home: root, applicationSupport: support)[0]
        XCTAssertEqual(source.id, "firefox")
        let store = WKWebsiteDataStore(forIdentifier: testStoreID)
        let done = expectation(description: "import")
        var payload: [String: Any] = [:]
        BrowserCookieImport.run(source: source, store: store) { result in
            payload = result
            done.fulfill()
        }
        wait(for: [done], timeout: 20)
        XCTAssertEqual(payload["code"] as? String, "ok")
        XCTAssertEqual(payload["imported"] as? Int, 1)
        XCTAssertEqual(payload["total"] as? Int, 1)

        let read = expectation(description: "read back")
        var inStore: [HTTPCookie] = []
        store.httpCookieStore.getAllCookies { cookies in
            inStore = cookies
            read.fulfill()
        }
        wait(for: [read], timeout: 10)
        XCTAssertEqual(inStore.first(where: { $0.name == "ddimport" })?.value, "yes")
        XCTAssertTrue(inStore.first(where: { $0.name == "ddimport" })?.isHTTPOnly == true)

        // 隔离：主 SPA 用的 default store 里不该有它
        let other = expectation(description: "default store")
        var defaultCookies: [HTTPCookie] = []
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            defaultCookies = cookies
            other.fulfill()
        }
        wait(for: [other], timeout: 10)
        XCTAssertFalse(defaultCookies.contains { $0.name == "ddimport" }, "浏览器的 cookie 不该漏进应用自身的 store")
    }

    // MARK: - 夹具

    private func seal(_ text: String, key: [UInt8]) -> Data {
        let body = Array(text.utf8)
        var out = [UInt8](repeating: 0, count: body.count + kCCBlockSizeAES128)
        var moved = 0
        let iv = [UInt8](repeating: 0x20, count: 16)
        let status = CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES128),
                             CCOptions(kCCOptionPKCS7Padding), key, key.count, iv,
                             body, body.count, &out, out.count, &moved)
        XCTAssertEqual(Int(status), Int(kCCSuccess))
        return Data("v10".utf8) + Data(out.prefix(moved))
    }

    private func open(db file: URL, sql: String) throws -> OpaquePointer {
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(file.path, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK)
        return try XCTUnwrap(db)
    }

    private func insert(_ db: OpaquePointer, _ sql: String, _ values: [Any]) throws {
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(db, sql, -1, &statement, nil), SQLITE_OK)
        for (index, value) in values.enumerated() {
            let position = Int32(index + 1)
            if let text = value as? String {
                sqlite3_bind_text(statement, position, text, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            } else if let number = value as? Int64 {
                sqlite3_bind_int64(statement, position, number)
            } else if let data = value as? Data {
                _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, position, $0.baseAddress, Int32(data.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
            }
        }
        XCTAssertEqual(sqlite3_step(statement), SQLITE_DONE)
        sqlite3_finalize(statement)
    }

    /// 造一个 Safari 的 `Cookies.binarycookies`（一页）。
    private func binaryCookies(_ cookies: [(domain: String, name: String, path: String, value: String,
                                            secure: Bool, httpOnly: Bool, expires: Double)]) -> Data {
        let count = cookies.count
        let headerSize = 12 + count * 4
        var records = Data()
        var offsets: [UInt32] = []
        for cookie in cookies {
            offsets.append(UInt32(headerSize + records.count))
            let strings = [cookie.domain, cookie.name, cookie.path, cookie.value].map { Data($0.utf8) + Data([0]) }
            let size = 56 + strings.reduce(0) { $0 + $1.count }
            var record = le32(UInt32(size)) + le32(0)
            record += le32((cookie.secure ? 1 : 0) | (cookie.httpOnly ? 4 : 0)) + le32(0)
            var stringOffset = UInt32(56)
            for text in strings {
                record += le32(stringOffset)
                stringOffset += UInt32(text.count)
            }
            // 记录头是 56 字节：四个 u32 + 四个偏移 + 到期 + 创建 + 8 字节未用（真档案里就是这样）
            record += leDouble(cookie.expires) + leDouble(0) + Data(repeating: 0, count: 8)
            for text in strings { record += text }
            records += record
        }
        var page = le32(0x0000_0100) + le32(UInt32(count))
        for offset in offsets { page += le32(offset) }
        page += le32(0)
        page += records
        return Data("cook".utf8) + be32(1) + be32(UInt32(page.count)) + page
    }

    private func le32(_ value: UInt32) -> Data { withUnsafeBytes(of: value.littleEndian) { Data($0) } }
    private func be32(_ value: UInt32) -> Data { withUnsafeBytes(of: value.bigEndian) { Data($0) } }
    private func leDouble(_ value: Double) -> Data { withUnsafeBytes(of: value.bitPattern.littleEndian) { Data($0) } }
}
