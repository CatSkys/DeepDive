// 侧栏浏览器的 agent 控制面：MCP server（随包分发的 Node 脚本，暴露单个 `js` 工具）把
// 命令 POST 到桥的 /browser-control，这里落到壳里的 BrowserTabs（按 tabId 找标签，缺省当前标签）。
//
// 分层照 ZCode：**高层语义（快照/ref/点击/输入）在 JS 侧**（随包的 browser-client SDK
// 拼页面脚本），壳只提供原语——导航、观察、截图、执行 JS、轮询等待、以及标签的增删选。
// 所以壳不认识 ref、不认识选择器，也不会因为 SDK 换代而改。
//
// 鉴权：boot 级随机 token（EngineSupervisor 随 env 交给 MCP server），Authorization 头带它。
// 桥的 Origin 全等闸不动——回环上的非浏览器客户端本就不带 Origin。

import Foundation

enum BrowserControl {
    /// 本次 boot 的控制 token（进程内随机，不落盘）。
    static let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    /// 取当前窗口的标签集合：桥是单例、窗口控制器不是，所以由窗口控制器装这个口子
    /// （弱捕获，窗口没了就回 nil）。
    static var tabsProvider: (() -> BrowserTabs?)?

    /// 轮询等待的硬上限：SDK 会给 timeoutMs，这里再兜一层，免得一个坏请求把线程占住。
    private static let maxWaitMs = 30_000

    /// 最近一次 cookie 导入的状态（`import_cookies` 起活、`import_cookies_status` 取结果）。
    /// 只在主线程读写（execute 就在主线程上跑）。
    private static var cookieImport: [String: Any] = ["ok": true, "status": "idle"]

    /// 处理一次控制请求（同步；MiniHTTPServer 每个连接一个线程）。
    static func handle(_ request: MiniHTTPServer.Request) -> MiniHTTPServer.Response {
        guard request.headers["authorization"] == "Bearer \(token)" else {
            return .init(status: 403, body: Data("forbidden".utf8))
        }
        guard let command = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any],
              let method = command["method"] as? String else {
            return json(["ok": false, "error": "malformed command"])
        }
        let semaphore = DispatchSemaphore(value: 0)
        var result: [String: Any] = ["ok": false, "error": "no browser"]
        DispatchQueue.main.async {
            result = execute(method: method, command: command, tabs: tabsProvider?())
            semaphore.signal()
        }
        // 等待必须在主线程之外（execute 自己也在主线程跑），否则死锁
        if semaphore.wait(timeout: .now() + .milliseconds(maxWaitMs + 5_000)) == .timedOut {
            return json(["ok": false, "error": "timeout"])
        }
        return json(result)
    }

    /// 主线程上的命令分发。
    private static func execute(method: String, command: [String: Any], tabs: BrowserTabs?) -> [String: Any] {
        guard let tabs else { return ["ok": false, "error": "no browser"] }
        switch method {
        case "list_tabs":
            return ["ok": true, "activeTabId": tabs.activeId, "tabs": tabs.listPayload()]
        case "reader":
            // 阅读模式（页面里就地换一版）：agent 想"干净地读一篇"时用得上
            guard let on = command["on"] as? Bool else { return ["ok": false, "error": "reader needs on"] }
            let host = tabs.activeHost
            if on {
                var result: String?
                BrowserReader.enter(host) { text in result = text }
                pumpUntil(timeout: 10) { result != nil }
                return ["ok": result == "read", "result": result ?? "timeout"]
            }
            BrowserReader.exit(host)
            return ["ok": true]
        case "hidden":
            // 按站隐藏：这一站藏了哪些元素（agent 也可能想把自己读页面时碍事的块拿掉）
            let hostName = URL(string: tabs.active.url)?.host ?? ""
            return ["ok": true, "host": hostName,
                    "veils": BrowserHidden.shared.veils(host: hostName).map { ["selector": $0.selector, "label": $0.label] },
                    "total": BrowserHidden.shared.totalCount()]
        case "hide_element":
            guard let selector = command["selector"] as? String, !selector.isEmpty,
                  let hostName = URL(string: tabs.active.url)?.host, !hostName.isEmpty else {
                return ["ok": false, "error": "hide_element needs a selector and a loaded page"]
            }
            let label = command["label"] as? String ?? selector
            BrowserHidden.shared.hide(selector: selector, label: label, host: hostName)
            BrowserHidden.shared.apply(tabs.activeHost, for: hostName)
            return ["ok": true, "host": hostName, "count": BrowserHidden.shared.veils(host: hostName).count]
        case "restore_hidden":
            guard let hostName = URL(string: tabs.active.url)?.host, !hostName.isEmpty else {
                return ["ok": false, "error": "restore_hidden needs a loaded page"]
            }
            if let selector = command["selector"] as? String, !selector.isEmpty {
                BrowserHidden.shared.restore(selector: selector, host: hostName)
            } else {
                BrowserHidden.shared.restoreAll(host: hostName)
            }
            BrowserHidden.shared.apply(tabs.activeHost, for: hostName)
            return ["ok": true, "host": hostName, "count": BrowserHidden.shared.veils(host: hostName).count]
        case "get_shield":
            return ["ok": true,
                    "enabled": BrowserShield.shared.enabled(),
                    "paused": BrowserShield.shared.pausedHosts(),
                    "trouble": BrowserShield.shared.trouble ?? ""]
        case "set_shield":
            // 两个可选项：全局开关（`enabled`）与"这一站暂停"（`host` + `paused`）。
            // 改完重载当前标签——规则表在导航那一刻才算数（同面板菜单那条路）
            if let on = command["enabled"] as? Bool {
                BrowserShield.shared.setEnabled(on)
                BrowserShield.shared.apply(to: tabs.controllers)
                tabs.activeHost.reload()
            }
            if let host = command["host"] as? String, !host.isEmpty {
                let paused = command["paused"] as? Bool ?? true
                BrowserShield.shared.setPaused(paused, host: host)
                BrowserShield.shared.tune(tabs.activeHost.view.configuration.userContentController, for: host)
                tabs.activeHost.reload()
            }
            return ["ok": true, "enabled": BrowserShield.shared.enabled(), "paused": BrowserShield.shared.pausedHosts()]
        case "list_cookie_sources":
            return ["ok": true, "sources": BrowserCookies.entries(BrowserCookies.installed())]
        case "import_cookies":
            // **起活不等人**：导入的写落在主线程（WKHTTPCookieStore 是 UI actor 的），而这条命令
            // 本身就跑在主线程上——把主线程堵在"等它写完"上会死锁（实测：泵 runloop 60s，
            // 读完了但一条都没写进去）。所以这里只起活，结果由 import_cookies_status 取。
            let wanted = command["source"] as? String ?? ""
            guard let source = BrowserCookies.installed().first(where: { $0.id == wanted }) else {
                return ["ok": false, "error": "unknown cookie source: \(wanted)"]
            }
            cookieImport = ["ok": true, "status": "running", "source": source.id]
            BrowserCookieImport.run(source: source, store: tabs.store) { payload in
                cookieImport = ["ok": true, "status": "done"].merging(payload) { _, new in new }
            }
            return cookieImport
        case "import_cookies_status":
            return cookieImport
        case "new_tab":
            // 带地址的新标签先过协议闸（同 navigate），别把坏地址变成一条错误页
            if let url = command["url"] as? String, let parsed = URL(string: url), !BrowserHost.allowed(parsed) {
                return ["ok": false, "error": "navigation_blocked: only http/https/about:blank are allowed"]
            }
            let tab = tabs.newTab(url: command["url"] as? String ?? "")
            return ["ok": true, "tabId": tab.id]
        case "select_tab", "close_tab":
            guard let id = command["tabId"] as? String, tabs.tab(id: id) != nil else {
                return ["ok": false, "error": "unknown tab: \(command["tabId"] as? String ?? "?")"]
            }
            if method == "select_tab" { tabs.select(id: id) } else { tabs.close(id: id) }
            return ["ok": true, "tabId": id]
        default:
            break
        }
        // 其余命令都落在某个标签上：指名就按指名找（找不到就报错，不要悄悄换一个标签干活），
        // 缺省是当前标签。`awake()` 让睡着的标签先醒——休眠因此不会把 agent 打死。
        guard let tab = target(tabs, command) else {
            return ["ok": false, "error": "unknown tab: \(command["tabId"] as? String ?? "?")"]
        }
        tab.touch()
        let host = tab.awake()
        switch method {
        case "navigate":
            guard let url = command["url"] as? String, let parsed = URL(string: url), BrowserHost.allowed(parsed) else {
                return ["ok": false, "error": "navigation_blocked: only http/https/about:blank are allowed"]
            }
            host.load(url)
            return ["ok": true, "tabId": tab.id]
        case "back": host.goBack(); return ["ok": true]
        case "forward": host.goForward(); return ["ok": true]
        case "reload": host.reload(); return ["ok": true]
        case "get_state": return state(tab, host)
        case "screenshot":
            var out: [String: Any] = ["ok": false, "error": "snapshot failed"]
            host.screenshot { base64 in
                guard let base64 else { return }
                out = ["ok": true, "image": ["base64": base64, "mimeType": "image/png"]]
            }
            // takeSnapshot 的回调在异步派发，这里用 runloop 泵到它回来（上限 10s）
            pumpUntil(timeout: 10) { out["ok"] as? Bool == true }
            return out
        case "evaluate":
            guard let script = command["script"] as? String else {
                return ["ok": false, "error": "evaluate needs a script"]
            }
            var out: [String: Any] = ["ok": false, "error": "evaluate timed out"]
            host.evaluate(script) { text in out = ["ok": true, "result": text] }
            pumpUntil(timeout: 10) { out["ok"] as? Bool == true }
            return out
        case "wait_for":
            // 两种形状（都给 = 两个条件都要满足）：页面里的真值脚本，与**壳里的状态**稳定下来。
            // 后者是必要的：地址/标题的到位由壳自己的导航事件定，页面脚本得靠猜（PITFALLS §4.29
            // 就是"标题比导航事件晚"那一课）。
            let script = command["script"] as? String
            let stateKey = command["state"] as? String
            guard script != nil || stateKey != nil else {
                return ["ok": false, "error": "wait_for needs a script or a state"]
            }
            return waitFor(tab: tab, host: host, script: script,
                           stateKey: stateKey, command: command,
                           timeoutMs: command["timeoutMs"] as? Int ?? 3_000)
        default:
            return ["ok": false, "error": "unknown method: \(method)"]
        }
    }

    /// 命令落到哪个标签。
    private static func target(_ tabs: BrowserTabs, _ command: [String: Any]) -> BrowserTab? {
        guard let id = command["tabId"] as? String else { return tabs.active }
        return tabs.tab(id: id)
    }

    /// 一个标签的状态。宿刚醒时 `view.url` 还答不出来，用标签镜像兜（同 SPA 那一条）。
    private static func state(_ tab: BrowserTab, _ host: BrowserHost) -> [String: Any] {
        let view = host.view
        return [
            "ok": true,
            "tabId": tab.id,
            "state": [
                "url": view.url?.absoluteString ?? tab.url,
                "title": view.title ?? tab.title,
                "loading": view.isLoading,
                "canGoBack": view.canGoBack,
                "canGoForward": view.canGoForward,
            ],
        ]
    }

    /// 轮询等待（ZCode 的 waitFor 语义：可观察状态优先，不睡固定时长）。
    ///
    /// `script` 是在页面里求值的真值脚本；`stateKey` 是壳里的状态字段（url/title），配
    /// `equals` / `contains` / `matches`（正则）之一。两个都给就两个都要满足。
    private static func waitFor(tab: BrowserTab, host: BrowserHost, script: String?,
                                stateKey: String?, command: [String: Any], timeoutMs: Int) -> [String: Any] {
        let deadline = Date().addingTimeInterval(Double(min(timeoutMs, maxWaitMs)) / 1000)
        var last = "false"
        while Date() < deadline {
            if let script {
                var out: [String: Any] = ["ok": false]
                host.evaluate(script) { text in out = ["ok": true, "result": text] }
                pumpUntil(timeout: 5) { out["ok"] as? Bool == true }
                last = out["result"] as? String ?? last
                if last != "true" {
                    RunLoop.current.run(until: Date().addingTimeInterval(0.15))
                    continue
                }
            }
            if let stateKey {
                let value = stateValue(tab: tab, host: host, key: stateKey)
                if !matches(value, command) {
                    last = value
                    RunLoop.current.run(until: Date().addingTimeInterval(0.15))
                    continue
                }
            }
            return ["ok": true, "result": "true"]
        }
        return ["ok": false, "error": "timeout waiting for condition (last: \(last))"]
    }

    /// 壳里的那个字段（与 get_state 同一份来源）。
    private static func stateValue(tab: BrowserTab, host: BrowserHost, key: String) -> String {
        switch key {
        case "url": return host.view.url?.absoluteString ?? tab.url
        case "title": return host.view.title ?? tab.title
        default: return ""
        }
    }

    /// 条件三选一（`equals` / `contains` / `matches`）；一个都没给 = 只要字段非空。
    ///
    /// 不是 `private`：它是**跨端契约**的判定（SDK 的 `waitForURL` 按它拼请求），拼错不会报错、
    /// 只会一直等到超时——所以要有单测钉住。
    static func matches(_ value: String, _ command: [String: Any]) -> Bool {
        if let wanted = command["equals"] as? String { return value == wanted }
        if let part = command["contains"] as? String { return value.contains(part) }
        if let pattern = command["matches"] as? String {
            return (try? NSRegularExpression(pattern: pattern))?.firstMatch(
                in: value, range: NSRange(value.startIndex..., in: value)) != nil
        }
        return !value.isEmpty
    }

    /// 在主线程上泵 runloop 直到条件成立或超时（WKWebView 的回调都是主线程派发的）。
    private static func pumpUntil(timeout: TimeInterval, _ done: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while !done() && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
    }

    private static func json(_ object: [String: Any]) -> MiniHTTPServer.Response {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return .init(status: 200, headers: ["content-type": "application/json"], body: data)
    }
}
