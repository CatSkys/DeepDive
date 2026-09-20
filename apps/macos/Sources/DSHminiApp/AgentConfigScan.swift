import Foundation

/// 其他 Agent 的配置读取——新手引导「迁移」步的后半截（前半截的会话导入走
/// dsh-chat-import 插件的 /api-import/* 面板路由）。
///
/// 管什么：白名单文件在不在、把原文读出来（带大小上限）；不管什么：解析、映射、
/// 写凭据——那些都在前端一处实现（`frontend/src/onboarding/agentModelImport.ts`），
/// 与手输 Key 共用同一条落库通道（`credentials/set` + `settings.update`）。
///
/// 隐私边界：这些文件可能含明文 API Key。壳只做搬运：**绝不把内容写进日志/通知**，
/// 只经宿主消息回给自家 webview（与用户在设置页手输 Key 同一条通道）。
enum AgentConfigScan {
    /// 来源 id 与前端映射表（`agentModelImport.ts`）逐字对应。
    struct Candidate {
        let source: String
        let path: String
    }

    /// 单文件上限：配置文件都是几 KB 量级；超过上限视为异常不导入（不截断——
    /// 半截 JSON 解析必然失败，反而给出误导性的"解析失败"）。
    private static let maxBytes = 1 * 1024 * 1024

    /// 白名单。dsh 不在列：它的密钥已由壳在启动期自动迁移（`LegacyCredentials`），
    /// 自定义提供方在 `~/.dsh/settings.yaml` 里、需要 YAML 解析，本轮不导（界面如实说明）。
    static func candidates(home: URL) -> [Candidate] {
        [
            Candidate(source: "zcode", path: home.appendingPathComponent(".zcode/v2/config.json").path),
            Candidate(source: "mimocode", path: home.appendingPathComponent(".config/mimocode/mimocode.jsonc").path),
            Candidate(source: "pi", path: home.appendingPathComponent(".pi/agent/models.json").path),
            Candidate(source: "opencode", path: home.appendingPathComponent(".local/share/opencode/auth.json").path),
        ]
    }

    /// 读回 `来源 id → 文件原文`。不存在 / 读失败 / 超上限的来源直接不出现——调用方
    /// 按"这家没有可导入的模型配置"降级，而不是拿到半份内容去猜。
    static func read(home: URL) -> [String: String] {
        var out: [String: String] = [:]
        for candidate in candidates(home: home) {
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: candidate.path),
                  let size = attrs[.size] as? Int, size <= maxBytes,
                  let text = try? String(contentsOfFile: candidate.path, encoding: .utf8) else { continue }
            out[candidate.source] = text
        }
        return out
    }
}
