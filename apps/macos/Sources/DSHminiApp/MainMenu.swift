import AppKit

/// 主菜单（文件 / 编辑 / 视图 / 窗口 / 帮助）——照 macOS 应用惯例给齐，别只留一个
/// 编辑菜单。管什么：菜单结构与键位；不管什么：动作实现（都落在 AppDelegate /
/// MainWindowController 上，这里只连选择器）。
///
/// 两条纪律：
/// ① **可改键位不写死**：应用内快捷键（新建会话 ⌘N、搜索 ⌘K、侧栏 ⌘B、听写 ⌘D、
///    思考强度 ⇧⌘E、设置 ⌘,）的事实源是前端键位注册表（`frontend/src/keybinds.ts`，
///    设置→快捷键 可改）。菜单项若占同一个键，会把可改键位焊死（菜单先于 web 收到
///    按键），所以这些项**不带键位**——快捷键由注册表给，侧栏与工具提示里有键帽。
/// ② 其余按系统惯例给足（⌘O/⌘W/⌘M/⌘±/⌘0/⌘Z），包括「窗口」菜单的三条标准动作与
///    帮助里的日志/诊断入口——这些是"像正常 Mac 应用一样"的部分。
enum MainMenu {
    static func install(app: NSApplication, target: AppDelegate, window: MainWindowController) {
        let main = NSMenu()

        main.addItem(appMenuItem(target: target))
        main.addItem(fileMenuItem(target: target))
        main.addItem(editMenuItem())
        main.addItem(viewMenuItem(window: window))
        main.addItem(windowMenuItem())
        main.addItem(helpMenuItem(target: target))
        app.mainMenu = main
    }

    // MARK: - 各区

    private static func appMenuItem(target: AppDelegate) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu()
        item.submenu = menu
        menu.addItem(withTitle: "关于 DeepDive", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        // 「检查更新…」是 macOS 惯例位（关于之下）。Debug 构建不摆它——那种构建本来就不
        // 更新（AppUpdater.isSupported），摆一个点下去没反应的菜单项只会让人以为功能没做。
        if AppUpdater.isSupported {
            let checkUpdates = NSMenuItem(title: "检查更新…", action: #selector(AppDelegate.checkForUpdatesFromMenu(_:)), keyEquivalent: "")
            checkUpdates.target = target
            menu.addItem(checkUpdates)
        }
        menu.addItem(.separator())
        let settings = NSMenuItem(title: "设置…", action: #selector(AppDelegate.openSettingsFromMenu(_:)), keyEquivalent: "")
        menu.addItem(settings)
        menu.addItem(.separator())
        let services = NSMenu()
        let servicesItem = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
        servicesItem.submenu = services
        menu.addItem(servicesItem)
        NSApp.servicesMenu = services
        menu.addItem(.separator())
        menu.addItem(withTitle: "隐藏 DeepDive", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        menu.addItem(hideOthers)
        menu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 DeepDive", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        return item
    }

    private static func fileMenuItem(target: AppDelegate) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "文件")
        item.submenu = menu
        // 无键位：⌘N 属可改键位（见文件头 ①）。
        let newSession = NSMenuItem(title: "新建会话", action: #selector(AppDelegate.newSessionFromMenu(_:)), keyEquivalent: "")
        newSession.target = target
        menu.addItem(newSession)
        let openWorkspace = NSMenuItem(title: "打开工作区…", action: #selector(AppDelegate.pickWorkspaceFromMenu(_:)), keyEquivalent: "o")
        openWorkspace.target = target
        menu.addItem(openWorkspace)
        menu.addItem(.separator())
        // 关闭窗口＝收起面板（与红灯同语义：hidePanel，应用留在菜单栏）。
        menu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        return item
    }

    private static func editMenuItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "编辑")
        item.submenu = menu
        // 撤销/重做走响应链（WKWebView 实现 undo:/redo:，输入框里的撤销归它）；
        // 桌面版惯例键位：⌘Z / ⇧⌘Z。
        menu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(redo)
        menu.addItem(.separator())
        menu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        // AutoFill / 听写 / 表情与符号由系统按「编辑」菜单名自动追加（勿手写）。
        return item
    }

    private static func viewMenuItem(window: MainWindowController) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "视图")
        item.submenu = menu
        // ⌃⌘F 是系统惯例的全屏键位（⌘F 留给"查找"这类将来用途）。
        let fullScreen = NSMenuItem(title: "切换全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        menu.addItem(fullScreen)
        menu.addItem(.separator())
        let zoomIn = NSMenuItem(title: "放大", action: #selector(MainWindowController.pageZoomIn(_:)), keyEquivalent: "+")
        zoomIn.target = window
        menu.addItem(zoomIn)
        let zoomOut = NSMenuItem(title: "缩小", action: #selector(MainWindowController.pageZoomOut(_:)), keyEquivalent: "-")
        zoomOut.target = window
        menu.addItem(zoomOut)
        let zoomReset = NSMenuItem(title: "实际大小", action: #selector(MainWindowController.pageZoomReset(_:)), keyEquivalent: "0")
        zoomReset.target = window
        menu.addItem(zoomReset)
        return item
    }

    private static func windowMenuItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "窗口")
        item.submenu = menu
        menu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "全部置于前台", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApp.windowsMenu = menu
        return item
    }

    private static func helpMenuItem(target: AppDelegate) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "帮助")
        item.submenu = menu
        // 新手引导可随时再打开（首启错过 / 想复查各步设置）——同一张卡，不是第二套。
        let onboarding = NSMenuItem(title: "新手引导", action: #selector(AppDelegate.openOnboardingFromMenu(_:)), keyEquivalent: "")
        onboarding.target = target
        menu.addItem(onboarding)
        menu.addItem(.separator())
        let log = NSMenuItem(title: "显示日志", action: #selector(AppDelegate.revealLogFromMenu(_:)), keyEquivalent: "")
        log.target = target
        menu.addItem(log)
        let diagnostics = NSMenuItem(title: "复制诊断信息", action: #selector(AppDelegate.copyDiagnosticsFromMenu(_:)), keyEquivalent: "")
        diagnostics.target = target
        menu.addItem(diagnostics)
        let dataDir = NSMenuItem(title: "打开数据目录", action: #selector(AppDelegate.revealDataDirFromMenu(_:)), keyEquivalent: "")
        dataDir.target = target
        menu.addItem(dataDir)
        NSApp.helpMenu = menu
        return item
    }
}
