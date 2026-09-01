import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shared: AppDelegate?

    private var supervisor: EngineSupervisor!
    private var windowController: MainWindowController!
    private var statusItem: StatusItemController!
    private var hotKey: HotKeyManager!
    private var recovery: RecoveryWindowController!
    private var config: AppConfig!
    private var terminationSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = AppPaths.supportDir
        AppDelegate.shared = self
        installTerminationHandler()
        installMainMenu()
        adjustOcclusionDetection()
        config = AppConfig.load()

        // Same-origin bridge seat: serves the self-built SPA and relays /api.
        try? FileManager.default.createDirectory(
            at: AppPaths.supportDir, withIntermediateDirectories: true
        )
        BridgeServer.shared.configure(webRoot: webRoot())
        _ = BridgeServer.shared.start()

        supervisor = EngineSupervisor(home: AppPaths.harnessHome, workspace: config.workspaceURL)
        windowController = MainWindowController(themeEnabled: config.themeEnabled)
        recovery = RecoveryWindowController()
        statusItem = StatusItemController()
        hotKey = HotKeyManager()

        statusItem.install()
        statusItem.onShowWindow = { [weak self] in self?.windowController.showPanel() }
        statusItem.onOpenSettings = { [weak self] in self?.openSettings() }
        statusItem.onReloadWeb = { [weak self] in self?.windowController.reloadWeb() }
        statusItem.onRestartEngine = { [weak self] in
            guard let self else { return }
            self.recovery.hide()
            self.supervisor.start()
        }
        statusItem.onChooseWorkspace = { [weak self] in self?.chooseWorkspace() }
        statusItem.onQuit = { [weak self] in
            self?.supervisor.stop()
            NSApp.terminate(nil)
        }

        recovery.onRetry = { [weak self] in
            self?.supervisor.start()
        }
        recovery.onOpenSettings = { [weak self] in
            self?.openSettings()
        }

        supervisor.onState = { [weak self] state in
            self?.handleEngineState(state)
        }

        // Built-in settings page (user decision: no native settings window).
        // Theme changes flow through the same path as the old menu toggle and
        // push `themeChanged`; hotkey re-binds re-register the Carbon hotkey.
        windowController.onHostMessage = { [weak self] body in
            self?.handleHostMessage(body)
        }

        // Notification tap → activate + route to the tapped session (§1.1).
        NativeAlerts.onOpenSession = { [weak self] sessionId in
            self?.showMainWindow()
            if let sessionId {
                self?.windowController.pushHostCommand(
                    "navigateToSession",
                    payload: #"{"sessionId":"\#(sessionId)"}"#
                )
            }
        }
        NativeAlerts.install()

        hotKey.onHotKey = { [weak self] in self?.windowController.togglePanel() }
        if hotKey.register(spec: config.hotkey) {
            EngineLog.shared.append("[shell] hotkey registered: \(config.hotkey)")
        } else {
            EngineLog.shared.append("[shell] hotkey register FAILED: \(config.hotkey)")
        }

        supervisor.start()

        // Load the bridge (SPA shows "引擎启动中" until the engine is up).
        if let bridgeURL = BridgeServer.shared.url {
            // Deep link aid: DSHMINI_OPEN_SID=<session-id> opens that session on boot.
            if let sid = ProcessInfo.processInfo.environment["DSHMINI_OPEN_SID"],
               !sid.isEmpty,
               var comps = URLComponents(url: bridgeURL, resolvingAgainstBaseURL: false) {
                comps.queryItems = [URLQueryItem(name: "sid", value: sid)]
                windowController.load(url: comps.url ?? bridgeURL)
            } else {
                windowController.load(url: bridgeURL)
            }
        }

        // Second launch of the same app: bring the existing window forward.
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(showFromOtherInstance(_:)),
            name: Notification.Name("com.dshmini.app.show"),
            object: nil
        )

        // First run: show the window so onboarding is discoverable.
        if !FileManager.default.fileExists(atPath: AppPaths.configURL.path) {
            windowController.showPanel()
        }

        // Dev/verification hook (same family as DSHMINI_OPEN_SID): open the
        // settings window right after boot.
        if ProcessInfo.processInfo.environment["DSHMINI_OPEN_SETTINGS"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.openSettings()
            }
        }
    }

    @objc private func showFromOtherInstance(_ note: Notification) {
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

    /// Bridge push helper for native surfaces (bubble, notifications).
    func pushNavigateToSession(_ sessionId: String) {
        windowController.pushHostCommand(
            "navigateToSession",
            payload: #"{"sessionId":"\#(sessionId)"}"#
        )
    }

    // MARK: - frontend→shell host commands (SPEC-NOTIFICATIONS §3.1)

    private var hotkeyRecorder: HotkeyRecorderWindow?

    private func handleHostMessage(_ body: [String: Any]) {
        guard let type = body["type"] as? String else { return }
        switch type {
        case "host-ready":
            pushPrefs()
            pushHotkey()
        case "restart-engine":
            recovery.hide()
            supervisor.start()
        case "rebind-hotkey":
            beginHotkeyRecording()
        case "set-pref":
            guard let key = body["key"] as? String else { return }
            let value = body["value"] as? Bool ?? false
            switch key {
            case "notifyTurnEnd": DSHAppPrefs.setNotifyTurnEnd(value)
            case "notifyAttention": DSHAppPrefs.setNotifyAttention(value)
            case "bubble": FloatingBubbleManager.shared.setEnabled(value)
            default: break
            }
        case "set-theme":
            let enabled = body["enabled"] as? Bool ?? true
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
        default:
            EngineLog.shared.append("[bridge] unhandled host message: \(type)")
        }
    }

    /// Preference + path snapshot for the settings page (推送于 host-ready
    /// 与 get-prefs;键值与 frontend/src/components/SettingsPage.tsx 约定)。
    private func pushPrefs() {
        let payload: [String: Any] = [
            "notifyTurnEnd": DSHAppPrefs.notifyTurnEnd,
            "notifyAttention": DSHAppPrefs.notifyAttention,
            "bubble": FloatingBubbleManager.shared.enabled,
            "glass": config.themeEnabled,
            "home": AppPaths.harnessHome.path,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        windowController.pushHostCommand("prefs", payload: json)
    }

    private func pushHotkey() {
        let spec = AppConfig.load().hotkey
        guard let data = try? JSONSerialization.data(withJSONObject: ["spec": spec]),
              let json = String(data: data, encoding: .utf8) else { return }
        windowController.pushHostCommand("hotkeyChanged", payload: json)
    }

    private func beginHotkeyRecording() {
        let recorder = HotkeyRecorderWindow()
        recorder.onResult = { [weak self] spec in
            guard let self else { return }
            guard let spec else { return }
            var cfg = AppConfig.load()
            cfg.hotkey = spec
            cfg.save()
            self.hotKey.register(spec: cfg.hotkey)
            EngineLog.shared.append("[settings] hotkey rebound: \(spec)")
            self.pushHotkey()
        }
        hotkeyRecorder = recorder
        recorder.showRecorder()
    }

    // MARK: - main menu (⌘, needs a menu seat; Edit menu powers ⌘C/⌘V in
    // native text fields)

    private func installMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(NSMenuItem(title: "关于 DSHmini", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        let settingsItem = NSMenuItem(title: "设置…", action: #selector(openSettingsFromMenu), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(settingsItem)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "隐藏 DSHmini", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "退出 DSHmini", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))

        NSApp.mainMenu = mainMenu
    }

    @objc private func openSettingsFromMenu() {
        openSettings()
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

    /// A SIGTERM (kill from terminal / launchd) must not orphan the engine:
    /// route it through the normal terminate path so applicationWillTerminate
    /// stops the child process.
    private func installTerminationHandler() {
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [weak self] in
            self?.supervisor.stop()
            NSApp.terminate(nil)
        }
        source.resume()
        terminationSource = source
    }

    func applicationWillTerminate(_ notification: Notification) {
        supervisor.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    // MARK: - engine state

    private func handleEngineState(_ state: EngineSupervisor.State) {
        statusItem.setState(state)
        switch state {
        case .ready(let url):
            recovery.hide()
            BridgeServer.shared.setEngine(url)
            // Mint the engine browser-auth cookie FIRST (alpha.2+), then wire
            // the native consumers (settings RPC + event observer, §3 方案 A).
            Task { @MainActor in
                await EngineAuth.shared.exchangeNow(for: url)
                EngineGateway.shared.update(base: url)
                EngineEventObserver.shared.update(base: url)
            }
            // The SPA may have loaded while the engine was still booting
            // (bridge answers 503); reload now that the upstream is live.
            if let bridgeURL = BridgeServer.shared.url {
                windowController.load(url: bridgeURL)
            }
        case .failed(let reason):
            statusItem.setState(state)
            EngineAuth.shared.update(base: nil)
            EngineEventObserver.shared.update(base: nil)
            EngineGateway.shared.update(base: nil)
            NativeAlerts.notifyEngineFailed(reason: reason)
            recovery.show(reason: reason, log: EngineLog.shared.tailText)
        case .launching, .restarting, .idle:
            break
        }
    }

    private func webRoot() -> URL? {
        if let env = ProcessInfo.processInfo.environment["DSHMINI_WEB_ROOT"] {
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
        recovery.hide()
        supervisor.stop()
        // Engine binds workspace committed at process start (sandbox root = cwd).
        let newSupervisor = EngineSupervisor(home: AppPaths.harnessHome, workspace: config.workspaceURL)
        newSupervisor.onState = { [weak self] state in self?.handleEngineState(state) }
        supervisor = newSupervisor
        newSupervisor.start()
    }
}
