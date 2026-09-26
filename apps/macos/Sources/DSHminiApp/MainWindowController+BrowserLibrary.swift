// 主窗口的浏览器接线之四：**历史与书签**（`browser-history` / `browser-bookmarks`）。
//
// 两份记忆都在壳里（`BrowserHistory` / `BrowserBookmarks`），SPA 只渲染与发命令：地址栏补全用的
// 那份"最近去过哪儿"也是这里推过去的（`browserHistory`，只推最近 50 条；设置页要看长表就 list）。
//
// 记录发生在导航结束时（`BrowserTabs.changed` → `onHistoryChanged`），不在这里：这一份只管桥。

import AppKit

extension MainWindowController {
    /// 记一次访问并推给 SPA（`BrowserTabs` 在页面加载完成时叫它）。
    func historyRecorded() {
        pushHistory(limit: 50)
    }

    /// 推历史（`limit` 条新在前的记录 + 总数）。
    func pushHistory(limit: Int) {
        let entries = BrowserHistory.shared.entries(limit: limit).map(\.payload)
        pushHostCommand("browserHistory", payload: AppDelegate.jsonPayload([
            "entries": entries, "total": BrowserHistory.shared.total(),
        ]))
    }

    /// 推书签。
    func pushBookmarks() {
        pushHostCommand("browserBookmarks", payload: AppDelegate.jsonPayload([
            "entries": BrowserBookmarks.shared.list().map(\.payload),
        ]))
    }

    /// SPA 发来的历史命令（`browser-history`）：列表 / 删一条 / 清空。
    func handleBrowserHistory(_ body: [String: Any]) {
        switch body["action"] as? String {
        case "list":
            pushHistory(limit: body["limit"] as? Int ?? 200)
        case "remove":
            guard let url = body["url"] as? String else { return }
            BrowserHistory.shared.remove(url: url)
            pushHistory(limit: 200)
        case "clear":
            BrowserHistory.shared.clear()
            pushHistory(limit: 200)
        default:
            EngineLog.shared.append("[browser] unknown history command")
        }
    }

    /// SPA 发来的书签命令（`browser-bookmarks`）：列表 / 增删 / 清空。
    func handleBrowserBookmarks(_ body: [String: Any]) {
        switch body["action"] as? String {
        case "list":
            pushBookmarks()
        case "add":
            guard let url = body["url"] as? String, !url.isEmpty else { return }
            BrowserBookmarks.shared.add(url: url, title: body["title"] as? String ?? "")
            pushBookmarks()
        case "remove":
            guard let url = body["url"] as? String else { return }
            BrowserBookmarks.shared.remove(url: url)
            pushBookmarks()
        case "clear":
            BrowserBookmarks.shared.clear()
            pushBookmarks()
        default:
            EngineLog.shared.append("[browser] unknown bookmarks command")
        }
        // 「…」菜单那枚的文案跟着观察走：重推一次当前标签的状态
        browserTabs.resync()
    }
}
