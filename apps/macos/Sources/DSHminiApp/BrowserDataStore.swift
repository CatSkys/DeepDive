// 浏览器自己的数据存储：**持久且独立**。
//
// 为什么不是 `default()`：那份与主 SPA（同一个进程里的应用界面）共用，浏览器的 cookie 会漏进
// 应用自身会话，反过来也一样。为什么不是 `nonPersistent()`：重启即清，登录态留不住——而
// "agent 常被登录墙拦下"正是这一块要解决的问题（`SPEC-BROWSER-USE.md §3.5` 定稿第 2 条）。
//
// macOS 14 的 `dataStore(forIdentifier:)` 就是"持久且独立"那一支：WebKit 按标识把 store 放进
// 应用容器，与 default 各一份；标识必须**固定**（每次启动新生成等于又回到重启即清）。
import WebKit

enum BrowserDataStore {
    /// 固定标识（UUID 形态是 API 要求：非法标识会抛异常）。
    static let identifier = UUID(uuidString: "6F1C2A54-0C1E-4C4B-9F5A-2B7D1E0A9C31")!

    static func make(identifier: UUID = BrowserDataStore.identifier) -> WKWebsiteDataStore {
        WKWebsiteDataStore(forIdentifier: identifier)
    }

    /// 清空（设置页的「清除浏览数据」）：cookie + 缓存 + 本地存储一起清。活着的视图不必重挂——
    /// WebKit 会把清除应用到已经挂在窗口上的 store 上。
    static func clear(_ store: WKWebsiteDataStore, completion: @escaping () -> Void) {
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
            completion()
        }
    }
}
