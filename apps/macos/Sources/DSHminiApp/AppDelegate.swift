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
        installDictation()

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
                    payload: Self.jsonPayload(["sessionId": sessionId])
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
            name: Notification.Name("com.deepdive.app.show"),
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
            payload: Self.jsonPayload(["sessionId": sessionId])
        )
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
            // 字符串偏好（外观三态 / 语言）：JS string 桥接成 NSString。
            if let mode = body["value"] as? String {
                if key == "appearance" {
                    DSHAppPrefs.setAppearance(mode)
                    windowController.applyAppearanceMode()
                } else if key == "language" {
                    DSHAppPrefs.setLanguage(mode)
                }
                break
            }
            guard let raw = body["value"] as? NSNumber else { break }
            // JS true/false 与数字都桥接成 NSNumber，且数字能被 as? Bool
            // 误转成功 —— 必须按 CFBoolean 类型判别分流，不能靠 cast 试探。
            if CFGetTypeID(raw) == CFBooleanGetTypeID() {
                let value = raw.boolValue
                switch key {
                case "notifyTurnEnd": DSHAppPrefs.setNotifyTurnEnd(value)
                case "notifyAttention": DSHAppPrefs.setNotifyAttention(value)
                case "bubble": FloatingBubbleManager.shared.setEnabled(value)
                default: break
                }
            } else if key == "sidebarWidth" {
                DSHAppPrefs.setSidebarWidth(raw.doubleValue)
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
        case "pick-workspace":
            pickWorkspaceDirectory()
        case "list-dir":
            listDirectory(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "run-git":
            runGit(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "git-run":
            gitRun(reqId: body["reqId"] as? String ?? "",
                   path: body["path"] as? String ?? "",
                   args: body["args"] as? [String] ?? [])
        case "open-url":
            // Markdown 链接经壳打开（webview 内跳转会离开 SPA）；只放行 http/https
            if let url = URL(string: body["url"] as? String ?? ""), url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
            }
        case "dictation-start":
            DictationController.shared.start()
        case "dictation-stop":
            DictationController.shared.stop()
        default:
            EngineLog.shared.append("[bridge] unhandled host message: \(type)")
        }
    }

    /// 听写事件回推：partial 实时、final 终稿、error 权限/设备问题。
    /// pending 槽位是 last-wins，partial 相互覆盖正是期望行为。
    private func installDictation() {
        func payload(_ text: String) -> String {
            let data = try? JSONSerialization.data(withJSONObject: ["text": text])
            return String(data: data ?? Data(), encoding: .utf8) ?? "{}"
        }
        DictationController.shared.onPartial = { [weak self] text in
            self?.windowController.pushHostCommand("dictation-partial", payload: payload(text))
        }
        DictationController.shared.onFinal = { [weak self] text in
            self?.windowController.pushHostCommand("dictation-final", payload: payload(text))
        }
        DictationController.shared.onError = { [weak self] text in
            self?.windowController.pushHostCommand("dictation-error", payload: payload(text))
        }
    }

    /// 壳侧目录列举（@ 引用候选源，host.listDir 契约见 frontend/src/host.ts）：
    /// 一层目录、目录优先、隐藏文件排除。错误也回包（entries 空 + error），
    /// 前端按 reqId 配对。
    private func listDirectory(reqId: String, path: String) {
        func reply(_ entries: [[String: Any]], error: String? = nil) {
            var fields: [String: Any] = ["reqId": reqId, "entries": entries]
            if let error { fields["error"] = error }
            windowController.pushHostCommand("dirListing", payload: Self.jsonPayload(fields))
        }
        let base = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: base.path) else {
            reply([], error: "not-found")
            return
        }
        let items = (try? FileManager.default.contentsOfDirectory(
            at: base,
            includingPropertiesForKeys: [.isDirectoryKey, .isHiddenKey],
        )) ?? []
        struct Row { let name: String; let path: String; let isDir: Bool }
        var rows: [Row] = []
        for url in items {
            guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isHiddenKey]),
                  values.isHidden != true else { continue }
            rows.append(Row(name: url.lastPathComponent, path: url.path, isDir: values.isDirectory ?? false))
        }
        rows.sort { a, b in
            if a.isDir != b.isDir { return a.isDir }
            return a.name < b.name
        }
        reply(rows.prefix(200).map { ["name": $0.name, "path": $0.path, "isDir": $0.isDir] })
    }

    /// 状态胶囊的未提交改动摘要（run-git → gitStatus 回推）。引擎无 git 能力，
    /// 由壳在工作区路径跑只读 git 命令聚合；非 git 仓库/命令不可用回 repo=false，
    /// 前端按无 git 数据处理。status 计未提交文件（含未跟踪），numstat 计行数。
    private func runGit(reqId: String, path: String) {
        func reply(_ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            windowController.pushHostCommand("gitStatus", payload: AppDelegate.jsonPayload(all))
        }
        func git(_ args: [String]) -> String? {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = args
            process.currentDirectoryURL = URL(fileURLWithPath: path)
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()
            do { try process.run() } catch { return nil }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            return String(data: data, encoding: .utf8)
        }
        guard FileManager.default.fileExists(atPath: path),
              let branch = git(["rev-parse", "--abbrev-ref", "HEAD"])?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            reply(["repo": false])
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
        reply(["repo": true, "branch": branch, "files": files, "additions": additions, "deletions": deletions])
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
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = args
            process.currentDirectoryURL = URL(fileURLWithPath: path)
            let outPipe = Pipe()
            let errPipe = Pipe()
            process.standardOutput = outPipe
            process.standardError = errPipe
            do { try process.run() } catch {
                DispatchQueue.main.async { reply(false, "spawn failed") }
                return
            }
            let out = outPipe.fileHandleForReading.readDataToEndOfFile()
            let err = errPipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            var output = String(data: out, encoding: .utf8) ?? ""
            if let errText = String(data: err, encoding: .utf8), !errText.isEmpty {
                output += "\n\(errText)"
            }
            let ok = process.terminationStatus == 0
            DispatchQueue.main.async { reply(ok, output) }
        }
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

    /// Preference + path snapshot for the settings page (推送于 host-ready
    /// 与 get-prefs;键值与 frontend/src/components/SettingsPage.tsx 约定)。
    private func pushPrefs() {
        let payload: [String: Any] = [
            "notifyTurnEnd": DSHAppPrefs.notifyTurnEnd,
            "notifyAttention": DSHAppPrefs.notifyAttention,
            "bubble": FloatingBubbleManager.shared.enabled,
            "glass": config.themeEnabled,
            "sidebarWidth": DSHAppPrefs.sidebarWidth,
            "appearance": DSHAppPrefs.appearance,
            "language": DSHAppPrefs.language,
            "schemeDark": windowController.isEffectiveDark,
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
