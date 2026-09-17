// MCP server 行（设置 → 插件 → MCP）：每个 server 一行 `@deepseek-ai/dsh-mcp-client`
// 插进 profile 的装配树。挂在 home 级 patch 层里的托管块（与插件开关同一份
// `<DSH_HOME>/cordis.patch.yml`，另一对标记）——引擎 `patchReload: live` 热重载，
// 所以增删改与启停都不必重启进程。挂载形状见 docs/TODO.md §7。
//
// config 用 JSON 写进 YAML：YAML 1.2 是 JSON 的超集，flow mapping 天然合法 ——
// 于是既不手搓 YAML 生成器，也不必写 YAML 解析器。
//
// 本轮只接 stdio 的 command/args 与 http 的 url：**env/headers（密钥面）未接**，
// 因为密钥要走既有凭据面、不能落进这份明文 patch 文件（TODO §7 的同一条纪律）。

import Foundation

enum McpServerAdmin {
    /// MCP server 的托管块。
    static let marker = ManagedPatchBlock.Marker(
        begin: "# >>> DeepDive managed — MCP servers (do not edit) >>>",
        end: "# <<< DeepDive managed <<<",
    )

    static let pluginName = "@deepseek-ai/dsh-mcp-client"

    /// 一个 server 行。
    struct Server: Equatable {
        /// 行 id（`mcp-<name>`）：启停开关的 patch 目标。
        var rowId: String
        /// serverName：模型侧工具名是 `mcp__<name>__<tool>`。
        var name: String
        /// `stdio` | `http`。
        var transport: String
        /// stdio：可执行文件。
        var command: String
        /// stdio：参数。
        var args: [String]
        /// http：端点。
        var url: String
        var enabled: Bool
    }

    static func fileURL(home: URL) -> URL { PluginPatchAdmin.fileURL(home: home) }

    static func servers(in home: URL) -> [Server] {
        guard let text = try? String(contentsOf: fileURL(home: home), encoding: .utf8) else { return [] }
        return parse(text)
    }

    /// 全量保存（增删改都走它）。成功回 nil，否则回给用户看的原因。
    static func save(_ servers: [Server], in home: URL) -> String? {
        if let bad = validate(servers) { return bad }
        let url = fileURL(home: home)
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        do {
            try compose(existing: existing, servers: servers).write(to: url, atomically: true, encoding: .utf8)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// 校验：名字是合法标识符、不重名，且各 transport 的必填项都在。
    static func validate(_ servers: [Server]) -> String? {
        var seen = Set<String>()
        for server in servers {
            let name = server.name.trimmingCharacters(in: .whitespaces)
            if name.isEmpty { return "名字不能为空" }
            if !name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) {
                return "名字只能用字母、数字、连字符与下划线"
            }
            if !seen.insert(name).inserted { return "名字重复：\(name)" }
            if server.transport == "http" {
                if server.url.trimmingCharacters(in: .whitespaces).isEmpty { return "\(name)：http 传输要填 URL" }
            } else if server.command.trimmingCharacters(in: .whitespaces).isEmpty {
                return "\(name)：stdio 传输要填命令"
            }
        }
        return nil
    }

    // MARK: - 纯函数（单测钉子）

    static func parse(_ text: String) -> [Server] {
        var out: [Server] = []
        var rowId: String?
        var enabled = true
        for line in ManagedPatchBlock.lines(of: text, marker: marker) {
            if let id = ManagedPatchBlock.scalar(line, key: "- id:") {
                rowId = id
                enabled = true
            } else if let flag = ManagedPatchBlock.scalar(line, key: "disabled:") {
                enabled = flag != "true"
            } else if let json = rawConfig(line), let id = rowId {
                if let server = decode(json, rowId: id, enabled: enabled) { out.append(server) }
                rowId = nil
            }
        }
        return out
    }

    static func compose(existing: String, servers: [Server]) -> String {
        guard !servers.isEmpty else { return ManagedPatchBlock.replacing(existing, marker: marker, body: []) }
        var body = ["- insert:"]
        for server in servers {
            body.append("    - id: \(ManagedPatchBlock.yamlString(server.rowId))")
            body.append("      name: \(ManagedPatchBlock.yamlString(pluginName))")
            body.append("      disabled: \(server.enabled ? "false" : "true")")
            body.append("      config: \(configJSON(server))")
        }
        return ManagedPatchBlock.replacing(existing, marker: marker, body: body)
    }

    /// 行 id：`mcp-<name>`（名字已被 validate 限成标识符字符集）。
    static func rowId(of name: String) -> String { "mcp-\(name)" }

    /// 取 `config:` 后的 JSON 文本。
    private static func rawConfig(_ line: String) -> String? {
        ManagedPatchBlock.scalar(line, key: "config:")
    }

    private static func configJSON(_ server: Server) -> String {
        var dict: [String: Any] = ["serverName": server.name, "transport": server.transport]
        if server.transport == "http" {
            dict["url"] = server.url
        } else {
            dict["command"] = server.command
            if !server.args.isEmpty { dict["args"] = server.args }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func decode(_ json: String, rowId: String, enabled: Bool) -> Server? {
        guard let data = json.data(using: .utf8),
              let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let name = dict["serverName"] as? String else { return nil }
        let transport = dict["transport"] as? String ?? "stdio"
        return Server(
            rowId: rowId,
            name: name,
            transport: transport,
            command: dict["command"] as? String ?? "",
            args: dict["args"] as? [String] ?? [],
            url: dict["url"] as? String ?? "",
            enabled: enabled,
        )
    }
}
