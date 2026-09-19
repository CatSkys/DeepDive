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
        installWakeObserver()
        installMainMenu()
        adjustOcclusionDetection()
        config = AppConfig.load()

        // Same-origin bridge seat: serves the self-built SPA and relays /api.
        try? FileManager.default.createDirectory(
            at: AppPaths.supportDir, withIntermediateDirectories: true
        )
        BridgeServer.shared.configure(webRoot: webRoot())
        _ = BridgeServer.shared.start()
        // 移动端远程面：上次开着就接着开（端口固定，手机上已存的链接不必重扫）
        if RemoteAccess.shared.enabled { _ = RemoteAccess.shared.start() }

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
        // 通知区可见性（设置-通用）：菜单栏图标可整体隐藏；Dock 图标走
        // accessory 策略（不经 Dock/Cmd⌘-Tab，窗口与热键不受影响）。
        statusItem.setVisible(DSHAppPrefs.menuBar)
        NSApp.setActivationPolicy(DSHAppPrefs.dockIcon ? .regular : .accessory)

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
        // 全局热键开关（设置-快捷键）：关 = 系统级注销，⌥Space 不再触发
        if !DSHAppPrefs.hotkeyOn {
            hotKey.unregister()
            EngineLog.shared.append("[shell] hotkey disabled by pref")
        }

        // Chat-import 插件须在引擎启动前装进 harness home 的 web profile：
        // 引擎按 profile bundles 加载后才挂上 /api-import/* 导入路由。
        if let runtime = Bundle.main.resourceURL {
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
        // 上次运行登记过的取消归档 / 删除：趁引擎还没起，把引擎状态文件落到位
        // （运行期改会被内存状态覆写——PITFALLS §4.15）
        if let applied = SessionAdmin.applyPending(home: AppPaths.harnessHome) {
            EngineLog.shared.append("[session-admin] applied pending: removed \(applied.removed.count)\(applied.error.map { " error: \($0)" } ?? "")")
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

    /// Dock 图标点击（运行中 reopen）：主面板是 orderOut 管理的 NSPanel，
    /// 系统 reopen 不会自动恢复它——显式走 showPanel（与通知点击/菜单栏
    /// 同一入口），面板已可见时等价于把它带回前台。返回 false 表示已接管。
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
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
            // 真正的重启：start() 对运行中的引擎是 no-op（process 幂等守卫），
            // 只调它等于"什么都不做"——而 bundle 成员变化（如卸载插件）必须换进程才生效。
            supervisor.stop()
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
                } else if key == "keybinds" {
                    // 前端键位覆盖（JSON 串，结构由前端定义）：只存不解析。
                    DSHAppPrefs.setKeybinds(mode)
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
                case "evolutionEnabled":
                    DSHAppPrefs.setEvolutionEnabled(value)
                case "sessionMemoryEnabled":
                    DSHAppPrefs.setSessionMemoryEnabled(value)
                case "hotkeyOn":
                    DSHAppPrefs.setHotkeyOn(value)
                    if value {
                        hotKey.register(spec: config.hotkey)
                    } else {
                        hotKey.unregister()
                    }
                case "menuBar":
                    DSHAppPrefs.setMenuBar(value)
                    statusItem.setVisible(value)
                case "dockIcon":
                    DSHAppPrefs.setDockIcon(value)
                    NSApp.setActivationPolicy(value ? .regular : .accessory)
                case "bubble": FloatingBubbleManager.shared.setEnabled(value)
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
            openWithList(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
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
        case "session-admin-sync":
            // 登记本地覆盖集（取消归档/删除）：不碰引擎，留到下次启动空窗期落账
            SessionAdmin.remember(
                unarchived: body["unarchived"] as? [String] ?? [],
                removed: body["removed"] as? [String] ?? [],
            )
        case "session-delete":
            // 立刻删日志目录（毫秒级、不需要引擎配合）；状态侧落账同上去登记
            SessionAdmin.remember(
                unarchived: body["unarchived"] as? [String] ?? [],
                removed: body["removed"] as? [String] ?? [],
            )
            let result = SessionAdmin.deleteDirectories(
                sessionIds: body["sessionIds"] as? [String] ?? [], home: AppPaths.harnessHome,
            )
            var fields: [String: Any] = ["reqId": body["reqId"] as? String ?? "", "removed": result.removed]
            if let error = result.error { fields["error"] = error }
            windowController.pushHostCommand("sessionAdmin", payload: AppDelegate.jsonPayload(fields))
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
        case "prepare-workspace":
            prepareWorkspace(
                reqId: body["reqId"] as? String ?? "",
                path: body["path"] as? String ?? "",
                name: body["name"] as? String ?? "",
                instructions: body["instructions"] as? String ?? "",
            )
        case "pick-attachments":
            pickAttachments(reqId: body["reqId"] as? String ?? "")
        case "list-dir":
            listDirectory(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "read-workspace-icon":
            readWorkspaceIcon(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "run-git":
            runGit(reqId: body["reqId"] as? String ?? "", path: body["path"] as? String ?? "")
        case "git-run":
            gitRun(reqId: body["reqId"] as? String ?? "",
                   path: body["path"] as? String ?? "",
                   args: body["args"] as? [String] ?? [])
        case "lesson-tool":
            lessonTool(reqId: body["reqId"] as? String ?? "",
                       tool: body["tool"] as? String ?? "",
                       args: body["args"] as? [String] ?? [])
        case "evolution-env":
            windowController.pushHostCommand(
                "evolutionEnv",
                payload: AppDelegate.jsonPayload(["reqId": body["reqId"] as? String ?? "", "harnessHome": AppPaths.harnessHome.path]),
            )
        case "memory-list":
            memoryList(reqId: body["reqId"] as? String ?? "")
        case "memory-delete":
            memoryDelete(reqId: body["reqId"] as? String ?? "", sessionId: body["sessionId"] as? String ?? "")
        case "memory-clear":
            memoryClear(reqId: body["reqId"] as? String ?? "")
        case "worktree-list":
            worktreeRun(
                reqId: body["reqId"] as? String ?? "", repo: body["repo"] as? String ?? "",
                args: ["worktree", "list", "--porcelain"], command: "worktrees",
            )
        case "worktree-add":
            worktreeRun(
                reqId: body["reqId"] as? String ?? "", repo: body["repo"] as? String ?? "",
                args: WorktreeAdmin.addArguments(
                    branch: body["branch"] as? String ?? "", path: body["path"] as? String ?? "",
                ),
                command: "worktreeDone",
            )
        case "worktree-remove":
            worktreeRun(
                reqId: body["reqId"] as? String ?? "", repo: body["repo"] as? String ?? "",
                args: WorktreeAdmin.removeArguments(path: body["path"] as? String ?? ""),
                command: "worktreeDone",
            )
        case "skill-list":
            skillList(reqId: body["reqId"] as? String ?? "")
        case "skill-remove":
            skillRemove(reqId: body["reqId"] as? String ?? "", directory: body["directory"] as? String ?? "")
        case "skill-create":
            skillCreate(
                reqId: body["reqId"] as? String ?? "",
                name: body["name"] as? String ?? "",
                description: body["description"] as? String ?? "",
            )
        case "skill-install":
            skillInstall(reqId: body["reqId"] as? String ?? "")
        case "plugin-patch-list":
            pluginPatchList(reqId: body["reqId"] as? String ?? "")
        case "plugin-patch-set":
            pluginPatchSet(
                reqId: body["reqId"] as? String ?? "",
                rowId: body["rowId"] as? String ?? "",
                disabled: body["disabled"] as? Bool ?? false,
            )
        case "plugin-admin-info":
            pluginAdminInfo(reqId: body["reqId"] as? String ?? "")
        case "plugin-uninstall":
            pluginUninstall(reqId: body["reqId"] as? String ?? "", moduleName: body["moduleName"] as? String ?? "")
        case "mcp-servers-list":
            mcpServersList(reqId: body["reqId"] as? String ?? "")
        case "mcp-servers-save":
            mcpServersSave(
                reqId: body["reqId"] as? String ?? "",
                rows: body["servers"] as? [[String: Any]] ?? [],
                newSecrets: (body["secrets"] as? [String: [String: String]]) ?? [:],
            )
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
        case "remote-copy":
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(body["text"] as? String ?? "", forType: .string)
        case "qr-encode":
            // 通用二维码（Bot Channel 的扫码配对：插件给的是 verificationUrl）。
            // 复用壳里那一份 CoreImage 生成器，前端不再塞第二套 QR 实现。
            windowController.pushHostCommand("qrEncoded", payload: AppDelegate.jsonPayload([
                "reqId": body["reqId"] as? String ?? "",
                "qr": QRCode.dataURL(text: body["text"] as? String ?? "") ?? "",
            ]))
        case "open-url":
            // Markdown 链接经壳打开（webview 内跳转会离开 SPA）；只放行 http/https
            if let url = URL(string: body["url"] as? String ?? ""), url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
            }
        case "dictation-start":
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

    /// 全屏预览页「打开方式」候选：OpenWithCatalog 出事实（App 列表 + 图标
    /// dataURL + 默认 App），这里只负责按桥约定回推。文件不存在/无候选回空表
    /// （前端按「无候选」隐藏选择器，不冒充）。
    private func openWithList(reqId: String, path: String) {
        guard let listing = OpenWithCatalog.listing(forPath: path) else {
            windowController.pushHostCommand(
                "openWith",
                payload: AppDelegate.jsonPayload(["reqId": reqId, "defaultId": "", "apps": []]),
            )
            return
        }
        windowController.pushHostCommand(
            "openWith",
            payload: AppDelegate.jsonPayload(OpenWithCatalog.payload(listing, reqId: reqId)),
        )
    }

    /// 新建项目弹窗的落地准备：① 目录——引擎 workspace/create 要求目录已
    /// 存在（vendored workspace 包 realpath+stat 校验），自动建目录只能在壳
    /// 做：未显式给 path 时在 ~/Documents/DeepDive Projects/<净化名> 下建
    /// （撞名追加序号）；② 项目指令——写入 <目录>/AGENTS.md（引擎按会话
    /// cwd 读它），文件已存在则不改动。磁盘操作走后台队列（对齐 runGit
    /// 的线程纪律），主线程只回推 payload。
    private func prepareWorkspace(reqId: String, path: String, name: String, instructions: String) {
        func reply(_ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            windowController.pushHostCommand("workspacePrepared", payload: AppDelegate.jsonPayload(all))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            var target = path
            if target.isEmpty {
                let safe = name
                    .components(separatedBy: CharacterSet(charactersIn: "/:").union(.newlines).union(.controlCharacters))
                    .joined(separator: "-")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let base = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent("Documents", isDirectory: true)
                    .appendingPathComponent("DeepDive Projects", isDirectory: true)
                var candidate = base.appendingPathComponent(safe.isEmpty ? "Project" : safe)
                var n = 2
                while FileManager.default.fileExists(atPath: candidate.path) {
                    candidate = base.appendingPathComponent("\(safe.isEmpty ? "Project" : safe) \(n)")
                    n += 1
                }
                target = candidate.path
            }
            let fm = FileManager.default
            do {
                try fm.createDirectory(atPath: target, withIntermediateDirectories: true)
            } catch {
                DispatchQueue.main.async { reply(["error": error.localizedDescription]) }
                return
            }
            var agentsFile = false
            if !instructions.isEmpty {
                let agents = URL(fileURLWithPath: target).appendingPathComponent("AGENTS.md")
                if !fm.fileExists(atPath: agents.path) {
                    do {
                        try instructions.write(to: agents, atomically: true, encoding: .utf8)
                        agentsFile = true
                    } catch {
                        DispatchQueue.main.async { reply(["error": error.localizedDescription]) }
                        return
                    }
                }
            }
            DispatchQueue.main.async { reply(["path": target, "agentsFile": agentsFile]) }
        }
    }

    /// 侧栏空间格图标：读项目根目录约定图标文件（WorkspaceIcon.probe），
    /// base64 dataURL 回推；无图标/路径非目录回空串——前端回落项目首字母。
    private func readWorkspaceIcon(reqId: String, path: String) {
        func reply(_ dataUrl: String) {
            windowController.pushHostCommand("workspaceIcon", payload: AppDelegate.jsonPayload(["reqId": reqId, "dataUrl": dataUrl]))
        }
        let dir = URL(fileURLWithPath: path)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue,
              let hit = WorkspaceIcon.probe(in: dir) else {
            reply("")
            return
        }
        reply("data:\(hit.mime);base64,\(hit.data.base64EncodedString())")
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

    // MARK: - 工作树（设置 → 工作树）：生命周期交给 git 本体，解析在 WorktreeAdmin

    private func worktreeRun(
        reqId: String, repo: String, args: [String], command: String, okExtra: [String: Any] = [:],
    ) {
        func reply(_ ok: Bool, _ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            all["ok"] = ok
            windowController.pushHostCommand(command, payload: AppDelegate.jsonPayload(all))
        }
        guard FileManager.default.fileExists(atPath: repo) else {
            reply(false, ["error": "工作区路径不存在"])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let result = ProcessRunner.run(executable: "/usr/bin/git", arguments: args, workingDirectory: repo)
            var fields = okExtra
            if result.status == 0 {
                if args.first == "worktree", args.dropFirst().first == "list" {
                    let rows = WorktreeAdmin.parsePorcelain(result.output).map { item -> [String: Any] in
                        [
                            "path": item.path, "head": item.head, "branch": item.branch,
                            "detached": item.detached, "bare": item.bare,
                            "prunable": item.prunable, "locked": item.locked,
                        ]
                    }
                    fields["worktrees"] = rows
                    // git 的 porcelain 给的是 realpath（macOS 上 /var 会写成 /private/var），
                    // 而前端拿到的是用户输入的工作区路径。主工作树的判定要同一把尺子，
                    // 所以把解析后的仓库路径一并回推（解析符号链接只有壳做得到）。
                    fields["resolvedRepo"] = URL(fileURLWithPath: repo).resolvingSymlinksInPath().path
                } else {
                    fields["output"] = result.output
                }
            } else {
                // git 的拒绝原文就是最有用的信息（分支已存在 / 工作树有未提交改动），照传
                fields["error"] = result.output.isEmpty ? "git 命令失败" : result.output
            }
            DispatchQueue.main.async { reply(result.status == 0, fields) }
        }
    }

    /// 会话记忆笔记的审计面（memory-list/delete/clear）：笔记是插件的落盘文件
    /// （<DSH_HOME>/deepdive/memory/<sessionId>.md），壳只读与删——可审计性照
    /// Ditto 记忆页（查看/单条忘记/全部清除）。sessionId 只放行安全字符防穿越。
    private static func isSafeSessionId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 128 && id.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
    }

    private func memoryList(reqId: String) {
        func reply(_ notes: [[String: Any]]) {
            windowController.pushHostCommand("memoryFiles", payload: AppDelegate.jsonPayload(["reqId": reqId, "notes": notes]))
        }
        let dir = EngineSupervisor.memoryDir
        let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        let notes: [[String: Any]] = items.compactMap { url in
            guard url.pathExtension == "md" else { return nil }
            let sessionId = url.deletingPathExtension().lastPathComponent
            guard sessionId.hasPrefix("session-"), AppDelegate.isSafeSessionId(sessionId),
                  let content = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            return ["sessionId": sessionId, "content": String(content.prefix(8000))]
        }
        reply(notes)
    }

    private func memoryDelete(reqId: String, sessionId: String) {
        func reply(_ ok: Bool) {
            windowController.pushHostCommand("memoryDeleted", payload: AppDelegate.jsonPayload(["reqId": reqId, "ok": ok]))
        }
        guard AppDelegate.isSafeSessionId(sessionId) else { reply(false); return }
        let url = EngineSupervisor.memoryDir.appendingPathComponent(sessionId + ".md")
        guard FileManager.default.fileExists(atPath: url.path) else { reply(true); return }
        do { try FileManager.default.removeItem(at: url); reply(true) } catch { reply(false) }
    }

    private func memoryClear(reqId: String) {
        func reply(_ ok: Bool) {
            windowController.pushHostCommand("memoryCleared", payload: AppDelegate.jsonPayload(["reqId": reqId, "ok": ok]))
        }
        let dir = EngineSupervisor.memoryDir
        let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        do {
            for url in items where url.pathExtension == "md" {
                try FileManager.default.removeItem(at: url)
            }
            reply(true)
        } catch {
            reply(false)
        }
    }

    /// 技能清单（设置 → 技能与插件）：技能是 `<DSH_HOME>/skills` 下的普通文件，
    /// 引擎侧没有 skill 方法，所以清单由壳读盘给出（含 frontmatter 缺键与是否随应用发布）。
    private func skillList(reqId: String) {
        let skills = SkillAdmin.list(in: AppPaths.harnessHome)
        let rows: [[String: Any]] = skills.map { skill in
            [
                "id": skill.id,
                "title": skill.title,
                "detail": skill.detail,
                "manifest": skill.manifest,
                "directory": skill.directory,
                "missing": skill.missing,
                "managed": SkillAdmin.managedNames.contains(skill.id),
            ]
        }
        windowController.pushHostCommand("skillFiles", payload: AppDelegate.jsonPayload(["reqId": reqId, "skills": rows]))
    }

    /// 删除一个技能目录（前端已在列表里确认过一次；路径穿越由 SkillAdmin 挡）。
    private func skillRemove(reqId: String, directory: String) {
        let error = SkillAdmin.remove(directory: directory, home: AppPaths.harnessHome)
        var fields: [String: Any] = ["reqId": reqId, "ok": error == nil]
        if let error { fields["error"] = error }
        windowController.pushHostCommand("skillRemoved", payload: AppDelegate.jsonPayload(fields))
    }

    /// 新建一个技能（写 SKILL.md 骨架）；引擎 chokidar 热发现，不用重启。
    private func skillCreate(reqId: String, name: String, description: String) {
        let error = SkillAdmin.create(name: name, description: description, home: AppPaths.harnessHome)
        var fields: [String: Any] = ["reqId": reqId, "ok": error == nil]
        if let error { fields["error"] = error }
        windowController.pushHostCommand("skillCreated", payload: AppDelegate.jsonPayload(fields))
    }

    /// 从目录安装技能：开一个选目录的 sheet，选完把那一层拷进技能根（引擎 chokidar 热发现）。
    /// 用户取消时回 cancelled（不是错误），前端据此不弹报错框。
    private func skillInstall(reqId: String) {
        guard let window = windowController.window else {
            windowController.pushHostCommand("skillInstalled", payload: AppDelegate.jsonPayload(
                ["reqId": reqId, "ok": false, "error": "没有可用窗口"]))
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
                let error = SkillAdmin.install(sourceDirectory: url.path, home: AppPaths.harnessHome)
                fields["ok"] = error == nil
                if let error { fields["error"] = error }
            } else {
                fields["ok"] = false
                fields["cancelled"] = true
            }
            self.windowController.pushHostCommand("skillInstalled", payload: AppDelegate.jsonPayload(fields))
        }
    }

    /// 插件开关的当前落账（设置 → 插件）：托管段里被显式设置过的行。
    /// 前端据此把"用户关掉的"与"本层本来就没挂载"分开——两者在 inventory 里
    /// 都是 enabled:false，混在一起会让开关看起来点了没反应（PITFALLS §7.6）。
    private func pluginPatchList(reqId: String) {
        let toggles = PluginPatchAdmin.toggles(in: AppPaths.harnessHome)
        let rows: [[String: Any]] = toggles.map { ["rowId": $0.rowId, "disabled": $0.disabled] }
        windowController.pushHostCommand("pluginPatches", payload: AppDelegate.jsonPayload(["reqId": reqId, "toggles": rows]))
    }

    /// 拨一个插件开关：写 home 级 patch 层，引擎 patchReload:live 热重载生效（无需重启）。
    private func pluginPatchSet(reqId: String, rowId: String, disabled: Bool) {
        guard !rowId.isEmpty else {
            windowController.pushHostCommand("pluginPatchSet", payload: AppDelegate.jsonPayload(["reqId": reqId, "ok": false, "error": "缺少行 id"]))
            return
        }
        let error = PluginPatchAdmin.set(rowId: rowId, disabled: disabled, in: AppPaths.harnessHome)
        var fields: [String: Any] = ["reqId": reqId, "ok": error == nil, "rowId": rowId, "disabled": disabled]
        if let error { fields["error"] = error }
        windowController.pushHostCommand("pluginPatchSet", payload: AppDelegate.jsonPayload(fields))
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

    /// MCP server 清单（设置 → 插件 → MCP）：配置源是 app 自己的 JSON，
    /// patch 块由 McpServerAdmin 生成。密钥**只回"哪些 key 已配置"**（不回值）——
    /// 与模型 Key 同一条惯例（`credentials/describe` 也不回值）。
    private func mcpServersList(reqId: String) {
        let store = McpServerAdmin.load(in: AppPaths.supportDir)
        let rows: [[String: Any]] = store.servers.map {
            [
                "rowId": $0.rowId, "name": $0.name, "transport": $0.transport,
                "command": $0.command, "args": $0.args, "url": $0.url,
                "env": $0.env, "headers": $0.headers, "enabled": $0.enabled,
            ]
        }
        let configured = store.secrets.mapValues { Array($0.keys).sorted() }
        windowController.pushHostCommand("mcpServers", payload: AppDelegate.jsonPayload([
            "reqId": reqId, "servers": rows, "configured": configured,
        ]))
    }

    /// 保存 MCP server（增删改都走它）。密钥合并规则：用户填了值就覆盖；不再被该
    /// server 的 env/headers 引用的 key 丢掉（用户在弹窗里删了引用即等于删密钥）。
    private func mcpServersSave(reqId: String, rows: [[String: Any]], newSecrets: [String: [String: String]]) {
        let previous = McpServerAdmin.load(in: AppPaths.supportDir)
        let servers = rows.map { row in
            let name = row["name"] as? String ?? ""
            return McpServerAdmin.Server(
                rowId: (row["rowId"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? McpServerAdmin.rowId(of: name),
                name: name,
                transport: row["transport"] as? String ?? "stdio",
                command: row["command"] as? String ?? "",
                args: row["args"] as? [String] ?? [],
                url: row["url"] as? String ?? "",
                env: row["env"] as? [String] ?? [],
                headers: row["headers"] as? [String] ?? [],
                enabled: row["enabled"] as? Bool ?? true,
            )
        }
        var secrets: [String: [String: String]] = [:]
        for server in servers {
            let referenced = Set(server.env + server.headers)
            var keys = (previous.secrets[server.name] ?? [:]).filter { referenced.contains($0.key) }
            for key in referenced {
                if let fresh = newSecrets[server.name]?[key], !fresh.isEmpty { keys[key] = fresh }
            }
            if !keys.isEmpty { secrets[server.name] = keys }
        }
        let error = McpServerAdmin.save(
            McpServerAdmin.Store(servers: servers, secrets: secrets),
            in: AppPaths.supportDir, harnessHome: AppPaths.harnessHome,
        )
        var fields: [String: Any] = ["reqId": reqId, "ok": error == nil]
        if let error { fields["error"] = error }
        windowController.pushHostCommand("mcpServersSaved", payload: AppDelegate.jsonPayload(fields))
    }

    /// 移动端远程访问的状态回推：开关、局域网链接、二维码 data URL、设备台账。
    /// 开启/停止/刷新令牌/解绑都回这一份，前端不自己拼状态。
    private func remoteStatus(reqId: String) {
        var payload = RemoteAccess.shared.statusPayload()
        payload["reqId"] = reqId
        windowController.pushHostCommand("remoteStatus", payload: AppDelegate.jsonPayload(payload))
    }

    /// 自进化机械脚本执行（lesson-tool → lessonToolResult 回推）：随包 node 直跑    /// 固化脚本（gate/land/verify，启动时铺盘在 <DSH_HOME>/deepdive/），模型不在
    /// 环内——零人审的信任底座（Ditto selftest：宿主验证，不采信 agent 口头"完成"）。
    /// DSH_HOME 显式进脚本环境（壳进程环境里没有）；stdout 完整回传（回执在末行），
    /// 解析在前端边界做。node/脚本缺席（dev 的 .single 入口）显式 ok=false 降级。
    private func lessonTool(reqId: String, tool: String, args: [String]) {
        func reply(_ ok: Bool, _ output: String) {
            let trimmed = output.count > 8000 ? String(output.suffix(8000)) : output
            windowController.pushHostCommand("lessonToolResult", payload: AppDelegate.jsonPayload([
                "reqId": reqId, "ok": ok, "output": trimmed,
            ]))
        }
        let script: URL? = switch tool {
        case "gate": EngineSupervisor.lessonScriptURL("lesson-gate.mjs")
        case "land": EngineSupervisor.lessonScriptURL("lesson-land.mjs")
        case "verify": EngineSupervisor.lessonScriptURL("lesson-verify.mjs")
        default: nil
        }
        guard let node = EngineSupervisor.bundledNodePath, let script, FileManager.default.fileExists(atPath: script.path) else {
            reply(false, "lesson tool unavailable: \(tool)")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [script.path] + args
            process.environment = ProcessInfo.processInfo.environment.merging(
                ["DSH_HOME": AppPaths.harnessHome.path],
            ) { _, new in new }
            let outPipe = Pipe()
            let errPipe = Pipe()
            process.standardOutput = outPipe
            process.standardError = errPipe
            do { try process.run() } catch {
                DispatchQueue.main.async { reply(false, "spawn failed") }
                return
            }
            // stderr 独立线程排空（与 gitRun 同因：顺序读有管道互锁面）
            var errText = ""
            let errLock = NSLock()
            Thread.detachNewThread {
                let d = errPipe.fileHandleForReading.readDataToEndOfFile()
                errLock.lock()
                errText = String(data: d, encoding: .utf8) ?? ""
                errLock.unlock()
            }
            let out = outPipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            var output = String(data: out, encoding: .utf8) ?? ""
            errLock.lock()
            if !errText.isEmpty { output += "\n\(errText)" }
            errLock.unlock()
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

    /// 附件选择器（composer ＋）：文件与文件夹都可多选；绝对路径回推给前端
    /// 走 @ 引用（引擎宿主侧读盘），图片附带 base64 走真字节上传。取消回推
    /// 空数组——前端据此收尾，不悬挂 reqId。NSOpenPanel 留在主线程；整图
    /// 磁盘读与 base64 编码移后台队列（读大图会卡主线程 UI，AUD-079，对齐
    /// 同文件 gitRun 的后台样板），主线程只回推 payload。
    private func pickAttachments(reqId: String) {
        guard let window = windowController.window else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.message = "选择要附加的文件或文件夹"
        panel.prompt = "添加"
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            let urls = response == .OK ? panel.urls : []
            DispatchQueue.global(qos: .userInitiated).async {
                var items: [[String: Any]] = []
                for url in urls {
                    var item: [String: Any] = [
                        "path": url.path,
                        "name": url.lastPathComponent,
                        "isDir": (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false,
                    ]
                    // 0.1.5：图片附 base64（imageLimits 准入类型）；其余
                    // 文件 ≤8MB 也附 base64（fileUploads/upload 真上传），
                    // 超限/读取失败降级为纯路径（前端转 @ 引用）。
                    let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
                    if !isDir, let data = try? Data(contentsOf: url) {
                        if Self.imageExtensions.contains(url.pathExtension.lowercased()) {
                            item["isImage"] = true
                            item["base64"] = data.base64EncodedString()
                        } else if data.count <= Self.maxPickFileBytes {
                            item["base64"] = data.base64EncodedString()
                        }
                    }
                    items.append(item)
                }
                let payload = Self.jsonPayload(["reqId": reqId, "items": items])
                DispatchQueue.main.async {
                    self.windowController.pushHostCommand("pickedAttachments", payload: payload)
                }
            }
        }
    }

    /// 与引擎 imageLimits 准入的媒体类型对齐（png/jpeg/webp/gif）。
    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "gif"]
    /// 选择器单文件字节上限（对齐桥直通与引擎无上限的流式路由）。
    private static let maxPickFileBytes = 128 * 1024 * 1024

    /// Preference + path snapshot for the settings page (推送于 host-ready
    /// 与 get-prefs;键值与 frontend/src/components/SettingsPage.tsx 约定)。
    private func pushPrefs() {
        let payload: [String: Any] = [
            "notifyTurnEnd": DSHAppPrefs.notifyTurnEnd,
            "notifyAttention": DSHAppPrefs.notifyAttention,
            "menuBar": DSHAppPrefs.menuBar,
            "dockIcon": DSHAppPrefs.dockIcon,
            "bubble": FloatingBubbleManager.shared.enabled,
            "glass": config.themeEnabled,
            "sidebarWidth": DSHAppPrefs.sidebarWidth,
            "appearance": DSHAppPrefs.appearance,
            "language": DSHAppPrefs.language,
            "keybinds": DSHAppPrefs.keybinds,
            "hotkeyOn": DSHAppPrefs.hotkeyOn,
        "evolutionEnabled": DSHAppPrefs.evolutionEnabled,
            "sessionMemoryEnabled": DSHAppPrefs.sessionMemoryEnabled,
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
        appMenu.addItem(NSMenuItem(title: "关于 DeepDive", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        let settingsItem = NSMenuItem(title: "设置…", action: #selector(openSettingsFromMenu), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(settingsItem)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "隐藏 DeepDive", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "退出 DeepDive", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

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
            // The SPA loads unconditionally (static serving never 503s); this
            // reload re-boots it against the now-live upstream so boot-time
            // RPCs that hit the 503 window get real answers.
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
