// 浏览历史：壳是唯一事实源（地址栏补全与设置页那张表都读它）。
//
// 落 UserDefaults（`deepdive.browser.history`，一份 JSON），**进程内带缓存**：补全每次渲染都要问
// "最近去过哪儿"，每次解码几百条是不必要的开销；写就走缓存 + 落盘。
//
// 容量：最多 500 条，按 url 去重（同一条再访就提前 + 计数）。历史不是日志，是"最近去过什么地方"，
// 所以上限宁可小、顺序必须新在前。
import Foundation

struct Visit: Codable, Equatable {
    var url: String
    var title: String
    var host: String
    /// 最后一次访问
    var at: Date
    /// 来过几次（参考实现也记这个；表里不显示，但"最常去"以后可以用）
    var count: Int

    var payload: [String: Any] {
        ["url": url, "title": title, "host": host,
         "at": at.timeIntervalSince1970 * 1000, "count": count]
    }
}

final class BrowserHistory {
    static let shared = BrowserHistory()

    /// 上限：够补全与"找回昨天那篇"，又不至于让一份 JSON 长到每次落盘都心疼。
    static let limit = 500
    private static let storeKey = "deepdive.browser.history"

    private var cache: [Visit]?

    private init() {}

    private func load() -> [Visit] {
        if let cache { return cache }
        guard let text = UserDefaults.standard.string(forKey: Self.storeKey),
              let data = text.data(using: .utf8),
              let list = try? JSONDecoder().decode([Visit].self, from: data) else {
            cache = []
            return []
        }
        cache = list
        return list
    }

    private func save(_ list: [Visit]) {
        cache = list
        guard let data = try? JSONEncoder().encode(list), let text = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: Self.storeKey)
    }

    /// 新在前。
    func entries(limit: Int = BrowserHistory.limit) -> [Visit] {
        Array(load().prefix(max(0, limit)))
    }

    func total() -> Int { load().count }

    /// 记一次访问（同一条 url 提前 + 计数）。
    @discardableResult
    func record(url: String, title: String) -> Bool {
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = parsed.host, !host.isEmpty else { return false }
        var list = load()
        let previous = list.first { $0.url == url }
        list.removeAll { $0.url == url }
        list.insert(Visit(url: url, title: title.isEmpty ? url : title, host: host,
                          at: Date(), count: (previous?.count ?? 0) + 1), at: 0)
        if list.count > Self.limit { list.removeLast(list.count - Self.limit) }
        save(list)
        return true
    }

    /// 标题晚到（`didFinish` 那一刻常常还没有，见 BrowserTab.refresh）：先把记下的那条补成真标题。
    /// 回 true = 真改了（调用方据此决定要不要重推给 SPA）。
    @discardableResult
    func updateTitle(url: String, title: String) -> Bool {
        guard !title.isEmpty else { return false }
        var list = load()
        guard let index = list.firstIndex(where: { $0.url == url }), list[index].title != title else { return false }
        list[index].title = title
        save(list)
        return true
    }

    func remove(url: String) {
        save(load().filter { $0.url != url })
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.storeKey)
        cache = []
    }
}
