import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shared: AppDelegate?

    private var supervisor: EngineSupervisor!
    private var windowController: MainWindowController!
    private var statusItem: StatusItemController!
    private var hotKey: HotKeyManager!
    private var config: AppConfig!
    private var terminationSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
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

        statusItem.install()
        statusItem.onShowWindow = { [weak self] in self?.windowController.showPanel() }
        statusItem.onOpenSettings = { [weak self] in self?.openSettings() }
        statusItem.onReloadWeb = { [weak self] in self?.windowController.reloadWeb() }
        statusItem.onRestartEngine = { [weak self] in self?.supervisor.start() }
        statusItem.onChooseWorkspace = { [weak self] in self?.chooseWorkspace() }
        statusItem.onQuit = { [weak self] in
            self?.supervisor.stop()
            NSApp.terminate(nil)
        }
        // 通知区可见性（设置-通用）：菜单栏图标可整体隐藏；Dock 图标走
        // accessory 策略（不经 Dock/Cmd⌘-Tab，窗口与热键不受影响）。
        statusItem.setVisible(DSHAppPrefs.menuBar)
        NSApp.setActivationPolicy(DSHAppPrefs.dockIcon ? .regular : .accessory)

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
        // 老 dsh CLI（~/.dsh）的凭据一次性接过来——引擎只认 DSH_HOME 下那一份。
        // 原挂载点是恢复窗的按钮，恢复窗删除后改在启动期自动走（.already/.missing
        // 是常态、静默；.imported/.failed 由 LegacyCredentials 自己落日志）。
        _ = LegacyCredentials.perform()
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

        // 双击图标启动就是要用：一律把窗口带到前台。旧判据是「config.json 不
        // 存在才算首启」，而 config.json 会被「改快捷键」与菜单栏「设置启动
        // 工作区…」（说明书里就教这一步）顺手创建——此后冷启动双击图标毫无
        // 反应，菜单栏应用连个提示都没有，被用户报成「打不开」（只剩 Dock
        // 图标 / 菜单栏 / ⌥Space 三条唤出路径）。bridge URL 已在上方 load。
        windowController.showPanel()

        // Dev/verification hook (same family as DSHMINI_OPEN_SID): open the
        // settings window right after boot.
        if ProcessInfo.processInfo.environment["DSHMINI_OPEN_SETTINGS"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.openSettings()
            }
        }
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
            // 引擎状态的快照也要推：SPA 每次 ready 都会整体重载，重载后它只剩默认
            // 相位——不补这一下，"重启中/已失败"在重载后就退回成笼统的"正在重试…"。
            pushEngineState(supervisor.state)
        case "restart-engine":
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
                } else if key == "onboarding" {
                    // 新手引导进度（JSON 串，结构由前端 onboarding/useOnboarding 定义）。
                    DSHAppPrefs.setOnboarding(mode)
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
        case "prepare-workspace":
            prepareWorkspace(
                reqId: body["reqId"] as? String ?? "",
                path: body["path"] as? String ?? "",
                name: body["name"] as? String ?? "",
                instructions: body["instructions"] as? String ?? "",
            )
        case "write-agents":
            writeAgents(
                reqId: body["reqId"] as? String ?? "",
                path: body["path"] as? String ?? "",
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
            windowController.pushHostCommand("qrEncoded", payload: AppDelegate.jsonPayload([
                "reqId": body["reqId"] as? String ?? "",
                "qr": QRCode.dataURL(text: body["text"] as? String ?? "") ?? "",
            ]))
        case "scan-agent-configs":
            // 新手引导「迁移」步：读其他 Agent 的配置原文交给前端解析（壳不解析、不落日志，
            // 见 AgentConfigScan 的隐私边界）。文件按白名单，缺失的来源直接不出现。
            windowController.pushHostCommand("agentConfigs", payload: AppDelegate.jsonPayload([
                "reqId": body["reqId"] as? String ?? "",
                "files": AgentConfigScan.read(home: FileManager.default.homeDirectoryForCurrentUser),
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

    /// 编辑项目弹窗的落盘：覆写 <项目>/AGENTS.md（与 prepare-workspace 的
    /// 「已存在不改动」相反——编辑是用户显式改，覆盖原内容）。磁盘操作走
    /// 后台队列（对齐 prepareWorkspace 的线程纪律），主线程只回推 payload。
    private func writeAgents(reqId: String, path: String, instructions: String) {
        func reply(_ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            windowController.pushHostCommand("agentsWritten", payload: AppDelegate.jsonPayload(all))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let agents = URL(fileURLWithPath: path).appendingPathComponent("AGENTS.md")
            do {
                try instructions.write(to: agents, atomically: true, encoding: .utf8)
                DispatchQueue.main.async { reply(["ok": true]) }
            } catch {
                DispatchQueue.main.async { reply(["ok": false, "error": error.localizedDescription]) }
            }
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
                    // 0.1.5：图片附 base64（imageLimits 准入类型）；其余文件同样附
                    // base64（fileUploads/upload 真上传）。两者共用同一个上限——桥
                    // 单请求 32MB，超了必 413，先在选文件这一步就分开走（前端明说）。
                    let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
                    if !isDir, let data = try? Data(contentsOf: url), data.count <= Self.maxPickFileBytes {
                        if Self.imageExtensions.contains(url.pathExtension.lowercased()) {
                            item["isImage"] = true
                        }
                        item["base64"] = data.base64EncodedString()
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
    /// 选择器单文件字节上限：**等于桥的单请求上限**（`MiniHTTPServer.maxBodyBytes`，
    /// 超了回 413）。图片与通用文件同一口径——上限只在选文件这一步分流，
    /// 不在这里给用户一个注定 413 的 base64。
    private static let maxPickFileBytes = 32 * 1024 * 1024

    /// Preference + path snapshot for the settings page (推送于 host-ready
    /// 与 get-prefs;键值与 frontend/src/components/SettingsPage.tsx 约定)。
    ///
    /// **值必须是 JSON 能写的类型**：一个方法引用混进来，`JSONSerialization` 会在 host-ready
    /// 那一刻抛异常——表现是"应用一启动就崩"（2026-09-26 实测：`BrowserShield.shared.enabled`
    /// 少写了调用括号，把 Bool 写成了一个闭包）。所以这一段单独留出来给测试钉住。
    func prefsPayload() -> [String: Any] {
        [
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
            "onboarding": DSHAppPrefs.onboarding,
            "hotkeyOn": DSHAppPrefs.hotkeyOn,
            // 热键 spec（"option+space"）：SPA 据此显示当前热键，不带它设置页只能显示
            // 一个写死的默认值（改过热键、重启后就对不上）
            "hotkey": AppConfig.load().hotkey,
            "schemeDark": windowController.isEffectiveDark,
            "home": AppPaths.harnessHome.path,
            "browserZoomDefault": Double(BrowserZoom.defaultZoom()),
            "browserZoomRememberSite": BrowserZoom.remembersPerSite(),
            "browserTabSleepMinutes": BrowserTabs.sleepMinutes(),
        ]
    }

    private func pushPrefs() {
        guard let data = try? JSONSerialization.data(withJSONObject: prefsPayload()),
              let json = String(data: data, encoding: .utf8) else { return }
        windowController.pushHostCommand("prefs", payload: json)
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
    private func beginHotkeyRecording() {
        let recorder = HotkeyRecorderWindow()
        recorder.onResult = { [weak self] spec in
            guard let self else { return }
            guard let spec else {
                self.windowController.pushHostCommand("hotkeyRecordingEnded", payload: "{}")
                return
            }
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

    // MARK: - 主菜单（结构在 MainMenu.swift，这里只放动作实现）

    private func installMainMenu() {
        MainMenu.install(app: NSApp, target: self, window: windowController)
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
        // 状态推给 SPA：壳的退避重试/放弃只有壳知道，不推的话前端永远显示
        // "正在重试…"（旧实现：放弃重试后界面还是同一句话，没有原因也没有重试入口）。
        pushEngineState(state)
        switch state {
        case .ready(let url):
            BridgeServer.shared.setEngine(url)
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
        supervisor.stop()
        // Engine binds workspace committed at process start (sandbox root = cwd).
        let newSupervisor = EngineSupervisor(home: AppPaths.harnessHome, workspace: config.workspaceURL)
        newSupervisor.onState = { [weak self] state in self?.handleEngineState(state) }
        supervisor = newSupervisor
        newSupervisor.start()
    }
}
