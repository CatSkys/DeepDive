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
    /// harness 存储里已注册的首个空间 → 新用户兜底 ~/Documents/DeepDive。
    /// 绝不落到用户主目录：home 做工作区会让引擎的 @ 文件索引递归扫全盘
    /// 家目录，逐保护区触发 TCC 授权弹窗（音乐/照片/其他App数据，
    /// PITFALLS §4.13），且沙箱根过大。
    static func resolveLaunchWorkspace(explicit: URL?, home: URL) -> URL {
        if let explicit { return explicit }
        if let first = firstRegisteredWorkspace(home: home) { return first }
        let fallback = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("DeepDive", isDirectory: true)
            ?? home.appendingPathComponent("workspace", isDirectory: true)
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
        // AUD-070：手动启动/重启必须先取消挂起的退避重启项——退避窗内本函数
        // spawn 一次、定时器稍后再 spawn 一次，会得到双引擎孤儿进程共用
        // DSH_HOME（会话写入交错，恰是单实例锁要防的事）。运行中调用则是
        // no-op（process 守卫）。
        restartWorkItem?.cancel()
        restartWorkItem = nil
        guard process == nil else { return }
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

    func stop() {
        stopping = true
        restartWorkItem?.cancel()
        restartWorkItem = nil
        process?.terminate()
        process = nil
        state = .idle
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
        // 遥测口径（SPEC-SEMANTICS：客户端默认关闭）：引擎 base 默认
        // FEEDBACK_ONLY，与产品语义冲突——壳显式注入 DISABLED 收口。
        environment["DSH_TELEMETRY_MODE"] = "DISABLED"

        // Engine cwd = workspace root: sandbox-policy.workspaceRoot defaults to
        // process.cwd(), so workspace choice is the safety boundary (SPEC §4.2).
        // 解析顺序见 resolveLaunchWorkspace——init 时已定，不再回落 home。
        let cwd = workspace.path

        let process = Process()
        let patchArg = Self.ensureEnginePatchFile()
        switch entry {
        case .bundled(let node, let script):
            process.executableURL = node
            process.arguments = [script.path, "--profile", "web", "--patch", patchArg.path, "--no-open", "--port", "0"]
        case .single(let url):
            process.executableURL = url
            process.arguments = ["--profile", "web", "--patch", patchArg.path, "--no-open", "--port", "0"]
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
        } catch {
            log.append("[engine] launch failed: \(error.localizedDescription)")
            state = .failed(reason: launchFailureCopy(entry, error: error))
        }
    }

    /// The overlay patch file handed to `dsh --profile web --patch <path>`
    /// (docs/DSH-WIRE.md §1). The engine's base bundle ships session-query
    /// with full-text search ready since 0.1.2-rc.1, so the overlay's one
    /// job is inserting the schedule tool plugin (present in the runtime
    /// closure but not composed into the web profile's bundles). Content is
    /// app-defined — rewritten on every launch so upgrades always win; a
    /// write failure degrades to the schedule tool being unavailable (the
    /// engine still boots: overlay errors fail-loud, so only a missing file
    /// is tolerable — it must exist, else the arg points nowhere).
    static func ensureEnginePatchFile() -> URL {
        let url = AppPaths.supportDir.appendingPathComponent("engine-patch.yml")
        var body = """
        # Written by DeepDive at every engine launch — app-owned overlay layer.
        # Do not edit: your changes are overwritten on the next launch.
        - insert:
            - id: schedule
              name: '@deepseek-ai/dsh-schedule'
        """
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? body.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// Failure copy follows the entry source (SPEC-ENGINE-RUNTIME §3.4):
    /// a broken bundle means "reinstall the app"; a missing system dsh keeps
    /// the historic "install dsh" hint.
    private func launchFailureCopy(_ entry: Entry, error: Error) -> String {
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
        log.append("[engine] exited; restart in \(Int(delay))s (attempt \(attempts))")

        let item = DispatchWorkItem { [weak self] in
            self?.spawn()
        }
        restartWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }
}

// 本文件已过 300 行红线，新引擎侧逻辑另开文件（AUD-083）
