// 侧栏浏览器的 agent 控制面安装器：把随包的 BrowserUse 目录（MCP server + 浏览器 SDK）
// 装进 `<support>/browser-use/`，并给出引擎 spawn 时要注入的环境变量与组合行需要的路径。
//
// 纪律同 ChatImportPlugin：**幂等**（内容与版本标记一致时零写入）。装到 support 而不是
// 直接用 bundle 内路径，是因为 Gatekeeper 的 App Translocation 会让 bundle 路径在
// 隔离运行（从下载目录直接打开）时漂移——那时引擎 spawn 的绝对路径会指向不存在的文件。

import Foundation

enum BrowserUseInstaller {
    /// 装完之后的两个绝对路径（组合行要写进 patch，所以必须是稳定的绝对路径）。
    struct Paths {
        /// 随包的 Node 可执行文件（引擎闭包自带的那一个）。
        var node: URL
        /// 装好的 MCP server 入口。
        var server: URL
    }

    /// 随包资源目录名（project.yml 里 BrowserUse → Contents/Resources/BrowserUse）。
    static let resourceDirName = "BrowserUse"
    /// support 下的安装目录名。
    static let installDirName = "browser-use"
    /// 版本标记文件：内容与随包一致时跳过复制。
    private static let markerName = ".installed-version"

    /// 内容版本：随包目录里所有文件的 (名字, 字节数) 摘要。文件改动即变。
    private static func contentVersion(in bundledDir: URL) -> String {
        let fm = FileManager.default
        let names = (try? fm.contentsOfDirectory(atPath: bundledDir.path))?.sorted() ?? []
        var parts: [String] = []
        for name in names where !name.hasPrefix(".") {
            let size = (try? fm.attributesOfItem(atPath: bundledDir.appendingPathComponent(name).path)[.size]) as? Int ?? 0
            parts.append("\(name):\(size)")
        }
        return parts.joined(separator: "|")
    }

    /// 安装（幂等）并返回两个路径；随包资源缺失时回 nil（引擎照常起，只是没有浏览器工具）。
    static func ensureInstalled(in supportDir: URL, bundledDir: URL) -> Paths? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let node = resources.appendingPathComponent("Runtime/node")
        let source = bundledDir
        let fm = FileManager.default
        guard fm.fileExists(atPath: source.path), fm.isExecutableFile(atPath: node.path) else { return nil }

        let install = supportDir.appendingPathComponent(installDirName, isDirectory: true)
        let marker = install.appendingPathComponent(markerName)
        let expected = contentVersion(in: source)
        let current = (try? String(contentsOf: marker, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        let server = install.appendingPathComponent("browser-use-server.mjs")

        if current == expected, fm.fileExists(atPath: server.path) {
            return Paths(node: node, server: server)
        }
        do {
            try fm.createDirectory(at: install, withIntermediateDirectories: true)
            for name in (try? fm.contentsOfDirectory(atPath: source.path))?.sorted() ?? [] {
                guard !name.hasPrefix(".") else { continue }
                let target = install.appendingPathComponent(name)
                if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
                try fm.copyItem(at: source.appendingPathComponent(name), to: target)
            }
            try expected.write(to: marker, atomically: true, encoding: .utf8)
        } catch {
            EngineLog.shared.append("[browser] install failed: \(error.localizedDescription)")
            return nil
        }
        EngineLog.shared.append("[browser] installed control plane at \(install.path)")
        return Paths(node: node, server: server)
    }

    /// 引擎 spawn 时注入的环境变量：控制面的地址（桥的回环 URL）与 boot token。
    static func environment(bridgeURL: URL?) -> [String: String] {
        guard let bridgeURL else { return [:] }
        return [
            "DEEPDIVE_BROWSER_URL": "http://127.0.0.1:\(bridgeURL.port ?? 0)",
            "DEEPDIVE_BROWSER_TOKEN": BrowserControl.token,
        ]
    }

    /// 组合行里要写的两个路径（写成环境变量引用，值由 environment(bridgeURL:) 提供）。
    static func patchRow(paths: Paths) -> String {
        """
            - id: mcp-browser
              name: '@deepseek-ai/dsh-mcp-client'
              disabled: false
              config:
                serverName: deepdive-browser
                transport: stdio
                command: \(ManagedPatchBlock.yamlString(paths.node.path))
                args: [\(ManagedPatchBlock.yamlString(paths.server.path))]
                env:
                  DEEPDIVE_BROWSER_URL: !!js process.env.DEEPDIVE_BROWSER_URL
                  DEEPDIVE_BROWSER_TOKEN: !!js process.env.DEEPDIVE_BROWSER_TOKEN
        """
    }
}
