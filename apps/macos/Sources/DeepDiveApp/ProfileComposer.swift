// 引擎组合的部署器：把随包分发的 engine/profile（DeepDive 自有的整棵插件树，
// 见该目录 README）装进 harness home 的 web profile，并把 dsh.profile.bundles
// 收敛到它——上游的 @deepseek-ai/dsh-base / dsh-web-app 从列表里摘掉，此后引擎
// 装载什么由本仓定义，而不是"挂载上游产品再打补丁"。
//
// 幂等（版本标记 + 目录存在即零写入）、失败只记日志不阻塞引擎启动——与
// ChatImportPlugin/BotChannelPlugin 同款纪律。

import Foundation

enum ProfileComposer {
    /// 自有组合的包名。**不能与上游包名重合**：bundle 解析先查 dsh 安装锚点、
    /// 再查 profile 的 node_modules，重名会被安装锚点那边抢走。
    static let bundleName = "deepdive-engine-profile"

    /// 随包但**不再作为层参与组合**的上游 bundle。用户既有 profile 里可能还留着
    /// 它们（旧版本壳写进去的默认元组），不摘掉就会被继续叠上来——那正是本组件
    /// 要脱离的形态。
    static let retiredBundleNames: Set<String> = [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
    ]

    /// 部署组合并迁移 profile 清单。返回是否有写入（EngineLog 用）。
    @discardableResult
    static func ensureInstalled(in dshHome: URL, bundledDir: URL) -> Bool {
        let profile = dshHome.appendingPathComponent("profiles/web", isDirectory: true)
        let fm = FileManager.default
        let bundledVersion = version(in: bundledDir)
        guard !bundledVersion.isEmpty else {
            EngineLog.shared.append("[composition] bundled engine/profile has no version — skipped")
            return false
        }

        let marker = profile.appendingPathComponent(".deepdive-engine-profile-version")
        let installedVersion = ((try? String(contentsOf: marker, encoding: .utf8)) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let target = profile.appendingPathComponent("node_modules/\(bundleName)")
        var wrote = false

        do {
            // ① 组合目录：版本一致且包在 → 零写入。
            //    顺序要紧：**bundle 必须先落盘、再被 manifest 引用**——解析先于
            //    loader 的模块兜底修复，而那条兜底刻意不创建 bundle 包本身。
            if installedVersion != bundledVersion || !fm.fileExists(atPath: target.appendingPathComponent("package.json").path) {
                try fm.createDirectory(at: profile.appendingPathComponent("node_modules"), withIntermediateDirectories: true)
                try? fm.removeItem(at: target)
                try fm.copyItem(at: bundledDir, to: target)
                try bundledVersion.write(to: marker, atomically: true, encoding: .utf8)
                wrote = true
                EngineLog.shared.append("[composition] deployed \(bundleName) v\(bundledVersion) into \(profile.path)")
            }

            // ② 清单：把 bundles 收敛成"自有组合在前、社区插件保留、上游两层摘掉"。
            //    只在真会变化时写——每次启动都重写会让用户手改的字段失去意义。
            let packageURL = profile.appendingPathComponent("package.json")
            let current = (try? Data(contentsOf: packageURL))
                .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
            var config = current
            var dsh = config["dsh"] as? [String: Any] ?? [:]
            var profileSpec = dsh["profile"] as? [String: Any] ?? [:]
            let existing = profileSpec["bundles"] as? [String] ?? []
            let kept = existing.filter { $0 != bundleName && !retiredBundleNames.contains($0) }
            let desired = [bundleName] + kept
            profileSpec["bundles"] = desired
            // patchReload 的默认值就是 live（引擎侧 profile.ts），写出来只是让清单自解释；
            // 用户显式设过别的值则保留他的选择。
            if profileSpec["patchReload"] as? String == nil { profileSpec["patchReload"] = "live" }
            dsh["profile"] = profileSpec
            config["dsh"] = dsh
            config["name"] = config["name"] as? String ?? "dsh-profile-web"
            config["private"] = true

            let desiredData = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
            if desired != existing || current.isEmpty {
                try desiredData.write(to: packageURL, options: .atomic)
                wrote = true
                let retired = existing.filter { retiredBundleNames.contains($0) }
                let note = retired.isEmpty ? "" : " (retired layers dropped: \(retired.joined(separator: ", ")))"
                EngineLog.shared.append("[composition] profile bundles = \(desired.joined(separator: ", "))\(note)")
            }
        } catch {
            // 部署失败不阻塞引擎启动：引擎会按既有清单启动，SPA 侧照常可用；
            // 组合没落地这件事必须留痕，否则"引擎装载的是什么"就无从查起。
            EngineLog.shared.append("[composition] deploy failed: \(error.localizedDescription)")
        }
        return wrote
    }

    /// 随包组合的版本（读 bundledDir/package.json）；缺失回空串 → 调用方走跳过分支。
    private static func version(in bundledDir: URL) -> String {
        let url = bundledDir.appendingPathComponent("package.json")
        guard let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let version = obj["version"] as? String else { return "" }
        return version
    }
}
