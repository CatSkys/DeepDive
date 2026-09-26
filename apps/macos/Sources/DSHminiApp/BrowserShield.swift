// 广告与跟踪拦截：`WKContentRuleList`（WebKit 在它自己的网络层执行——请求还没发出去就被挡掉，
// 也不跑 JS，所以不像脚本拦截器那样吃页面性能）。
//
// 规则表照参考实现（Search 的 `Shield.swift`）那份**故意短**的清单：第三方跟踪/广告域名 + 几处
// 一定是广告位的选择器。清单越长越容易把页面本身吃掉，这里宁可少而准。
//
// 两个开关：
//   · 全局 `deepdive.browser.shield.enabled`（默认开，值等于默认就删键）；
//   · **按站暂停**（`deepdive.browser.shield.paused`，一个 host 数组）：给"被拦坏了的站点"留的
//     退路（结账走不完、视频起不来），不是给广告放行。
//
// 规则表在导航那一刻按站点加减（`tune`）：从加上的那一刻起对后续请求生效，所以要"整个页面都
// 按新规矩来"就得重新加载——暂停/恢复之后由调用方重载当前标签（见 handleBrowserShield）。
import WebKit

final class BrowserShield {
    static let shared = BrowserShield()

    private static let enabledKey = "deepdive.browser.shield.enabled"
    private static let pausedKey = "deepdive.browser.shield.paused"

    private var list: WKContentRuleList?
    /// 编译还没好就来要规则的 controller（先记住，编译完补上）
    private var waiting: [WKUserContentController] = []

    /// 规则表编译好了没有。设置页那个开关写着"开"而这里是 false 的话，实际什么都没挡——
    /// 那是唯一值得说出来的失败（挡不住的广告是安静的）。
    var isCompiled: Bool { list != nil }
    /// 编译失败的原因（成功/还没编译完都是 nil）。
    private(set) var trouble: String?

    private init() {}

    // MARK: - 全局开关与按站暂停

    /// 读写都收一个 `UserDefaults`（缺省 `.standard`）：测试要拿独立 suite，别污染真机偏好。
    func enabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: Self.enabledKey) as? Bool ?? true
    }

    /// 默认（开）就删键，不留脏数据。
    func setEnabled(_ on: Bool, _ defaults: UserDefaults = .standard) {
        if on {
            defaults.removeObject(forKey: Self.enabledKey)
        } else {
            defaults.set(false, forKey: Self.enabledKey)
        }
    }

    func isPaused(host: String?, _ defaults: UserDefaults = .standard) -> Bool {
        guard let host, !host.isEmpty else { return false }
        return pausedHosts(defaults).contains(host)
    }

    func setPaused(_ paused: Bool, host: String, _ defaults: UserDefaults = .standard) {
        guard !host.isEmpty else { return }
        var hosts = pausedHosts(defaults)
        if paused {
            guard !hosts.contains(host) else { return }
            hosts.append(host)
        } else {
            hosts.removeAll { $0 == host }
        }
        defaults.set(hosts.sorted(), forKey: Self.pausedKey)
    }

    func pausedHosts(_ defaults: UserDefaults = .standard) -> [String] {
        defaults.stringArray(forKey: Self.pausedKey) ?? []
    }

    func forgetPaused(_ defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: Self.pausedKey)
    }

    // MARK: - 规则表

    /// 编译一次，进程内复用（标识固定，WebKit 也会把编译结果缓存到磁盘）。
    func compile() {
        guard list == nil else { return }
        guard let store = WKContentRuleListStore.default() else {
            EngineLog.shared.append("[browser] shield: WebKit has nowhere to compile it")
            return
        }
        guard let json = Self.rulesJSON() else { return }
        store.compileContentRuleList(forIdentifier: "deepdive-shield", encodedContentRuleList: json) { [weak self] compiled, error in
            guard let self else { return }
            guard let compiled else {
                // 编译失败就说出来：设置页那个开关还写着"开"，而实际什么都没挡
                self.trouble = error?.localizedDescription ?? "compile failed"
                EngineLog.shared.append("[browser] shield compile failed: \(self.trouble ?? "?")")
                return
            }
            self.trouble = nil
            self.list = compiled
            for controller in self.waiting where self.enabled() {
                controller.add(compiled)
            }
            self.waiting = []
        }
    }

    /// 每个新建的 controller 都来要一次；还没编译好就先记着。
    func protect(_ controller: WKUserContentController) {
        guard let list else {
            waiting.append(controller)
            return
        }
        if enabled() { controller.add(list) }
    }

    /// 导航那一刻按站点加减（要"整个页面都按新规矩来"，加完得重新加载）。
    func tune(_ controller: WKUserContentController, for host: String?) {
        guard let list else { return }
        controller.remove(list)
        if enabled(), !isPaused(host: host) { controller.add(list) }
    }

    /// 全局开关变了：对已经开着的页面立刻生效。
    func apply(to controllers: [WKUserContentController]) {
        guard let list else { return }
        for controller in controllers {
            controller.remove(list)
            if enabled() { controller.add(list) }
        }
    }

    // MARK: - 规则

    /// 第三方、且只干"盯着你/卖你"这一件事的那些域名。一方请求不动：站点自己的脚本就是站点自己。
    private static let unwanted = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "googletagservices.com", "google-analytics.com", "googletagmanager.com",
        "adservice.google.com", "amazon-adsystem.com", "adnxs.com", "adsrvr.org",
        "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
        "rubiconproject.com", "pubmatic.com", "openx.net", "casalemedia.com",
        "smartadserver.com", "sharethrough.com", "indexww.com", "bidswitch.net",
        "33across.com", "teads.tv", "moatads.com", "adroll.com",
        "scorecardresearch.com", "quantserve.com", "chartbeat.com",
        "hotjar.com", "mouseflow.com", "fullstory.com", "clarity.ms",
        "mixpanel.com", "amplitude.com", "segment.com", "segment.io",
        "branch.io", "appsflyer.com", "adjust.com", "analytics.tiktok.com",
        "connect.facebook.net", "ads-twitter.com", "analytics.twitter.com",
    ]

    /// 一定是广告位的那几处（**故意短**：一张大方的 cosmetic 清单就是拦截器开始吃页面的开始）。
    private static let slots = [
        ".adsbygoogle", "ins.adsbygoogle", "[id^=\"google_ads_\"]",
        "[id^=\"div-gpt-ad\"]", "[id^=\"taboola-\"]", "#taboola-below-article",
        "iframe[src*=\"doubleclick.net\"]", "iframe[src*=\"googlesyndication\"]",
        "iframe[src*=\"amazon-adsystem\"]",
    ]

    private static func rulesJSON() -> String? {
        var rules: [[String: Any]] = unwanted.map { domain in
            let escaped = domain.replacingOccurrences(of: ".", with: "\\.")
            return [
                "trigger": ["url-filter": "^https?://([^/]+\\.)?\(escaped)", "load-type": ["third-party"]],
                "action": ["type": "block"],
            ]
        }
        rules.append([
            "trigger": ["url-filter": ".*"],
            "action": ["type": "css-display-none", "selector": slots.joined(separator: ", ")],
        ])
        guard let data = try? JSONSerialization.data(withJSONObject: rules) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - 桥消息（SPA → 壳）

extension BrowserShield {
    /// `browser-shield` 桥消息的解析结果。
    enum Command: Equatable {
        case sync
        case setEnabled(Bool)
        case pause(String)
        case resume(String)
        case forgetPaused
    }

    /// 解析一条 `browser-shield`：设置页的开关优先，其次按动作分发；都不认识返回 nil。
    /// 动作带 host 的（暂停/恢复）缺 host 就当不认识——别对着"当前站点"猜一个。
    static func command(_ body: [String: Any]) -> Command? {
        if let on = body["enabled"] as? Bool { return .setEnabled(on) }
        switch body["action"] as? String {
        case "sync": return .sync
        case "pause": return (body["host"] as? String).map(Command.pause)
        case "resume": return (body["host"] as? String).map(Command.resume)
        case "forgetPaused": return .forgetPaused
        default: return nil
        }
    }
}
