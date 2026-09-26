// 标签休眠：没人看的标签把宿主还给系统（内存），只留三样东西——回去的路（`interactionState`）、
// 一张停帧图（盖住唤醒的空档）、以及"页面里有没有人打了一半的字"这一问的答案。
//
// 判据（怎么都不睡）：当前标签、空白页、正在加载、已经睡着、没有地址，以及页面里攥着没发出去的
// 输入（问不到就当没有——PDF、图片、进程已经没了的页面问不出来，参考实现同一取舍）。
//
// 门槛 `deepdive.browser.tabs.sleepMinutes`（0 = 关，默认 30 分钟）由设置页写；内存压力来了压到
// 5 分钟，critical 立即扫一遍（参考实现同一支）。关掉休眠连内存压力也不接管——用户说了算。
//
// 唤醒是**按需**的：人切到它就醒（BrowserTabs.activate），agent 的 screenshot/evaluate 走
// 同一条（BrowserTabs.activeHost）——休眠因此不会把 agent 的取图/等条件打死。
import AppKit
import WebKit

extension BrowserTabs {
    /// 默认门槛：30 分钟（参考实现的第一档）。
    static let defaultSleepMinutes = 30
    /// 内存压力（warning 档）下的门槛
    private static let pressuredSleepMinutes = 5
    private static let sleepMinutesKey = "deepdive.browser.tabs.sleepMinutes"

    static func sleepMinutes(_ defaults: UserDefaults = .standard) -> Int {
        guard let stored = defaults.object(forKey: sleepMinutesKey) as? Int else { return defaultSleepMinutes }
        return min(max(stored, 0), 240)
    }

    static func setSleepMinutes(_ minutes: Int, _ defaults: UserDefaults = .standard) {
        let value = min(max(minutes, 0), 240)
        if value == defaultSleepMinutes {
            defaults.removeObject(forKey: sleepMinutesKey)
        } else {
            defaults.set(value, forKey: sleepMinutesKey)
        }
    }

    /// 计时器周期取门槛的 1/4，夹在 5s…60s 之间（门槛 30 分钟 → 每 60s 扫一次）。
    func startSleepWatch() {
        sleepTimer?.invalidate()
        sleepTimer = nil
        guard Self.sleepMinutes() > 0 else { return }
        let period = min(60, max(5, TimeInterval(Self.sleepMinutes()) * 60 / 4))
        sleepTimer = Timer.scheduledTimer(withTimeInterval: period, repeats: true) { [weak self] _ in
            self?.sweepIdleTabs()
        }
        startPressureWatch()
    }

    /// 内存压力：warning 压到 5 分钟，critical 立刻扫。
    private func startPressureWatch() {
        guard pressureSource == nil else { return }
        let source = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: .main)
        source.setEventHandler { [weak self, weak source] in
            guard let self, let source else { return }
            self.pressured = source.data.contains(.critical) ? 0 : Self.pressuredSleepMinutes
            self.sweepIdleTabs()
        }
        source.resume()
        pressureSource = source
    }

    /// 扫一遍：够闲又是候选的标签，问一句"有没有没发出去的输入"，没有就睡。
    func sweepIdleTabs() {
        guard Self.sleepMinutes() > 0 else { return }
        let threshold = TimeInterval(pressured ?? Self.sleepMinutes()) * 60
        for tab in tabs where canSleep(tab, threshold: threshold) {
            putToSleep(tab)
        }
    }

    private func canSleep(_ tab: BrowserTab, threshold: TimeInterval) -> Bool {
        guard tab.id != activeId, !tab.asleep, !sleeping.contains(tab.id) else { return false }
        guard let host = tab.awakeHost, !host.view.isLoading else { return false }
        guard !tab.url.isEmpty, tab.url != "about:blank" else { return false }
        return Date().timeIntervalSince(tab.idleSince) >= threshold
    }

    /// 入睡流程：问页面 → 抓一张停帧图 → 放手（`fallAsleep` 自己会把清单变化推给 SPA）。
    private func putToSleep(_ tab: BrowserTab) {
        guard let host = tab.awakeHost else { return }
        sleeping.insert(tab.id)
        host.evaluate(Self.unsavedScript) { [weak self, weak tab] answer in
            guard let self, let tab else { return }
            // 页面里攥着人打了一半的字：这轮不睡（下一轮再问）
            guard answer != "true" else {
                self.sleeping.remove(tab.id)
                return
            }
            // 封面 900px 宽：面板那一格多半更宽，但它是停帧图不是正文，够用且过桥便宜
            host.previewShot(width: 900) { [weak self] png in
                guard let self else { return }
                self.sleeping.remove(tab.id)
                // 抓图是异步的：这一会儿里它可能已经被切回前台/关掉了——那就别睡
                guard self.tabs.contains(where: { $0 === tab }), tab.id != self.activeId, !tab.asleep else { return }
                tab.fallAsleep(memory: host.view.interactionState, cover: png)
                // 睡与醒是标签生命周期里唯一不留痕的两步：留一条日志，排查"图怎么白了/内存怎么没降"用
                EngineLog.shared.append("[browser] sleep \(tab.url) cover=\(png == nil ? "no" : "yes")")
            }
        }
    }

    /// 页面里有没有"打了一半、还没发出去"的东西：任何输入框的值与默认值不同，或可编辑区里有字。
    /// 密码框与隐藏域跳过（站点自己填的不算人打的字）。问不到时 `evaluate` 回的是错误文本，
    /// 不等于 "true"，按"没攥着东西"处理。
    ///
    /// **回字符串而不是布尔**：桥把 JS 布尔交成 NSNumber，壳那边 `String(describing:)` 出来是
    /// "1"/"0"（实测：这处一开始写成回 `true`，判据 `== "true"` 永远不成立，半填的表单照样被睡掉）。
    /// 页面脚本要比真值一律照 `browser-page-scripts.mjs` 的 `READY_STATE` 老规矩转成字符串。
    private static let unsavedScript = """
    (function () {
      var fields = document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]');
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (field.type === "password" || field.type === "hidden") continue;
        if (field.isContentEditable) { if (field.textContent.trim()) return "true"; continue; }
        if ((field.value || "") !== (field.defaultValue || "")) return "true";
      }
      return "false";
    })()
    """
}
