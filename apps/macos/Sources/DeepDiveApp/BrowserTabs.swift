// 标签集合：一个窗口里所有标签的模型与舞台。四件事——
//   · 增删选，外加一条不变式：**永远至少留一个空白标签**（关掉最后一个不是"没有浏览器"，
//     是回到空白页；浏览器实体在面板生命周期里一直存在）；
//   · 舞台：当前标签的 WKWebView 是窗口里唯一挂着的浏览器视图，换标签就换视图；
//   · 观察扇出：每个标签的宿主都回报，当前标签那条推给 SPA（桥指令 `browserState`），
//     标签栏清单另推一条（`browserTabs`）；
//   · 槽位：SPA 推来的几何作用于当前标签；换标签/唤醒时用同一份几何把新宿主重新摆好
//     （槽位状态因此从单个宿主搬到这里——宿主是会被回收的，几何不跟着它走）。
//
// 休眠策略（谁该睡、什么时候睡）在 BrowserTabs+Sleep.swift。进程池不用自己管：macOS 12 起
// `WKProcessPool` 已废弃、"多个实例不再有任何效果"，WebKit 自己按应用共享内容进程；
// 这里共享的是**数据存储**（`store`），cookie 因此跨标签可见。
import AppKit
import WebKit

final class BrowserTabs {
    /// 当前标签的观察（桥指令 `browserState`；载荷里带 `tabId` 与 `cover`）
    var onObservation: (([String: Any]) -> Void)?
    /// 标签栏清单（桥指令 `browserTabs`）
    var onTabsChanged: (([String: Any]) -> Void)?
    /// 页面在要摄像头/麦克风（窗口控制器把它推给 SPA 弹窗）
    var onPermissionAsk: ((String, String) -> Void)?
    /// 按站隐藏的拾取回来了／被取消（窗口控制器据此记下并推给 SPA）
    var onPicked: ((String, String) -> Void)?
    var onPickCancelled: (() -> Void)?
    /// 记了一条浏览历史（窗口控制器据此把最近的那份推给 SPA 做补全）
    var onHistoryChanged: (() -> Void)?

    private(set) var tabs: [BrowserTab] = []
    private(set) var activeId = ""
    /// 浏览器视图的容器（窗口控制器在 viewDidLoad 交进来）：加在 SPA webView 之后、
    /// 悬浮输入框之前——原生网页恒在 SPA 之上、恒在对话卡之下。
    private weak var stage: NSView?
    /// SPA 推来的槽位 + 换算要的两个实时值（换标签/唤醒时重新摆用）
    private var slot: BrowserSlot?
    private var contentHeight: CGFloat = 0
    private var zoom: CGFloat = 1
    /// 一个窗口一个存储：cookie/Web 存储跨标签共享，**持久且独立**（重启仍在；
    /// 与主 SPA 的 default store 各一份，见 BrowserDataStore）。导入 cookie 也写进它。
    let store = BrowserDataStore.make()

    // 休眠看门的几件状态。逻辑在 BrowserTabs+Sleep.swift；Swift 的扩展放不了存储属性，
    // 所以它们留在类里（同 MainWindowController 的 browserKeyMonitor）。
    var sleepTimer: Timer?
    var pressureSource: DispatchSourceMemoryPressure?
    /// 内存压力下临时压低的门槛（分钟）；nil = 没压力，用设置里的值
    var pressured: Int?
    /// 正在走休眠流程的标签（问页面、抓封面都是异步的，别进去两次）
    var sleeping: Set<String> = []

    /// 当前标签（不变式：非空）。
    var active: BrowserTab { tabs.first { $0.id == activeId } ?? tabs[0] }
    /// 当前标签的宿主。**取用即唤醒**——agent 的 screenshot/evaluate 只要图，不该被
    /// "这个标签睡过"打死；人这边切标签本身也会先唤醒（见 activate）。
    var activeHost: BrowserHost { active.awake() }

    func tab(id: String) -> BrowserTab? { tabs.first { $0.id == id } }

    /// 已经建好宿主的那些标签的 `userContentController`（拦截开关改了要立刻作用到它们）。
    var controllers: [WKUserContentController] {
        tabs.compactMap { $0.awakeHost?.view.configuration.userContentController }
    }

    /// 窗口没了就把看门的两支停掉（计时器是被 run loop 持有的，不停会一直空转）。
    deinit {
        sleepTimer?.invalidate()
        pressureSource?.cancel()
    }

    // MARK: - 舞台与增删选

    /// 装到窗口上：建首个空白标签、挂视图、开始看闲置。
    func attach(to stage: NSView) {
        self.stage = stage
        let first = makeTab(url: "")
        tabs = [first]
        activate(first)
        startSleepWatch()
    }

    /// 新建标签（url 空 = 空白页）并切过去。
    @discardableResult
    func newTab(url: String = "") -> BrowserTab {
        let tab = makeTab(url: url)
        tabs.append(tab)
        activate(tab)
        return tab
    }

    func select(id: String) {
        guard let tab = tab(id: id) else { return }
        activate(tab)
    }

    func close(id: String) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closed = tabs[index]
        closed.awakeHost?.view.removeFromSuperview()
        tabs.remove(at: index)
        guard !tabs.isEmpty else {
            // 关掉最后一个：回到空白页，并告知 SPA 这次是自动补的（用户报：
            // 页面全关了就该把浏览器页收回去，别停在一张空白页上）
            let fresh = makeTab(url: "")
            tabs = [fresh]
            activate(fresh, respawned: true)
            return
        }
        // 关掉当前标签就接上它右边那个（没有右边就左边那个），其余情况只是清单变了
        if closed.id == activeId {
            activate(tabs[min(index, tabs.count - 1)])
        } else {
            pushTabs()
        }
    }

    // MARK: - 槽位

    func setSlot(_ slot: BrowserSlot, contentHeight: CGFloat, zoom: CGFloat) {
        self.slot = slot
        applySlot(contentHeight: contentHeight, zoom: zoom)
    }

    /// 这一格现在要不要显示（SPA 推的槽位说了算）：窗口层序跟着它走，见
    /// `MainWindowController.restackBrowserStage`。
    var slotVisible: Bool { slot?.visible ?? false }

    /// 按缓存的槽位与当前 bounds/pageZoom 重算当前标签的 frame（窗口尺寸/缩放变化时调）。
    func applySlot(contentHeight: CGFloat, zoom: CGFloat) {
        self.contentHeight = contentHeight
        self.zoom = zoom
        guard let slot, let host = active.awakeHost else { return }
        host.setSlot(slot, contentHeight: contentHeight, zoom: zoom)
    }

    // MARK: - 观察与推送

    /// 补推（SPA 挂载浏览器页 / 换标签）：标签栏清单 + 当前标签的观察。
    func resync() {
        pushTabs()
        pushState(active, active.awakeHost?.observation() ?? BrowserObservation())
    }

    /// 页面加载完成：记一条浏览历史（同一个 url 只在**换过页之后**记一次——观察是"变化就推"的，
    /// 不挡一下会把同一页记成好几次）。
    private func recordVisit(_ tab: BrowserTab) {
        guard !tab.url.isEmpty, tab.url != "about:blank", tab.recordedUrl != tab.url else { return }
        tab.recordedUrl = tab.url
        guard BrowserHistory.shared.record(url: tab.url, title: tab.title) else { return }
        onHistoryChanged?()
    }

    /// 标题是稍后解析出来的（`didFinish` 那一刻常常还没有）：历史里那条当时只能先写地址，
    /// 等真标题到了再补一次，别让"历史"这一栏永远是一串 URL。
    private func settleVisitTitle(_ tab: BrowserTab) {
        guard !tab.recordedUrl.isEmpty, tab.recordedUrl == tab.url, !tab.title.isEmpty else { return }
        if BrowserHistory.shared.updateTitle(url: tab.url, title: tab.title) { onHistoryChanged?() }
    }

    /// 一个标签有变化：清单总要更新（标题/图标/睡着），当前标签另推一条观察与图标。
    func changed(_ tab: BrowserTab) {
        settleVisitTitle(tab)
        pushTabs()
        if tab.id == activeId, let host = tab.awakeHost {
            pushState(tab, host.observation())
        }
        adoptIcon(tab)
        armScroll(tab)
    }

    /// 滚动上报：每次页面落地后武装一次（阅读进度的事实来源；通道与脚本见 BrowserHost+Scroll）。
    private func armScroll(_ tab: BrowserTab) {
        guard let host = tab.awakeHost, !host.view.isLoading else { return }
        guard !tab.url.isEmpty, tab.url != "about:blank", tab.scrollArmedUrl != tab.url else { return }
        tab.scrollArmedUrl = tab.url
        host.armScrollReport()
    }

    /// 站点图标：先问页面自己声明的那个（`link[rel~=icon]`），页面没声明就退回本站的
    /// `/favicon.ico`。一次导航问一次，不下载缓存——SPA 直接按这个地址取图，取不到退回首字母。
    ///
    /// `/favicon.ico` 这条兜底是 2026-10-10 补的，此前刻意不猜，理由是"多数站点没有、
    /// 只会打一堆 404"。实测相反：微博、豆瓣这类页面**不在 HTML 里声明 icon**（SPA 之后
    /// 才注入或干脆没有），但 `/favicon.ico` 都返回 200——浏览器自己也是这么兜的
    /// （无声明时默认取站点根的那个），所以"不猜"反而让一批正常站点没有图标。
    /// 真没有的站点会 404，由 SPA 那侧的 `<img onError>` 吃掉（退回首字母/地球），
    /// 每次导航至多多打一个 404，代价可以忽略。
    private func adoptIcon(_ tab: BrowserTab) {
        guard let host = tab.awakeHost, !host.view.isLoading else { return }
        guard !tab.url.isEmpty, tab.url != "about:blank", tab.iconAsked != tab.url else { return }
        tab.iconAsked = tab.url
        host.evaluate(Self.iconScript) { [weak self, weak tab] text in
            guard let self, let tab else { return }
            // evaluate 对字符串结果给的是**裸串**（见 BrowserHost.evaluate 的三个分支），
            // 只有出错时才带 "Error:" 前缀——那时当"没声明图标"，别把错误文本当地址
            let icon = text.hasPrefix("Error:") ? "" : text
            EngineLog.shared.append("[browser] icon asked url=\(tab.url) → [\(text)]")
            guard icon != tab.icon else { return }
            tab.icon = icon
            self.pushTabs()
        }
    }

    private func makeTab(url: String) -> BrowserTab {
        let tab = BrowserTab(id: UUID().uuidString, store: store)
        tab.onChange = { [weak self] tab in self?.changed(tab) }
        // 页面的 target=_blank / window.open：开一个新标签（当前这页留着）。
        // 挪到下一轮 runloop：这会儿还在 WKUIDelegate 的调用栈里，同步建新 webview 有再入风险。
        tab.onPopup = { [weak self] url in
            DispatchQueue.main.async { self?.newTab(url: url) }
        }
        tab.onPermissionAsk = { [weak self] host, kind in self?.onPermissionAsk?(host, kind) }
        tab.onPicked = { [weak self] selector, label in self?.onPicked?(selector, label) }
        tab.onPickCancelled = { [weak self] in self?.onPickCancelled?() }
        tab.onLoaded = { [weak self] tab in self?.recordVisit(tab) }
        if !url.isEmpty {
            tab.url = url
            tab.host.load(url)
        }
        return tab
    }

    /// 换舞台：旧标签的视图下场，新标签的视图挂上（睡着的先醒），槽位照旧摆好。
    private func activate(_ tab: BrowserTab, respawned: Bool = false) {
        if let previous = tabs.first(where: { $0.id == activeId }), previous !== tab {
            previous.awakeHost?.view.removeFromSuperview()
        }
        activeId = tab.id
        tab.touch()
        let host = tab.awake()
        stage?.addSubview(host.view)
        if let slot {
            host.setSlot(slot, contentHeight: contentHeight, zoom: zoom)
        } else {
            // SPA 还没推过槽位（面板关着）：给 agent 的默认视口、不可见（见 BrowserHost.place）
            host.place(rect: BrowserHost.idleViewport, visible: false, interactive: false)
        }
        pushTabs(respawned: respawned)
        host.resync()
    }

    /// 标签清单（桥指令 `browserTabs` 与 agent 控制面的 `list_tabs` 共用这一条形状）。
    /// 读之前先把每个标签的镜像拉成它宿主此刻的事实——清单是"现在长什么样"，
    /// 不能停在上一次观察事件那一刻（标题晚到的坑见 BrowserTab.refresh）。
    func listPayload() -> [[String: Any]] {
        for tab in tabs { tab.refresh() }
        return tabs.map { tab in
            [
                "id": tab.id, "title": tab.title, "url": tab.url, "icon": tab.icon,
                "asleep": tab.asleep, "active": tab.id == activeId,
                // 标签胶囊的四个活信号：转圈、灰底进度、喇叭（响着/被静音）
                "loading": tab.loading, "reading": tab.reading,
                "noisy": tab.noisy, "muted": tab.muted,
            ]
        }
    }

    private func pushTabs(respawned: Bool = false) {
        var payload: [String: Any] = ["activeId": activeId, "tabs": listPayload()]
        // respawned = 关掉最后一个标签后自动补的那张空白页；SPA 据此收起浏览器页
        if respawned { payload["respawned"] = true }
        onTabsChanged?(payload)
    }

    /// 当前标签的观察。宿刚刚醒来时它自己答不出地址（`view.url` 还是 nil 或 about:blank），
    /// 这时以标签镜像为准——否则 SPA 退回空态、连槽位都不推，原生视图就没地方摆（白屏）。
    private func pushState(_ tab: BrowserTab, _ observation: BrowserObservation) {
        tab.refresh()
        var payload = observation.payload
        if observation.url.isEmpty { payload["url"] = tab.url }
        payload["title"] = tab.title
        payload["tabId"] = tab.id
        payload["cover"] = tab.cover ?? ""
        // 面板菜单要显示"本站暂停拦截 / 本站恢复拦截"，所以观察里带上这一站的拦截状态
        let host = URL(string: tab.url)?.host
        payload["shieldPaused"] = BrowserShield.shared.isPaused(host: host)
        // 面板菜单要显示"恢复本站隐藏的 N 项"与"正在等点击"
        payload["hiddenCount"] = host.map { BrowserHidden.shared.veils(host: $0).count } ?? 0
        // 「…」菜单那枚书签按钮的文案：这一页收藏了没有
        payload["bookmarked"] = !tab.url.isEmpty && BrowserBookmarks.shared.contains(url: tab.url)
        onObservation?(payload)
    }

    private static let iconScript = """
    (function () {
      var link = document.querySelector('link[rel~="icon" i], link[rel="apple-touch-icon" i]');
      if (link) return new URL(link.getAttribute('href'), location.href).href;
      // 页面没声明：退到站点根的 /favicon.ico（浏览器自己的默认行为）。取不到由 SPA
      // 的 <img onError> 兜底，所以这里不必先探一次存在性。
      return location.origin + '/favicon.ico';
    })()
    """
}
