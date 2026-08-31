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

    // MARK: - internals

    private func resolveDshEntry() -> String {
        if let env = ProcessInfo.processInfo.environment["DSHMINI_DSH_ENTRY"],
           FileManager.default.isExecutableFile(atPath: env) {
            return env
        }
        // Launchd-launched GUI apps inherit a minimal PATH; always probe the
        // usual Homebrew locations before falling back to `env dsh`.
        let candidates = [
            "/opt/homebrew/bin/dsh",
            "/usr/local/bin/dsh",
            "/usr/bin/dsh",
        ]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            return c
        }
        return "dsh"
    }

    private func spawn() {
        var environment = ProcessInfo.processInfo.environment
        environment["DSH_HOME"] = home.path
        var path = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        for dir in ["/opt/homebrew/bin", "/usr/local/bin"] where !path.contains(dir) {
            path = dir + ":" + path
        }
        environment["PATH"] = path

        // Engine cwd = workspace root: sandbox-policy.workspaceRoot defaults to
        // process.cwd(), so workspace choice is the safety boundary (SPEC §4.2).
        let cwd = workspace?.path ?? FileManager.default.homeDirectoryForCurrentUser.path

        let process = Process()
        process.executableURL = URL(fileURLWithPath: resolveDshEntry())
        process.arguments = ["--profile", "web", "--no-open", "--port", "0"]
        process.environment = environment
        process.currentDirectoryURL = URL(fileURLWithPath: cwd, isDirectory: true)

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.handleExit(proc) }
        }

        state = .launching
        log.append("[engine] launching dsh --profile web --no-open --port 0")
        log.append("[engine] DSH_HOME=\(home.path) cwd=\(cwd)")

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                // EOF: without clearing the handler Foundation keeps invoking
                // it with empty reads — a busy spin for the process lifetime.
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
            state = .failed(reason: "无法启动引擎：\(error.localizedDescription)\n\n请确认已安装 dsh：\nnpm i -g @deepseek-ai/dsh")
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
            state = .failed(reason: "引擎连续启动失败（\(attempts) 次）。\n请查看日志后点「重试」。")
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
