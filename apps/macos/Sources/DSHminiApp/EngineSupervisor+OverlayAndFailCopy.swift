// EngineSupervisor 的「overlay 补丁装配 + 失败文案 + 行级解析」纯函数群（从
// EngineSupervisor.swift 拆出，行数棘轮）：这些成员不与引擎进程的任何监督
// 状态共享（静态/入参即全部依赖），单测直接钉住，抽成独立文件让监督状态机
// 本体保持可读。
import Foundation

extension EngineSupervisor {
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
        try? enginePatchBody(browserUse: installBrowserUseControlPlane())
            .write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// 装浏览器控制面（随包 BrowserUse → support）并返回路径；装不上就回 nil，组合里
    /// 少一行（引擎照常起，只是模型手里没有浏览器工具）。
    private static func installBrowserUseControlPlane() -> BrowserUseInstaller.Paths? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let bundled = resources.appendingPathComponent(BrowserUseInstaller.resourceDirName, isDirectory: true)
        return BrowserUseInstaller.ensureInstalled(in: AppPaths.supportDir, bundledDir: bundled)
    }

    /// Overlay 正文（纯函数，单测钉子）：写坏了引擎会在 boot 时 fail-loud 起不来。
    ///
    /// **不写 `system-prompt` 的 personaPrefix**：那条路被 agent preset 的
    /// `dsh-persona` 遮蔽、到不了模型（PITFALLS §7.7 实测），而且它对 config 是整体
    /// 替换，还会顺手打掉 web 层设的 personaSuffix。部署提示词改落
    /// `<DSH_HOME>/AGENTS.md`（`DeploymentPrompt`）。
    ///
    /// 浏览器行只在控制面装好了才写（路径每次启动重算，所以绝对路径写死在这里是安全的）。
    static func enginePatchBody(browserUse: BrowserUseInstaller.Paths? = nil) -> String {
        var rows = """
            - id: schedule
              name: '@deepseek-ai/dsh-schedule'
        """
        if let browserUse {
            rows += "\n" + BrowserUseInstaller.patchRow(paths: browserUse)
        }
        return """
        # Written by DeepDive at every engine launch — app-owned overlay layer.
        # Do not edit: your changes are overwritten on the next launch.
        - insert:
        \(rows)
        """
    }

    /// Failure copy follows the entry source (SPEC-ENGINE-RUNTIME §3.4):
    /// a broken bundle means "reinstall the app"; a missing system dsh keeps
    /// the historic "install dsh" hint.
    func launchFailureCopy(_ entry: Entry, error: Error) -> String {
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
}
