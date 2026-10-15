import AppKit

/// Menu bar status item (regular Dock app since the AppIcon landed;
/// LSUIElement=false). Shows the engine state glyph plus live activity
/// (SPEC-NOTIFICATIONS §1.4): attention state wins, then running, then
/// idle. Business data stays out of the shell.
final class StatusItemController: NSObject {
    static var shared: StatusItemController?

    var onShowWindow: (() -> Void)?
    var onOpenSettings: (() -> Void)?
    var onReloadWeb: (() -> Void)?
    var onRestartEngine: (() -> Void)?
    var onChooseWorkspace: (() -> Void)?
    var onQuit: (() -> Void)?

    /// 「更新」那一项的动作与可用性都落在 AppDelegate（`updateMenuItemAction` /
    /// `validateMenuItem`）：App 菜单与这份状态栏菜单是两份 NSMenu，文案、动作、禁用条件
    /// 必须同源，所以这里只借它的 target，不自己再实现一遍。
    weak var updateMenuTarget: AnyObject?
    /// App 菜单里那一项的同款引用由 `MainMenu.install` 返回；两份都由 AppDelegate 刷标题。
    private(set) var updateMenuItem: NSMenuItem?

    private var item: NSStatusItem?
    /// 右键那一份功能菜单。**不挂到 `item.menu` 上**——挂上去左键也会弹菜单（见 `install`）。
    private var menu: NSMenu?
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
            let updates = NSMenuItem(title: "检查更新…", action: #selector(AppDelegate.updateMenuItemAction(_:)), keyEquivalent: "")
            updates.target = updateMenuTarget
            menu.addItem(updates)
            updateMenuItem = updates
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

        item.menu = nil
        // Atd 同款（用户 2026-10-14 定稿）：**左键 = 显示主界面，右键 = 弹这份功能菜单**。
        // 把 menu 挂到 `item.menu` 上会变成"左右键都弹菜单"，所以改由按钮的动作分派：
        // 两种按键都送上来，`buttonClicked` 按事件类型分流。
        item.button?.target = self
        item.button?.action = #selector(buttonClicked(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        self.menu = menu
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

    /// 状态项按钮的两用：左键显示主界面，右键（含 ⌃ 左键，等于右键的那套习惯）弹功能菜单。
    @objc private func buttonClicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        let secondary =
            event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true
        guard secondary, let menu else {
            onShowWindow?()
            return
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 5), in: sender)
    }

    @objc private func showWindowAction() { onShowWindow?() }
    @objc private func openSettingsAction() { onOpenSettings?() }
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
