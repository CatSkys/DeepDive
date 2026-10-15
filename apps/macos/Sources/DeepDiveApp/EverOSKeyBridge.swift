// EverOS 提取用 LLM 凭据的桥（纯函数，单测钉子）。
//
// 为什么需要这座桥：EverOS 是**独立进程**（本地 Python 服务，由 dsh 插件 provision
// 拉起），它做「把会话轨迹提炼成记忆」这一步时要自己调 LLM——读不到引擎进程内的
// `ctx.credentials`，所以必须自己拿一份能用的 key。模型与端点和引擎同源
// （api.deepseek.com/v1），缺的只是 key 的传递，不该让用户把同一个密钥再粘一遍。
//
// 规则（避免覆盖用户的显式配置）：`~/.everos/everos.toml` 的 [llm] api_key 非空
// = 用户自己配过（可能故意用另一个模型/账号），一律不动；只有它为空时才用引擎
// `.credentials.yaml` 里的 DEEPSEEK_API_KEY 兜上。
//
// 两个文件都是引擎自己的明文格式（引擎文档写明该存储不是对 agent 的保密边界），
// 这里只做行级扫描：解析不出就返回 nil（不注入、不猜），调用方记日志。

import Foundation

enum EverOSKeyBridge {
    /// 引擎凭据文件里的 DeepSeek key（`refs:` 段下 2 空格缩进的 `KEY: value`）。
    /// 形状不合/空值 → nil。
    static func apiKeyFromCredentials(_ yaml: String) -> String? {
        var inRefs = false
        for raw in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            // 顶层键（无缩进）：refs 段开始，其它顶层键结束
            if !raw.hasPrefix(" ") && !raw.hasPrefix("\t") {
                inRefs = line == "refs:"
                continue
            }
            guard inRefs, let colon = line.firstIndex(of: ":") else { continue }
            guard line[line.startIndex..<colon] == "DEEPSEEK_API_KEY" else { continue }
            let value = unquote(String(line[line.index(after: colon)...]))
            return value.isEmpty ? nil : value
        }
        return nil
    }

    /// 用户在 `~/.everos/everos.toml` 的 [llm] 段里配的 api_key；未配/空值 → nil
    ///（nil 表示"该由桥兜上"，不是"读取失败"）。
    static func llmApiKeyFromToml(_ toml: String) -> String? {
        var inLlm = false
        for raw in toml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("[") {
                inLlm = line == "[llm]"
                continue
            }
            guard inLlm, let eq = line.firstIndex(of: "=") else { continue }
            guard line[line.startIndex..<eq].trimmingCharacters(in: .whitespaces) == "api_key" else { continue }
            let value = unquote(String(line[line.index(after: eq)...]))
            return value.isEmpty ? nil : value
        }
        return nil
    }

    /// 注入给 EverOS 的 key：用户配过 → nil（不动）；没配 → 引擎那把。
    static func resolveApiKey(credentialsYaml: String?, everosToml: String?) -> String? {
        if let toml = everosToml, llmApiKeyFromToml(toml) != nil { return nil }
        guard let yaml = credentialsYaml else { return nil }
        return apiKeyFromCredentials(yaml)
    }

    /// 去掉两侧空白与成对引号（YAML/TOML 的标量引法）。
    private static func unquote(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.count >= 2, (s.hasPrefix("\"") && s.hasSuffix("\"")) || (s.hasPrefix("'") && s.hasSuffix("'")) {
            s = String(s.dropFirst().dropLast())
        }
        return s.trimmingCharacters(in: .whitespaces)
    }
}
