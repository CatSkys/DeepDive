// 能从哪些浏览器导入 cookie：这台机器上装了、且真有 cookie 库的那些。
//
// 布局是"读文件"那一层的事（`BrowserCookieFiles`），这里只管三件：装了什么、库在哪、
// 读出来归谁。根目录由调用方给（`installed(home:applicationSupport:)`）——测试拿临时目录
// 造档案，不必碰真机上的浏览器。
import Foundation

struct BrowserCookieSource: Identifiable, Equatable {
    /// Chromium 系的解密要它：keychain 里那一项的服务名与账号名。
    struct SafeStorage: Equatable {
        var service: String
        var account: String
    }

    enum Kind: Equatable {
        case chromium(SafeStorage)
        case firefox
        case safari
    }

    let id: String
    let name: String
    let kind: Kind
    /// 数据根：chromium 是它在 Application Support 下的目录，firefox 是 `Firefox`，
    /// safari 是它容器里那个 Cookies 目录（cookie 不在 Application Support 下）。
    let root: URL

    /// 认识的浏览器（顺序即设置页里的顺序）。
    static let known: [(id: String, name: String, folder: String, kind: Kind)] = [
        ("chrome", "Chrome", "Google/Chrome", .chromium(SafeStorage(service: "Chrome Safe Storage", account: "Chrome"))),
        ("edge", "Edge", "Microsoft Edge", .chromium(SafeStorage(service: "Microsoft Edge Safe Storage", account: "Microsoft Edge"))),
        ("arc", "Arc", "Arc/User Data", .chromium(SafeStorage(service: "Arc Safe Storage", account: "Arc"))),
        ("brave", "Brave", "BraveSoftware/Brave-Browser", .chromium(SafeStorage(service: "Brave Safe Storage", account: "Brave"))),
        ("dia", "Dia", "Dia/User Data", .chromium(SafeStorage(service: "Dia Safe Storage", account: "Dia"))),
        ("vivaldi", "Vivaldi", "Vivaldi", .chromium(SafeStorage(service: "Vivaldi Safe Storage", account: "Vivaldi"))),
        ("chromium", "Chromium", "Chromium", .chromium(SafeStorage(service: "Chromium Safe Storage", account: "Chromium"))),
        ("firefox", "Firefox", "Firefox", .firefox),
        ("safari", "Safari", "Containers/com.apple.Safari/Data/Library/Cookies", .safari),
    ]

    /// Safari 的根在 `~/Library/Containers` 下，其余在 `~/Library/Application Support` 下；
    /// 表里的 folder 已经写成两种前缀都能拼的样子（safari 那条带 `Containers/`）。
    static func installed(home: URL, applicationSupport: URL) -> [BrowserCookieSource] {
        known.compactMap { entry in
            let root = entry.id == "safari"
                ? home.appendingPathComponent("Library").appendingPathComponent(entry.folder)
                : applicationSupport.appendingPathComponent(entry.folder)
            let source = BrowserCookieSource(id: entry.id, name: entry.name, kind: entry.kind, root: root)
            do {
                return try source.cookieFiles().isEmpty ? nil : source
            } catch {
                // 目录不在 = 没装；列不出来（权限）= 装了但被系统挡着，照样列出来让人看见
                return Self.isMissing(error) ? nil : source
            }
        }
    }

    /// 这个浏览器的 cookie 库（可能不止一个：Chromium 系每个 profile 一份，Firefox 每个 profile 一份）。
    ///
    /// **空数组 = 没装；抛 = 装了但列不出来**。macOS 14 起"别的应用的数据"是独立一道 TCC 闸：
    /// 实测壳里列 Chrome / Edge / Brave 的目录就是 "Operation not permitted"（同一个目录，
    /// 终端里的 python 列得出来）——这条不能当成"没装"，否则设置页会说"没检测到可导入的浏览器"。
    func cookieFiles() throws -> [URL] {
        let fm = FileManager.default
        switch kind {
        case .chromium:
            let names = try fm.contentsOfDirectory(atPath: root.path)
            return names
                .filter { $0 == "Default" || $0.hasPrefix("Profile ") || $0 == "Guest Profile" }
                .sorted()
                .map { root.appendingPathComponent($0).appendingPathComponent("Cookies") }
                .filter { fm.fileExists(atPath: $0.path) }
        case .firefox:
            let profiles = try fm.contentsOfDirectory(atPath: root.appendingPathComponent("Profiles").path)
            return profiles.sorted()
                .map { root.appendingPathComponent("Profiles").appendingPathComponent($0).appendingPathComponent("cookies.sqlite") }
                .filter { fm.fileExists(atPath: $0.path) }
        case .safari:
            let file = root.appendingPathComponent("Cookies.binarycookies")
            return fm.fileExists(atPath: file.path) ? [file] : []
        }
    }

    private static func isMissing(_ error: Error) -> Bool {
        (error as NSError).code == NSFileReadNoSuchFileError
    }

    /// 读出来。**阻塞且可能等用户**（Chromium 系要读 keychain 那一项）——调用方放后台线程。
    enum Trouble: Error {
        /// 库不在了（导入前被卸掉/删档）
        case missing
        /// 拿不到 Safe Storage 口令（用户没批准那次 keychain 询问）
        case noKey
        /// 文件读不动（Safari 的容器要"完全磁盘访问权限"）
        case permission
        /// 库在，但一条能用的都没有
        case empty
    }

    func read() throws -> [BrowserCookie] {
        let files: [URL]
        do {
            files = try cookieFiles()
        } catch {
            throw Self.isMissing(error) ? Trouble.missing : Trouble.permission
        }
        guard !files.isEmpty else { throw Trouble.missing }
        var out: [BrowserCookie] = []
        var unreadable = false
        switch kind {
        case .chromium(let storage):
            guard let passphrase = ChromiumCookieCrypto.safeStorage(service: storage.service, account: storage.account) else {
                throw Trouble.noKey
            }
            let key = ChromiumCookieCrypto.stretch(passphrase)
            for file in files {
                do { out += try chromiumCookies(at: file, key: key) } catch { unreadable = true }
            }
        case .firefox:
            for file in files {
                do { out += try firefoxCookies(at: file) } catch { unreadable = true }
            }
        case .safari:
            for file in files {
                do { out += try safariCookies(at: file) } catch { unreadable = true }
            }
        }
        guard !out.isEmpty else { throw unreadable ? Trouble.permission : Trouble.empty }
        return out
    }
}
