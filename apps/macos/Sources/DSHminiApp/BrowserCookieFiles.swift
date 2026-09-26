// 三种浏览器 cookie 库的读取。**只读，而且先拷一份再读**：浏览器多半正开着，
// 直接读它的活库会拿不到锁（或更糟——把它的注意力招来）。
//
//   · Chromium 系：`Cookies`（SQLite），值在 `encrypted_value` 里，用 `v10` AES 解；
//   · Firefox：`cookies.sqlite`，明文；
//   · Safari：`Cookies.binarycookies`，自家二进制格式（见下）。
//
// 解析器都收"一个文件 URL"，发现哪些文件是 BrowserCookieSource 的事。
import Foundation
import SQLite3

enum CookieFileTrouble: Error {
    /// 打不开/读不动（Safari 的容器没授权就是这一条）
    case unreadable
}

/// 拷贝到临时目录再只读打开：活库要锁，副本不用。
func withCookieDatabase<T>(_ file: URL, _ body: (OpaquePointer) throws -> T) throws -> T {
    let copy = FileManager.default.temporaryDirectory
        .appendingPathComponent("dd-cookie-\(UUID().uuidString).db")
    guard (try? FileManager.default.copyItem(at: file, to: copy)) != nil else { throw CookieFileTrouble.unreadable }
    defer { try? FileManager.default.removeItem(at: copy) }

    var db: OpaquePointer?
    guard sqlite3_open_v2(copy.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
        throw CookieFileTrouble.unreadable
    }
    defer { sqlite3_close(db) }
    return try body(db)
}

func cookieRows(_ db: OpaquePointer, _ sql: String, _ row: (OpaquePointer) -> BrowserCookie?) throws -> [BrowserCookie] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
        throw CookieFileTrouble.unreadable
    }
    defer { sqlite3_finalize(statement) }
    var out: [BrowserCookie] = []
    while sqlite3_step(statement) == SQLITE_ROW {
        if let cookie = row(statement) { out.append(cookie) }
    }
    return out
}

func sqlText(_ statement: OpaquePointer, _ column: Int32) -> String {
    sqlite3_column_text(statement, column).map { String(cString: $0) } ?? ""
}

func sqlBlob(_ statement: OpaquePointer, _ column: Int32) -> Data {
    guard let bytes = sqlite3_column_blob(statement, column) else { return Data() }
    return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, column)))
}

// MARK: - Chromium 系

/// Chrome / Edge / Brave / Arc / Dia / Vivaldi / Chromium 的 `cookies` 表。
/// 值在 `encrypted_value`（`v10` AES）；`value` 那一列在新版一直是空的。
func chromiumCookies(at file: URL, key: [UInt8]) throws -> [BrowserCookie] {
    try withCookieDatabase(file) { db in
        try cookieRows(db, "SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly FROM cookies") { row in
            let name = sqlText(row, 1)
            guard !name.isEmpty else { return nil }
            guard let value = ChromiumCookieCrypto.unwrap(sqlBlob(row, 2), key: key), !value.isEmpty else { return nil }
            // expires_utc 是"1601 年起的微秒"，Chromium 自己的纪元
            let stamp = sqlite3_column_int64(row, 4)
            let expires = stamp > 0 ? Date(timeIntervalSince1970: Double(stamp) / 1_000_000 - 11_644_473_600) : nil
            return BrowserCookie(
                name: name, value: value, domain: sqlText(row, 0), path: sqlText(row, 3),
                secure: sqlite3_column_int(row, 5) != 0, httpOnly: sqlite3_column_int(row, 6) != 0,
                expires: expires
            )
        }
    }
}

// MARK: - Firefox

/// Firefox 的 `moz_cookies` 表（明文，不需要任何授权）。
func firefoxCookies(at file: URL) throws -> [BrowserCookie] {
    try withCookieDatabase(file) { db in
        try cookieRows(db, "SELECT host, name, value, path, expiry, isSecure, isHttpOnly FROM moz_cookies") { row in
            let name = sqlText(row, 1)
            let value = sqlText(row, 2)
            guard !name.isEmpty, !value.isEmpty else { return nil }
            let stamp = sqlite3_column_int64(row, 4)
            let expires = stamp > 0 ? Date(timeIntervalSince1970: Double(stamp)) : nil
            return BrowserCookie(
                name: name, value: value, domain: sqlText(row, 0), path: sqlText(row, 3),
                secure: sqlite3_column_int(row, 5) != 0, httpOnly: sqlite3_column_int(row, 6) != 0,
                expires: expires
            )
        }
    }
}

// MARK: - Safari

/// Safari 的 `Cookies.binarycookies`：`cook` + 页数 + 每页长度，页里是"长度 + 各字段偏移"的
/// 记录，字符串以 NUL 结尾、相对记录起点寻址。全部小端（除页长度是大端）。
///
/// 文件在 Safari 自己的容器里：没给"完全磁盘访问权限"时连打开都会被拒（实测 EPERM），
/// 所以这一支的失败要能区分"没装/没有"与"读不动"。
func safariCookies(at file: URL) throws -> [BrowserCookie] {
    guard let data = try? Data(contentsOf: file) else { throw CookieFileTrouble.unreadable }
    guard data.count > 8, data.prefix(4) == Data("cook".utf8) else { throw CookieFileTrouble.unreadable }

    let pageCount = Int(data.bigEndianUInt32(at: 4) ?? 0)
    guard pageCount > 0, data.count >= 8 + pageCount * 4 else { throw CookieFileTrouble.unreadable }
    var pageSizes: [Int] = []
    for index in 0..<pageCount {
        pageSizes.append(Int(data.bigEndianUInt32(at: 8 + index * 4) ?? 0))
    }

    var out: [BrowserCookie] = []
    var page = 8 + pageCount * 4
    for size in pageSizes {
        guard size > 0, page + size <= data.count else { break }
        out += cookies(inPage: data, start: page, size: size)
        page += size
    }
    return out
}

private func cookies(inPage data: Data, start: Int, size: Int) -> [BrowserCookie] {
    guard let count = data.littleEndianUInt32(at: start + 4) else { return [] }
    var out: [BrowserCookie] = []
    for index in 0..<Int(count) {
        guard let offset = data.littleEndianUInt32(at: start + 8 + index * 4) else { break }
        let record = start + Int(offset)
        guard record + 56 <= start + size else { break }
        let flags = data.littleEndianUInt32(at: record + 8) ?? 0
        // 记录内偏移都是相对记录起点的
        let domain = data.nulTerminatedString(at: record + Int(data.littleEndianUInt32(at: record + 16) ?? 0))
        let name = data.nulTerminatedString(at: record + Int(data.littleEndianUInt32(at: record + 20) ?? 0))
        let path = data.nulTerminatedString(at: record + Int(data.littleEndianUInt32(at: record + 24) ?? 0))
        let value = data.nulTerminatedString(at: record + Int(data.littleEndianUInt32(at: record + 28) ?? 0))
        guard !name.isEmpty, !domain.isEmpty else { continue }
        // 到期时间是"2001 年起的秒"（Cocoa 纪元），0 = 会话 cookie
        let stamp = data.littleEndianDouble(at: record + 32) ?? 0
        out.append(BrowserCookie(
            name: name, value: value, domain: domain, path: path,
            secure: flags & 1 != 0, httpOnly: flags & 4 != 0,
            expires: stamp > 0 ? Date(timeIntervalSinceReferenceDate: stamp) : nil
        ))
    }
    return out
}

private extension Data {
    func littleEndianUInt32(at offset: Int) -> UInt32? {
        guard offset >= 0, offset + 4 <= count else { return nil }
        return withUnsafeBytes { raw in
            UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: offset, as: UInt32.self))
        }
    }

    func bigEndianUInt32(at offset: Int) -> UInt32? {
        guard offset >= 0, offset + 4 <= count else { return nil }
        return withUnsafeBytes { raw in
            UInt32(bigEndian: raw.loadUnaligned(fromByteOffset: offset, as: UInt32.self))
        }
    }

    func littleEndianDouble(at offset: Int) -> Double? {
        guard offset >= 0, offset + 8 <= count else { return nil }
        return withUnsafeBytes { raw in
            Double(bitPattern: UInt64(littleEndian: raw.loadUnaligned(fromByteOffset: offset, as: UInt64.self)))
        }
    }

    /// 从偏移读到 NUL（含）为止；没找到 NUL 就到此为止。
    func nulTerminatedString(at offset: Int) -> String {
        guard offset >= 0, offset < count else { return "" }
        let end = self[offset...].firstIndex(of: 0) ?? count
        return String(data: self[offset..<end], encoding: .utf8) ?? ""
    }
}
