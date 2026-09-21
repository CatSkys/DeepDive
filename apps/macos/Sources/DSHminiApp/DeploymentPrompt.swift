// 部署级提示词：随应用发布的那几条指路线——自动化协议、富输出围栏词表、
// 自进化与会话记忆指路（后两条各随开关）。管的是「说什么」与「落到哪」，不管
// 引擎监督，也不管 skill 正文（那些在 EngineSupervisor / 各 skill 里）。
//
// 落点是 `<DSH_HOME>/AGENTS.md` 的**托管块**，不是引擎 `system-prompt` 行的
// `personaPrefix`：随包的四个 agent preset 都挂 `@deepseek-ai/dsh-persona`，它注册
// 的 section 名与 `dsh-system-prompt` 的部署级 persona 相同，按设计遮蔽部署级默认值
// ——实测那条路到不了模型（`docs/PITFALLS.md §7.7`：隔离起引擎发一条消息，解会话
// 日志的 system/message，overlay 注入的 personaPrefix 不在、preset 的在）。
// 而 AGENTS.md 经 agent-instructions 进系统提示词、不经过 persona section。
//
// 之所以用托管块：这个文件还有另一个写入者——自进化落地的 lesson（`EVOLUTION-POLICY`
// 的 global 落点就是它）。整段重写会把用户的 lesson 抹掉，所以只替换标记之间的部分，
// 段外逐字保留。

import Foundation

enum DeploymentPrompt {
    /// Markdown 注释形式的边界行（这个文件是 Markdown，`#` 开头会渲染成标题）。
    static let marker = ManagedPatchBlock.Marker(
        begin: "<!-- DeepDive managed: deployment prompt — written on every launch, do not edit -->",
        end: "<!-- DeepDive managed: end of deployment prompt -->"
    )

    /// 块内行（纯函数，单测钉子）：自动化指路与富输出词表恒在，自进化 / 会话记忆
    /// 各随开关——关着就不出现对应那句。每段提示词是一行（源码里用行连续符拼的），
    /// 段间留空行以便阅读。
    static func body(evolutionEnabled: Bool, sessionMemoryEnabled: Bool) -> [String] {
        var parts = [automationProtocolPrompt, richOutputProtocolPrompt]
        if evolutionEnabled { parts.append(evolutionProtocolPrompt) }
        if sessionMemoryEnabled { parts.append(sessionMemoryProtocolPrompt) }
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
    static func ensureInstalled(in home: URL, evolutionEnabled: Bool, sessionMemoryEnabled: Bool) -> Bool {
        let url = home.appendingPathComponent("AGENTS.md")
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let desired = ManagedPatchBlock.replacing(
            existing,
            marker: marker,
            body: body(evolutionEnabled: evolutionEnabled, sessionMemoryEnabled: sessionMemoryEnabled)
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

    /// Deployment system prompt: one pointer, nothing more — the protocol itself
    /// lives in the `deepdive-automation` skill (loaded on demand through the
    /// engine's skill tool), so every session does not pay for the full shape.
    static let automationProtocolPrompt = """
    DeepDive automation: when the user asks for a scheduled or recurring task, or to change one, \
    load the `deepdive-automation` skill and follow its protocol exactly. One-off reminders \
    inside this conversation keep using the schedule tools.
    """
    static let evolutionProtocolPrompt = """
    DeepDive self-evolution: when the user says "remember this" / "don't make me re-explain", or \
    you just worked something out the hard way, load the `deepdive-evolution` skill and propose a \
    lesson. Proposals only — never change rules or docs yourself; the user accepts them in \
    Settings → Self-evolution.
    """
    static let sessionMemoryProtocolPrompt = """
    DeepDive session memory: your session notes are injected at the start of each user turn. Keep \
    them current with the `memory_note_write` tool as you make progress or hit dead ends, and use \
    `new_context` before the window feels long — see the `deepdive-session-memory` skill.
    """
}
