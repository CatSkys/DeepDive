import Foundation

/// `@xmanrui/dsh-im` 插件（社区包，MIT）安装器：把随包分发的 IM 渠道插件装进
/// harness home 的 web profile（profiles/web），引擎启动时按 package.json 的
/// `dsh.profile.bundles` 自动加载，从而挂上各渠道的 HTTP 面
/// `POST /api/dsh-im/<渠道>`——设置页「移动端远程控制」的 Bot Channel 与
/// 机器人管理经桥接调用同一契约（形状见 docs/SPEC-MOBILE-REMOTE.md）。
///
/// 与 `ChatImportPlugin` 同一套纪律：幂等（已装且版本一致零写入）、保留用户
/// 自己的 profile bundles、失败不阻塞引擎启动（设置面按路由 404 自行降级）。
///
/// 与它不同的是**要整棵依赖闭包**：host 面是自包含 bundle，但各渠道在运行时
/// 动态 import qrcode / undici / dingtalk-stream 等 SDK，缺一个对应渠道就起不来
/// ——所以同步整棵 staged node_modules，而不是只拷插件目录。
enum BotChannelPlugin {
    private static let pluginName = "@xmanrui/dsh-im"
    private static let markerName = ".deepdive-dsh-im-version"

    static func ensureInstalled(in dshHome: URL, bundledDir: URL) {
        let profile = dshHome.appendingPathComponent("profiles/web", isDirectory: true)
        let fm = FileManager.default
        let modules = profile.appendingPathComponent("node_modules", isDirectory: true)
        let marker = profile.appendingPathComponent(markerName)
        let installed = (try? String(contentsOf: marker, encoding: .utf8)) ?? ""
        let expected = bundledVersion(in: bundledDir)
        // 已装且与随包版本一致 → 零写入。
        if !expected.isEmpty, installed.trimmingCharacters(in: .whitespacesAndNewlines) == expected,
           fm.fileExists(atPath: modules.appendingPathComponent("\(pluginName)/package.json").path) {
            return
        }
        guard !expected.isEmpty else {
            EngineLog.shared.append("[bot-channel] bundled plugin missing — skip install")
            return
        }

        do {
            try fm.createDirectory(at: modules, withIntermediateDirectories: true)

            // ① package.json：合并 bundles 与 dependencies（保留用户已有插件）。
            let packageURL = profile.appendingPathComponent("package.json")
            var config = (try? JSONSerialization.jsonObject(with: Data(contentsOf: packageURL))) as? [String: Any] ?? [:]
            var dsh = config["dsh"] as? [String: Any] ?? [:]
            var profileSpec = dsh["profile"] as? [String: Any] ?? [:]
            var bundles = profileSpec["bundles"] as? [String] ?? ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
            if !bundles.contains(pluginName) { bundles.append(pluginName) }
            profileSpec["bundles"] = bundles
            dsh["profile"] = profileSpec
            config["dsh"] = dsh
            config["name"] = config["name"] as? String ?? "dsh-profile-web"
            config["private"] = true
            var deps = config["dependencies"] as? [String: String] ?? [:]
            deps[pluginName] = "^\(expected)"
            config["dependencies"] = deps
            try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
                .write(to: packageURL, options: .atomic)

            // ② 整棵依赖闭包按随包版本刷新（逐项替换，不动不相关的包）。
            let bundledModules = bundledDir.appendingPathComponent("node_modules", isDirectory: true)
            let entries = (try? fm.contentsOfDirectory(at: bundledModules, includingPropertiesForKeys: nil)) ?? []
            for entry in entries {
                let target = modules.appendingPathComponent(entry.lastPathComponent)
                try? fm.removeItem(at: target)
                try fm.copyItem(at: entry, to: target)
            }

            try expected.write(to: marker, atomically: true, encoding: .utf8)
            EngineLog.shared.append("[bot-channel] plugin installed into \(profile.path) (v\(expected), \(entries.count) packages)")
        } catch {
            // 安装失败不阻塞引擎启动：设置面按渠道路由 404/503 自行降级隐藏。
            EngineLog.shared.append("[bot-channel] install failed: \(error.localizedDescription)")
        }
    }

    /// 随包插件版本（读 stage 内 package.json；缺失返回空串走"跳过安装"）。
    private static func bundledVersion(in bundledDir: URL) -> String {
        let url = bundledDir.appendingPathComponent("node_modules/\(pluginName)/package.json")
        guard let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let version = obj["version"] as? String else { return "" }
        return version
    }
}
