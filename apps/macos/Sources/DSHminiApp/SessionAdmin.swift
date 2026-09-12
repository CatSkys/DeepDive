// 会话数据维护：取消归档 / 删除（用户定稿功能）。
//
// 为什么由壳来做：引脚的引擎 wire 面只有 `workspace/archiveSession`（单向），
// 既没有取消归档也没有删除会话的方法——官方自己的 README 也写着 “No Session
// deletion or unarchive control”。而归档集与会话日志都是 DSH_HOME 下的普通文件：
//   归档集 = storages/workspace.json 的 global.archivedSessionIds
//   会话日志 = sessions/<转义 cwd>/<sessionId>/（session*.jsonl.zstd + lock）
//   投影缓存 = storages/session_projcache.json 的 tables.sessions[<id>]
// 于是：取消归档 = 从归档集摘掉；删除 = 摘归档项 + 清投影缓存 + 删日志目录。
//
// 纪律（PITFALLS §4.15）：引擎运行期在内存持有这些状态、下次 setState 会整份
// 覆写文件，所以**只能在引擎停止时改**（调用方负责停机窗口）；JSON 结构不符
// 预期一律不写、fail-loud 报错，不做“尽量修一修”的兜底。

import Foundation

enum SessionAdmin {
    struct Result: Equatable {
        /** 实际处理成功的 sessionId（删目录失败的计入 error，不计入这里）。 */
        var removed: [String]
        var error: String?
    }

    // MARK: - 对外操作

    /** 取消归档：只摘 archivedSessionIds（会话日志原样保留）。 */
    static func unarchive(sessionIds: [String], home: URL) -> Result {
        let ids = Set(sessionIds)
        let url = home.appendingPathComponent("storages/workspace.json")
        guard let state = readJSON(url) else {
            return Result(removed: [], error: "无法读取 workspace 状态文件")
        }
        guard let next = removingArchived(ids, from: state) else {
            return Result(removed: [], error: "workspace 状态结构不符预期，已放弃写入")
        }
        guard writeJSON(next, to: url) else {
            return Result(removed: [], error: "无法写入 workspace 状态文件")
        }
        return Result(removed: Array(ids), error: nil)
    }

    /** 删除：摘归档项 + 清投影缓存 + 删日志目录（先改状态再删文件，失败不回滚已成功的部分）。 */
    static func delete(sessionIds: [String], home: URL) -> Result {
        let ids = Set(sessionIds)
        var removed: [String] = []
        var errors: [String] = []
        let workspaceURL = home.appendingPathComponent("storages/workspace.json")
        if let state = readJSON(workspaceURL), let next = removingArchived(ids, from: state) {
            if !writeJSON(next, to: workspaceURL) { errors.append("workspace 状态写入失败") }
        } else {
            errors.append("workspace 状态不可用")
        }
        let cacheURL = home.appendingPathComponent("storages/session_projcache.json")
        if let state = readJSON(cacheURL), let next = removingProjections(ids, from: state) {
            if !writeJSON(next, to: cacheURL) { errors.append("投影缓存写入失败") }
        }
        for dir in sessionDirectories(in: home, sessionIds: ids) {
            do {
                try FileManager.default.removeItem(at: dir)
                removed.append(dir.lastPathComponent)
            } catch {
                errors.append("\(dir.lastPathComponent): \(error.localizedDescription)")
            }
        }
        return Result(removed: removed, error: errors.isEmpty ? nil : errors.joined(separator: "; "))
    }

    // MARK: - 纯函数（单测钉子）

    /** 摘掉归档集里的这些 id；结构不符预期回 nil（调用方不写盘）。 */
    static func removingArchived(_ ids: Set<String>, from state: [String: Any]) -> [String: Any]? {
        guard let global = state["global"] as? [String: Any],
              let archived = global["archivedSessionIds"] as? [String] else { return nil }
        var nextGlobal = global
        nextGlobal["archivedSessionIds"] = archived.filter { !ids.contains($0) }
        var next = state
        next["global"] = nextGlobal
        return next
    }

    /** 清掉投影缓存里这些会话的条目；缺 tables.sessions（新装/无缓存）回原状态。 */
    static func removingProjections(_ ids: Set<String>, from state: [String: Any]) -> [String: Any]? {
        guard let tables = state["tables"] as? [String: Any] else { return nil }
        guard var sessions = tables["sessions"] as? [String: Any] else { return state }
        for id in ids { sessions.removeValue(forKey: id) }
        var nextTables = tables
        nextTables["sessions"] = sessions
        var next = state
        next["tables"] = nextTables
        return next
    }

    /** 会话日志目录：sessions/<转义 cwd>/<sessionId>/（目录名就是 sessionId，
     *  不去复刻引擎的 cwd 转义规则，直接扫一层找同名目录）。 */
    static func sessionDirectories(in home: URL, sessionIds: Set<String>) -> [URL] {
        let root = home.appendingPathComponent("sessions", isDirectory: true)
        guard let buckets = try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles],
        ) else { return [] }
        var hits: [URL] = []
        for bucket in buckets {
            for id in sessionIds {
                let dir = bucket.appendingPathComponent(id, isDirectory: true)
                var isDir: ObjCBool = false
                if FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue {
                    hits.append(dir)
                }
            }
        }
        return hits
    }

    // MARK: - 文件读写

    private static func readJSON(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /** 原子写（临时文件 + 替换）：写坏引擎状态文件的代价太高。 */
    private static func writeJSON(_ state: [String: Any], to url: URL) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: state) else { return false }
        let tmp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).tmp")
        do {
            try data.write(to: tmp)
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
            return true
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            return false
        }
    }
}
