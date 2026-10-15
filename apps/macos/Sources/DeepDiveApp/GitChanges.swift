// 审查面板的 git 取数：工作区「未暂存」档的改动文件清单与单文件 patch。
// 引擎无 git 能力（docs/SPEC-GIT-COMMIT-MESSAGE.md §1），这里跑 /usr/bin/git；
// 纪律同 runGit：调用方在后台队列上、ProcessRunner 两侧排空（PITFALLS §4.11）。
//
// 与 gitRun 的分工：gitRun 是动作通道（切分支/提交/推送），输出留 4000 字符尾部
// 供人读；diff patch 走这里，**绝不截尾**——半截 patch 解析出来是错的，比不显示更糟。
//
// 解析层（parseStatusPorcelain / parseNumstat / countUntrackedLines）是独立纯函数，
// XCTest 喂 fixture 即可覆盖，不必起真仓库。

import Foundation

enum GitChanges {
    /// git 可执行文件（与 runGit/gitRun 同一路径约定）。
    static let executable = "/usr/bin/git"

    /// 单文件 patch 的字符上限。超了回报 truncated 而不发半截。
    static let maxPatchChars = 200_000

    /// 读回文件正文的字节上限（未跟踪全文与已跟踪的"当前内容"共用）。超限按 binary
    /// 处理——一兆多的未跟踪文件基本都是数据（锁文件、产物、大 fixture），判成二进制
    /// 给出的结论本来就对，且比谎报 "+0" 诚实。
    static let maxFileBytes = 1_048_576

    /// git 命令时限：外部 CLI 卡死不能把整条链路挂住。gitRun 至今没传 timeout
    /// （P1，docs/review-2026-09-22.md WK5-005），本项只保证新通道不重复这个毛病。
    static let timeout: TimeInterval = 10

    enum ChangeKind: String {
        case modified, added, deleted, renamed, untracked, conflicted
    }

    /// 一行增删计数；二进制文件两列是 "-"，记 0 并置 binary。
    struct LineCount: Equatable {
        let added: Int
        let removed: Int
        let binary: Bool
    }

    struct StatusEntry: Equatable {
        let path: String
        /// 重命名/复制的原路径；其余 nil。
        let originalPath: String?
        let kind: ChangeKind
        /// index→worktree 有改动（porcelain v2 的 Y 位非 "."）。未跟踪恒为 true。
        /// 纯暂存的文件为 false —— 那是「已暂存」档的将来，不进本档清单。
        let unstaged: Bool
    }

    struct Change {
        let path: String
        let originalPath: String?
        let kind: ChangeKind
        let added: Int
        let removed: Int
        let binary: Bool
    }

    struct ChangeSet {
        let branch: String
        let files: [Change]
    }

    enum DiffKind: String {
        case patch, untracked, binary, truncated, unavailable
    }

    struct FileDiff {
        let kind: DiffKind
        /// kind == .patch 时的 unified diff 原文。
        let patch: String?
        /// 该文件**当前在工作树里**的全文。两种用途：未跟踪时前端把每行标成新增；
        /// 已跟踪时前端用它补出 patch 里没有的未改动行（hunk 只带 3 行上下文，
        /// 中间的正文不在 patch 里，不回传正文就展不开折叠段）。
        /// 取不到（二进制/超限/已删除）时为 nil。
        let content: String?
    }

    // MARK: - 解析（纯函数）

    /// `--porcelain=v2 -z`：记录以 NUL 分隔，重命名条目的原路径是紧随其后的独立字段。
    /// `-z` 下路径不加引号，所以空格是字面量——切分要限量，否则索引会错位。
    static func parseStatusPorcelain(_ text: String) -> [StatusEntry] {
        var fields = text.split(separator: "\0", omittingEmptySubsequences: true).map(String.init)
        var out: [StatusEntry] = []
        var i = 0
        while i < fields.count {
            let record = fields[i]
            i += 1
            switch record.first {
            case "1":
                let cols = cols(record, splits: 8)
                guard cols.count == 9 else { continue }
                out.append(entry(xy: cols[1], path: cols[8], originalPath: nil, unmerged: false))
            case "2":
                let cols = cols(record, splits: 9)
                guard cols.count == 10, i < fields.count else { continue }
                let originalPath = fields[i]
                i += 1
                out.append(entry(xy: cols[1], path: cols[9], originalPath: originalPath, unmerged: false))
            case "u":
                let cols = cols(record, splits: 10)
                guard cols.count == 11 else { continue }
                out.append(entry(xy: cols[1], path: cols[10], originalPath: nil, unmerged: true))
            case "?":
                let cols = cols(record, splits: 1)
                guard cols.count == 2 else { continue }
                out.append(StatusEntry(path: cols[1], originalPath: nil, kind: .untracked, unstaged: true))
            default:
                continue // "!": 被忽略的文件（未传 --ignored，本就不会出现）
            }
        }
        return out
    }

    /// `--numstat -z`：普通条目是 `加\t减\t路径`；重命名/复制时路径字段为空，
    /// preimage 与 postimage 紧随其后作为两个 NUL 字段。
    static func parseNumstat(_ text: String) -> [String: LineCount] {
        var out: [String: LineCount] = [:]
        let fields = text.split(separator: "\0", omittingEmptySubsequences: false).map(String.init)
        var i = 0
        while i < fields.count {
            let record = fields[i]
            i += 1
            // numstat 是 **Tab** 分隔（status 是空格）；保留空字段，重命名条目的
            // 路径字段正是空的，丢了就认不出它是重命名
            let cols = record.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false)
                .map(String.init)
            guard cols.count == 3 else { continue }
            let key: String
            if cols[2].isEmpty {
                guard i + 1 < fields.count else { break }
                i += 1 // preimage，丢弃
                key = fields[i]
                i += 1  // postimage，键取新路径
            } else {
                key = cols[2]
            }
            out[key] = LineCount(added: numstatValue(cols[0]), removed: numstatValue(cols[1]),
                                 binary: cols[0] == "-" || cols[1] == "-")
        }
        return out
    }

    /// numstat 的数字位：二进制是 "-"，非数字一律 0。
    static func numstatValue(_ raw: String) -> Int {
        raw == "-" ? 0 : (Int(raw) ?? 0)
    }

    /// 未跟踪文件的行数（numstat 没有它的条目，+N 得自己数）。空文件 0 行且不算二进制；
    /// 读不到（不存在/无权限）、含 NUL 字节、超上限，都按二进制记 0。
    static func countUntrackedLines(at path: String) -> LineCount {
        guard let data = FileManager.default.contents(atPath: path) else {
            return LineCount(added: 0, removed: 0, binary: true)
        }
        guard data.count <= maxFileBytes, !data.contains(0) else {
            return LineCount(added: 0, removed: 0, binary: true)
        }
        guard !data.isEmpty else {
            return LineCount(added: 0, removed: 0, binary: false)
        }
        let text = String(decoding: data, as: UTF8.self)
        // 结尾换行是终止符不算一行（与 diffModel.diffContentLines 同规则）
        let body = text.hasSuffix("\n") ? String(text.dropLast()) : text
        return LineCount(added: body.split(separator: "\n", omittingEmptySubsequences: false).count,
                         removed: 0, binary: false)
    }

    // MARK: - 取数

    /// 「未暂存」档的改动清单。返回 nil = 这不是 git 仓库 / git 不可用 / 命令超时
    /// （前端一律按"没有 git 数据"处理，不报错——与 runGit 的 repo:false 同义）。
    static func fetchChanges(at path: String) -> ChangeSet? {
        guard let branch = run(["rev-parse", "--abbrev-ref", "HEAD"], at: path),
              branch.status == 0 else { return nil }
        let name = branch.output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty,
              let status = run(["status", "--porcelain=v2", "-z", "--untracked-files=all"], at: path),
              status.status == 0,
              let numstat = run(["diff", "--numstat", "-z", "--find-renames", "--"], at: path),
              numstat.status == 0 else { return nil }

        let counts = parseNumstat(numstat.output)
        var files: [Change] = []
        for entry in parseStatusPorcelain(status.output) where entry.unstaged {
            // 未跟踪没有 numstat 条目，自己数行；其余取 numstat 的 +N −M
            let count = entry.kind == .untracked
                ? countUntrackedLines(at: (path as NSString).appendingPathComponent(entry.path))
                : (counts[entry.path] ?? LineCount(added: 0, removed: 0, binary: false))
            files.append(Change(path: entry.path, originalPath: entry.originalPath, kind: entry.kind,
                                added: count.added, removed: count.removed, binary: count.binary))
        }
        return ChangeSet(branch: name, files: files.sorted { $0.path < $1.path })
    }

    /// 单文件 diff。`file` 来自 fetchChanges 的清单（同一次 git status 的产物），
    /// 因此这里不再校验它是否在清单内。
    static func fetchDiff(at path: String, file: String) -> FileDiff {
        guard let out = run(["diff", "--no-color", "-U3", "--find-renames", "--", file], at: path),
              out.status == 0 else {
            return FileDiff(kind: .unavailable, patch: nil, content: nil)
        }
        // patch 为空 ⇒ 未跟踪：git 根本不看未跟踪文件，于是没有任何 diff 可给
        guard !out.output.isEmpty else {
            guard let text = readWorktree(at: path, file: file) else {
                return FileDiff(kind: .binary, patch: nil, content: nil)
            }
            return FileDiff(kind: .untracked, patch: nil, content: text)
        }
        if out.output.contains("Binary files ") || out.output.contains("GIT binary patch") {
            return FileDiff(kind: .binary, patch: nil, content: nil)
        }
        if out.output.count > maxPatchChars {
            return FileDiff(kind: .truncated, patch: nil, content: nil)
        }
        return FileDiff(kind: .patch, patch: out.output, content: readWorktree(at: path, file: file))
    }

    /// 工作树里该文件的当前全文；二进制/超限/已被删掉（删除态就是读不到）时 nil。
    private static func readWorktree(at path: String, file: String) -> String? {
        let full = (path as NSString).appendingPathComponent(file)
        guard let data = FileManager.default.contents(atPath: full),
              data.count <= maxFileBytes,
              !data.contains(0) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /// nil = 目录不存在 / 起不动 git / 超时（都归"git 不可用"）；非 nil 但 status != 0
    /// 是"git 跑了并报错"，调用点自行分辨。
    private static func run(_ args: [String], at path: String) -> ProcessRunner.Result? {
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        let result = ProcessRunner.run(executable: executable, arguments: args,
                                       workingDirectory: path, timeout: timeout)
        return result.timedOut ? nil : result
    }

    // MARK: - 小工具

    private static func cols(_ record: String, splits: Int) -> [String] {
        record.split(separator: " ", maxSplits: splits, omittingEmptySubsequences: true)
            .map(String.init)
    }

    private static func entry(xy: String, path: String, originalPath: String?, unmerged: Bool) -> StatusEntry {
        // XY 两字符：X = HEAD→index（已暂存），Y = index→worktree（未暂存）；"." 表示该侧没动
        let staged = xy.first
        let unstaged = xy.dropFirst().first
        let kind: ChangeKind
        if unmerged { kind = .conflicted }
        else if originalPath != nil { kind = .renamed }
        else if staged == "A" { kind = .added }
        else if unstaged == "D" { kind = .deleted }
        else { kind = .modified }
        return StatusEntry(path: path, originalPath: originalPath, kind: kind,
                           unstaged: unstaged != nil && unstaged != ".")
    }
}
