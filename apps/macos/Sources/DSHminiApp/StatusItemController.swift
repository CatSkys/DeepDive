import AppKit

/// Menu bar residency (no Dock; LSUIElement). Shows the engine state glyph
/// and the minimal control surface. Business data stays out of the shell —
/// the "recent sessions" list belongs to the P2 data plane, not v1.
final class StatusItemController: NSObject, NSMenuDelegate {
    var onShowWindow: (() -> Void)?
    var onReloadWeb: (() -> Void)?
    var onRestartEngine: (() -> Void)?
    var onToggleTheme: (() -> Void)?
    var onChooseWorkspace: (() -> Void)?
    var onQuit: (() -> Void)?

    var themeEnabled = true {
        didSet { themeMenuItem?.state = themeEnabled ? .on : .off }
    }

    private var item: NSStatusItem?
    private var themeMenuItem: NSMenuItem?

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        self.item = item

        let menu = NSMenu()

        let show = NSMenuItem(title: "显示 DSHmini", action: #selector(showWindowAction), keyEquivalent: "")
        show.target = self
        menu.addItem(show)

        let reload = NSMenuItem(title: "刷新界面", action: #selector(reloadAction), keyEquivalent: "r")
        reload.target = self
        menu.addItem(reload)

        let restart = NSMenuItem(title: "重启引擎", action: #selector(restartAction), keyEquivalent: "")
        restart.target = self
        menu.addItem(restart)

        menu.addItem(.separator())

        let theme = NSMenuItem(title: "黑白主题", action: #selector(themeAction), keyEquivalent: "")
        theme.target = self
        theme.state = themeEnabled ? .on : .off
        themeMenuItem = theme
        menu.addItem(theme)

        let workspace = NSMenuItem(title: "设置启动工作区…", action: #selector(workspaceAction), keyEquivalent: "")
        workspace.target = self
        menu.addItem(workspace)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "退出 DSHmini", action: #selector(quitAction), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        item.menu = menu
        setState(.launching)
    }

    func setState(_ state: EngineSupervisor.State) {
        let symbol: String
        switch state {
        case .ready: symbol = "circle.fill"
        case .idle, .launching: symbol = "arrow.triangle.2.circlepath"
        case .restarting: symbol = "arrow.triangle.2.circlepath"
        case .failed: symbol = "exclamationmark.triangle.fill"
        }
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "DSHmini 引擎")
        image?.isTemplate = true
        item?.button?.image = image
        item?.button?.toolTip = "DSHmini — \(state.shortLabel)"
    }

    // MARK: - actions

    @objc private func showWindowAction() { onShowWindow?() }
    @objc private func reloadAction() { onReloadWeb?() }
    @objc private func restartAction() { onRestartEngine?() }
    @objc private func themeAction() {
        themeEnabled.toggle()
        onToggleTheme?()
    }
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
