// 部署级提示词：随应用发布的那两条指路线——自动化协议、富输出围栏词表。
// 管的是「说什么」与「落到哪」，不管引擎监督，也不管 skill 正文（那些在
// EngineSupervisor / 各 skill 里）。
//
// 落点是 `<DSH_HOME>/AGENTS.md` 的**托管块**，不是引擎 `system-prompt` 行的
// `personaPrefix`：随包的四个 agent preset 都挂 `@deepseek-ai/dsh-persona`，它注册
// 的 section 名与 `dsh-system-prompt` 的部署级 persona 相同，按设计遮蔽部署级默认值
// ——实测那条路到不了模型（`docs/PITFALLS.md §7.7`：隔离起引擎发一条消息，解会话
// 日志的 system/message，overlay 注入的 personaPrefix 不在、preset 的在）。
// 而 AGENTS.md 经 agent-instructions 进系统提示词、不经过 persona section。
//
// 之所以用托管块：这个文件是引擎的 home 级 AGENTS.md，用户自己也会往里写。
// 整段重写会抹掉用户的内容，所以只替换标记之间的部分，段外逐字保留。

import Foundation

enum DeploymentPrompt {
    /// Markdown 注释形式的边界行（这个文件是 Markdown，`#` 开头会渲染成标题）。
    static let marker = ManagedPatchBlock.Marker(
        begin: "<!-- DeepDive managed: deployment prompt — written on every launch, do not edit -->",
        end: "<!-- DeepDive managed: end of deployment prompt -->"
    )

    /// 块内行（纯函数，单测钉子）。每段提示词是一行（源码里用行连续符拼的），
    /// 段间留空行以便阅读。
    static func body() -> [String] {
        let parts = [automationProtocolPrompt, richOutputProtocolPrompt, deliverableMentionPrompt]
        var lines = [""]
        for part in parts {
            lines.append(part)
            lines.append("")
        }
        return lines
    }

    /// 把托管块写进 `<home>/AGENTS.md`（不存在则创建），段外逐字保留。
    /// 返回是否有写入。失败只记日志：这条指路缺失不该拦下引擎启动。
    @discardableResult
    static func ensureInstalled(in home: URL) -> Bool {
        let url = home.appendingPathComponent("AGENTS.md")
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let desired = ManagedPatchBlock.replacing(
            existing,
            marker: marker,
            body: body()
        )
        guard desired != existing else { return false }
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
            try desired.write(to: url, atomically: true, encoding: .utf8)
            return true
        } catch {
            EngineLog.shared.append("[deployment-prompt] write failed: \(error.localizedDescription)")
            return false
        }
    }

    /// Rich output: the app renders three fence languages in the conversation body
    /// (implementation and security boundaries in `frontend/src/rich/`).
    ///
    /// 这句必须说清**偏好**，不只是"可以用"：2026-09-16 用户说"画个 svg"，模型直接写了一份
    /// .svg 文件当产物交付（`dsh_im_return_file`），于是对话里没有任何围栏可渲染——用户看到
    /// 的就是"没显示"。模型的默认直觉是交付文件，所以要把"想让人在对话里看见 → 用围栏；
    /// 要文件/交付物 → 写文件"这条分界写出来。
    ///
    /// 注：当时这句是经 `system-prompt` 的 personaPrefix 注入的，而那条路被 preset 遮蔽
    /// （PITFALLS §7.7）——所以那次"修复"没生效过。改落点后它才真正到达模型。
    static let richOutputProtocolPrompt = """
    DeepDive rich output: when the user should see a figure or diagram in the conversation, \
    draw it inline in a fenced code block whose info string is `mermaid` (diagram), `svg` \
    (hand-written vector figure) or `widget` (one small self-contained interactive HTML page, \
    rendered sandboxed). The app draws those as figures and shows the code verbatim only when \
    one cannot be rendered. Write or return a file only when the user asked for a file or a \
    deliverable — "draw me a diagram" means the inline fence, not an .svg file on disk.
    """

    /// Outputs: name the files a turn produced, as inline code.
    ///
    /// 这段原来住在引擎的 `ui-deliverables` 行里（官方客户端那条线）。2026-09-29 剪包
    /// 时把它搬到这里——同一段模型可见行为，换成我们自己的家（AGENTS.md 托管块）。
    /// 原句里"以便在 Web 里点开"那半句删掉了：我们的 SPA 不把行内代码渲染成可点链接，
    /// 留着它等于教模型做一件界面不支持的事。
    static let deliverableMentionPrompt = """
    DeepDive outputs: when you create or modify files, name the primary ones in your final \
    response as Markdown inline code using the exact file path (or a basename when it is \
    unique among the files changed in that turn).
    """

    /// Deployment system prompt: one pointer, nothing more — the protocol itself
    /// lives in the `deepdive-automation` skill (loaded on demand through the
    /// engine's skill tool), so every session does not pay for the full shape.
    static let automationProtocolPrompt = """
    DeepDive automation: when the user asks for a scheduled or recurring task, or to change one, \
    load the `deepdive-automation` skill and follow its protocol exactly. One-off reminders \
    inside this conversation keep using the schedule tools.
    """
}
