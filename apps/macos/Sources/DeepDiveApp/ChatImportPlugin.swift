import Foundation

/// dsh-chat-import 插件（社区包，MIT）安装器：把随包分发的插件装进 harness
/// home 的 web profile（profiles/web），引擎启动时按 package.json 的
/// dsh.profile.bundles 自动加载，从而挂上 /api-import/* 面板路由——SPA 的
/// 「导入」设置页与首启欢迎页经桥接中继调用同一契约。
/// 幂等：已安装且版本一致时零写入；用户自己的 profile bundles 合并保留。
enum ChatImportPlugin {
    /// 也用于卸载面的"随包发布、不给卸载"判定（ProfilePluginAdmin）。
    static let pluginName = "dsh-chat-import"
    private static let dependencyName = "fzstd"

    /// 安装结果（EngineLog 用）。
    static func ensureInstalled(in dshHome: URL, bundledDir: URL) {
        let profile = dshHome.appendingPathComponent("profiles/web", isDirectory: true)
        let fm = FileManager.default
        let marker = profile.appendingPathComponent(".deepdive-chat-import-version")
        let expectedVersion = (try? String(contentsOf: marker, encoding: .utf8)) ?? ""
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let bundledVersion = bundledVersion(in: bundledDir)
        // 已安装且与随包版本一致 → 零写入。
        if !bundledVersion.isEmpty && expectedVersion == bundledVersion,
           fm.fileExists(atPath: profile.appendingPathComponent("node_modules/\(pluginName)/package.json").path) {
            return
        }

        do {
            try fm.createDirectory(at: profile.appendingPathComponent("node_modules"), withIntermediateDirectories: true)
            // ① package.json：合并 bundles（保留用户已有插件）与 dependencies。
            let packageURL = profile.appendingPathComponent("package.json")
            var config = (try? JSONSerialization.jsonObject(with: Data(contentsOf: packageURL))) as? [String: Any] ?? [:]
            var dsh = config["dsh"] as? [String: Any] ?? [:]
            var profileSpec = dsh["profile"] as? [String: Any] ?? [:]
            // 兜底元组 = 自有组合（ProfileComposer 先跑，正常不会走到这里）；
            // 写回上游两层会让引擎重新挂载上游产品。
            var bundles = profileSpec["bundles"] as? [String] ?? [ProfileComposer.bundleName]
            if !bundles.contains(pluginName) { bundles.append(pluginName) }
            profileSpec["bundles"] = bundles
            dsh["profile"] = profileSpec
            config["dsh"] = dsh
            config["name"] = config["name"] as? String ?? "dsh-profile-web"
            config["private"] = true
            var deps = config["dependencies"] as? [String: String] ?? [:]
            deps[pluginName] = "^\(bundledVersion)"
            config["dependencies"] = deps
            let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: packageURL, options: .atomic)

            // ② 插件包 + 运行时依赖（fzstd）整目录刷新（随包版本为准）。
            let target = profile.appendingPathComponent("node_modules/\(pluginName)")
            try? fm.removeItem(at: target)
            try fm.copyItem(at: bundledDir.appendingPathComponent(pluginName), to: target)
            let fzstdTarget = profile.appendingPathComponent("node_modules/\(dependencyName)")
            try? fm.removeItem(at: fzstdTarget)
            try fm.copyItem(at: bundledDir.appendingPathComponent(dependencyName), to: fzstdTarget)

            try bundledVersion.write(to: marker, atomically: true, encoding: .utf8)
            EngineLog.shared.append("[chat-import] plugin installed into \(profile.path) (v\(bundledVersion))")
        } catch {
            // 安装失败不阻塞引擎启动：导入设置页按引擎 404/503 自行降级隐藏。
            EngineLog.shared.append("[chat-import] install failed: \(error.localizedDescription)")
        }
    }

    /// 随包插件版本（读 bundle 内 package.json；缺失时返回空串走强制刷新）。
    private static func bundledVersion(in bundledDir: URL) -> String {
        let url = bundledDir.appendingPathComponent("\(pluginName)/package.json")
        guard let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let version = obj["version"] as? String else { return "" }
        return version
    }
}
