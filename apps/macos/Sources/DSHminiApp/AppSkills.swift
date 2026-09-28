// 随应用发布的技能：壳每次启动把它们写回引擎的用户技能根
// （<DSH_HOME>/skills/<名字>/SKILL.md），并清掉早年铺下、现已停发的那些。
//
// 为什么这件事留在壳里：技能**清单/新建/删除**归引擎（`skills/admin*`，技能根是引擎
// 的状态），但"这个应用带哪几个技能、正文是什么"是随应用发布的内容，与 ProfileComposer
// 铺 profile、DeploymentPrompt 写 AGENTS.md 同类——发布动作归壳。`published` 是这件事的
// 唯一事实源：铺盘照它铺，前端据 `publishedNames` 不给删除入口（删了下次启动也会回来）。
//
// 纪律：frontmatter 是硬契约——缺 name/description、或用了 legacy 键，引擎只记一条 warn
// 然后**静默忽略整个技能**，模型就再也看不到它（EngineSupervisorTests 钉着这条）；
// 退役清理只碰常量名单里的一层目录，用户自己的技能一个都不动。

import Foundation

enum AppSkills {
    /// 随应用发布的技能：名字 + 正文。铺盘照它铺，前端据 `publishedNames` 不给删除入口。
    static var published: [(name: String, markdown: String)] {
        [
            (automationSkillName, automationSkillMarkdown),
            (BrowserSkill.name, BrowserSkill.markdown),
        ]
    }

    /// The skill that carries the conversation-side automation protocol. Written on
    /// every launch into the engine's user skill root (<DSH_HOME>/skills/<name>/
    /// SKILL.md, discovered by @deepseek-ai/dsh-skill-filesystem); frontmatter must
    /// stay valid — a malformed file is only a warning in the engine log and the
    /// skill silently disappears (name + description are mandatory).
    static let automationSkillName = "deepdive-automation"

    static let automationSkillMarkdown = #"""
    ---
    name: deepdive-automation
    description: Propose or update a DeepDive scheduled task (a recurring automation that runs on its own schedule; each run opens a fresh chat unless the task reuses one). Use when the user asks for something that should run every day / every weekday / every N hours / at a fixed time, or asks to change or pause such a task. Not for one-off reminders inside this conversation — those use the schedule tools.
    ---

    # DeepDive scheduled tasks

    The DeepDive app keeps its own task list (Settings → Automation). You cannot write it:
    you propose a task, the app renders your proposal as a card, and the user confirms it
    in a form. Never claim a task was created or is already running.

    ## How to propose

    Reply with a fenced code block whose info string is `automation` and whose body is
    exactly one JSON object (no other text inside the fence):

    ````text
    ```automation
    {"title":"提交与风险扫描","instruction":"<what the agent does on each run>","schedule":{"kind":"weekdays","hour":9,"minute":0},"workspace":"<workspace folder name, optional>","permission":"read-only"}
    ```
    ````

    Fields:

    - `title` (required) — short name shown on the card.
    - `instruction` (required) — the prompt sent on each run. Write it self-contained: a task
      that opens a fresh chat has no memory of this conversation. Say explicitly whether the
      run may write (`只读分析：不要修改文件`) or not.
    - `schedule` (required) — one of the shapes below. Times are the user's local time.
    - `workspace` (optional) — the workspace **folder name** (e.g. `DSHmini`). Omit to use the
      workspace the user is in.
    - `permission` (optional) — a permission preset key: `read-only`, `workspace-write`, or
      `danger-full-access`. Prefer `read-only` for analysis-only tasks.

    ## Schedules

    - `{"kind":"hourly","minute":0}` — every hour at :00
    - `{"kind":"daily","hour":9,"minute":0}` — every day at 09:00
    - `{"kind":"weekdays","hour":9,"minute":0}` — every weekday at 09:00
    - `{"kind":"weekly","weekday":1,"hour":9,"minute":0}` — weekly, 0=Sunday … 6=Saturday
    - `{"kind":"monthly","day":1,"hour":9,"minute":0}` — monthly on a day of month
    - `{"kind":"custom","everyDays":3,"hour":9,"minute":0}` — every N days at a time

    ## Rules

    - One JSON object per fence; several tasks means several fences.
    - Keep the block machine-readable: no comments, no trailing commas, no text inside the fence.
    - Changing an existing task means proposing the whole new version and saying what changed;
      you cannot edit or pause a task yourself.
    - "Remind me in 10 minutes" / "report to me here every 30 minutes" is not a scheduled task —
      that is a reminder inside this conversation: use the schedule tools.

    """#

    /// 随应用发布、每次启动被写回技能根的技能名（前端据此不给删除入口）。
    static var publishedNames: Set<String> { Set(published.map(\.name)) }

    /// 铺盘 + 清停发技能；每次启动重写（升级以应用内为准）。返回实际删掉的退役目录名。
    @discardableResult
    static func install(in home: URL) -> [String] {
        for skill in published { writeSkill(name: skill.name, markdown: skill.markdown, in: home) }
        return removeRetired(in: home)
    }

    /// 已停发、但旧版本铺在盘上的技能名。技能根是引擎自动发现的（rank 400），
    /// 留着等于继续教模型一个没人消费的协议——每次启动幂等清一次
    /// （同 ProfileComposer 的 retiredBundleNames）。
    static let retiredNames: Set<String> = ["deepdive-evolution", "deepdive-session-memory"]

    /// 清掉停发技能的目录，返回实际删掉的目录名（供调用方记日志）。
    @discardableResult
    static func removeRetired(in home: URL) -> [String] {
        let root = home.appendingPathComponent("skills", isDirectory: true)
        var removed: [String] = []
        for name in retiredNames.sorted() {
            let directory = root.appendingPathComponent(name, isDirectory: true)
            guard FileManager.default.fileExists(atPath: directory.path) else { continue }
            do {
                try FileManager.default.removeItem(at: directory)
                removed.append(name)
            } catch {
                // 删不掉就留着：下次启动会再试一次，这里不值得打断引擎启动
            }
        }
        return removed
    }

    private static func writeSkill(name: String, markdown: String, in home: URL) -> URL {
        let dir = home
            .appendingPathComponent("skills", isDirectory: true)
            .appendingPathComponent(name, isDirectory: true)
        let url = dir.appendingPathComponent("SKILL.md")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? markdown.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
