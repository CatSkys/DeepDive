// 书签：壳是唯一事实源（面板「…」菜单那枚与设置页那张表都读它）。
//
// 落 UserDefaults（`deepdive.browser.bookmarks`，一份 JSON）+ 进程内缓存，与 BrowserHistory 同一套。
// 按 url 去重：同一个地址存两次没有意义，再点一次是"取消收藏"。
import Foundation

struct Bookmark: Codable, Equatable {
    var url: String
    var title: String
    var at: Date

    var payload: [String: Any] {
        ["url": url, "title": title.isEmpty ? url : title, "at": at.timeIntervalSince1970 * 1000]
    }
}

final class BrowserBookmarks {
    static let shared = BrowserBookmarks()

    private static let storeKey = "deepdive.browser.bookmarks"
    private var cache: [Bookmark]?

    private init() {}

    private func load() -> [Bookmark] {
        if let cache { return cache }
        guard let text = UserDefaults.standard.string(forKey: Self.storeKey),
              let data = text.data(using: .utf8),
              let list = try? JSONDecoder().decode([Bookmark].self, from: data) else {
            cache = []
            return []
        }
        cache = list
        return list
    }

    private func save(_ list: [Bookmark]) {
        cache = list
        guard let data = try? JSONEncoder().encode(list), let text = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: Self.storeKey)
    }

    /// 新在前。
    func list() -> [Bookmark] { load() }

    func contains(url: String) -> Bool { load().contains { $0.url == url } }

    func add(url: String, title: String) {
        guard !url.isEmpty, !contains(url: url) else { return }
        var list = load()
        list.insert(Bookmark(url: url, title: title, at: Date()), at: 0)
        save(list)
    }

    func remove(url: String) {
        save(load().filter { $0.url != url })
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.storeKey)
        cache = []
    }
}
