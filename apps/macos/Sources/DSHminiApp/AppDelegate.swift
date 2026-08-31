import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var supervisor: EngineSupervisor!
    private var windowController: MainWindowController!
    private var statusItem: StatusItemController!
    private var hotKey: HotKeyManager!
    private var recovery: RecoveryWindowController!
    private var config: AppConfig!
    private var terminationSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = AppPaths.supportDir
        installTerminationHandler()
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
        statusItem.themeEnabled = config.themeEnabled
        hotKey = HotKeyManager()

        statusItem.install()
        statusItem.onShowWindow = { [weak self] in self?.windowController.showPanel() }
        statusItem.onReloadWeb = { [weak self] in self?.windowController.reloadWeb() }
        statusItem.onRestartEngine = { [weak self] in
            guard let self else { return }
            self.recovery.hide()
            self.supervisor.start()
        }
        statusItem.onToggleTheme = { [weak self] in
            guard let self else { return }
            self.config.themeEnabled = self.statusItem.themeEnabled
            self.config.save()
            self.windowController.setTheme(self.config.themeEnabled)
        }
        statusItem.onChooseWorkspace = { [weak self] in self?.chooseWorkspace() }
        statusItem.onQuit = { [weak self] in
            self?.supervisor.stop()
            NSApp.terminate(nil)
        }

        recovery.onRetry = { [weak self] in
            self?.supervisor.start()
        }

        supervisor.onState = { [weak self] state in
            self?.handleEngineState(state)
        }

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
    }

    @objc private func showFromOtherInstance(_ note: Notification) {
        windowController.showPanel()
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
            // The SPA may have loaded while the engine was still booting
            // (bridge answers 503); reload now that the upstream is live.
            if let bridgeURL = BridgeServer.shared.url {
                windowController.load(url: bridgeURL)
            }
        case .failed(let reason):
            statusItem.setState(state)
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
