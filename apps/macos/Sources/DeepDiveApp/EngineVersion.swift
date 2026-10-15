import Foundation

/// Engine version identity for the entry gate (SPEC-ENGINE-RUNTIME §3.4).
/// 管什么：读随包 pin、探测非 bundled 入口版本、给出拒启文案。
/// 不管什么：spawn 参数、失败面（在 SPA 内）、会话迁移。
enum EngineVersion {
    /// 随包引擎引脚：`scripts/dsh-runtime-version.txt` 由 project.yml 直接拷进
    /// bundle（唯一事实源，不复制版本值）。读资源而不是内嵌 runtime 的
    /// package.json——「未嵌入引擎」的构建（make dev）也必须能读出 pin，
    /// 否则版本门在唯一需要它的场景（无 bundled、只剩系统 dsh）里失效。
    static var pinnedVersion: String? {
        guard let url = Bundle.main.url(forResource: "dsh-runtime-version", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let version = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return version.isEmpty ? nil : version
    }

    /// 探测超时（秒）：外部入口挂住不能把调用方（主线程启动路径）焊死。
    static let probeTimeout: TimeInterval = 10

    /// `<executable> --version` 的版本 token。dsh 把版本打到 stderr、node +
    /// bin.js 打到 stdout，故两路合并进同一管道（单管道单读者，无 PITFALLS
    /// §4.11 的两管道互锁面）；合并后可能先出现包装脚本的警告行，所以不取
    /// 首 token，只认「数字开头」的 token。读管道放后台队列 + 截止时间：
    /// 到点 terminate 并按「版本未知」返回，不无限等 EOF。
    static func probeExecutableVersion(_ executable: URL) -> String? {
        let process = Process()
        process.executableURL = executable
        process.arguments = ["--version"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.environment = ProcessInfo.processInfo.environment
        do {
            try process.run()
        } catch {
            return nil
        }
        let done = DispatchSemaphore(value: 0)
        var data = Data()
        DispatchQueue.global(qos: .userInitiated).async {
            data = pipe.fileHandleForReading.readDataToEndOfFile()
            done.signal()
        }
        if done.wait(timeout: .now() + probeTimeout) == .timedOut {
            process.terminate()
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let text = String(data: data, encoding: .utf8) ?? ""
        return text.split(whereSeparator: { $0.isWhitespace })
            .first { $0.first?.isNumber == true }
            .map(String.init)
    }

    /// 会话格式单行道：非 bundled 入口必须与随包 pin 逐字一致，否则拒启。
    /// 开发对照走 `DEEPDIVE_DSH_ENTRY` + 隔离 `DEEPDIVE_SUPPORT_DIR`（SPEC §5），
    /// 不对生产 home 做“随便找个系统 dsh 凑合”的降级。`nil` = 放行。
    static func gateNonBundled(pin: String?, found: String?, path: String) -> String? {
        guard let pin, !pin.isEmpty else { return nil }
        guard let found, !found.isEmpty else {
            return """
            无法确认外部 dsh 的版本（\(path)）。\n\n\
            本应用随包引擎为 \(pin)。会话数据格式不可降级读取，已拒绝使用无法识别版本的入口。\n\n\
            请重新安装 DeepDive，或设置 DEEPDIVE_DSH_ENTRY 指向与随包同版本的 dsh（开发对照）。
            """
        }
        if found == pin { return nil }
        return """
        引擎版本不匹配：外部 dsh（\(path)）为 \(found)，本应用随包为 \(pin)。\n\n\
        会话数据格式升级后不可降级读取，混用旧引擎会导致会话打不开。\n\n\
        请重新安装 DeepDive（使用随包引擎），或设置 DEEPDIVE_DSH_ENTRY 指向 \(pin)。
        """
    }

    static func incompleteBundleCopy(nodeOK: Bool, scriptOK: Bool) -> String {
        """
        引擎程序不完整（node=\(nodeOK) bin.js=\(scriptOK)）。\n\n\
        为避免回落到系统 dsh 后把会话迁到不兼容格式，已拒绝启动。\n\n\
        请重新安装 DeepDive。
        """
    }
}
