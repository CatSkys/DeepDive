// 插件卸载（设置 → 插件 → 行菜单「卸载」）：把插件从 web profile 的 package.json 摘掉
// （`dependencies` 与 `dsh.profile.bundles` 两处），引擎启动时按 bundles 装配 ——
// 所以**改完必须重启引擎**才生效：bundle 成员变化有启动边界（引擎 README 明写
// "A running Profile keeps the Bundle set from its current start"），热重载只覆盖 patch 层。
//
// 不给卸载的插件：随应用发布、每次启动由壳幂等装回来的那些（ChatImportPlugin）。
// 删了下次启动就回来，给入口只会骗人。
//
// 只动 package.json：`node_modules` 里的包留着 —— 重新安装可复用，且删目录是
// 破坏性大得多的动作（用户在别处也可能引用同一个包）。

import Foundation

enum ProfilePluginAdmin {
    /// 随应用发布、每次启动重装的插件：不提供卸载（删了也会回来）。
    /// 含自有组合包——它每次启动由 ProfileComposer 装回来，摘掉它等于拆掉引擎的整棵插件树。
    static var bundledPluginNames: Set<String> { [ChatImportPlugin.pluginName, ProfileComposer.bundleName] }

    /// web profile 目录。与 ChatImportPlugin 同一路径约定（壳只启动这一个 profile）。
    static func profileDir(in dshHome: URL) -> URL {
        dshHome.appendingPathComponent("profiles/web", isDirectory: true)
    }

    /// 从 profile 摘掉一个插件。成功回 nil，否则回给用户看的原因。
    static func uninstall(moduleName: String, dshHome: URL) -> String? {
        guard !moduleName.isEmpty else { return "缺少插件名" }
        if bundledPluginNames.contains(moduleName) {
            return "这个插件随应用发布，每次启动都会装回来，不能卸载"
        }
        let packageURL = profileDir(in: dshHome).appendingPathComponent("package.json")
        guard let data = try? Data(contentsOf: packageURL),
              var config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return "读不到 profile 的 package.json"
        }
        var deps = config["dependencies"] as? [String: String] ?? [:]
        guard deps[moduleName] != nil else { return "这个插件不在 profile 的依赖里" }
        deps.removeValue(forKey: moduleName)
        config["dependencies"] = deps

        var dsh = config["dsh"] as? [String: Any] ?? [:]
        var profileSpec = dsh["profile"] as? [String: Any] ?? [:]
        var bundles = profileSpec["bundles"] as? [String] ?? []
        bundles.removeAll { $0 == moduleName }
        profileSpec["bundles"] = bundles
        dsh["profile"] = profileSpec
        config["dsh"] = dsh

        do {
            let out = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
            try out.write(to: packageURL, options: .atomic)
            return nil
        } catch {
            return error.localizedDescription
        }
    }
}
