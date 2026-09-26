// 一个浏览器标签：身份 + 壳侧镜像（标题/地址/站点图标——标签栏要显示的那几个字段）
// + 一个**惰性的**宿主（`WKWebView` 首次访问才建，参考实现 Tab.swift 的 lazy `web`：
// 打开 N 个标签只花 N 个对象，进程要等真访问才起）。
//
// 这个文件只管"有没有宿主、给谁用"，以及睡着时留下的三样东西（回去的路 `memory`、
// 停帧封面 `cover`、镜像字段）。谁该睡、什么时候睡是策略，归 BrowserTabs+Sleep.swift。
import AppKit
import WebKit

final class BrowserTab {
    let id: String
    /// 壳侧镜像：页面回报什么就记什么。换标签/唤醒的那一瞬宿主答不出话
    /// （`view.url` 还是 nil），标签栏与地址栏靠这份镜像不至于退回空态。
    var title = ""
    var url = ""
    /// 站点图标：页面自己声明的那个地址（空 = 没声明，标签栏退化成首字母）
    var icon = ""
    /// 问过图标的那个 url：一次导航问一次，不重复问
    var iconAsked = ""
    /// 睡着 = 宿主已经还给系统（内存），`memory` 里留着回去的路
    private(set) var asleep = false
    /// 睡着/唤醒期间铺在面板上的停帧图（base64 PNG）。页面画出来时原生视图本来就压着它，
    /// 所以这里只需一个撤退时限（见 wake）。
    var cover: String?
    /// 闲置计时（休眠判据）：切过来、给它下命令、它自己在加载，都算有人用
    var idleSince = Date()
    /// 回去的路：历史 + 滚动位置 + 表单状态（`WKWebView.interactionState`）
    var memory: Any?
    /// 任何变化（观察/睡着/封面撤了）——集合据此推标签栏清单与当前页观察
    var onChange: ((BrowserTab) -> Void)?
    /// 页面要开新标签（`target=_blank` / `window.open`）——集合据此开一个，并把地址带过去
    var onPopup: ((String) -> Void)?
    /// 页面在要摄像头/麦克风（集合据此推给 SPA 弹窗）
    var onPermissionAsk: ((String, String) -> Void)?

    private var built: BrowserHost?
    private let store: WKWebsiteDataStore

    init(id: String, store: WKWebsiteDataStore) {
        self.id = id
        self.store = store
    }

    /// 当前宿主；没建就建（惰性）。
    var host: BrowserHost {
        if let built { return built }
        let host = BrowserHost(configuration: BrowserHost.configuration(store: store))
        host.onObservation = { [weak self] observation in
            guard let self else { return }
            self.mirror(observation)
            self.onChange?(self)
        }
        // 页面要开新标签（`target=_blank`）：交给集合去开——宿主管不了标签集合
        host.onPopup = { [weak self] url in self?.onPopup?(url) }
        host.onPermissionAsk = { [weak self] host, kind in self?.onPermissionAsk?(host, kind) }
        built = host
        return host
    }

    /// 已经建好的宿主（不触发创建）——给睡着的标签推状态、比焦点时不要吵醒它。
    var awakeHost: BrowserHost? { built }

    /// 要这个标签的宿主，且保证它是醒的：睡着的先醒，返回要挂上舞台的那个宿主。
    /// 人对它做任何事（切过来、下命令）与 agent 找它要图都走这一条。
    @discardableResult
    func awake() -> BrowserHost {
        if asleep { wake() }
        return host
    }

    /// 有人用它了（切过来/给它下命令/它在加载）。
    func touch() { idleSince = Date() }

    /// 把镜像拉成宿主此刻的事实。**必须在读之前拉一次**：观察事件发生在导航各个时点，
    /// `didFinish` 那一刻 `view.title` 常常还是空的（标题是稍后解析出来的），
    /// 只靠"变化才推"的观察，标签栏会一直显示空标题（实测）。
    func refresh() {
        guard let host = awakeHost else { return }
        let live = host.view.url?.absoluteString ?? ""
        if !live.isEmpty { url = live }
        // 标题只在新标题非空时替换：重载中/新页面还没解析出标题时，留着上一次的
        // （浏览器同一条：加载时标题不闪成空）
        let liveTitle = host.view.title ?? ""
        if !liveTitle.isEmpty { title = liveTitle }
    }

    /// 睡：宿主还给系统，留住回去的路与长相。
    func fallAsleep(memory: Any?, cover: String?) {
        built?.view.removeFromSuperview()
        built = nil
        self.memory = memory
        self.cover = cover
        asleep = true
        onChange?(self)
    }

    /// 醒：宿主重新建，页面按 `memory` 回到原处（没有 memory 就按镜像里的地址重开）。
    ///
    /// 封面**不靠"页面画好了"来撤**：压住它的原生视图一有像素就盖住它了，剩下的只是
    /// 时限——挂住的站点不能永远盖着一张旧图（参考实现 `uncover(after: 4)` 同一取舍）。
    private func wake() {
        asleep = false
        let state = memory
        memory = nil
        let host = self.host
        host.lastError = false
        // 与 sleep 成对的那条日志（见 BrowserTabs+Sleep.putToSleep）：restored=no 表示
        // 这个标签没有回去的路，只能按地址重开
        EngineLog.shared.append("[browser] wake \(url) restored=\(state == nil ? "no" : "yes")")
        if let state {
            host.restore(interactionState: state)
        } else if !url.isEmpty {
            host.load(url)
        }
        if cover != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self, !self.asleep, self.cover != nil else { return }
                self.cover = nil
                self.onChange?(self)
            }
        }
        onChange?(self)
    }

    private func mirror(_ observation: BrowserObservation) {
        if !observation.url.isEmpty { url = observation.url }
        title = observation.title
    }
}
