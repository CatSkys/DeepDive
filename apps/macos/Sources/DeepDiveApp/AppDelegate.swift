import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shared: AppDelegate?

    private var supervisor: EngineSupervisor!
    private var windowController: MainWindowController!
    private var quickPanel: QuickPanelController!
    private var miniPanel: MiniPanelController!
    private var statusItem: StatusItemController!
    /// 应用自身更新（Sparkle）；Debug 构建里它是空壳（永远不更新，见 AppUpdater）。
    private var updater: AppUpdater!
    /// App 菜单里那一项「更新」（状态栏那份在 StatusItemController 上）。两份的标题随
    /// 更新状态变，由 `refreshUpdateMenuItems()` 一处刷新。
    private var appMenuUpdateItem: NSMenuItem?
    private var hotKey: HotKeyManager!
    /// 悬浮注释的宿主（独立原生玻璃窗口 + 注释那一页）：三块页面（主窗/迷你面板/命令
    /// 中心卡）的 `data-tip` 都汇到这一处——注释窗口只有一块，按屏幕坐标摆，天然同时
    /// 服务所有窗口。懒建：测试宿主不碰 webview。
    lazy var tooltip = TooltipController()
    /// 截图的壳侧编排（Atd 移植族的接线）；懒建：测试宿主不碰屏幕冻结与授权计时器。
    private lazy var screenshot = ScreenshotController()
    /// 划词的壳侧编排（Atd 移植族的接线）；懒建同上。
    private lazy var selection = SelectionController()
    /// 桥消息的来源窗口：结果要回到发起它的那个页面。
    enum BridgeSource { case main, panel }
    /// 进行中的截图：来源（nil = 全局热键，交付后要把面板亮起来）与请求 id。
    private var pendingCapture: (source: BridgeSource?, reqId: String?)?
    private var config: AppConfig!
    private var terminationSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // §5 测试宿主瘦身（2026-10-12）：单测不消费 app 服务（引擎/webview/桥，
        // 各测试自造 fixture）——XCTest 环境下整条启动链跳过。不带 WebContent/
        // 引擎进程，宿主收尾挂死与子进程 spawn 压力（GitChangesTests flake 同根）
        // 整类消失；保留 AppDelegate.shared 供断言"宿主在"的测试。
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
            AppDelegate.shared = self
            config = AppConfig.load() // prefsPayload 等断言要读它；读文件而已，不启服务
            // prefsPayload 读 miniPanel.isShown：测试宿主不跑启动链，这里只建
            // 控制器不 start（init 纯逻辑不开窗不开进程，窗在 start/present）。
            miniPanel = MiniPanelController()
            return
        }
        _ = AppPaths.supportDir
        AppDelegate.shared = self
        installTerminationHandler()
        installWakeObserver()
        adjustOcclusionDetection()
        config = AppConfig.load()

        // Same-origin bridge seat: serves the self-built SPA and relays /api.
        try? FileManager.default.createDirectory(
            at: AppPaths.supportDir, withIntermediateDirectories: true
        )
        BridgeServer.shared.configure(webRoot: webRoot())
        // 监听失败 = SPA 无处加载（窗口只有透明底、没有任何 JS 报错）：结果不能丢
        // （AUD-039 同族：静默放行比崩溃更难查）。
        if !BridgeServer.shared.start() {
            EngineLog.shared.append("[bridge] no listener could be started — the SPA cannot be served")
        }
        // 移动端远程面：上次开着就接着开（端口固定，手机上已存的链接不必重扫）
        if RemoteAccess.shared.enabled { _ = RemoteAccess.shared.start() }

        supervisor = EngineSupervisor(home: AppPaths.harnessHome, workspace: config.workspaceURL)
        windowController = MainWindowController(themeEnabled: config.themeEnabled)
        // 菜单在窗口控制器之后装：视图菜单的缩放动作要挂到它身上（AUD：早装=取到 nil 崩）。
        installMainMenu()
        statusItem = StatusItemController()
        hotKey = HotKeyManager()
        installDictation()

        // 状态栏那份「更新」项的动作与校验借 AppDelegate（两份菜单同源，见 StatusItemController）。
        statusItem.updateMenuTarget = self
        statusItem.install()
        statusItem.onShowWindow = { [weak self] in self?.windowController.showPanel() }
        statusItem.onOpenSettings = { [weak self] in self?.openSettings() }
        statusItem.onReloadWeb = { [weak self] in self?.windowController.reloadWeb() }
        statusItem.onRestartEngine = { [weak self] in self?.startEngine() }
        statusItem.onChooseWorkspace = { [weak self] in self?.chooseWorkspace() }
        statusItem.onQuit = { [weak self] in
            // 引擎收到 SIGTERM 后正常毫秒级退出，退出即经 stop 完结回调 terminate——
            // 退出期不再忙等（旧实现主线程 usleep 轮询 0.8–6s）。卡住的引擎由宽限
            // SIGKILL 收，极端情况下应用先离开、孤儿由下一次启动 reap。
            self?.supervisor?.stop { NSApp.terminate(nil) }
        }
        // 通知区可见性（设置-通用）：菜单栏图标可整体隐藏；Dock 图标走
        // accessory 策略（不经 Dock/Cmd⌘-Tab，窗口与热键不受影响）。
        statusItem.setVisible(DSHAppPrefs.menuBar)
        NSApp.setActivationPolicy(DSHAppPrefs.dockIcon ? .regular : .accessory)

        // 应用自身更新（Sparkle）：起在引擎之前——它只碰 Info.plist 里的 feed 与公钥，
        // 与引擎无关，慢一点起就少一次后台检查。下载完只把版本号交出来（不弹窗），
        // 原生入口在菜单里，设置页那一屏收 `updateState`。
        updater = AppUpdater()
        updater.onChange = { [weak self] in self?.updateStateChanged() }
        updater.start()

        supervisor.onState = { [weak self] state in
            self?.handleEngineState(state)
        }

        // Built-in settings page (user decision: no native settings window).
        // Theme changes flow through the same path as the old menu toggle and
        // push `themeChanged`; hotkey re-binds re-register the Carbon hotkey.
        windowController.onHostMessage = { [weak self] body in
            self?.handleHostMessage(body, from: .main)
        }

        // Notification tap → activate + route to the tapped session (§1.1).
        NativeAlerts.onOpenSession = { [weak self] sessionId in
            self?.showMainWindow()
            if let sessionId {
                self?.windowController.pushHostCommand(
                    "navigateToSession",
                    payload: Self.jsonPayload(["sessionId": sessionId])
                )
            }
        }
        NativeAlerts.install()

        // 全局热键 = 会话窗口（迷你面板）的显隐开关（用户定稿：热键是会话窗口的
        // 开关，与胶囊无关）；召唤目标永远是迷你面板，不是本体主窗。
        hotKey.onPanelHotKey = { [weak self] in self?.quickPanel.togglePanel() }
        hotKey.onScreenshotHotKey = { [weak self] in self?.beginCapture(from: nil, reqId: nil) }
        // 迷你面板的启动器（屏缘药丸/胶囊，Atd 整包移植）：Actions 接到本项目
        // 的既有流程；划词（P2）/截图（P3）未上——条目按 §6.1 不显示，对应
        // Actions 槽位先空着留给后续接线。拖放那三条已接（见 importDroppedItems）。
        miniPanel = MiniPanelController()
        miniPanel.actions = MiniPanelController.Actions(
            openMainWindow: { [weak self] in self?.showMainWindow() },
            newTask: { [weak self] in self?.quickPanelNewTask() },
            ask: { [weak self] in self?.askAboutSelection() },
            screenshot: { [weak self] in self?.beginCapture(from: .panel, reqId: nil) },
            command: { [weak self] id in self?.quickPanelCommand(id) },
            openSettings: { [weak self] in self?.openSettings() },
            openItems: { [weak self] urls in self?.importDroppedItems(urls) },
            importImage: { [weak self] data in self?.importDroppedImage(data) },
            askAbout: { [weak self] text in self?.askAboutSelection(known: text) },
            showPanel: { [weak self] in self?.quickPanel.showPanel() },
            reportFailures: { [weak self] failures in self?.reportDropFailures(failures) },
            stateChanged: {}
        )
        miniPanel.start()
        wireCaptureAndSelection()
        if hotKey.register(.panel, spec: config.hotkey) {
            EngineLog.shared.append("[shell] hotkey registered: \(config.hotkey)")
        } else {
            EngineLog.shared.append("[shell] hotkey register FAILED: \(config.hotkey)")
        }
        registerScreenshotHotkey()
        // 全局热键开关（设置-快捷键）：关 = 系统级注销，⌥Space 不再触发
        if !DSHAppPrefs.hotkeyOn {
            hotKey.unregister(.panel)
            EngineLog.shared.append("[shell] hotkey disabled by pref")
        }

        // 老 dsh CLI（~/.dsh）的凭据一次性接过来——引擎只认 DSH_HOME 下那一份。
        // 原挂载点是恢复窗的按钮，恢复窗删除后改在启动期自动走（.already/.missing
        // 是常态、静默；.imported/.failed 由 LegacyCredentials 自己落日志）。

        // Load the bridge (SPA shows "引擎启动中" until the engine is up).
        // 迷你面板窗口**无条件创建**：热键与药丸钮随时会碰它， IUO 上留 nil
        // 就是崩溃；bridge 起不来时只加载不出页面（玻璃空壳），与主窗同命。
        quickPanel = QuickPanelController()
        quickPanel.onHostMessage = { [weak self] body in self?.handleHostMessage(body, from: .panel) }
        // 这扇窗里拖入的**目录**：路径只有壳拿得到（页面拿不到，PITFALLS §4.36），
        // 转 @ 引用推给**它自己那一页**（主窗那一投推主窗，别串页）
        quickPanel.onFoldersDropped = { [weak self] urls in
            self?.deliverDroppedFolders(urls, to: .panel)
        }
        if let bridgeURL = BridgeServer.shared.url {
            // Deep link aid: DEEPDIVE_OPEN_SID=<session-id> opens that session on boot.
            if let sid = ProcessInfo.processInfo.environment["DEEPDIVE_OPEN_SID"],
               !sid.isEmpty,
               var comps = URLComponents(url: bridgeURL, resolvingAgainstBaseURL: false) {
                comps.queryItems = [URLQueryItem(name: "sid", value: sid)]
                windowController.load(url: comps.url ?? bridgeURL)
            } else {
                windowController.load(url: bridgeURL)
            }
            quickPanel.load(bridgeURL: bridgeURL)
            // 悬浮注释那块窗口（系统液态玻璃 + 注释那一页）：**跟着预载**——注释是随手
            // 悬停就看的东西，第一次悬停不能是空的。
            tooltip.load(bridgeURL: bridgeURL)
        }

        // 「提取文字」那颗钮要用的识别服务先热起来：它的首次请求实测可能是分钟级（服务/模型
        // 冷启动，热起来 ~1s，PITFALLS §11.9），那份代价该在启动期后台付掉，而不是等用户按下
        // 那颗钮之后。用户拿不出这么久的余量，启动期拿得出。
        Task.detached(priority: .utility) { await ScreenText.warmUp() }

        // 铺盘期放后台：首启/升级那一次 ProfileComposer/ChatImport/BotChannel 各要
        // 整树拷贝（node_modules 闭包数万文件），同步在主线程上=启动卡死；凭据迁移
        // 也要触文件面板。**串行保证**：引擎 spawn 必须等它们做完（profile bundles
        // 决定装载、凭据不由用户错过则冷启动零回复），同一后台队列顺序执行再回主
        // 线程调用 start（spawn 本体仍走主线程 supervisor 的字面量纪律）。
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            if let runtime = Bundle.main.resourceURL {
                // 组合先落地、再谈别的插件：ProfileComposer 写 dsh.profile.bundles，
                // 下面两个安装器读同一份清单做合并——顺序倒了就会把上游两层重新写回去。
                ProfileComposer.ensureInstalled(
                    in: AppPaths.harnessHome,
                    bundledDir: runtime.appendingPathComponent("EngineProfile", isDirectory: true)
                )
                ChatImportPlugin.ensureInstalled(
                    in: AppPaths.harnessHome,
                    bundledDir: runtime.appendingPathComponent("Runtime/chat-import", isDirectory: true)
                )
                // IM 渠道插件同批铺盘：引擎按 profile bundles 加载后才挂上
                // /api/dsh-im/<渠道>（移动端远程控制的 Bot Channel 与机器人管理）。
                BotChannelPlugin.ensureInstalled(
                    in: AppPaths.harnessHome,
                    bundledDir: runtime.appendingPathComponent("Runtime/dsh-im", isDirectory: true)
                )
            }
            LegacyCredentials.perform()
            DispatchQueue.main.async { self.startEngine() }
        }

        // Second launch of the same app: bring the existing window forward.
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(showFromOtherInstance(_:)),
            name: Notification.Name("com.deepdive.app.show"),
            object: nil
        )

        // 双击图标启动就是要用：一律把窗口带到前台。旧判据是「config.json 不
        // 存在才算首启」，而 config.json 会被「改快捷键」与菜单栏「设置启动
        // 工作区…」（说明书里就教这一步）顺手创建——此后冷启动双击图标毫无
        // 反应，菜单栏应用连个提示都没有，被用户报成「打不开」（只剩 Dock
        // 图标 / 菜单栏 / ⌥Space 三条唤出路径）。bridge URL 已在上方 load。
        windowController.showPanel()

        // Dev/verification hook (same family as DEEPDIVE_OPEN_SID): open the
        // settings window right after boot.
        if ProcessInfo.processInfo.environment["DEEPDIVE_OPEN_SETTINGS"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.openSettings()
            }
        }
    }

    /// 引擎启动的唯一入口：启动链（铺盘完/重启链收尾）都汇到它。start() 内有
    /// 幂等守卫 + reap 后台等待，重复调用安全。
    private func startEngine() {
        supervisor.start()
    }

    /// 第二个实例的唤醒（双击图标时已有实例在跑）：把面板带到前台。
    /// 已在最前就什么都不做——发起方在等锁期间每 0.5s 补发一次（它的首个通知
    /// 可能早于本实例挂上观察者），连点图标不该让窗口反复淡入。
    @objc private func showFromOtherInstance(_ note: Notification) {
        guard let window = windowController.window else { return }
        if window.isVisible, window.isKeyWindow, NSApp.isActive { return }
        windowController.showPanel()
    }

    // MARK: - settings page + main window access

    /// Settings live inside the main window (built-in SPA pane): bring the
    /// window forward and instruct the frontend to open the pane.
    func openSettings() {
        showMainWindow()
        windowController.pushHostCommand("navigateToSettings", payload: "{}")
    }

    func showMainWindow() {
        windowController.showPanel()
    }

    // MARK: - 迷你面板（QuickPanel）召唤目标

    /// 胶囊「新会话」：页面未加载先现身面板（Atd 的门槛），随后推 openQuickSession；
    /// 迷你面板页切好新会话视图、画出首帧后回 quickPanel-show，壳再把窗口带到前台
    /// ——用户看到的永远是新会话页，绝不闪旧视图（Atd task.new 的编排）。
    func quickPanelNewTask() {
        let pageReady = quickPanel.webView.url != nil
        if !pageReady { quickPanel.showPanel() }
        quickPanel.pushHostCommand("openQuickSession", payload: "{}")
    }

    /// 胶囊命令卡一行：在迷你面板的快捷会话里执行该命令（输入框预填，用户回车确认）。
    func quickPanelCommand(_ id: String) {
        quickPanel.showPanel()
        quickPanel.pushHostCommand("runQuickCommand", payload: Self.jsonPayload(["name": id]))
    }

    /// Dock 图标点击（运行中 reopen）：主面板是 orderOut 管理的 NSPanel，
    /// 系统 reopen 不会自动恢复它——显式走 showPanel（与通知点击/菜单栏
    /// 同一入口），面板已可见时等价于把它带回前台。返回 false 表示已接管。
    /// §5 瘦身测试宿主没建窗（windowController 为 nil）：没有可显的面板，
    /// 交给系统默认——没有这一守卫，activate/reopen Apple Event 在宿主里
    /// 直接崩掉（崩溃报告 2026-10-12：reopen → showMainWindow → nil 解包），
    /// xcodebuild 重启宿主重跑剩余测试，套件账目错乱。
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard windowController != nil else { return true }
        showMainWindow()
        return false
    }

    /// Bridge push helper for native surfaces (bubble, notifications).
    func pushNavigateToSession(_ sessionId: String) {
        windowController.pushHostCommand(
            "navigateToSession",
            payload: Self.jsonPayload(["sessionId": sessionId])
        )
    }

    /// 迷你面板 → 本体的指令通道（openQuickSession 等）；payload 为 JSON 文本。
    func pushHostCommand(_ cmd: String, payload: String?) {
        windowController.pushHostCommand(cmd, payload: payload ?? "{}")
    }

    /// JSON payload builder for every bridge pushHostCommand — JSONSerialization
    /// only, so ids with quotes/backslashes can't produce invalid JSON and the
    /// shell has a single JSON construction path (hand-built interpolation and
    /// this helper used to coexist; AUD-013).
    static func jsonPayload(_ fields: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: fields),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    // MARK: - frontend→shell host commands (SPEC-NOTIFICATIONS §3.1)

    private var hotkeyRecorder: HotkeyRecorderWindow?

    private func handleHostMessage(_ body: [String: Any], from source: BridgeSource) {
        guard let type = body["type"] as? String else { return }
        switch type {
        case "host-ready":
            pushPrefs()
            pushHotkey()
            // 引擎状态的快照也要推：SPA 每次 ready 都会整体重载，重载后它只剩默认
            // 相位——不补这一下，"重启中/已失败"在重载后就退回成笼统的"正在重试…"。
            pushEngineState(supervisor.state)
            // 更新状态同理：重载后「已下载 x.y.z 待装」不该消失。
            pushUpdateState()
        case "check-update":
            updater.checkForUpdates()
        case "install-update":
            updater.installNow()
        case "update-state":
            pushUpdateState()
        case "restart-engine":
            // 真正的重启：start() 对运行中的引擎是 no-op（process 幂等守卫），
            // 只调它等于"什么都不做"——而 bundle 成员变化（如卸载插件）必须换进程才生效。
            // 收尾链（stop→start）事件化：引擎退出即在 stop 完结回调里起新的，
            // 主线程不再忙等（旧实现 0.8–6s 冻结）。回调期可能撞上
            // chooseWorkspace 换装（supervisor 已换）：这时重启落在新链上，
            // 旧实例只归还其完结。
            let retiring = supervisor
            guard let retiring else { return }
            retiring.stop { [weak self] in
                guard let self, self.supervisor === retiring else { return }
                self.startEngine()
            }
        case "rebind-hotkey":
            beginHotkeyRecording(which: body["which"] as? String ?? "panel")
        case "set-pref":
            guard let key = body["key"] as? String else { return }
            // 字符串偏好（外观三态 / 语言）：JS string 桥接成 NSString。
            if let mode = body["value"] as? String {
                if key == "appearance" {
                    DSHAppPrefs.setAppearance(mode)
                    windowController.applyAppearanceMode()
                    tooltip.applyAppearanceMode()
                } else if key == "language" {
                    DSHAppPrefs.setLanguage(mode)
                    // 原生面那套文案（迷你面板药丸/选区工具条/截图标注与 HUD）走 ShellStrings，
                    // 它在 init 里读一次语言、靠这条 apply 发通知让长寿命面重建——不喂它，
                    // 原生面就停在启动时那一刻（2026-10-14 用户报"顺带检查划词工具和截图"）。
                    ShellStrings.shared.apply(appLanguage: mode)
                    // 语言是**运行中会变**的偏好，而 prefs 平时只在 host-ready / get-prefs 推
                    // 快照：不在这里补这一条，设置里切语言就只到主窗（它自己乐观更新），面板页
                    // 与命令中心卡页那两份 store 会一直停在启动时那一刻（2026-10-14 用户报
                    // "整个浮动面板没有英文"）。
                    pushPrefs()
                } else if key == "keybinds" {
                    // 前端键位覆盖（JSON 串，结构由前端定义）：只存不解析。
                    DSHAppPrefs.setKeybinds(mode)
                } else if key == "onboarding" {
                    // 新手引导进度（JSON 串，结构由前端 onboarding/useOnboarding 定义）。
                    DSHAppPrefs.setOnboarding(mode)
                } else if key == "screenshotHotkey" {
                    DSHAppPrefs.setScreenshotHotkey(mode)
                    registerScreenshotHotkey()
                } else if key == "selectionCommands" {
                    // 划词命令目录（JSON 串，结构由前端 settings/selectionCommands.ts 定义）：
                    // 壳只存不解析——胶囊按钮要的名字经 selection-toolbar-set 来，这里存的是
                    // 用户的编辑（名字与提示词模板）。
                    DSHAppPrefs.setSelectionCommands(mode)
                } else if key == "miniRunningGlow" {
                    // 面板进行中动效的形态：写的人在命令中心卡页，画的人在面板页——
                    // 两块 webview 两份 store，不推回面板页它就换不过去（同 language 那条）。
                    DSHAppPrefs.setMiniRunningGlow(mode)
                    pushPrefs()
                }
                break
            }
            guard let raw = body["value"] as? NSNumber else { break }
            // JS true/false 与数字都桥接成 NSNumber，且数字能被 as? Bool
            // 误转成功 —— 必须按 CFBoolean 类型判别分流，不能靠 cast 试探。
            if CFGetTypeID(raw) == CFBooleanGetTypeID() {
                let value = raw.boolValue
                switch key {
                case "notifyTurnEnd":
                    DSHAppPrefs.setNotifyTurnEnd(value)
                    // 打开开关就是用户表达"我要通知"的时刻：授权请求在这里发。
                    // 旧实现只在首个任务派发时请求（且只在 running=true 时），
                    // 于是没跑过任务的会话永远拿不到授权，引擎异常通知静默丢弃、
                    // 设置页的开关看着能用其实没生效（AUD-0xx）。
                    if value { NativeAlerts.requestAuthorizationIfNeeded() }
                case "notifyAttention":
                    DSHAppPrefs.setNotifyAttention(value)
                    if value { NativeAlerts.requestAuthorizationIfNeeded() }
                case "hotkeyOn":
                    DSHAppPrefs.setHotkeyOn(value)
                    if value {
                        hotKey.register(.panel, spec: config.hotkey)
                    } else {
                        hotKey.unregister(.panel)
                    }
                case "menuBar":
                    DSHAppPrefs.setMenuBar(value)
                    statusItem.setVisible(value)
                case "dockIcon":
                    DSHAppPrefs.setDockIcon(value)
                    NSApp.setActivationPolicy(value ? .regular : .accessory)
                case "miniPanel": miniPanel.setShown(value)
                case "modelDetail": DSHAppPrefs.setModelDetail(value)
                case "screenshotHotkeyOn":
                    DSHAppPrefs.setScreenshotHotkeyOn(value)
                    registerScreenshotHotkey()
                case "quickPanelPinned":
                    // 快捷面板置顶（命令中心那一行）：偏好落壳，窗口层级立刻摆过去；
                    // 这一条要**推回**两块面板承载页——标签的当前值在它们手上（同 language 那条：
                    // 命令中心卡页是另一份 store，不推它就永远停在上一次的快照上）。
                    DSHAppPrefs.setQuickPanelPinned(value)
                    quickPanel.applyPinned()
                    pushPrefs()
                default: break
                }
            } else if key == "sidebarWidth" {
                DSHAppPrefs.setSidebarWidth(raw.doubleValue)
            }
        case "set-theme":
            // 与 set-pref 同因：JS true/false 与数字都桥接成 NSNumber，数字能被
            // as? Bool 误转成功——按 CFBoolean 类型判别取值（AUD-081）；
            // 非布尔/缺省回落 true（保持旧默认）。
            let enabled: Bool
            if let raw = body["enabled"] as? NSNumber, CFGetTypeID(raw) == CFBooleanGetTypeID() {
                enabled = raw.boolValue
            } else {
                enabled = true
            }
            config.themeEnabled = enabled
            config.save()
            windowController.setTheme(enabled)
        case "get-prefs":
            pushPrefs()
        case "reveal-home":
            NSWorkspace.shared.open(AppPaths.harnessHome)
        case "reveal-path":
            let path = body["path"] as? String ?? ""
            guard FileManager.default.fileExists(atPath: path) else { break }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        case "open-path":
            // 产物三动作之一：默认应用打开（0.1.5 产物面；只开确已存在的路径）
            let openPath = body["path"] as? String ?? ""
            guard FileManager.default.fileExists(atPath: openPath) else { break }
            NSWorkspace.shared.open(URL(fileURLWithPath: openPath))
        case "keep-awake":
            // 自动化页的「运行会话时保持电脑唤醒」：前端按 开关 ∧ 有会话在跑 推
            KeepAwake.set((body["on"] as? NSNumber)?.boolValue ?? false)
        case "open-with-list":
            // 全屏预览页「打开方式」候选：能打开该文件的 App + 图标 dataURL
            openWithList(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "", out: windowController)
        case "open-path-with":
            // 指定 App 打开（只认已存在的文件与 .app，别让前端拼出任意路径）
            let target = body["path"] as? String ?? ""
            let app = body["app"] as? String ?? ""
            guard FileManager.default.fileExists(atPath: target),
                  FileManager.default.fileExists(atPath: app) else { break }
            NSWorkspace.shared.open(
                [URL(fileURLWithPath: target)],
                withApplicationAt: URL(fileURLWithPath: app),
                configuration: NSWorkspace.OpenConfiguration(),
            )
        case "copy-log-path":
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(AppPaths.logURL.path, forType: .string)
        case "open-host-doc":
            Task { @MainActor in
                let opened = await EngineGateway.shared.openSettingsDocument()
                if !opened {
                    let doc = AppPaths.harnessHome.appendingPathComponent("settings.yaml")
                    if FileManager.default.fileExists(atPath: doc.path) {
                        NSWorkspace.shared.activateFileViewerSelecting([doc])
                    } else {
                        NSWorkspace.shared.open(AppPaths.harnessHome)
                    }
                }
            }
        case "pick-workspace":
            pickWorkspaceDirectory()
        case "quiet-sessions":
            // 前端推来的"不打扰"会话集（后台会话判据的唯一事实源在前端）
            EngineEventObserver.shared.setQuietSessions(body["ids"] as? [String] ?? [])
        case "quickPanel-show":
            // 迷你面板页报新视图首帧已画出 → 把面板带到前台（Atd windowShow 语义）。
            quickPanel.showPanel()
        case "mini-cc-escape":
            // 面板页收到 Esc 而命令中心卡还开着 → 这一次按键的语义归卡页（先返回上层、
            // 已在根行才收卡）。壳只转发，不代它收卡（见 forwardEscapeToCard）。
            quickPanel.forwardEscapeToCard()
        case "open-quick-panel":
            // 主窗侧栏「快捷会话」图标 → 把面板窗带到前台（与 ⌥Space 同一落点；
            // 让面板自己决定露出哪一视图，这里不管内容，只负责"叫它出来"）。
            quickPanel.showPanel()
        case "prepare-workspace":
            prepareWorkspace(
                reqId: body["reqId"] as? String ?? "",
                path: body["path"] as? String ?? "",
                name: body["name"] as? String ?? "",
                instructions: body["instructions"] as? String ?? "",
                out: windowController,
            )
        case "write-agents":
            writeAgents(
                reqId: body["reqId"] as? String ?? "",
                path: body["path"] as? String ?? "",
                instructions: body["instructions"] as? String ?? "",
                out: windowController,
            )
        case "screenshot-capture":
            beginCapture(from: source, reqId: body["reqId"] as? String)
        case "screenshot-edit":
            beginCaptureEdit(
                path: body["path"] as? String ?? "", from: source, reqId: body["reqId"] as? String)
        case "selection-capture":
            captureSelectionFor(source: source, reqId: body["reqId"] as? String)
        case "selection-toolbar-set":
            if let settings = body["settings"] as? [String: Any] {
                DSHAppPrefs.setSelectionToolbar(Self.jsonString(settings))
                selection.apply(ToolbarSetParams(settings))
            }
        case "selection-listening":
            selection.setListening(body["on"] as? Bool ?? false)
        case "selection-apps-pick":
            pickExcludedApps(from: source, reqId: body["reqId"] as? String)
        case "accessibility-request":
            selection.openAccessibilityPane()
        case "screen-recording-request":
            screenshot.requestPermission()
        case "permissions-state":
            pushHost("permissionsState", payload: Self.permissionsPayload(), to: source)
        case "pick-attachments":
            pickAttachments(
                reqId: body["reqId"] as? String ?? "",
                kind: AttachmentPickKind(raw: body["kind"] as? String),
                to: source
            )
        // 按路径上传附件（选择器挑中的文件走这条：SPA 那侧要么整段进一次请求，
        // 要么把整个文件 base64 进消息——壳直接流式送给引擎，见 EngineGateway.uploadFile）
        case "upload-path":
            uploadAttachmentPath(
                reqId: body["reqId"] as? String ?? "",
                path: body["path"] as? String ?? "",
                sessionId: body["sessionId"] as? String ?? "",
                name: body["name"] as? String ?? "",
                to: source,
            )
        case "list-dir":
            listDirectory(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "", to: source)
        case "read-workspace-icon":
            readWorkspaceIcon(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "", out: windowController)
        case "miniPanel.setCommands":
            // 迷你面板页推来的引擎命令目录（Atd 桥契约同名；命令卡的唯一数据源）。
            let rows = (body["commands"] as? [[String: Any]]) ?? []
            let commands: [MiniPanelSetCommandsParams.Command] = rows.compactMap { row in
                guard let id = row["id"] as? String, !id.isEmpty,
                      let name = row["name"] as? String, !name.isEmpty else { return nil }
                return MiniPanelSetCommandsParams.Command(id: id, name: name)
            }
            miniPanel.setCommands(commands)
        case "run-git":
            runGit(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "git-run":
            gitRun(reqId: body["reqId"] as? String ?? "",
                   path: body["path"] as? String ?? "",
                   args: body["args"] as? [String] ?? [])
        case "git-changes":
            gitChanges(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "git-diff":
            gitDiff(reqId: body["reqId"] as? String ?? "",
                    path: body["path"] as? String ?? "",
                    file: body["file"] as? String ?? "")
        case "skill-pick-directory":
            skillPickDirectory(reqId: body["reqId"] as? String ?? "")
        case "plugin-admin-info":
            pluginAdminInfo(reqId: body["reqId"] as? String ?? "")
        case "plugin-uninstall":
            pluginUninstall(reqId: body["reqId"] as? String ?? "", moduleName: body["moduleName"] as? String ?? "")
        case "remote-status":
            remoteStatus(reqId: body["reqId"] as? String ?? "")
        case "remote-start":
            _ = RemoteAccess.shared.start()
            remoteStatus(reqId: body["reqId"] as? String ?? "")
        case "remote-stop":
            RemoteAccess.shared.stop()
            remoteStatus(reqId: body["reqId"] as? String ?? "")
        case "remote-refresh":
            RemoteAccess.shared.rotateToken()
            remoteStatus(reqId: body["reqId"] as? String ?? "")
        case "remote-revoke":
            RemoteAccess.shared.revoke(deviceId: body["deviceId"] as? String ?? "")
            remoteStatus(reqId: body["reqId"] as? String ?? "")
        case "copy-text":
            // 前端唯一剪贴板通道（远程页的链接、引擎失败详情的诊断日志共用）：
            // WKWebView 里 navigator.clipboard 要权限、也写不进系统剪贴板的
            // 原生语义，所以统一由壳落 NSPasteboard。
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(body["text"] as? String ?? "", forType: .string)
        case "qr-encode":
            // 通用二维码（Bot Channel 的扫码配对：插件给的是 verificationUrl）。
            // 复用壳里那一份 CoreImage 生成器，前端不再塞第二套 QR 实现。
            // 生成在后台队列（CoreImage 渲染不是瞬时活；此前主线程同步生成）。
            let reqId = body["reqId"] as? String ?? ""
            let text = body["text"] as? String ?? ""
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let qr = QRCode.dataURL(text: text) ?? ""
                DispatchQueue.main.async {
                    self?.windowController.pushHostCommand("qrEncoded", payload: AppDelegate.jsonPayload([
                        "reqId": reqId,
                        "qr": qr,
                    ]))
                }
            }
        case "scan-agent-configs":
            // 新手引导「迁移」步：读其他 Agent 的配置原文交给前端解析（壳不解析、不落日志，
            // 见 AgentConfigScan 的隐私边界）。文件按白名单，缺失的来源直接不出现。
            // 逐来源读文件走后台队列（对齐 runGit 的线程纪律）。
            let reqId = body["reqId"] as? String ?? ""
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let files = AgentConfigScan.read(home: FileManager.default.homeDirectoryForCurrentUser)
                DispatchQueue.main.async {
                    self?.windowController.pushHostCommand("agentConfigs", payload: AppDelegate.jsonPayload([
                        "reqId": reqId,
                        "files": files,
                    ]))
                }
            }
        case "open-url":
            // Markdown 链接经壳打开（webview 内跳转会离开 SPA）；只放行 http/https
            if let url = URL(string: body["url"] as? String ?? ""), url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
            }
        case "dictation-start":
            // 听写结果回**发起它的那一页**（面板里的麦克风与主窗共用这套回调）
            dictationTarget = source
            DictationController.shared.start()
        case "dictation-stop":
            DictationController.shared.stop()
        case "dictation-toggle":
            // 快捷键触发的听写开关：控制器自持 running 状态
            DictationController.shared.running ? DictationController.shared.stop() : DictationController.shared.start()
        default:
            EngineLog.shared.append("[bridge] unhandled host message: \(type)")
        }
    }

    /// 听写事件回推：partial 实时、final 终稿、error 权限/设备问题。
    /// 听写结果回哪一页：`dictation-start` 那一刻的发起页（热键那条没有页面，沿用上一次）。
    private var dictationTarget: BridgeSource = .main

    /// pending 槽位是 last-wins，partial 相互覆盖正是期望行为。
    private func installDictation() {
        DictationController.shared.onPartial = { [weak self] text in
            guard let self else { return }
            self.pushHost("dictation-partial", payload: ["text": text], to: self.dictationTarget)
        }
        DictationController.shared.onFinal = { [weak self] text in
            guard let self else { return }
            self.pushHost("dictation-final", payload: ["text": text], to: self.dictationTarget)
        }
        DictationController.shared.onError = { [weak self] text in
            guard let self else { return }
            self.pushHost("dictation-error", payload: ["text": text], to: self.dictationTarget)
        }
    }

    /// 状态胶囊的未提交改动摘要（run-git → gitStatus 回推）。引擎无 git 能力，
    /// 由壳在工作区路径跑只读 git 命令聚合；非 git 仓库/命令不可用回 repo=false，
    /// 前端按无 git 数据处理。status 计未提交文件（含未跟踪），numstat 计行数。
    /// AUD-015：与 gitRun 同款后台队列（此前在主线程同步跑 3 条 git，
    /// readDataToEndOfFile+waitUntilExit 会卡 UI；且 stderr Pipe 从不排空——
    /// 子进程 stderr 写满 64KB 管道缓冲后阻塞，主线程永久死锁）。stderr 与
    /// stdout 先并发读完再 wait，杜绝管道死锁。
    private func runGit(reqId: String, path: String) {
        func reply(_ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            windowController.pushHostCommand("gitStatus", payload: AppDelegate.jsonPayload(all))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            // 管道纪律统一由 ProcessRunner 持有（stderr/stdout 各自排空，不顺序读）
            func git(_ args: [String]) -> String? {
                let result = ProcessRunner.run(executable: "/usr/bin/git", arguments: args, workingDirectory: path)
                return result.status == 0 ? result.output : nil
            }
            guard FileManager.default.fileExists(atPath: path),
                  let branch = git(["rev-parse", "--abbrev-ref", "HEAD"])?.trimmingCharacters(in: .whitespacesAndNewlines) else {
                DispatchQueue.main.async { reply(["repo": false]) }
                return
            }
            let files = git(["status", "--porcelain"])?
                .split(separator: "\n", omittingEmptySubsequences: true).count ?? 0
            var additions = 0
            var deletions = 0
            for line in git(["diff", "HEAD", "--numstat"])?.split(separator: "\n") ?? [] {
                // 二进制文件两列是 "-"，Int 转换失败即跳过
                let cols = line.split(separator: "\t")
                if cols.count >= 3, let a = Int(cols[0]), let d = Int(cols[1]) {
                    additions += a
                    deletions += d
                }
            }
            DispatchQueue.main.async {
                reply(["repo": true, "branch": branch, "files": files, "additions": additions, "deletions": deletions])
            }
        }
    }

    /// 状态胶囊的 git 动作（git-run → gitRunResult 回推）：切分支/提交/推送。
    /// 参数数组直传 Process，不经 shell，无注入面；push 等网络操作在后台队列
    /// 跑，完成后回主线程回推 ok/output（尾部截断，防超长刷屏）。
    private func gitRun(reqId: String, path: String, args: [String]) {
        func reply(_ ok: Bool, _ output: String) {
            let trimmed = output.count > 4000 ? String(output.suffix(4000)) : output
            windowController.pushHostCommand("gitRunResult", payload: AppDelegate.jsonPayload([
                "reqId": reqId, "ok": ok, "output": trimmed,
            ]))
        }
        guard !args.isEmpty, FileManager.default.fileExists(atPath: path) else {
            reply(false, "bad request")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let result = ProcessRunner.run(executable: "/usr/bin/git", arguments: args, workingDirectory: path)
            DispatchQueue.main.async { reply(result.status == 0, result.output) }
        }
    }

    /// 审查面板的改动清单（git-changes → gitChangesResult）。与 runGit 同源但更细：
    /// 按文件拆出 kind 与逐文件增删，前端不自己数行。repo=false 覆盖非仓库 / git
    /// 不可用 / 超时（前端按"没有 git 数据"处理，不报错）。
    private func gitChanges(reqId: String, path: String) {
        func reply(_ set: GitChanges.ChangeSet?) {
            let files: [[String: Any]] = set?.files.map { change in
                [
                    "path": change.path,
                    "originalPath": change.originalPath as Any,
                    "kind": change.kind.rawValue,
                    "added": change.added,
                    "removed": change.removed,
                    "binary": change.binary,
                ]
            } ?? []
            windowController.pushHostCommand("gitChangesResult", payload: AppDelegate.jsonPayload([
                "reqId": reqId, "repo": set != nil, "branch": set?.branch as Any, "files": files,
            ]))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let set = GitChanges.fetchChanges(at: path)
            DispatchQueue.main.async { reply(set) }
        }
    }

    /// 审查面板的单文件 diff（git-diff → gitDiffResult）。与 gitRun 的截尾相反：
    /// patch 要么整份给，要么回报 truncated/binary——半截 patch 解析出来是错的。
    private func gitDiff(reqId: String, path: String, file: String) {
        func reply(_ diff: GitChanges.FileDiff) {
            windowController.pushHostCommand("gitDiffResult", payload: AppDelegate.jsonPayload([
                "reqId": reqId, "kind": diff.kind.rawValue,
                "patch": diff.patch as Any, "content": diff.content as Any,
            ]))
        }
        let unavailable = GitChanges.FileDiff(kind: .unavailable, patch: nil, content: nil)
        guard !file.isEmpty, FileManager.default.fileExists(atPath: path) else {
            reply(unavailable)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let diff = GitChanges.fetchDiff(at: path, file: file)
            DispatchQueue.main.async { reply(diff) }
        }
    }

    /// 开一个选目录 sheet，只回挑中的目录；拷贝由引擎做（技能根归引擎）。
    /// 用户取消时回 cancelled（不是错误），前端据此不弹报错框。
    private func skillPickDirectory(reqId: String) {
        guard let window = windowController.window else {
            windowController.pushHostCommand("skillPickedDirectory", payload: AppDelegate.jsonPayload(
                ["reqId": reqId, "cancelled": true]))
            return
        }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "选择含 SKILL.md 的技能目录"
        panel.prompt = "安装"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            var fields: [String: Any] = ["reqId": reqId]
            if response == .OK, let url = panel.url {
                fields["path"] = url.path
                fields["cancelled"] = false
            } else {
                fields["cancelled"] = true
            }
            self.windowController.pushHostCommand("skillPickedDirectory", payload: AppDelegate.jsonPayload(fields))
        }
    }

    /// 随包发布、不给卸载的插件名：前端据此决定行菜单里显不显示「卸载」。
    private func pluginAdminInfo(reqId: String) {
        windowController.pushHostCommand(
            "pluginAdminInfo",
            payload: AppDelegate.jsonPayload(["reqId": reqId, "bundled": Array(ProfilePluginAdmin.bundledPluginNames).sorted()]),
        )
    }

    /// 卸载一个插件：摘掉 profile 依赖与 bundle 行（改完需重启引擎才生效，调用方负责重启）。
    private func pluginUninstall(reqId: String, moduleName: String) {
        let error = ProfilePluginAdmin.uninstall(moduleName: moduleName, dshHome: AppPaths.harnessHome)
        var fields: [String: Any] = ["reqId": reqId, "ok": error == nil, "moduleName": moduleName]
        if let error { fields["error"] = error }
        windowController.pushHostCommand("pluginUninstalled", payload: AppDelegate.jsonPayload(fields))
    }

    /// 移动端远程访问的状态回推：开关、局域网链接、二维码 data URL、设备台账。
    /// 开启/停止/刷新令牌/解绑都回这一份，前端不自己拼状态。
    private func remoteStatus(reqId: String) {
        var payload = RemoteAccess.shared.statusPayload()
        payload["reqId"] = reqId
        windowController.pushHostCommand("remoteStatus", payload: AppDelegate.jsonPayload(payload))
    }

    /// 目录选择器（侧栏「＋新建空间」）：选一个已有文件夹，把绝对路径推回
    /// 前端，由前端调引擎 `workspace.create` 注册（与官方 DSH 一致）；取消
    /// 不发任何消息。sheet 挂主窗口，不阻塞 webview 其余交互。
    private func pickWorkspaceDirectory() {
        guard let window = windowController.window else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.message = "选择要添加为工作空间的项目文件夹"
        panel.prompt = "添加"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            let path = url.path
            guard let data = try? JSONSerialization.data(withJSONObject: ["path": path]),
                  let payload = String(data: data, encoding: .utf8) else { return }
            self?.windowController.pushHostCommand("workspacePicked", payload: payload)
        }
    }

    /// 附件选择器（composer ＋ 的二级菜单）：`kind` 决定挑文件还是文件夹（Atd 的 ＋ 菜单
    /// 把「上传文件」与「添加文件夹…」分成两项，共用这一个面板入口）。绝对路径回推给前端
    /// 走 @ 引用（引擎宿主侧读盘），图片附带 base64 走真字节上传。取消回推空数组——前端
    /// 据此收尾，不悬挂 reqId。NSOpenPanel 留在主线程；整图磁盘读与 base64 编码移后台
    /// 队列（读大图会卡主线程 UI，AUD-079，对齐同文件 gitRun 的后台样板），主线程只回推。
    /// 条目形状与拖入那条（`importDroppedItems`）共用 `attachmentItems(for:)`。
    private func pickAttachments(reqId: String, kind: AttachmentPickKind, to source: BridgeSource) {
        guard let window = windowController.window else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = kind.choosesFiles
        panel.canChooseDirectories = kind.choosesDirectories
        panel.allowsMultipleSelection = true
        panel.message = kind.message
        panel.prompt = "添加"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            let urls = response == .OK ? panel.urls : []
            DispatchQueue.global(qos: .userInitiated).async {
                let items = Self.attachmentItems(for: urls)
                DispatchQueue.main.async {
                    self.pushHost("pickedAttachments", payload: ["reqId": reqId, "items": items], to: source)
                }
            }
        }
    }

    /// 一批本机文件 → 桥的**附件项**（选择器回推与拖入摄入共用这一份，别写第二遍）：
    /// 只有**图片**（且不超过内联上限）带 base64——它要随 prompt 直传，模型才看得见图；
    /// **其余一律不带字节**，前端拿着 path 请壳按路径流式上传（`upload-path`），桥不参与、
    /// 没有上限，也不用把整个文件 base64 进一条桥消息（用户 2026-10-09："不应该有大小限制"）。
    /// 大小随载荷带上：chip 立刻显示，不用等上传回来才知道多大。目录只给路径（转 @ 引用）。
    /// **读盘与 base64 编码**在调用方的后台队列上做（读大图会卡主线程，AUD-079）。
    private static func attachmentItems(for urls: [URL]) -> [[String: Any]] {
        urls.map { url in
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            var item: [String: Any] = [
                "path": url.path,
                "name": url.lastPathComponent,
                "isDir": isDir,
            ]
            if !isDir, let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                item["bytes"] = size
            }
            if !isDir, imageExtensions.contains(url.pathExtension.lowercased()),
               let data = try? Data(contentsOf: url), data.count <= maxInlineImageBytes {
                item["isImage"] = true
                item["base64"] = data.base64EncodedString()
            }
            return item
        }
    }

    /// 与引擎 imageLimits 准入的媒体类型对齐（png/jpeg/webp/gif）。
    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "gif"]
    /// **图片**随消息直传的字节上限：等于桥的单请求缓冲上限（`MiniHTTPServer.maxBodyBytes`）。
    /// 超了就不带字节，前端按普通文件处理——请壳按路径流式上传（没有大小上限），
    /// 所以这里只影响"能不能内联给模型看"，不会让附件发不出去。
    private static let maxInlineImageBytes = 32 * 1024 * 1024

    /// 按路径上传一个附件（选择器挑的大文件）：壳直接流式送给引擎，桥不参与，
    /// 于是没有那条单请求缓冲上限，也不用把文件 base64 进消息。
    /// 结果经 `attachmentUploaded` 回前端（ok/value 或 error），chip 据此转终态。
    private func uploadAttachmentPath(reqId: String, path: String, sessionId: String, name: String, to source: BridgeSource) {
        Task { @MainActor in
            do {
                let value = try await EngineGateway.shared.uploadFile(
                    at: URL(fileURLWithPath: path), sessionId: sessionId, name: name)
                self.pushHost("attachmentUploaded", payload: ["reqId": reqId, "ok": true, "value": value], to: source)
            } catch {
                let message = (error as? LocalizedError)?.errorDescription ?? "\(error)"
                self.pushHost("attachmentUploaded", payload: ["reqId": reqId, "ok": false, "error": message], to: source)
            }
        }
    }

    /// 拖入的**文件夹**（壳读拖放板得到真路径）→ 推给该窗口的页面转 @ 引用。
    /// 同一投里的文件与图片不走这条：WebKit 会把它们照常投给页面（页面拿得到字节）。
    private func deliverDroppedFolders(_ urls: [URL], to source: BridgeSource) {
        pushHost("hostDroppedItems", payload: ["items": DragPasteboard.folderItems(urls)], to: source)
    }

    /// 药丸/胶囊面板（Atd 移植）那一投的落点：文件、文件承诺、长文字落成的文本文件、落盘的
    /// 位图都会走到这儿。页面（DOM）拿不到路径，所以路径由壳给，**摄入走 ＋ 选择器同一条**
    /// `ingestPicked`：图片内联 chip、普通文件上传 chip（按路径流式，没有大小上限）、
    /// 文件夹转 @ 引用——面板页与主窗那一份输入区因此行为一致。
    /// 面板先亮出来：Drop 的四条路由都要求"落进草稿并且看得见"（Atd 同款）。
    private func importDroppedItems(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        quickPanel.showPanel()
        // 读盘 + base64 编码在后台（读大图会卡主线程，AUD-079）；命令按通道推给面板页，
        // 页面还没起来时暂存在壳里（QuickPanelController.pushHostCommand）。
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let items = Self.attachmentItems(for: urls)
            DispatchQueue.main.async {
                self?.pushHost("hostDroppedItems", payload: ["items": items], to: .panel)
            }
        }
    }

    /// 拖入的**位图**（没有文件的：从浏览器/预览里拖出来的一张图）：先落盘成面板拖放目录里的
    /// 一份 PNG，再按普通文件那一条摄入——`attachmentItems` 会给它带上 base64，于是它和其它
    /// 图片一样是内联 chip（模型看得见），而不是一颗"看不见内容"的文件 chip。
    /// 解码 + 落盘在后台（读大图会卡主线程，AUD-079）；面板由落点那两条自己亮。
    private func importDroppedImage(_ data: Data) {
        let folder = miniPanel.folder
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let url = try folder.write(image: data, droppedAt: .now)
                DispatchQueue.main.async { self?.importDroppedItems([url]) }
            } catch {
                EngineLog.shared.append("[drag] dropped image could not be written: \(error)")
                DispatchQueue.main.async {
                    self?.reportDropFailures([
                        .init(name: MiniPanelDroppedImage.kind, reason: .unsupported),
                    ])
                }
            }
        }
    }

    /// 一投什么都没落下来（承诺的文件没到、文本写盘失败…）：面板亮出来**报出来**，
    /// 不静默——用户定稿"附件不许静默丢"。
    private func reportDropFailures(_ failures: [ResourcesImportedEvent.Failure]) {
        guard !failures.isEmpty else { return }
        quickPanel.showPanel()
        pushHost(
            "hostDropFailed",
            payload: ["names": failures.map(\.name)],
            to: .panel
        )
    }

    /// Preference + path snapshot for the settings page (推送于 host-ready
    /// 与 get-prefs;键值与 frontend/src/components/SettingsPage.tsx 约定)。
    ///
    /// **值必须是 JSON 能写的类型**：一个方法引用混进来，`JSONSerialization` 会在 host-ready
    /// 那一刻抛异常——表现是"应用一启动就崩"（2026-09-26 实测：`BrowserShield.shared.enabled`
    /// 少写了调用括号，把 Bool 写成了一个闭包）。所以这一段单独留出来给测试钉住。
    func prefsPayload() -> [String: Any] {
        // 快捷会话默认空间目录（D14）：引擎 workspace/create 只收已存在的绝对
        // 路径（~ 不展开），目录由壳保证存在，注册由 SPA 幂等做。
        let quickDir = QuickPanelController.quickWorkspaceDirectory
        try? FileManager.default.createDirectory(at: quickDir, withIntermediateDirectories: true)
        return [
            "quickWorkspacePath": quickDir.path,
            "notifyTurnEnd": DSHAppPrefs.notifyTurnEnd,
            "notifyAttention": DSHAppPrefs.notifyAttention,
            "menuBar": DSHAppPrefs.menuBar,
            "dockIcon": DSHAppPrefs.dockIcon,
            "miniPanel": miniPanel.isShown,
            "glass": config.themeEnabled,
            "sidebarWidth": DSHAppPrefs.sidebarWidth,
            "appearance": DSHAppPrefs.appearance,
            "language": DSHAppPrefs.language,
            "keybinds": DSHAppPrefs.keybinds,
            "onboarding": DSHAppPrefs.onboarding,
            "hotkeyOn": DSHAppPrefs.hotkeyOn,
            "selectionToolbar": DSHAppPrefs.selectionToolbar,
            "selectionCommands": DSHAppPrefs.selectionCommands,
            "screenshotHotkey": DSHAppPrefs.screenshotHotkey,
            "screenshotHotkeyOn": DSHAppPrefs.screenshotHotkeyOn,
            // 热键 spec（"option+space"）：SPA 据此显示当前热键，不带它设置页只能显示
            // 一个写死的默认值（改过热键、重启后就对不上）
            "hotkey": AppConfig.load().hotkey,
            // 瘦身测试宿主无窗（§5）：prod 恒在 boot 时先建 windowController，
            // `?.` 只在宿主里落 false——快照断言只管"JSON 可写"，不管暗色值。
            "schemeDark": windowController?.isEffectiveDark ?? false,
            "home": AppPaths.harnessHome.path,
            "browserZoomDefault": Double(BrowserZoom.defaultZoom()),
            "browserZoomRememberSite": BrowserZoom.remembersPerSite(),
            "browserTabSleepMinutes": BrowserTabs.sleepMinutes(),
            "modelDetail": DSHAppPrefs.modelDetail,
            "quickPanelPinned": DSHAppPrefs.quickPanelPinned,
            "miniRunningGlow": DSHAppPrefs.miniRunningGlow,
        ]
    }

    private func pushPrefs() {
        guard let data = try? JSONSerialization.data(withJSONObject: prefsPayload()),
              let json = String(data: data, encoding: .utf8) else { return }
        windowController.pushHostCommand("prefs", payload: json)
        // 面板那一侧是**两块**承载 SPA 的页（面板页 + 命令中心卡页），各有自己的 store。
        quickPanel.pushHostCommandToPanelPages("prefs", payload: json)
    }

    private func pushHotkey() {
        let spec = AppConfig.load().hotkey
        guard let data = try? JSONSerialization.data(withJSONObject: ["spec": spec]),
              let json = String(data: data, encoding: .utf8) else { return }
        windowController.pushHostCommand("hotkeyChanged", payload: json)
    }

    /// 录制窗结束（成功带新 spec，取消/关窗带 nil）：两条路都要回一条消息——SPA 的
    /// 组合键钮在等这一条才能从「录制中…」退出来（取消时静默返回，那枚钮会一直卡在
    /// 录制态，用户只能重开设置页）。
    private func beginHotkeyRecording(which: String) {
        let recorder = HotkeyRecorderWindow()
        recorder.onResult = { [weak self] spec in
            guard let self else { return }
            guard let spec else {
                self.windowController.pushHostCommand("hotkeyRecordingEnded", payload: "{}")
                return
            }
            if which == "screenshot" {
                DSHAppPrefs.setScreenshotHotkey(spec)
                self.registerScreenshotHotkey()
                EngineLog.shared.append("[settings] screenshot hotkey rebound: \(spec)")
                self.pushScreenshotHotkey()
                return
            }
            var cfg = AppConfig.load()
            cfg.hotkey = spec
            cfg.save()
            self.hotKey.register(.panel, spec: cfg.hotkey)
            EngineLog.shared.append("[settings] hotkey rebound: \(spec)")
            self.pushHotkey()
        }
        hotkeyRecorder = recorder
        recorder.showRecorder()
    }

    /// 截图热键的新值推给页面（设置页那枚钮据此退出「录制中…」并显示新组合）。
    private func pushScreenshotHotkey() {
        let json = Self.jsonPayload([
            "which": "screenshot", "spec": DSHAppPrefs.screenshotHotkey,
        ])
        windowController.pushHostCommand("hotkeyChanged", payload: json)
        quickPanel.pushHostCommand("hotkeyChanged", payload: json)
    }

    // MARK: - main menu (⌘, needs a menu seat; Edit menu powers ⌘C/⌘V in
    // native text fields)

    // MARK: - 主菜单（结构在 MainMenu.swift，这里只放动作实现）

    private func installMainMenu() {
        // 拖入的文件夹（路径只有壳拿得到）交给**窗口自己那一页**的 SPA 转 @ 引用
        // （推错页 = 附件落进另一份草稿，用户看不见；迷你面板那条在 quickPanel 建好后接）
        windowController.onFoldersDropped = { [weak self] urls in
            self?.deliverDroppedFolders(urls, to: .main)
        }
        appMenuUpdateItem = MainMenu.install(app: NSApp, target: self, window: windowController)
    }

    /// 新建会话：会话由前端 store 管，菜单只发桥指令（与侧栏「新建会话」同一入口）。
    @objc func newSessionFromMenu(_ sender: Any?) {
        showMainWindow()
        windowController.pushHostCommand("newSession", payload: "{}")
    }

    /// 打开工作区：目录选择器在壳（引擎要求目录已存在），选完经 workspacePicked 回推前端注册。
    @objc func pickWorkspaceFromMenu(_ sender: Any?) {
        pickWorkspaceDirectory()
    }

    /// 菜单「帮助 → 新手引导」：把卡片请出来（渲染在 SPA 里，壳只发指令）。
    @objc func openOnboardingFromMenu(_ sender: Any?) {
        showMainWindow()
        windowController.pushHostCommand("openOnboarding", payload: "{}")
    }

    @objc func revealLogFromMenu(_ sender: Any?) {
        NSWorkspace.shared.activateFileViewerSelecting([AppPaths.logURL])
    }

    /// 复制诊断信息：与引擎失败详情的「复制诊断」同源（日志尾部），排障时一键交出。
    @objc func copyDiagnosticsFromMenu(_ sender: Any?) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(EngineLog.shared.tailText, forType: .string)
    }

    @objc func revealDataDirFromMenu(_ sender: Any?) {
        NSWorkspace.shared.open(AppPaths.harnessHome)
    }

    @objc func openSettingsFromMenu(_ sender: Any?) {
        openSettings()
    }

    /// 两份菜单里那一项「更新」共用的动作：有待装的一份就是「装」，否则就是「查」。
    /// 标题由 `refreshUpdateMenuItems()` 刷，可用性由下面的 `validateMenuItem` 给。
    @objc func updateMenuItemAction(_ sender: Any?) {
        if case .restart = updater.menuState {
            updater.installNow()
        } else {
            updater.checkForUpdates()
        }
    }

    /// 下载期那一项是状态展示而不是入口，禁用它——一个点下去什么都不发生的菜单项比没有它更难查。
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(updateMenuItemAction(_:)) {
            return updater.menuState.isActionable
        }
        return true
    }

    // MARK: - lifecycle

    /// WebKit anti-throttle (Raycast deep-dive): WebKit suspends rendering and
    /// timers when it believes the view is occluded. AppKit no longer exposes
    /// a public toggle, so this applies the private
    /// `setWindowOcclusionDetectionEnabled:` best-effort: if the selector
    /// exists it is used, otherwise this no-ops and the alpha-staging in
    /// MainWindowController remains the fallback. Never crashes either way.
    private func adjustOcclusionDetection() {
        let selector = Selector(("setWindowOcclusionDetectionEnabled:"))
        if NSApp.responds(to: selector) {
            _ = NSApp.perform(selector, with: false)
        }
    }

    /// 引擎状态 → 前端（banner 文案与"重试"入口的依据）。
    private func pushEngineState(_ state: EngineSupervisor.State) {
        var payload: [String: Any] = [:]
        switch state {
        case .idle: payload["phase"] = "idle"
        case .launching: payload["phase"] = "launching"
        case .ready: payload["phase"] = "ready"
        case .restarting(let attempt):
            payload["phase"] = "restarting"
            payload["attempt"] = attempt
        case .failed(let reason):
            payload["phase"] = "failed"
            payload["reason"] = reason
            // 日志尾随失败一起推：失败面在 SPA 里（横幅 + 详情弹窗），诊断信息
            // 必须跟着过去——原生的"复制诊断"没了，用户要能从界面里看到/复制日志。
            payload["tail"] = EngineLog.shared.tailText
        }
        windowController.pushHostCommand("engineState", payload: Self.jsonPayload(payload))
        quickPanel.pushHostCommand("engineState", payload: Self.jsonPayload(payload))
    }

    /// 更新状态变化的统一收口：推给前端 + 刷两份菜单的标题（标题要说「已下载/正在下载」）。
    private func updateStateChanged() {
        pushUpdateState()
        refreshUpdateMenuItems()
    }

    /// 两份菜单那一项「更新」的标题。文案的事实源在 `AppUpdater.menuTitle`——这里只负责
    /// 把同一个串写到两份 NSMenu 上，不自己再拼一次。
    private func refreshUpdateMenuItems() {
        let title = AppUpdater.menuTitle(for: updater.menuState)
        appMenuUpdateItem?.title = title
        statusItem.updateMenuItem?.title = title
    }

    /// 应用更新状态 → 前端（设置页「关于」那一屏：当前版本 + 有没有待装的一份）。
    private func pushUpdateState() {
        let json = Self.jsonPayload(updater.status)
        windowController.pushHostCommand("updateState", payload: json)
        quickPanel.pushHostCommand("updateState", payload: json)
    }

    /// A SIGTERM (kill from terminal / launchd) must not orphan the engine:
    /// route it through the normal terminate path so applicationWillTerminate
    /// stops the child process.
    private func installTerminationHandler() {
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [weak self] in
            self?.supervisor?.stop { NSApp.terminate(nil) }
        }
        source.resume()
        terminationSource = source
    }

    /// WKWebView 假死自愈（PITFALLS §4.7）：系统睡眠唤醒后 webview 里的
    /// WebSocket 可能既不 onclose 也不 onerror 而帧已停——直播事件从此
    /// 不再抵达，重启应用才恢复。didWake 时通知前端弃掉 mux socket 重建；
    /// 重连后引擎每条流重发快照、消费方按全量替换处理，健康连接误杀
    /// 代价为零，故无条件触发。
    private func installWakeObserver() {
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(systemDidWake(_:)),
            name: NSWorkspace.didWakeNotification,
            object: nil
        )
    }

    @objc private func systemDidWake(_ note: Notification) {
        windowController.pushHostCommand("systemWake", payload: "{}")
    }

    func applicationWillTerminate(_ notification: Notification) {
        supervisor?.stop()
        // 日志是攒批落盘的（EngineLog）：退场前收口，最后一批不丢。
        EngineLog.shared.flushNow()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    // MARK: - engine state

    private func handleEngineState(_ state: EngineSupervisor.State) {
        statusItem.setState(state)
        // 状态推给 SPA：壳的退避重试/放弃只有壳知道，不推的话前端永远显示
        // "正在重试…"（旧实现：放弃重试后界面还是同一句话，没有原因也没有重试入口）。
        pushEngineState(state)
        switch state {
        case .ready(let url):
            BridgeServer.shared.setEngine(url)
            quickPanel.noteEngineReady()
            // Mint the engine browser-auth cookie FIRST (alpha.2+), then wire
            // the native consumers (settings RPC + event observer, §3 方案 A).
            Task { @MainActor in
                await EngineAuth.shared.exchangeNow(for: url)
                EngineGateway.shared.update(base: url)
                EngineEventObserver.shared.update(base: url)
            }
            // **不重载 SPA**：就绪那一刻整页 load 会把文档拆掉重建——启动骨架屏 →
            // 真实界面的交接处因此必断一下（用户报"卡一下"，无论过渡动画怎么做都盖
            // 不住白屏那一帧）。原来这次重载是为了让启动期撞上 503 的那些一次性 RPC
            // 重来一遍，那批取数已改为自补：store 的就绪分支立刻 kick 一次 refresh +
            // presets 跟随 engineUp 重取（见 frontend/src/store.tsx）。
            // 断线重连（引擎重启）同理不必重载：mux 自带重连、桥的 engineBase 也在
            // setEngine 里换新，各流重连后重发快照。
        case .failed:
            // 失败只走内置面（SPA 的引擎横幅 + 详情弹窗，见 pushEngineState 的
            // tail 字段）：不弹原生窗口、不发系统通知——错误面一律在应用内
            //（UI-SPEC 的 ToastBar/DialogHost 约定：DialogHost 全应用替换系统弹窗）。
            EngineAuth.shared.update(base: nil)
            EngineEventObserver.shared.update(base: nil)
            EngineGateway.shared.update(base: nil)
        case .launching, .restarting, .idle:
            break
        }
    }

    private func webRoot() -> URL? {
        if let env = ProcessInfo.processInfo.environment["DEEPDIVE_WEB_ROOT"] {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        return Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)
    }

    // MARK: - workspace picker

    private func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "选择引擎启动工作区（沙箱根目录）"
        panel.prompt = "选择"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        config.launchWorkspace = url.path
        config.save()
        EngineLog.shared.append("[shell] workspace set to \(url.path); restarting engine")
        // 换装链事件化：旧引擎退出（stop 完结回调）后换装再启动，主线程不再
        // 忙等。回调时判 supervisor 没被再换过，避免两次选区各来一条链。
        let retiring = supervisor
        guard let retiring else { return }
        retiring.stop { [weak self] in
            guard let self, self.supervisor === retiring else { return }
            // Engine binds workspace committed at process start (sandbox root = cwd).
            let newSupervisor = EngineSupervisor(home: AppPaths.harnessHome, workspace: self.config.workspaceURL)
            newSupervisor.onState = { [weak self] state in self?.handleEngineState(state) }
            self.supervisor = newSupervisor
            self.startEngine()
        }
    }

    // MARK: - 截图与划词的接线（Atd 移植族，见 ScreenshotController / SelectionController）

    /// 结果交付、事件外推与持久化设置回灌——移植族本身不碰桥，全在这一段。
    private func wireCaptureAndSelection() {
        // 截图的结果统一走 `finishCapture(outcome:)`（一次请求一条回执），不再挂回调。
        // 授权态变化（用户在系统设置里点了）：推给页面显示状态，不要求重启才发现。
        screenshot.onTrustChange = { [weak self] trusted in
            guard let self else { return }
            self.pushHost("screenRecordingTrust", payload: ["trusted": trusted], to: self.currentSource())
        }
        // 「问 DeepDive」：页面亮面板并把暂存里的文字引用进草稿（文字已由壳存好）。
        selection.onAsk = { [weak self] _ in
            guard let self else { return }
            self.quickPanel.showPanel()
            self.pushHost("selectionAsk", payload: [:], to: .panel)
        }
        // 工具条上的划词命令：面板亮起，命令在面板会话里跑（页面自己去暂存取文字，
        // 渲染提示词后当一条消息发出）。与迷你面板命令卡（引擎斜杠命令）不是一条道。
        selection.onCommand = { [weak self] id in
            guard let self else { return }
            self.quickPanel.showPanel()
            self.pushHost("selectionCommand", payload: ["id": id], to: .panel)
        }
        selection.onListeningChange = { [weak self] on in
            guard let self else { return }
            self.pushHost("selectionListening", payload: ["on": on], to: self.currentSource())
        }
        selection.onTrustChange = { [weak self] trusted in
            guard let self else { return }
            self.pushHost("accessibilityTrust", payload: ["trusted": trusted], to: self.currentSource())
        }
        applyPersistedSelectionToolbar()
    }

    /// 两处授权现在的状态（设置页据此显示「已授权」而不是一枚按钮）。
    static func permissionsPayload() -> [String: Any] {
        [
            "accessibility": SelectionReader.isTrusted,
            "screenRecording": CGPreflightScreenCaptureAccess(),
        ]
    }

    /// 结果推给谁：迷你面板窗可见就推它（用户正在那儿工作），否则主窗。
    private func currentSource() -> BridgeSource {
        (quickPanel?.window.isVisible ?? false) ? .panel : .main
    }

    /// 应答一律回到**发起请求的那一页**（主窗 or 迷你面板页）：两页跑的是同一份 SPA，
    /// 写死主窗会让面板里的等待永远等不到——前端 `bridgeRequest` 超时后只能报"上传失败"，
    /// 而引擎那边其实已经成功了（用户 2026-10-14 报：面板里截图导入的上下文 md 上传失败）。
    func pushHost(_ cmd: String, payload: [String: Any], to source: BridgeSource) {
        let json = Self.jsonPayload(payload)
        switch source {
        case .main: windowController.pushHostCommand(cmd, payload: json)
        case .panel: quickPanel.pushHostCommand(cmd, payload: json)
        }
    }

    /// 截图热键（默认 ⌘⇧2）：关着就注销；注册失败只落日志（设置页的状态由它自己读）。
    private func registerScreenshotHotkey() {
        guard DSHAppPrefs.screenshotHotkeyOn else {
            hotKey.unregister(.screenshot)
            return
        }
        let spec = DSHAppPrefs.screenshotHotkey
        if !hotKey.register(.screenshot, spec: spec) {
            EngineLog.shared.append("[shell] screenshot hotkey register FAILED: \(spec)")
        }
    }

    /// 上次存的工具条设置：页面还没推之前先按它工作（工具条要在加载前就生效）。
    private func applyPersistedSelectionToolbar() {
        let raw = DSHAppPrefs.selectionToolbar
        guard !raw.isEmpty, let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        selection.apply(ToolbarSetParams(object))
    }

    /// `screenshot-capture`：来源 nil = 全局热键（交付后把面板亮起来）。
    private func beginCapture(from source: BridgeSource?, reqId: String?) {
        guard pendingCapture == nil else {
            // 已在截：答一句"正在截图"，别无声拒绝（早先这里直接 return，用户只会看到没反应）。
            pushHost(
                "screenshotCaptured",
                payload: [
                    "ok": false, "reqId": reqId ?? "",
                    "error": ShellStrings.shared.text(.screenshotAlreadyRunning),
                ],
                to: source ?? currentSource())
            return
        }
        pendingCapture = (source, reqId)
        Task { @MainActor in self.finishCapture(outcome: await self.screenshot.capture()) }
    }

    /// `screenshot.edit`：重开一张已存图片继续编辑。
    private func beginCaptureEdit(path: String, from source: BridgeSource, reqId: String?) {
        guard pendingCapture == nil, !path.isEmpty else { return }
        pendingCapture = (source, reqId)
        Task { @MainActor in self.finishCapture(outcome: await self.screenshot.edit(path: path)) }
    }

    /// 一次截图/重开编辑的**唯一**收尾：按结果回一条 `screenshotCaptured`，并把在途标记清掉。
    /// 结果只有这几种，每一种都必须回执——没有"什么都不说"的分支（那正是"用一次之后
    /// 再也打不开"的成因：在途标记留着，后续请求全被挡在门外）。
    private func finishCapture(outcome: ScreenshotController.Outcome) {
        guard let pending = pendingCapture else { return }
        pendingCapture = nil
        var body: [String: Any]
        var delivered = false
        // 工具条上的提问（`chat`）：页面把这句话与这张图当**一条消息**直接发出去。
        var asked = false
        switch outcome {
        case .delivered(let shot):
            body = ["ok": true, "items": captureItems(shot)]
            delivered = true
        case .asked(let shot, let text):
            body = ["ok": true, "items": captureItems(shot), "chat": text]
            delivered = true
            asked = true
        case .copied:
            body = ["ok": false, "copied": true]
        case .cancelled:
            body = ["ok": false, "cancelled": true]
        case .needsPermission:
            body = ["ok": false, "error": ShellStrings.shared.text(.screenshotNeedsPermission)]
        case .failed(let error):
            body = ["ok": false, "error": error.message]
        }
        if let reqId = pending.reqId { body["reqId"] = reqId }
        // 热键召来的（无请求方）由**面板**接手：提问那条消息发进面板会话（照划词命令——
        // 亮起面板，答案在面板对话里流式回来），成图那条只是把面板亮出来（Atd 的
        // 「截图后见面板」）。目标页要在亮面板**之前**定：面板一显示，`currentSource()`
        // 就认它了，成图那条的口径会跟着变。
        let target = pending.source ?? (asked ? BridgeSource.panel : currentSource())
        EngineLog.shared.append(
            "[capture] \(pending.reqId == nil ? "hotkey" : "request") → \(delivered ? (asked ? "asked" : "delivered") : String(describing: outcome))")
        if pending.source == nil, delivered { quickPanel.showPanel() }
        pushHost("screenshotCaptured", payload: body, to: target)
    }

    /// 一次截图的附件清单：**只有那张图**（能内联就带字节，页面按既有通道摄入）。
    private func captureItems(_ delivered: ScreenshotController.Delivered) -> [[String: Any]] {
        var items: [[String: Any]] = []
        if let data = try? Data(contentsOf: delivered.image),
           data.count <= Self.maxInlineImageBytes {
            items.append([
                "path": delivered.image.path,
                "name": delivered.image.lastPathComponent,
                "isDir": false,
                "isImage": true,
                "bytes": data.count,
                "base64": data.base64EncodedString(),
            ])
        }
        return items
    }

    /// `selection-capture`：答**暂存**里那次召唤读到的选区（Ask / 命令点击 / 菜单与
    /// 迷你面板的「就所选文字询问」都会先写暂存）。面板已经亮着时现读前台 App 是靠不住的
    /// ——那正是要暂存的原因。
    private func captureSelectionFor(source: BridgeSource, reqId: String?) {
        var payload = selection.captureResult().json
        payload["reqId"] = reqId ?? ""
        pushHost("selectionCaptured", payload: payload, to: source)
    }

    /// 迷你面板「就所选文字询问」：文字已知（拖入的文本）就用它，否则现读前台选区，
    /// 然后亮面板让页面把文字引用进草稿。
    private func askAboutSelection(known: String? = nil) {
        Task { @MainActor in
            if let known {
                selection.stash(known)
            } else {
                _ = await selection.captureCurrentSelection()
            }
            quickPanel.showPanel()
            pushHost("selectionAsk", payload: [:], to: .panel)
        }
    }

    /// `selection-apps-pick`：选一批「不显示工具条」的 App（结果按 bundleId 记设置）。
    private func pickExcludedApps(from source: BridgeSource, reqId: String?) {
        Task { @MainActor in
            let result = await selection.pickExcludedApps()
            pushHost(
                "appsPicked",
                payload: [
                    "reqId": reqId ?? "",
                    "apps": result.apps.map { ["bundleId": $0.bundleId, "name": $0.name] },
                ],
                to: source)
        }
    }

    /// 一段 JSON 文本（存偏好用；构造路径与 jsonPayload 同一份 JSONSerialization）。
    static func jsonString(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }
}
