import Darwin
import Foundation

/// Supervises the `dsh` child process: spawn, parse the `dsh web:` URL,
/// graceful restart with exponential backoff, recovery signal after repeated
/// failures. The shell never talks business data to the engine — only the
/// boot URL and the lifecycle.
final class EngineSupervisor {
    enum State: Equatable {
        case idle
        case launching
        case ready(URL)
        case restarting(attempt: Int)
        case failed(reason: String)
    }

    /// Entry shape (SPEC-ENGINE-RUNTIME §3.4): bundled runs `node bin.js …`,
    /// single runs one executable directly. The shape decides spawn arguments,
    /// PATH injection and which failure copy the recovery surface shows.
    enum Entry {
        case bundled(node: URL, script: URL)
        case single(URL)
    }

    var onState: ((State) -> Void)?

    private(set) var state: State = .idle {
        didSet {
            guard state != oldValue else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onState?(self.state)
            }
        }
    }

    private var process: Process?
    private var stopping = false
    private var attempts = 0
    /// 最近一次就绪时刻（AUD-074：存活满 readyGrace 的运行才清零退避计数）。
    private var readyAt: Date?
    /// 秒崩判定窗：就绪后存活不足此秒数即退出的重启计入连续失败。
    private static let readyGraceSeconds: TimeInterval = 300
    private var restartWorkItem: DispatchWorkItem?
    private var stdoutBuffer = Data()
    private let home: URL
    private let workspace: URL
    private let log = EngineLog.shared

    /// 引擎 cwd（=sandbox-policy.workspaceRoot 默认）解析顺序：显式配置 →
    /// harness 存储里已注册的首个空间 → 新用户兜底 ~/DeepDive。
    /// 绝不落到用户主目录：home 做工作区会让引擎的 @ 文件索引递归扫全盘
    /// 家目录，逐保护区触发 TCC 授权弹窗（音乐/照片/其他App数据，
    /// PITFALLS §4.13），且沙箱根过大。
    /// 兜底目录同样**不放进 ~/Documents**：那是受保护目录，首启在这里建目录会
    /// 弹「DeepDive 想访问文稿」系统框——而它发生在主窗口建出之前的主线程上，
    /// 用户忽略就卡住整个启动、点了拒绝引擎则连 cwd 都进不去（§4.8 /§7.1.2）。
    /// ~/DeepDive 不收系统授权，首启全程无弹窗；已注册过工作区的用户不受影响
    /// （走上一级 workspace.json）。
    static func resolveLaunchWorkspace(explicit: URL?, home: URL) -> URL {
        if let explicit { return explicit }
        if let first = firstRegisteredWorkspace(home: home) { return first }
        let fallback = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("DeepDive", isDirectory: true)
        try? FileManager.default.createDirectory(at: fallback, withIntermediateDirectories: true)
        return fallback
    }

    /// harness 存储 workspace.json 的首个注册空间（global.workspaceIds[0] →
    /// tables.workspaces[id].path，UI 同序）；文件缺失/损坏/无注册/路径无效
    /// 一律回 nil。
    static func firstRegisteredWorkspace(home: URL) -> URL? {
        let url = home.appendingPathComponent("storages/workspace.json")
        guard let data = try? Data(contentsOf: url),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let firstId = ((root["global"] as? [String: Any])?["workspaceIds"] as? [String])?.first,
              let row = ((root["tables"] as? [String: Any])?["workspaces"] as? [String: Any])?[firstId] as? [String: Any],
              let path = row["path"] as? String, !path.isEmpty else { return nil }
        let dir = URL(fileURLWithPath: path, isDirectory: true)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else { return nil }
        return dir
    }

    init(home: URL, workspace: URL?) {
        self.home = home
        self.workspace = Self.resolveLaunchWorkspace(explicit: workspace, home: home)
    }

    func start() {
        stopping = false
        // 手动启动/重启＝重新给满重试窗口。旧实现只在"稳定运行 300s"后清零，于是
        // 放弃之后用户点重试，一次失败就是第 4 次 → 立刻再次 failed，退避形同虚设。
        // 自愈路径走 spawn()，不经这里，所以清零只影响手动动作。
        attempts = 0
        // AUD-070：手动启动/重启必须先取消挂起的退避重启项——退避窗内本函数
        // spawn 一次、定时器稍后再 spawn 一次，会得到双引擎孤儿进程共用
        // DSH_HOME（会话写入交错，恰是单实例锁要防的事）。运行中调用则是
        // no-op（process 守卫）。
        restartWorkItem?.cancel()
        restartWorkItem = nil
        guard process == nil else { return }
        // 壳被强杀过（上一条 pid 还活着）：先收掉它，再起新的——同一份 DSH_HOME
        // 同时被两个引擎写，会话会交错。
        Self.reapLeftoverEngine()
        if !FileManager.default.fileExists(
            atPath: home.appendingPathComponent(".credentials.yaml").path
        ) {
            // 引擎照常启动（引擎侧容忍缺凭据并 watch 凭据文件热发布）：
            // 设置页的 credentials.set 是引擎 RPC，不启动引擎就永远无法
            // 配出第一把 Key——拒启会把冷启动闭环焊死（PITFALLS §5.6）。
            log.append("[engine] credentials missing at \(home.appendingPathComponent(".credentials.yaml").path) — starting anyway; configure the key in settings (credentials.set).")
        }
        spawn()
    }

    /// 收掉引擎：SIGTERM →（等它走）→ SIGKILL。
    /// 旧实现发完 SIGTERM 就把引用丢了、不等待：SIGTERM 被忽略或卡住的引擎就此
    /// 变成孤儿，继续占着 DSH_HOME 写会话——下次启动就是两个引擎交错写同一份存储
    /// （单实例锁想防的正是这件事）。等待有上限（引擎正常是毫秒级退出）。
    func stop() {
        stopping = true
        restartWorkItem?.cancel()
        restartWorkItem = nil
        guard let proc = process else { state = .idle; return }
        process = nil
        proc.terminate()
        let deadline = Date().addingTimeInterval(Self.stopGraceSeconds)
        while proc.isRunning, Date() < deadline {
            usleep(20_000)
        }
        if proc.isRunning {
            log.append("[engine] did not exit on SIGTERM within \(Self.stopGraceSeconds)s; SIGKILL")
            kill(proc.processIdentifier, SIGKILL)
            proc.waitUntilExit()
        }
        Self.clearPidFile()
        state = .idle
    }

    /// SIGTERM 之后等它自己走的宽限。实测空闲时 0.78s 退出，但忙时（一轮在跑、
    /// 投影缓存正在落盘）见过 >2s——SIGKILL 打断写盘会截断会话日志，所以宁可多等。
    /// 它一退出就立刻返回，所以正常退出不受这个上限影响。
    private static let stopGraceSeconds: TimeInterval = 6

    /// 引擎 pid 文件：壳被强杀（Force Quit / SIGKILL）时进程不会走 stop()，
    /// 留下的引擎靠它在下一次启动时被收掉。
    static var enginePidFile: URL { AppPaths.supportDir.appendingPathComponent("engine.pid") }

    private static func clearPidFile() {
        try? FileManager.default.removeItem(at: enginePidFile)
    }

    /// 收掉上一次运行残留的引擎（壳被强杀才会出现）。**先核对可执行路径**再动手：
    /// pid 会被复用，不看身份就 kill 可能误杀无关进程。
    static func reapLeftoverEngine() {
        guard let raw = try? String(contentsOf: enginePidFile, encoding: .utf8),
              let pid = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)) else { return }
        defer { clearPidFile() }
        guard kill(pid, 0) == 0 else { return } // 已经死了
        var buffer = [UInt8](repeating: 0, count: Int(MAXPATHLEN))
        let n = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard n > 0 else { return }
        let path = String(decoding: buffer[0..<Int(n)], as: UTF8.self)
        // 身份核对：必须是我们的随包 node（或外部 dsh）在跑引擎脚本
        guard path.contains(".app/Contents/Resources/Runtime/") || path.hasSuffix("/bin/node") else {
            EngineLog.shared.append("[engine] leftover pid \(pid) has unexpected image \(path); leaving it alone")
            return
        }
        EngineLog.shared.append("[engine] reaping leftover engine pid \(pid) (\(path))")
        kill(pid, SIGTERM)
        let deadline = Date().addingTimeInterval(stopGraceSeconds)
        while kill(pid, 0) == 0, Date() < deadline { usleep(20_000) }
        if kill(pid, 0) == 0 { kill(pid, SIGKILL) }
    }

    // MARK: - entry resolution

    /// Priority (SPEC-ENGINE-RUNTIME §3.4): explicit `DSHMINI_DSH_ENTRY` is
    /// the strongest override (must beat bundled, or cross-version A/B testing
    /// in §5 could not force a system dsh) → bundled node+bin.js → usual
    /// system locations → `PATH`.
    ///
    /// 版本门（0.1.5 会话格式 V3 单行道）：
    /// - bundled 完整 → 只用 bundled，绝不回落系统；
    /// - bundled 残缺 → 拒启（重装），禁止静默换系统 dsh（`spawn` 拦下）；
    /// - 无 bundled 时的系统/PATH 入口 → 版本必须与 `EngineVersion.pinnedVersion`
    ///   逐字一致，否则拒启；
    /// - `DSHMINI_DSH_ENTRY` 允许异版本（开发对照），但对生产 home 高危，仅告警。
    /// `failure` = 找到了入口但被版本门拒启（Failure 须为 Error：String 不是，
    /// 包一层）。
    private struct EntryRejection: Error { let message: String }

    private func resolveEntry() -> Result<Entry, EntryRejection> {
        let env = ProcessInfo.processInfo.environment["DSHMINI_DSH_ENTRY"]
        if let env, FileManager.default.isExecutableFile(atPath: env) {
            let url = URL(fileURLWithPath: env)
            let pin = EngineVersion.pinnedVersion
            let found = EngineVersion.probeExecutableVersion(url)
            if let pin, let found, found != pin {
                log.append("[engine] DSHMINI_DSH_ENTRY version \(found) != pinned \(pin) (dev override; isolate with DSHMINI_SUPPORT_DIR)")
            }
            return .success(.single(url))
        }
        if case .complete(let bundled) = bundledRuntimeState() {
            return .success(bundled)
        }
        // Launchd-launched GUI apps inherit a minimal PATH; always probe the
        // usual Homebrew locations before falling back to `env dsh`.
        var external: URL?
        let candidates = [
            "/opt/homebrew/bin/dsh",
            "/usr/local/bin/dsh",
            "/usr/bin/dsh",
        ]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            external = URL(fileURLWithPath: c)
            break
        }
        if external == nil { external = whichDsh() }
        guard let external else {
            return .failure(EntryRejection(message: "未找到 dsh。\n\n请重新安装 DeepDive（随包引擎），或安装 dsh：\nnpm i -g @deepseek-ai/dsh"))
        }
        let pin = EngineVersion.pinnedVersion
        let found = EngineVersion.probeExecutableVersion(external)
        if let gate = EngineVersion.gateNonBundled(pin: pin, found: found, path: external.path) {
            log.append("[engine] external entry rejected: \(external.path) version=\(found ?? "unknown") pin=\(pin ?? "unknown")")
            return .failure(EntryRejection(message: gate))
        }
        return .success(.single(external))
    }

    /// bundled 运行时三态：完整 / 残缺（已嵌入但缺一半）/ 未嵌入。
    private enum BundledRuntime {
        case complete(Entry)
        case damaged(nodeOK: Bool, scriptOK: Bool)
        case absent
    }

    /// Bundled layout: `Contents/Resources/Runtime/node` + `Contents/Resources/
    /// Runtime/dsh/lib/bin.js`. node 绝不能放进 `Contents/MacOS/`——该目录下的
    /// 可执行文件会被 Launch Services 当成同 bundle 的第二个 app，引擎一拉起
    /// Dock 就闪出独立的 node 图标/窗口（2026-09-10 用户实测）。
    /// 残缺（任一半在）与未嵌入（两半全不在）必须区分：残缺要按「重装」拒启，
    /// 未嵌入才允许走外部入口。
    private func bundledRuntimeState() -> BundledRuntime {
        guard let resources = Bundle.main.resourceURL else { return .absent }
        let node = resources.appendingPathComponent("Runtime/node")
        let script = resources.appendingPathComponent("Runtime/dsh/lib/bin.js")
        let nodeOK = FileManager.default.isExecutableFile(atPath: node.path)
        let scriptOK = FileManager.default.fileExists(atPath: script.path)
        if nodeOK && scriptOK { return .complete(.bundled(node: node, script: script)) }
        let runtimeDir = resources.appendingPathComponent("Runtime/dsh")
        guard nodeOK || FileManager.default.fileExists(atPath: runtimeDir.path) else { return .absent }
        return .damaged(nodeOK: nodeOK, scriptOK: scriptOK)
    }

    private func whichDsh() -> URL? {
        guard let path = ProcessInfo.processInfo.environment["PATH"] else { return nil }
        for dir in path.split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(dir)).appendingPathComponent("dsh")
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    private var lastEntry: Entry?

    // MARK: - spawn

    private func spawn() {
        // 幂等守卫（AUD-070）：restartWorkItem 的闭包直达此处，不经 start()
        // 的 process 检查——已有活进程时再 spawn 只会覆盖引用留下孤儿。
        guard process == nil else { return }
        if case .damaged(let nodeOK, let scriptOK) = bundledRuntimeState() {
            log.append("[engine] refusing fallback: bundled runtime damaged (node=\(nodeOK) bin.js=\(scriptOK))")
            state = .failed(reason: EngineVersion.incompleteBundleCopy(nodeOK: nodeOK, scriptOK: scriptOK))
            return
        }
        let entry: Entry
        switch resolveEntry() {
        case .success(let value):
            entry = value
        case .failure(let rejection):
            log.append("[engine] entry rejected: \(rejection.message.replacingOccurrences(of: "\n", with: " | "))")
            state = .failed(reason: rejection.message)
            return
        }
        lastEntry = entry

        var environment = ProcessInfo.processInfo.environment
        switch entry {
        case .bundled(let node, _):
            // The runtime's own child processes need the bundled toolchain on
            // PATH (aligned with the reference host).
            var path = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
            let nodeDir = node.deletingLastPathComponent().path
            if !path.contains(nodeDir) {
                path = nodeDir + ":" + path
            }
            environment["PATH"] = path
        case .single:
            var path = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
            for dir in ["/opt/homebrew/bin", "/usr/local/bin"] where !path.contains(dir) {
                path = dir + ":" + path
            }
            environment["PATH"] = path
        }
        environment["DSH_HOME"] = home.path
        // EverOS 记忆插件（若挂载）的自动启动：uv tool 的默认装法不在引擎 PATH 上，
        // 给插件传绝对路径启动命令；二进制缺席时不注入（插件 fail-open，不挡引擎）。
        let everos = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin/everos")
        if FileManager.default.isExecutableFile(atPath: everos.path) {
            environment["EVEROS_DSH_START_COMMAND"] = everos.path + " server start"
        }
        // EverOS 提取要自己调 LLM（独立进程，读不到引擎的凭据服务）：用户没在
        // ~/.everos/everos.toml 里配过 api_key 时，把引擎同一把 key 交给它——
        // 范式见 EverOSKeyBridge。注入进环境，EverOS 服务由插件派生、继承此环境。
        let support = AppPaths.harnessHome
        let credentials = try? String(contentsOf: support.appendingPathComponent(".credentials.yaml"), encoding: .utf8)
        let everosToml = try? String(contentsOf: FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".everos/everos.toml"), encoding: .utf8)
        if let key = EverOSKeyBridge.resolveApiKey(credentialsYaml: credentials, everosToml: everosToml) {
            environment["EVEROS_LLM__API_KEY"] = key
        } else if everosToml == nil {
            log.append("[engine] everos.toml not found; EverOS extraction key not bridged")
        }
        // 遥测口径（SPEC-SEMANTICS：客户端默认关闭）：引擎 base 默认
        // FEEDBACK_ONLY，与产品语义冲突——壳显式注入 DISABLED 收口。
        environment["DSH_TELEMETRY_MODE"] = "DISABLED"

        // Engine cwd = 启动工作区。**安全边界不在这里**：沙箱根按会话取
        // session.header.cwd（= 该会话所属工作区），引擎进程 cwd 只是没有会话
        // 上下文时的兜底根（agentless 调用）与 @ 文件索引的扫描根——PITFALLS
        // §4.13 那场 TCC 弹窗风暴就是它扫到家目录引起的。
        // 解析顺序见 resolveLaunchWorkspace——init 时已定，不再回落 home。
        let cwd = workspace.path

        let process = Process()
        Self.ensureAutomationSkill()
        let retired = SkillAdmin.removeRetired(in: home)
        if !retired.isEmpty { log.append("[engine] dropped retired skills: \(retired.joined(separator: ", "))") }
        let patchArg = Self.ensureEnginePatchFile()
        // 部署提示词落 AGENTS.md（不是 overlay 的 personaPrefix——那条路被 agent preset
        // 遮蔽，见 DeploymentPrompt 的头注与 PITFALLS §7.7）。
        DeploymentPrompt.ensureInstalled(in: home)
        switch entry {
        case .bundled(let node, let script):
            process.executableURL = node
            process.arguments = [script.path, "--profile", "web", "--patch", patchArg.path, "--no-open", "--port", "0"]
        case .single(let url):
            process.executableURL = url
            process.arguments = ["--profile", "web", "--patch", patchArg.path, "--no-open", "--port", "0"]
        }
        // MCP server 的密钥经环境变量交给引擎：patch 里只写
        // `!!js process.env.MCP_<SERVER>_<KEY>` 这个引用，值本身不落 patch 文件
        // （MCP client 的挂载形状即如此，见 McpServerAdmin.environment）。
        for (key, value) in McpServerAdmin.environment(in: AppPaths.supportDir) {
            environment[key] = value
        }
        process.environment = environment
        process.currentDirectoryURL = URL(fileURLWithPath: cwd, isDirectory: true)

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.handleExit(proc) }
        }

        state = .launching
        switch entry {
        case .bundled(let node, let script):
            log.append("[engine] launching bundled: \(node.path) \(script.path) --profile web --patch \(patchArg.path) --no-open --port 0")
        case .single(let url):
            log.append("[engine] launching \(url.path) --profile web --patch \(patchArg.path) --no-open --port 0")
        }
        log.append("[engine] DSH_HOME=\(home.path) cwd=\(cwd)")

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                // EOF: availableData stays empty forever; without nil-ing the
                // handler dispatch re-fires it in a busy loop (PITFALLS §4.4).
                handle.readabilityHandler = nil
                return
            }
            self?.consume(data)
        }

        do {
            try process.run()
            self.process = process
            // pid 落盘必须在 run() 之后（此前 processIdentifier 还是 0）
            try? "\(process.processIdentifier)".write(to: Self.enginePidFile, atomically: true, encoding: .utf8)
        } catch {
            log.append("[engine] launch failed: \(error.localizedDescription)")
            state = .failed(reason: launchFailureCopy(entry, error: error))
        }
    }

    /// The overlay patch file handed to `dsh --profile web --patch <path>`
    /// (docs/DSH-WIRE.md §1). The engine's base bundle ships session-query
    /// with full-text search ready since 0.1.2-rc.1, so the overlay's jobs are
    /// inserting the schedule tool plugin (present in the runtime closure but
    /// not composed into the web profile's bundles) and installing the
    /// deployment system prompt that teaches the conversation-side automation
    /// protocol. Content is app-defined — rewritten on every launch so upgrades
    /// always win; a write failure degrades to those two capabilities being
    /// unavailable (the engine still boots: overlay errors fail-loud, so only a
    /// missing file is tolerable — it must exist, else the arg points nowhere).
    static func ensureEnginePatchFile() -> URL {
        let url = AppPaths.supportDir.appendingPathComponent("engine-patch.yml")
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? enginePatchBody()
            .write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// Overlay 正文（纯函数，单测钉子）：写坏了引擎会在 boot 时 fail-loud 起不来。
    ///
    /// **不写 `system-prompt` 的 personaPrefix**：那条路被 agent preset 的
    /// `dsh-persona` 遮蔽、到不了模型（PITFALLS §7.7 实测），而且它对 config 是整体
    /// 替换，还会顺手打掉 web 层设的 personaSuffix。部署提示词改落
    /// `<DSH_HOME>/AGENTS.md`（`DeploymentPrompt`）。
    static func enginePatchBody() -> String {
        """
        # Written by DeepDive at every engine launch — app-owned overlay layer.
        # Do not edit: your changes are overwritten on the next launch.
        - insert:
            - id: schedule
              name: '@deepseek-ai/dsh-schedule'
        """
    }

    /// The skill that carries the conversation-side automation protocol. Written on
    /// every launch into the engine's user skill root (<DSH_HOME>/skills/<name>/
    /// SKILL.md, discovered by @deepseek-ai/dsh-skill-filesystem); frontmatter must
    /// stay valid — a malformed file is only a warning in the engine log and the
    /// skill silently disappears (name + description are mandatory).
    static let automationSkillName = "deepdive-automation"

    static let automationSkillMarkdown = #"""
    ---
    name: deepdive-automation
    description: Propose or update a DeepDive scheduled task (a recurring automation that runs on its own schedule; each run opens a fresh chat unless the task reuses one). Use when the user asks for something that should run every day / every weekday / every N hours / at a fixed time, or asks to change or pause such a task. Not for one-off reminders inside this conversation — those use the schedule tools.
    ---

    # DeepDive scheduled tasks

    The DeepDive app keeps its own task list (Settings → Automation). You cannot write it:
    you propose a task, the app renders your proposal as a card, and the user confirms it
    in a form. Never claim a task was created or is already running.

    ## How to propose

    Reply with a fenced code block whose info string is `automation` and whose body is
    exactly one JSON object (no other text inside the fence):

    ````text
    ```automation
    {"title":"提交与风险扫描","instruction":"<what the agent does on each run>","schedule":{"kind":"weekdays","hour":9,"minute":0},"workspace":"<workspace folder name, optional>","permission":"read-only"}
    ```
    ````

    Fields:

    - `title` (required) — short name shown on the card.
    - `instruction` (required) — the prompt sent on each run. Write it self-contained: a task
      that opens a fresh chat has no memory of this conversation. Say explicitly whether the
      run may write (`只读分析：不要修改文件`) or not.
    - `schedule` (required) — one of the shapes below. Times are the user's local time.
    - `workspace` (optional) — the workspace **folder name** (e.g. `DSHmini`). Omit to use the
      workspace the user is in.
    - `permission` (optional) — a permission preset key: `read-only`, `workspace-write`, or
      `danger-full-access`. Prefer `read-only` for analysis-only tasks.

    ## Schedules

    - `{"kind":"hourly","minute":0}` — every hour at :00
    - `{"kind":"daily","hour":9,"minute":0}` — every day at 09:00
    - `{"kind":"weekdays","hour":9,"minute":0}` — every weekday at 09:00
    - `{"kind":"weekly","weekday":1,"hour":9,"minute":0}` — weekly, 0=Sunday … 6=Saturday
    - `{"kind":"monthly","day":1,"hour":9,"minute":0}` — monthly on a day of month
    - `{"kind":"custom","everyDays":3,"hour":9,"minute":0}` — every N days at a time

    ## Rules

    - One JSON object per fence; several tasks means several fences.
    - Keep the block machine-readable: no comments, no trailing commas, no text inside the fence.
    - Changing an existing task means proposing the whole new version and saying what changed;
      you cannot edit or pause a task yourself.
    - "Remind me in 10 minutes" / "report to me here every 30 minutes" is not a scheduled task —
      that is a reminder inside this conversation: use the schedule tools.

    """#

    /// 铺 skill 到引擎的用户技能根（每次都重写：升级以应用内为准）。
    @discardableResult
    static func ensureAutomationSkill() -> URL {
        writeSkill(name: automationSkillName, markdown: automationSkillMarkdown)
    }

    private static func writeSkill(name: String, markdown: String) -> URL {
        let dir = AppPaths.harnessHome
            .appendingPathComponent("skills", isDirectory: true)
            .appendingPathComponent(name, isDirectory: true)
        let url = dir.appendingPathComponent("SKILL.md")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? markdown.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// Failure copy follows the entry source (SPEC-ENGINE-RUNTIME §3.4):
    /// a broken bundle means "reinstall the app"; a missing system dsh keeps
    /// the historic "install dsh" hint.
    private func launchFailureCopy(_ entry: Entry, error: Error) -> String {
        if let mismatch = Self.archMismatchCopy(error) { return mismatch }
        switch entry {
        case .bundled:
            return "引擎程序不完整或无法执行（bundled runtime）。\n\n请重新安装 DeepDive。\n\n技术信息：\(error.localizedDescription)"
        case .single(let url):
            let isOverride = url.path != "/opt/homebrew/bin/dsh"
                && url.path != "/usr/local/bin/dsh"
                && url.path != "/usr/bin/dsh"
            if isOverride {
                return "无法启动引擎（\(url.path)）：\(error.localizedDescription)\n\n请检查 DSHMINI_DSH_ENTRY 指向的 dsh 是否可用。"
            }
            return "无法启动引擎：\(error.localizedDescription)\n\n请确认已安装 dsh：\nnpm i -g @deepseek-ai/dsh"
        }
    }

    /// EBADARCH（strerror(86) = "Bad CPU type in executable"）＝ 随包运行时不是
    /// 本机架构：`prepare-node-runtime.sh` 按**构建机**架构取 node，所以在 Intel
    /// Mac 上跑到这段的包必然是 arm64-only 的（PITFALLS §5.8 同族：分发包成立与否
    /// 从没在目标机上端到端验证过）。这与「包不完整」无关，报成「请重新安装」会让
    /// 用户重装到底也起不来——照实说清。nil = 不是这个原因，交给调用方原有文案。
    /// 纯函数，回归钉在 EngineSupervisorTests（Intel 用户看到的就是这句话）。
    static func archMismatchCopy(_ error: Error) -> String? {
        guard let posix = error as? POSIXError, posix.code == .EBADARCH else { return nil }
        return "此分发包只带 Apple 芯片（arm64）的引擎运行时，无法在这台 Mac（Intel 处理器）上启动。\n\n请在 Apple 芯片的 Mac 上使用 DeepDive。"
    }

    private func consume(_ data: Data) {
        stdoutBuffer.append(data)
        for line in Self.drainLines(&stdoutBuffer) { handleLine(line) }
    }

    /// Byte-level line drain (pure, unit-tested): complete lines split on the
    /// `\n` byte, each decoded on its own. A torn multi-byte UTF-8 sequence can
    /// only sit at the buffer tail (the engine writes line-buffered), so the
    /// tail simply waits for more bytes — decoding the WHOLE buffer used to
    /// fail on that tail and drop every buffered line, readiness line included
    /// (AUD-018). A complete-but-undecodable line is dropped alone; one bad
    /// line must not kill the stream.
    static func drainLines(_ buffer: inout Data) -> [String] {
        var lines: [String] = []
        while let nl = buffer.firstIndex(of: 0x0A) {
            let lineData = Data(buffer[buffer.startIndex..<nl])
            buffer.removeSubrange(buffer.startIndex...nl)
            if let line = String(data: lineData, encoding: .utf8) { lines.append(line) }
        }
        return lines
    }

    private func handleLine(_ line: String) {
        // AUD-077：就绪行原样携带 boot token（query），落日志前剥掉——
        // engine.log 是常驻磁盘文件，凭据不进日志。
        let sanitized = line.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? line
        log.append("[dsh] " + sanitized)
        let prefix = "dsh web: "
        if line.hasPrefix(prefix) {
            // 引擎可能在 URL 后追加 " (LAN: …)" 备选地址；就绪 URL 只取首个
            // 空白前的 token，整行交给 URL(string:) 会因空格解析失败丢就绪。
            let raw = line.dropFirst(prefix.count).split(separator: " ", maxSplits: 1).first.map(String.init) ?? ""
            if let url = URL(string: raw) {
                // AUD-074：就绪不再立即清零 attempts——「就绪后秒崩」循环会
                // 因此永远以 1s 间隔重启、无升级 failed 的路径。改为记录就绪
                // 时刻，退出时存活满 readyGrace 才算真恢复（见 handleExit）。
                readyAt = Date()
                state = .ready(url)
                log.append("[engine] ready: \(sanitized.dropFirst(prefix.count))")
            }
        }
    }

    private func handleExit(_ proc: Process) {
        guard proc === process else { return }
        process = nil
        if stopping { return }

        // 存活满 readyGrace 的运行才把退避计数清零；秒崩循环会累积到 3 次升级 failed。
        let uptime = readyAt.map { Date().timeIntervalSince($0) } ?? 0
        if uptime >= Self.readyGraceSeconds { attempts = 0 }
        attempts += 1
        if attempts >= 3 {
            log.append("[engine] failed after \(attempts) consecutive attempts")
            let extra: String
            switch lastEntry {
            case .bundled:
                extra = "\n\nbundled 引擎连续崩溃，可能是程序不完整——请尝试重新安装 DeepDive。"
            default:
                extra = ""
            }
            state = .failed(reason: "引擎连续启动失败（\(attempts) 次）。\n请查看日志后点「重试」。\n\(extra)")
            return
        }

        let delay = min(30.0, pow(2.0, Double(attempts - 1)))
        state = .restarting(attempt: attempts)
        // 退出原因要落日志：静默 SIGKILL（签名/TCC 一类）与引擎自己报错退出
        // 长得一模一样——都是"零输出 + 退出"，没有这一行就查不出是哪种。
        let reason = proc.terminationReason == .uncaughtSignal
            ? "signal \(proc.terminationStatus)"
            : "status \(proc.terminationStatus)"
        log.append("[engine] exited (\(reason)); restart in \(Int(delay))s (attempt \(attempts))")

        let item = DispatchWorkItem { [weak self] in
            self?.spawn()
        }
        restartWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }
}

// 本文件已过 300 行红线，新引擎侧逻辑另开文件（AUD-083）
