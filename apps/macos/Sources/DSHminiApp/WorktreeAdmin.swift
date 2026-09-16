// git worktree 的管理面（设置 → 工作树）：解析 `git worktree list --porcelain`、组装
// 创建/删除要跑的 git 参数。
//
// 只管**生命周期**：工作树是 git 的事，创建/删除/列出都交给 git 本体（不自己拼仓库布局）。
// 「并行会话在同一工作区的并发安全」需要引擎侧支持——会话 cwd 创建后不可变、沙箱根 =
// 引擎进程 cwd，所以每个工作树只能注册成独立工作区，会话就丢了"同一项目"的分组语义
// （`docs/TODO.md §12`、`packages/sandbox/sandbox-policy/src/index.ts:82`）。这一层不假装
// 能做到那件事，工作树分区的文案里如实写明。

import Foundation

enum WorktreeAdmin {
    struct Worktree: Equatable {
        var path: String
        var head: String
        /// refs/heads/x → x；detached/bare 时为空。
        var branch: String
        var detached: Bool
        var bare: Bool
        var prunable: Bool
        var locked: Bool
    }

    /// `git worktree list --porcelain` → 条目：空行分隔记录，`key value` 成对出现，
    /// branch 可能整行缺席（detached）。字段不认的键忽略，不做猜测性兜底。
    static func parsePorcelain(_ text: String) -> [Worktree] {
        var out: [Worktree] = []
        var current: Worktree?
        func flush() {
            if let item = current { out.append(item) }
            current = nil
        }
        for raw in text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); continue }
            let parts = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: false)
            let key = String(parts[0])
            let value = parts.count > 1 ? String(parts[1]) : ""
            switch key {
            case "worktree":
                flush()
                current = Worktree(
                    path: value, head: "", branch: "", detached: false, bare: false, prunable: false, locked: false,
                )
            case "HEAD":
                current?.head = String(value.prefix(7))
            case "branch":
                current?.branch = value.hasPrefix("refs/heads/") ? String(value.dropFirst("refs/heads/".count)) : value
            case "detached":
                current?.detached = true
            case "bare":
                current?.bare = true
            case "prunable":
                current?.prunable = true
            case "locked":
                current?.locked = true
            default:
                break
            }
        }
        flush()
        return out
    }

    /// 新建工作树并顺带建分支：`worktree add -b <branch> <path>`。
    /// 分支已存在等情形由 git 自己拒绝，错误原文直接回给用户（不替它猜原因）。
    static func addArguments(branch: String, path: String) -> [String] {
        ["worktree", "add", "-b", branch, path]
    }

    /// 删除工作树：**不带 --force**——工作树里有未提交改动时 git 会拒绝，那条拒绝就是
    /// 我们要的答案（宁可让用户回去处理，也不静默丢改动）。
    static func removeArguments(path: String) -> [String] {
        ["worktree", "remove", path]
    }
}
