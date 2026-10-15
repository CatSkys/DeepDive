// 导入的落点：把读出来的 cookie 一条条写进浏览器自己的 `WKHTTPCookieStore`，并汇报进去几条。
//
// 两段各在自己的线程上：**读**在后台（Chromium 系要读 keychain，会一直等用户点头），
// **写**回主线程（`WKHTTPCookieStore` 是 UI actor 的）。
//
// 逐条写而不是批量：`setCookies` 的批量版要 macOS 26，而这里最坏也就几千条。
import WebKit

enum BrowserCookieImport {
    /// 汇报用的码：UI 按码取文案（壳不产出给人看的句子）。
    enum Code: String {
        case ok
        case missing
        case noKey = "no-key"
        case permission
        case empty
    }

    /// 读一个来源并写进 store。`completion` 在主线程上回调，载荷：`source / code / total / imported`。
    static func run(source: BrowserCookieSource, store: WKWebsiteDataStore,
                    completion: @escaping ([String: Any]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let cookies: [BrowserCookie]
            do {
                cookies = try source.read()
            } catch {
                let code = Self.code(for: error)
                EngineLog.shared.append("[browser] cookie import \(source.id) → \(code.rawValue)")
                DispatchQueue.main.async {
                    completion(["source": source.id, "code": code.rawValue, "total": 0, "imported": 0])
                }
                return
            }
            let converted = cookies.compactMap { $0.httpCookie }
            DispatchQueue.main.async {
                write(converted, total: cookies.count, source: source.id, into: store.httpCookieStore, completion: completion)
            }
        }
    }

    private static func write(_ cookies: [HTTPCookie], total: Int, source: String,
                              into store: WKHTTPCookieStore, completion: @escaping ([String: Any]) -> Void) {
        var written = 0
        func next(_ index: Int) {
            guard index < cookies.count else {
                // 睡/醒那种"不留痕的两步"同一条理由：导入也留一行，排查"怎么没登进去"用
                EngineLog.shared.append("[browser] cookie import \(source) → ok imported=\(written)/\(total)")
                completion(["source": source, "code": Code.ok.rawValue, "total": total, "imported": written])
                return
            }
            store.setCookie(cookies[index]) {
                written += 1
                next(index + 1)
            }
        }
        next(0)
    }

    private static func code(for error: Error) -> Code {
        switch error {
        case BrowserCookieSource.Trouble.missing: return .missing
        case BrowserCookieSource.Trouble.noKey: return .noKey
        case BrowserCookieSource.Trouble.permission: return .permission
        case BrowserCookieSource.Trouble.empty: return .empty
        default: return .empty
        }
    }
}
