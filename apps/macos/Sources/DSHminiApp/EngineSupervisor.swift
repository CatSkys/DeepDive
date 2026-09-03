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
    private var restartWorkItem: DispatchWorkItem?
    private var stdoutBuffer = Data()
    private let home: URL
    private let workspace: URL?
    private let log = EngineLog.shared

    init(home: URL, workspace: URL?) {
        self.home = home
        self.workspace = workspace
    }

    func start() {
        stopping = false
        guard process == nil else { return }
        guard ensureCredentials() else { return }
        spawn()
    }

    /// The independent DSH_HOME must carry credentials for the engine to reach
    /// the LLM. Missing `.credentials.yaml` makes every turn resolve an empty
    /// assistant reply (silent). Fail loud instead of starting a dead engine.
    private func ensureCredentials() -> Bool {
        let creds = home.appendingPathComponent(".credentials.yaml")
        let ok = FileManager.default.fileExists(atPath: creds.path)
        if !ok {
            log.append("[engine] MISSING credentials at \(creds.path) — 无法调用 LLM（每轮将空回复）。请将 ~/.dsh/.credentials.yaml 复制到 DSHmini 的 harness home。")
            state = .failed(reason: "缺少 LLM 凭据：\(creds.path)\n\n请将 `~/.dsh/.credentials.yaml` 复制到 DSHmini 的 `\(home.path)`。")
            return false
        }
        return true
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
    /// system locations → `PATH`. `nil` only when everything is absent.
    private func resolveEntry() -> Entry? {
        let env = ProcessInfo.processInfo.environment["DSHMINI_DSH_ENTRY"]
        if let env, FileManager.default.isExecutableFile(atPath: env) {
            return .single(URL(fileURLWithPath: env))
        }
        if let bundled = bundledEntry() {
            return bundled
        }
        // Launchd-launched GUI apps inherit a minimal PATH; always probe the
        // usual Homebrew locations before falling back to `env dsh`.
        let candidates = [
            "/opt/homebrew/bin/dsh",
            "/usr/local/bin/dsh",
            "/usr/bin/dsh",
        ]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            return .single(URL(fileURLWithPath: c))
        }
        if let pathDsh = whichDsh() {
            return .single(pathDsh)
        }
        return nil
    }

    /// Bundled layout: `Contents/MacOS/node` + `Contents/Resources/Runtime/dsh
    /// /lib/bin.js`. A partial bundle (one side present, the other missing) is
    /// corruption and must surface as "reinstall", not as "install dsh".
    private func bundledEntry() -> Entry? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let node = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/node")
        let script = resources.appendingPathComponent("Runtime/dsh/lib/bin.js")
        let nodeOK = FileManager.default.isExecutableFile(atPath: node.path)
        let scriptOK = FileManager.default.fileExists(atPath: script.path)
        if nodeOK && scriptOK { return .bundled(node: node, script: script) }
        // Marker of an embedded-but-damaged bundle: either half present.
        let runtimeDir = resources.appendingPathComponent("Runtime/dsh")
        if FileManager.default.fileExists(atPath: runtimeDir.path) || nodeOK {
            log.append("[engine] bundled runtime incomplete (node=\(nodeOK) bin.js=\(scriptOK))")
        }
        return nil
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
        guard let entry = resolveEntry() else {
            log.append("[engine] no engine entry found (no env override, no bundled runtime, no system dsh)")
            state = .failed(reason: "未找到 dsh。\n\n请安装 dsh：\nnpm i -g @deepseek-ai/dsh")
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

        // Engine cwd = workspace root: sandbox-policy.workspaceRoot defaults to
        // process.cwd(), so workspace choice is the safety boundary (SPEC §4.2).
        let cwd = workspace?.path ?? FileManager.default.homeDirectoryForCurrentUser.path

        let process = Process()
        switch entry {
        case .bundled(let node, let script):
            process.executableURL = node
            process.arguments = [script.path, "--profile", "web", "--no-open", "--port", "0"]
        case .single(let url):
            process.executableURL = url
            process.arguments = ["--profile", "web", "--no-open", "--port", "0"]
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
            log.append("[engine] launching bundled: \(node.path) \(script.path) --profile web --no-open --port 0")
        case .single(let url):
            log.append("[engine] launching \(url.path) --profile web --no-open --port 0")
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

    /// Failure copy follows the entry source (SPEC-ENGINE-RUNTIME §3.4):
    /// a broken bundle means "reinstall the app"; a missing system dsh keeps
    /// the historic "install dsh" hint.
    private func launchFailureCopy(_ entry: Entry, error: Error) -> String {
        switch entry {
        case .bundled:
            return "引擎程序不完整或无法执行（bundled runtime）。\n\n请重新安装 DSHmini。\n\n技术信息：\(error.localizedDescription)"
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
        guard let text = String(data: stdoutBuffer, encoding: .utf8) else {
            stdoutBuffer.removeAll()
            return
        }
        var parts = text.split(separator: "\n").map(String.init)
        if !text.hasSuffix("\n"), let last = parts.popLast() {
            stdoutBuffer = Data(last.utf8)
        } else {
            stdoutBuffer.removeAll()
        }
        for line in parts { handleLine(line) }
    }

    private func handleLine(_ line: String) {
        log.append("[dsh] " + line)
        let prefix = "dsh web: "
        if line.hasPrefix(prefix) {
            let raw = line.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
            if let url = URL(string: raw) {
                attempts = 0
                state = .ready(url)
                log.append("[engine] ready: \(raw)")
            }
        }
    }

    private func handleExit(_ proc: Process) {
        guard proc === process else { return }
        process = nil
        if stopping { return }

        attempts += 1
        if attempts >= 3 {
            log.append("[engine] failed after \(attempts) consecutive attempts")
            let extra: String
            switch lastEntry {
            case .bundled:
                extra = "\n\nbundled 引擎连续崩溃，可能是程序不完整——请尝试重新安装 DSHmini。"
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
