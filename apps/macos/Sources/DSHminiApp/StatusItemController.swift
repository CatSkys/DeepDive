import AppKit

/// Menu bar status item (regular Dock app since the AppIcon landed;
/// LSUIElement=false). Shows the engine state glyph plus live activity
/// (SPEC-NOTIFICATIONS §1.4): attention state wins, then running, then
/// idle. Business data stays out of the shell.
final class StatusItemController: NSObject {
    static var shared: StatusItemController?

    var onShowWindow: (() -> Void)?
    var onOpenSettings: (() -> Void)?
    var onCheckForUpdates: (() -> Void)?
    var onReloadWeb: (() -> Void)?
    var onRestartEngine: (() -> Void)?
    var onChooseWorkspace: (() -> Void)?
    var onQuit: (() -> Void)?

    private var item: NSStatusItem?
    private var engineState: EngineSupervisor.State = .launching
    private var activityRunning = false
    private var activityAttention = false

    override init() {
        super.init()
        StatusItemController.shared = self
    }

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        self.item = item

        let menu = NSMenu()

        let show = NSMenuItem(title: "显示 DeepDive", action: #selector(showWindowAction), keyEquivalent: "")
        show.target = self
        menu.addItem(show)

        let settings = NSMenuItem(title: "设置…", action: #selector(openSettingsAction), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        // 与 App 菜单同一份判断：Debug 构建不摆「检查更新…」。
        if AppUpdater.isSupported {
            let updates = NSMenuItem(title: "检查更新…", action: #selector(checkForUpdatesAction), keyEquivalent: "")
            updates.target = self
            menu.addItem(updates)
        }

        let reload = NSMenuItem(title: "刷新界面", action: #selector(reloadAction), keyEquivalent: "r")
        reload.target = self
        menu.addItem(reload)

        let restart = NSMenuItem(title: "重启引擎", action: #selector(restartAction), keyEquivalent: "")
        restart.target = self
        menu.addItem(restart)

        menu.addItem(.separator())

        let workspace = NSMenuItem(title: "设置启动工作区…", action: #selector(workspaceAction), keyEquivalent: "")
        workspace.target = self
        menu.addItem(workspace)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "退出 DeepDive", action: #selector(quitAction), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        item.menu = menu
        // 「黑白主题」menu item removed in P2: theme lives in settings → 外观
        // (SPEC-NOTIFICATIONS §1.4); single entry point, no dual controls.
        setState(.launching)
    }

    func setState(_ state: EngineSupervisor.State) {
        engineState = state
        render()
        item?.button?.toolTip = "DeepDive — \(state.shortLabel)"
    }

    /// 设置-通用「菜单栏图标」：isVisible 只摘掉菜单栏里的图标，
    /// 菜单与回调保持持有，重新打开即时恢复。
    func setVisible(_ visible: Bool) {
        item?.isVisible = visible
    }

    /// Live activity from EngineEventObserver (§1.4): attention > running.
    func setActivity(running: Bool, attention: Bool) {
        activityRunning = running
        activityAttention = attention
        render()
    }

    private func render() {
        // Idle glyph = the DeepDive mark, unified with the floating bubble
        // (user decision); engine failure/launching keep the distinct system
        // glyphs so a broken engine reads at a glance. Activity rides as a
        // marker on the mark: attention dot wins, then running ring.
        let image: NSImage?
        switch engineState {
        case .failed:
            image = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "DeepDive 引擎")
        case .launching, .restarting:
            image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "DeepDive 引擎")
        case .idle, .ready:
            image = BrandMark.statusIcon(running: activityRunning, attention: activityAttention)
        }
        image?.isTemplate = true
        item?.button?.image = image
    }

    // MARK: - actions

    @objc private func showWindowAction() { onShowWindow?() }
    @objc private func openSettingsAction() { onOpenSettings?() }
    @objc private func checkForUpdatesAction() { onCheckForUpdates?() }
    @objc private func reloadAction() { onReloadWeb?() }
    @objc private func restartAction() { onRestartEngine?() }
    @objc private func workspaceAction() { onChooseWorkspace?() }
    @objc private func quitAction() { onQuit?() }
}

private extension EngineSupervisor.State {
    var shortLabel: String {
        switch self {
        case .idle: return "待机"
        case .launching: return "启动引擎…"
        case .ready: return "运行中"
        case .restarting(let attempt): return "重启中（第 \(attempt) 次）"
        case .failed: return "引擎异常"
        }
    }
}
