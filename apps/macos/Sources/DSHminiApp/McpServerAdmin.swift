// MCP server 行（设置 → 插件 → MCP）：每个 server 一行 `@deepseek-ai/dsh-mcp-client`
// 插进 profile 的装配树。**配置源是 app 自己的 JSON**（`<support>/mcp-servers.json`），
// patch 块由它生成 —— 因为 config 里要写 `!!js process.env.…` 这种 YAML 原生语法，
// 用"直接读写 patch 文件"表示不了它。
//
// 密钥不落进 patch 文件：README 的挂载形状是 `env: {GITHUB_TOKEN: !!js process.env.X}`，
// 所以**值只能来自引擎进程的环境变量**。壳在 spawn 引擎时把密钥表（同文件的 secrets 段，
// 0600）展平成 `MCP_<SERVER>_<KEY>` 注入环境；patch 里只留变量名这个引用。
//
// 装配面的实测：插入后 home 层 patch 被 `patchReload: live` 热应用（`include:mcp-<名字>`
// 立刻出现、`disabled` 翻转即时生效）。但 **bundle 成员的增删（卸载插件）有启动边界**，
// 那条路必须停起进程 —— 见 PITFALLS §7.6。

import Foundation

enum McpServerAdmin {
    /// MCP server 的托管块（与插件开关同一份 `<DSH_HOME>/cordis.patch.yml`）。
    static let marker = ManagedPatchBlock.Marker(
        begin: "# >>> DeepDive managed — MCP servers (do not edit) >>>",
        end: "# <<< DeepDive managed <<<",
    )

    static let pluginName = "@deepseek-ai/dsh-mcp-client"
    /// 注入引擎进程环境变量时的前缀：`MCP_<SERVER>_<KEY>`。
    static let envPrefix = "MCP_"

    /// 一个 server 行。密钥的**值**不在这个结构里（只在 Store.secrets），
    /// 所以它可以安全地回给前端渲染。
    struct Server: Codable, Equatable {
        /// 行 id（`mcp-<name>`）：启停开关的 patch 目标。
        var rowId: String
        /// serverName：模型侧工具名是 `mcp__<name>__<tool>`；`[A-Za-z0-9_-]{1,32}`。
        var name: String
        /// `stdio` | `streamable-http`（引擎 README 的取值，不是 `http`）。
        var transport: String
        var command: String
        var args: [String]
        var url: String
        /// stdio：要注入的**环境变量名**（值在密钥表里）。
        var env: [String]
        /// streamable-http：要注入的**请求头名**（值在密钥表里）。
        var headers: [String]
        var enabled: Bool
    }

    /// 磁盘形状：配置 + 密钥同文件（0600）。密钥按 `serverName → key → value` 存。
    struct Store: Codable {
        var servers: [Server]
        var secrets: [String: [String: String]]
    }

    /// 配置源文件（app 自己的数据目录，不污染 harness）。
    static func storeURL(in supportDir: URL) -> URL {
        supportDir.appendingPathComponent("mcp-servers.json")
    }

    static func load(in supportDir: URL) -> Store {
        guard let data = try? Data(contentsOf: storeURL(in: supportDir)),
              let store = try? JSONDecoder().decode(Store.self, from: data) else {
            return Store(servers: [], secrets: [:])
        }
        return store
    }

    /// 保存：写 JSON（0600）并重写 patch 块。成功回 nil，否则回给用户看的原因。
    static func save(_ store: Store, in supportDir: URL, harnessHome: URL) -> String? {
        if let bad = validate(store.servers) { return bad }
        let url = storeURL(in: supportDir)
        do {
            try FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(store).write(to: url, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            return error.localizedDescription
        }
        let patchURL = PluginPatchAdmin.fileURL(home: harnessHome)
        let existing = (try? String(contentsOf: patchURL, encoding: .utf8)) ?? ""
        do {
            try compose(existing: existing, servers: store.servers).write(to: patchURL, atomically: true, encoding: .utf8)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// 给引擎进程的环境变量表（spawn 时注入）：`MCP_<SERVER>_<KEY>` → 值。
    /// env 与 headers 都走它 —— 请求头的值同样只能是环境变量（README 的 `!!js` 形状）。
    static func environment(in supportDir: URL) -> [String: String] {
        let store = load(in: supportDir)
        var out: [String: String] = [:]
        for server in store.servers {
            let secrets = store.secrets[server.name] ?? [:]
            for key in server.env + server.headers {
                if let value = secrets[key] { out[envName(server: server.name, key: key)] = value }
            }
        }
        return out
    }

    /// 环境变量名：`MCP_<SERVER>_<KEY>`。加 server 前缀是为了两个 server 用同名 key
    /// （都叫 `API_KEY`）时不互相覆盖。
    static func envName(server: String, key: String) -> String {
        envPrefix + server.uppercased().replacingOccurrences(of: "-", with: "_") + "_" + key
    }

    /// 行 id：`mcp-<name>`。
    static func rowId(of name: String) -> String { "mcp-\(name)" }

    /// 校验：名字是合法 serverName（`[A-Za-z0-9_-]{1,32}`）、不重名，各 transport 的必填项都在。
    static func validate(_ servers: [Server]) -> String? {
        var seen = Set<String>()
        for server in servers {
            let name = server.name.trimmingCharacters(in: .whitespaces)
            if name.isEmpty { return "名字不能为空" }
            if name.count > 32 { return "名字最长 32 个字符" }
            // 引擎的 serverName 取值是 [A-Za-z0-9_-]{1,32}，多了会被拒
            if !name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) {
                return "名字只能用字母、数字、连字符与下划线：\(name)"
            }
            if !seen.insert(name).inserted { return "名字重复：\(name)" }
            if server.transport == "streamable-http" {
                if server.url.trimmingCharacters(in: .whitespaces).isEmpty { return "\(name)：http 传输要填 URL" }
            } else if server.command.trimmingCharacters(in: .whitespaces).isEmpty {
                return "\(name)：stdio 传输要填命令"
            }
        }
        return nil
    }

    // MARK: - patch 块生成（纯函数，单测钉子）

    /// servers → 新正文。空表则移除块（段外内容由 ManagedPatchBlock 逐字保留）。
    static func compose(existing: String, servers: [Server]) -> String {
        guard !servers.isEmpty else { return ManagedPatchBlock.replacing(existing, marker: marker, body: []) }
        var body = ["- insert:"]
        for server in servers {
            body.append("    - id: \(ManagedPatchBlock.yamlString(server.rowId))")
            body.append("      name: \(ManagedPatchBlock.yamlString(pluginName))")
            body.append("      disabled: \(server.enabled ? "false" : "true")")
            body.append("      config:")
            body.append("        serverName: \(ManagedPatchBlock.yamlString(server.name))")
            body.append("        transport: \(ManagedPatchBlock.yamlString(server.transport))")
            if server.transport == "streamable-http" {
                body.append("        url: \(ManagedPatchBlock.yamlString(server.url))")
                body.append(contentsOf: secretLines(server.headers, server: server.name, key: "headers"))
            } else {
                body.append("        command: \(ManagedPatchBlock.yamlString(server.command))")
                if !server.args.isEmpty {
                    let args = server.args.map(ManagedPatchBlock.yamlString).joined(separator: ", ")
                    body.append("        args: [\(args)]")
                }
                body.append(contentsOf: secretLines(server.env, server: server.name, key: "env"))
            }
        }
        return ManagedPatchBlock.replacing(existing, marker: marker, body: body)
    }

    /// 密钥引用行：值写成 `!!js process.env.<变量名>`（README 的挂载形状）。
    private static func secretLines(_ keys: [String], server: String, key: String) -> [String] {
        guard !keys.isEmpty else { return [] }
        return ["        \(key):"] + keys.map { "          \($0): !!js process.env.\(envName(server: server, key: $0))" }
    }
}
