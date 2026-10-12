import Cocoa

/// 迷你面板控制器（全原生重做，Atd 同构）：开关、⌥Space、状态 feed、快捷会话
/// 数据回填、动作回调。窗口视觉与交互归 `MiniPanelWindow.swift`。
/// 线程模型：窗口是 MainActor（NSPanel 族）；调用方两条——AppDelegate 消息泵
/// （主线程）与 EngineEventObserver feed（mux 线程）。触窗一律经 onMain 跳板：
/// 主线程调用零开销直跑，后台 feed 自动归位。
final class MiniPanelController: NSObject {
    static let shared = MiniPanelController()

    /// 快捷会话默认空间的目录（D14）：引擎 workspace/create 只收已存在的绝对
    /// 路径（~ 不展开），目录由壳保证存在、注册由 SPA 幂等做。
    static var quickWorkspaceDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("DeepDive/快捷会话", isDirectory: true)
    }

    private var panel: MiniPanelWindow?

    /// 主线程跳板：MainActor 窗口的一切触达都从这走。
    private func onMain(_ body: @escaping @MainActor () -> Void) {
        if Thread.isMainThread {
            MainActor.assumeIsolated(body)
        } else {
            DispatchQueue.main.async { MainActor.assumeIsolated(body) }
        }
    }

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(appBecameActive),
            name: NSApplication.didBecomeActiveNotification, object: nil
        )
    }

    @objc private func appBecameActive() {
        onMain { [weak self] in self?.panel?.model.unseen = false }
    }

    var enabled: Bool {
        UserDefaults.standard.object(forKey: "deepdive.miniPanel.enabled") == nil
            ? true
            : UserDefaults.standard.bool(forKey: "deepdive.miniPanel.enabled")
    }

    var side: String {
        UserDefaults.standard.string(forKey: "deepdive.miniPanel.side") ?? "right"
    }

    /// 药丸常驻：启动即贴边；显隐不随热键（§4.1 二次更正）。
    func show() {
        guard enabled else { return }
        onMain { [weak self] in
            guard let self else { return }
            if panel == nil {
                let p = MiniPanelWindow()
                p.model.onAction = { [weak self] action in self?.performAction(action) }
                p.model.onRunCommand = { [weak self] name in self?.runCommand(name) }
                panel = p
            }
            panel?.showTucked()
        }
    }

    /// ⌥Space：展开/收起（§4.1）。
    func toggleExpanded() {
        onMain { [weak self] in
            guard let self, enabled, let panel else { return }
            setExpanded(!panel.model.expanded)
        }
    }

    func setExpanded(_ on: Bool) {
        guard enabled else { return }
        onMain { [weak self] in self?.panel?.setExpanded(on) }
    }

    // MARK: - 状态 feed（EngineEventObserver 投喂；悬浮球退役承接，NOTIFICATIONS §2）

    private(set) var focusSessionId: String?

    func noteRunningStarted(sessionId: String) {
        onMain { [weak self] in
            guard let self, let model = panel?.model else { return }
            model.setStatus(running: true, attention: model.attention, unseen: false)
        }
    }

    func noteNeedsAttention() {
        onMain { [weak self] in
            guard let self, let model = panel?.model else { return }
            model.setStatus(running: model.running, attention: true, unseen: model.unseen)
        }
    }

    func noteTurnFinished(sessionId: String, appInactive: Bool) {
        onMain { [weak self] in
            guard let self, let model = panel?.model else { return }
            if appInactive { model.unseen = true }
            focusSessionId = sessionId
            model.setStatus(running: false, attention: model.attention, unseen: model.unseen)
        }
    }

    func sync(running: Bool, attention: Bool) {
        onMain { [weak self] in
            guard let self, let model = panel?.model else { return }
            model.setStatus(running: running, attention: attention, unseen: model.unseen)
        }
    }

    // MARK: - 快捷会话（主 SPA 推 quickSession 上壳 → 回填命令卡数据）

    func setQuickSession(_ sessionId: String?, commands: [[String: String]] = []) {
        onMain { [weak self] in
            guard let self, let model = panel?.model else { return }
            model.quickSessionId = sessionId
            model.commands = commands.compactMap { row in
                guard let name = row["name"], !name.isEmpty else { return nil }
                return MiniPanelModel.CommandItem(name: name, description: row["description"] ?? "")
            }
        }
    }

    // MARK: - 动作

    func performAction(_ action: String) {
        switch action {
        case "openMain", "newSession":
            setExpanded(false)
            NSApp.activate(ignoringOtherApps: true)
            AppDelegate.shared?.showMainWindow()
            if action == "newSession" {
                AppDelegate.shared?.pushHostCommand("openQuickSession", payload: nil)
            }
        default:
            break
        }
    }

    func runCommand(_ name: String) {
        guard let sid = panel?.model.quickSessionId else { return }
        onMain { [weak self] in
            guard let self, let panel else { return }
            panel.model.flyoutOpen = false
            panel.setExpanded(false)
        }
        NSApp.activate(ignoringOtherApps: true)
        AppDelegate.shared?.showMainWindow()
        AppDelegate.shared?.pushNavigateToSession(sid)
        AppDelegate.shared?.pushHostCommand(
            "runQuickCommand",
            payload: AppDelegate.jsonPayload(["sessionId": sid, "name": name])
        )
    }

    /// 「迷你面板」开关（设置 → 通知行）。
    func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "deepdive.miniPanel.enabled")
        if on { show() } else { onMain { [weak self] in self?.panel?.orderOut(nil) } }
    }
}
